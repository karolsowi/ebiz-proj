import fetch from 'node-fetch';
import { getTrackedSymbolsForPriceSync, priceService } from './databaseService.js';

interface ParsedStooqData {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UpdateProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  totalSymbols: number;
  completedSymbols: number;
  failedSymbols: number;
  skippedSymbols: number;
  totalRecordsAdded: number;
  currentSymbol: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errors: string[];
}

class StooqService {
  private readonly baseUrl = 'https://stooq.pl/q/d/l/';
  private progress: UpdateProgress = this.createEmptyProgress();

  private createEmptyProgress(): UpdateProgress {
    return {
      status: 'idle',
      totalSymbols: 0,
      completedSymbols: 0,
      failedSymbols: 0,
      skippedSymbols: 0,
      totalRecordsAdded: 0,
      currentSymbol: null,
      startedAt: null,
      completedAt: null,
      errors: [],
    };
  }

  /**
   * Get current update progress
   */
  getUpdateProgress(): UpdateProgress {
    return { ...this.progress };
  }

  /**
   * Download historical CSV data for a US stock symbol from Stooq
   * @param symbol Stock symbol (e.g., 'AAPL')
   * @param interval Data interval ('d' for daily)
   * @param minDate Optional minimum date to include (filters client-side after download)
   */
  async downloadHistoricalData(
    symbol: string,
    interval: 'd' | 'w' | 'm' = 'd',
    minDate?: Date
  ): Promise<ParsedStooqData[]> {
    const stooqSymbol = `${symbol.toLowerCase()}.us`;
    const apiKey = process.env.STOOQ_API_KEY?.trim();
    let url = `${this.baseUrl}?s=${stooqSymbol}&i=${interval}`;
    if (apiKey) {
      url += `&apikey=${encodeURIComponent(apiKey)}`;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`Stooq API error: ${response.status} ${response.statusText}`);
    }

    const csvData = await response.text();
    this.assertStooqCsvOrExplainGate(csvData, symbol);

    let records = this.parseCsvData(csvData);

    // Filter to only include records from year 2000+ (or minDate if specified)
    const cutoff = minDate ?? new Date('2000-01-01');
    records = records.filter(r => r.date >= cutoff);

    return records;
  }

  private assertStooqCsvOrExplainGate(body: string, symbol: string): void {
    const head = body.trim().split('\n')[0] ?? '';
    const looksLikeCsv = /^Date/i.test(head) || /Open|High|Low|Close/i.test(head);
    if (looksLikeCsv) return;

    if (/apikey|Uzyskaj apikey/i.test(body)) {
      throw new Error(
        `Stooq blocked CSV for ${symbol}: set STOOQ_API_KEY in backend/.env ` +
          `(get a key from https://stooq.pl/q/d/?s=${encodeURIComponent(symbol.toLowerCase())}.us&get_apikey )`
      );
    }

    if (/Przekroczony|dzienny limit|daily limit|limit wywo/i.test(body)) {
      throw new Error(
        `Stooq daily request limit exceeded (${symbol}). Wait for the limit to reset or reduce bulk jobs; ` +
          'response: ' + body.trim().slice(0, 120)
      );
    }

    throw new Error(
      `Stooq returned non-CSV for ${symbol}: ` + body.trim().slice(0, 200)
    );
  }

  /**
   * Parse CSV data from Stooq into structured format
   */
  private parseCsvData(csvData: string): ParsedStooqData[] {
    const lines = csvData.trim().split('\n');
    if (lines.length <= 1) {
      return []; // No data rows
    }

    const dataLines = lines.slice(1); // Skip header
    const records: ParsedStooqData[] = [];

    for (const line of dataLines) {
      const parts = line.trim().split(',');
      if (parts.length < 5) continue;

      const [dateStr, openStr, highStr, lowStr, closeStr, volumeStr] = parts;
      if (!dateStr || !openStr || !highStr || !lowStr || !closeStr) continue;

      const date = new Date(dateStr);
      const open = parseFloat(openStr);
      const high = parseFloat(highStr);
      const low = parseFloat(lowStr);
      const close = parseFloat(closeStr);
      const volume = parseInt(volumeStr || '0') || 0;

      if (isNaN(date.getTime()) || isNaN(open) || isNaN(close)) continue;

      records.push({ date, open, high, low, close, volume });
    }

    records.sort((a, b) => a.date.getTime() - b.date.getTime());
    return records;
  }

  /**
   * Download and store historical data for a single symbol (full download from year 2000)
   */
  async downloadAndStoreHistoricalData(
    symbol: string
  ): Promise<{ success: boolean; recordsAdded: number; recordsSkipped: number }> {
    try {
      const historicalData = await this.downloadHistoricalData(symbol, 'd');
      if (historicalData.length === 0) {
        return { success: true, recordsAdded: 0, recordsSkipped: 0 };
      }

      let recordsAdded = 0;

      // Batch store — storePriceData uses onConflictDoUpdate, so duplicates are safe
      for (const record of historicalData) {
        try {
          await priceService.storePriceData({
            symbol: symbol.toUpperCase(),
            date: record.date,
            open: record.open.toString(),
            high: record.high.toString(),
            low: record.low.toString(),
            close: record.close.toString(),
            volume: record.volume,
            source: 'Stooq',
          });
          recordsAdded++;
        } catch {
          // Silently skip individual record failures (e.g., constraint violations)
        }
      }

      return { success: true, recordsAdded, recordsSkipped: historicalData.length - recordsAdded };
    } catch (error) {
      console.error(`❌ Failed to download/store data for ${symbol}:`, error);
      return { success: false, recordsAdded: 0, recordsSkipped: 0 };
    }
  }

  /**
   * Incremental download: checks the latest date in the DB for a symbol,
   * then downloads only missing data from the day after to today.
   */
  async downloadAndStoreIncremental(
    symbol: string
  ): Promise<{ success: boolean; recordsAdded: number; skipped: boolean }> {
    try {
      // Find the latest date we already have for this symbol
      const existing = await priceService.getPriceHistory(symbol.toUpperCase(), undefined, undefined, 'daily');

      let dateFrom: Date = new Date('2000-01-01');
      if (existing.length > 0) {
        const latestDate = existing[0]!.date; // getPriceHistory returns desc order
        const ageHours = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60);

        // If latest data is less than 20 hours old (same trading day), skip
        if (ageHours < 20) {
          return { success: true, recordsAdded: 0, skipped: true };
        }

        // Start from the day after the latest date we have
        dateFrom = new Date(latestDate);
        dateFrom.setDate(dateFrom.getDate() + 1);
      }

      const data = await this.downloadHistoricalData(symbol, 'd', dateFrom);
      if (data.length === 0) {
        return { success: true, recordsAdded: 0, skipped: false };
      }

      let recordsAdded = 0;
      for (const record of data) {
        try {
          await priceService.storePriceData({
            symbol: symbol.toUpperCase(),
            date: record.date,
            open: record.open.toString(),
            high: record.high.toString(),
            low: record.low.toString(),
            close: record.close.toString(),
            volume: record.volume,
            source: 'Stooq',
          });
          recordsAdded++;
        } catch {
          // Skip individual failures
        }
      }

      return { success: true, recordsAdded, skipped: false };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Incremental update failed for ${symbol}: ${msg}`);
      return { success: false, recordsAdded: 0, skipped: false };
    }
  }

  /**
   * Incremental Stooq sync for a symbol list (respectful delay between requests).
   * First run per symbol with no DB rows still pulls full history via downloadAndStoreIncremental.
   */
  async runIncrementalForSymbols(
    symbols: string[],
    options?: { delayMs?: number; logLabel?: string }
  ): Promise<{ totalRecords: number; skipped: number; failed: number }> {
    const delayMs = Math.max(50, options?.delayMs ?? 450);
    const label = options?.logLabel ?? 'symbols';

    if (symbols.length === 0) {
      console.log(`📊 Stooq incremental (${label}): no symbols — add portfolio or watchlist entries.`);
      return { totalRecords: 0, skipped: 0, failed: 0 };
    }

    console.log(`🔄 Stooq incremental (${label}): ${symbols.length} symbol(s), ${delayMs}ms between requests...`);

    let totalRecords = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i]!;
      try {
        const result = await this.downloadAndStoreIncremental(symbol);
        if (result.skipped) skipped++;
        else totalRecords += result.recordsAdded;
        if (!result.success) failed++;
      } catch {
        failed++;
      }
      if (i < symbols.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    console.log(
      `✅ Stooq incremental (${label}) done: +${totalRecords} rows, skipped ${skipped}, failed ${failed}`
    );
    return { totalRecords, skipped, failed };
  }

  /**
   * Portfolio + watchlist symbols from DB. Skips if STOOQ_API_KEY is unset (gate page — set key once after Stooq captcha).
   */
  async runStartupIncrementalForTrackedSymbols(options?: { delayMs?: number }): Promise<void> {
    if (!process.env.STOOQ_API_KEY?.trim()) {
      console.warn(
        '⚠️ STOOQ_API_KEY not set — skipping incremental price sync. ' +
          'Visit Stooq once: complete captcha to get an apikey, paste into backend/.env; ' +
          'after that, requests use the key (no repeated captcha).'
      );
      return;
    }

    const symbols = await getTrackedSymbolsForPriceSync();
    const incOpts =
      options?.delayMs != null
        ? { delayMs: options.delayMs, logLabel: 'portfolio+watchlist' as const }
        : { logLabel: 'portfolio+watchlist' as const };
    await this.runIncrementalForSymbols(symbols, incOpts);
  }

  /**
   * Update all S&P 500 symbols incrementally.
   * On first run, downloads full history from year 2000.
   * On subsequent runs, only downloads missing days.
   */
  async updateAllSP500(delayMs: number = 1000): Promise<void> {
    if (!process.env.STOOQ_API_KEY?.trim()) {
      console.warn(
        '⚠️ STOOQ_API_KEY not set — skipping S&P 500 update. Obtain key from Stooq once (captcha), then set in .env.'
      );
      return;
    }
    if (this.progress.status === 'running') {
      console.log('⚠️ S&P 500 update already running, skipping.');
      return;
    }

    const symbols = this.getSP500Symbols();
    this.progress = {
      status: 'running',
      totalSymbols: symbols.length,
      completedSymbols: 0,
      failedSymbols: 0,
      skippedSymbols: 0,
      totalRecordsAdded: 0,
      currentSymbol: null,
      startedAt: new Date(),
      completedAt: null,
      errors: [],
    };

    console.log(`🔄 Starting S&P 500 data update for ${symbols.length} symbols...`);

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i]!;
      this.progress.currentSymbol = symbol;

      try {
        const result = await this.downloadAndStoreIncremental(symbol);

        if (result.skipped) {
          this.progress.skippedSymbols++;
        } else {
          this.progress.totalRecordsAdded += result.recordsAdded;
        }

        if (result.success) {
          this.progress.completedSymbols++;
        } else {
          this.progress.failedSymbols++;
          this.progress.errors.push(`${symbol}: download failed`);
        }

        // Log progress every 25 symbols
        if ((i + 1) % 25 === 0) {
          console.log(
            `📊 S&P 500 update progress: ${i + 1}/${symbols.length} | ` +
            `Added: ${this.progress.totalRecordsAdded} records | ` +
            `Skipped: ${this.progress.skippedSymbols} | Failed: ${this.progress.failedSymbols}`
          );
        }
      } catch (error) {
        this.progress.failedSymbols++;
        const msg = error instanceof Error ? error.message : String(error);
        this.progress.errors.push(`${symbol}: ${msg}`);
      }

      // Delay between requests to be respectful to stooq.pl
      if (i < symbols.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.progress.status = 'completed';
    this.progress.currentSymbol = null;
    this.progress.completedAt = new Date();

    const elapsed = ((this.progress.completedAt.getTime() - this.progress.startedAt!.getTime()) / 1000 / 60).toFixed(1);
    console.log(`🎉 S&P 500 update completed in ${elapsed} minutes:`);
    console.log(`   ✅ Successful: ${this.progress.completedSymbols}`);
    console.log(`   ⏭️ Skipped (up to date): ${this.progress.skippedSymbols}`);
    console.log(`   ❌ Failed: ${this.progress.failedSymbols}`);
    console.log(`   📊 Total records added: ${this.progress.totalRecordsAdded}`);
  }

  /**
   * Download historical data for multiple symbols (legacy method)
   */
  async downloadMultipleStocks(symbols: string[], delayMs: number = 1000): Promise<void> {
    console.log(`🚀 Starting bulk download for ${symbols.length} stocks...`);

    let successful = 0;
    let failed = 0;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      if (!symbol) continue;

      try {
        console.log(`📈 [${i + 1}/${symbols.length}] Processing ${symbol}...`);
        const result = await this.downloadAndStoreHistoricalData(symbol);
        if (result.success) successful++;
        else failed++;
      } catch {
        failed++;
      }

      if (i < symbols.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`🎉 Bulk download completed: ✅ ${successful} | ❌ ${failed}`);
  }

  /**
   * Auto-download historical data when a new stock is requested
   */
  async autoDownloadForSymbol(symbol: string): Promise<boolean> {
    try {
      const existingData = await priceService.getPriceHistory(symbol, undefined, undefined, 'daily');

      if (existingData.length > 100) {
        console.log(`📊 ${symbol} already has ${existingData.length} records, skipping.`);
        return true;
      }

      console.log(`🔄 Auto-downloading historical data for ${symbol}...`);
      const result = await this.downloadAndStoreHistoricalData(symbol);
      return result.success;
    } catch (error) {
      console.error(`Failed to auto-download data for ${symbol}:`, error);
      return false;
    }
  }

  /**
   * Get the top 100 US stocks by market cap (legacy method, kept for compatibility)
   */
  getTop100USStocks(): string[] {
    return this.getSP500Symbols().slice(0, 100);
  }

  /**
   * Full S&P 500 constituent list (as of early 2026)
   */
  getSP500Symbols(): string[] {
    return [
      // Technology
      'AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN',
      'IBM', 'INTU', 'TXN', 'QCOM', 'AMAT', 'NOW', 'PANW', 'ADI', 'LRCX', 'MU',
      'KLAC', 'SNPS', 'CDNS', 'MCHP', 'ON', 'FTNT', 'HPQ', 'HPE', 'KEYS', 'ANSS',
      'MPWR', 'FSLR', 'TER', 'SWKS', 'PTC', 'ZBRA', 'TRMB', 'GEN', 'JNPR', 'NTAP',
      'AKAM', 'FFIV', 'EPAM',

      // Communication Services
      'META', 'GOOGL', 'GOOG', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR',
      'EA', 'TTWO', 'WBD', 'PARA', 'OMC', 'IPG', 'MTCH', 'FOXA', 'FOX', 'LYV',
      'NWSA', 'NWS',

      // Consumer Discretionary
      'AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'BKNG', 'TJX', 'SBUX', 'CMG',
      'ABNB', 'ORLY', 'ROST', 'MAR', 'HLT', 'GM', 'F', 'DHI', 'LEN', 'AZO',
      'GPC', 'ULTA', 'EBAY', 'ETSY', 'YUM', 'DPZ', 'POOL', 'BBY', 'TSCO',
      'PHM', 'NVR', 'DRI', 'LVS', 'WYNN', 'CZR', 'MGM', 'HAS', 'APTV', 'BWA',
      'GRMN', 'DECK', 'EXPE', 'RCL', 'CCL', 'NCLH', 'TPR', 'RL', 'PVH', 'WHR',
      'KMX',

      // Consumer Staples
      'PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL', 'ADM',
      'KMB', 'GIS', 'SYY', 'STZ', 'HSY', 'KHC', 'KR', 'MNST', 'EL', 'CAG',
      'K', 'MKC', 'TSN', 'SJM', 'HRL', 'CPB', 'CLX', 'TAP', 'BF.B', 'CHD',
      'LW',

      // Energy
      'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'PXD', 'OKE',
      'WMB', 'HAL', 'HES', 'DVN', 'BKR', 'KMI', 'FANG', 'CTRA', 'TRGP', 'OXY',
      'MRO', 'APA',

      // Financials
      'BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'SPGI', 'BLK',
      'C', 'AXP', 'SCHW', 'CB', 'MMC', 'PGR', 'ICE', 'CME', 'AON', 'MCO',
      'MET', 'AIG', 'TRV', 'AJG', 'AFL', 'MSCI', 'ALL', 'PRU', 'FIS', 'NDAQ',
      'COF', 'USB', 'PNC', 'TFC', 'BK', 'FI', 'STT', 'FITB', 'MTB', 'HBAN',
      'RF', 'CFG', 'KEY', 'NTRS', 'CINF', 'L', 'BRO', 'WRB', 'RJF', 'CBOE',
      'MKTX', 'RE', 'GL', 'IVZ', 'BEN', 'ZION',

      // Health Care
      'UNH', 'JNJ', 'LLY', 'ABBV', 'PFE', 'TMO', 'MRK', 'ABT', 'DHR', 'BMY',
      'AMGN', 'MDT', 'GILD', 'ISRG', 'SYK', 'VRTX', 'CI', 'CVS', 'REGN', 'ELV',
      'BSX', 'ZTS', 'HCA', 'BDX', 'IDXX', 'HUM', 'EW', 'GEHC', 'A', 'IQV',
      'DXCM', 'MTD', 'BAX', 'LH', 'HOLX', 'RMD', 'ALGN', 'WST', 'COO', 'PODD',
      'RVTY', 'TFX', 'TECH', 'MOH', 'CNC', 'CAH', 'MCK', 'ABC', 'VTRS', 'OGN',
      'XRAY', 'DGX', 'BIO', 'HSIC', 'INCY', 'CRL',

      // Industrials
      'CAT', 'GE', 'RTX', 'HON', 'UNP', 'UPS', 'BA', 'DE', 'LMT', 'ADP',
      'NOC', 'GD', 'MMM', 'ITW', 'WM', 'EMR', 'FDX', 'ETN', 'TT', 'NSC',
      'CSX', 'PCAR', 'GWW', 'CTAS', 'PAYX', 'JCI', 'FAST', 'OTIS', 'AME', 'CARR',
      'RSG', 'VRSK', 'IR', 'ROK', 'DOV', 'XYL', 'WAB', 'DAL', 'LUV', 'UAL',
      'CPRT', 'PWR', 'J', 'LDOS', 'TXT', 'SNA', 'MAS', 'IEX', 'PNR', 'SWK',
      'HWM', 'AXON', 'HII', 'NDSN', 'RHI', 'CHRW', 'EXPD', 'JBHT', 'PAYC', 'ALLE',
      'GNRC', 'EFX', 'BR', 'ROP',

      // Materials
      'LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM', 'NUE', 'DOW', 'DD', 'PPG',
      'VMC', 'MLM', 'CTVA', 'BALL', 'AVY', 'IFF', 'CF', 'ALB', 'FMC', 'CE',
      'EMN', 'PKG', 'IP', 'SEE', 'AMCR', 'MOS',

      // Real Estate
      'PLD', 'AMT', 'CCI', 'EQIX', 'PSA', 'O', 'DLR', 'WELL', 'SPG', 'VICI',
      'AVB', 'EQR', 'WY', 'SBAC', 'VTR', 'IRM', 'MAA', 'ARE', 'ESS', 'EXR',
      'INVH', 'KIM', 'REG', 'CPT', 'HST', 'BXP', 'UDR', 'PEAK', 'FRT',

      // Utilities
      'NEE', 'SO', 'DUK', 'D', 'SRE', 'AEP', 'CEG', 'EXC', 'XEL', 'PCG',
      'ED', 'WEC', 'EIX', 'AWK', 'DTE', 'PPL', 'ETR', 'ES', 'FE', 'AEE',
      'ATO', 'CNP', 'CMS', 'NI', 'EVRG', 'PNW', 'NRG', 'LNT',

      // Additional large-cap / recently added
      'PYPL', 'SQ', 'COIN', 'MRVL', 'CRWD', 'ZS', 'NET', 'DDOG', 'SNOW', 'PLTR',
      'ARM', 'SMCI', 'CEG', 'CBRE', 'TROW', 'WDAY', 'TEAM', 'VEEV', 'SPLK', 'IT',
      'VRSN', 'WDC', 'STX', 'SEDG',
    ];
  }
}

export const stooqService = new StooqService();