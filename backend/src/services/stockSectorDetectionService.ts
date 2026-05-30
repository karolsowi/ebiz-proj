/**
 * Stock and Sector Detection Service
 * Identifies mentions of specific stocks, ETFs, and market sectors in text content
 */

export interface StockMention {
  symbol: string;
  company: string;
  sector: string;
  mentions: number;
  contexts: string[]; // Surrounding text context
  confidence: number; // 0-1 confidence score
}

export interface SectorMention {
  sector: string;
  mentions: number;
  relatedStocks: string[];
  contexts: string[];
  confidence: number;
}

export interface DetectionResult {
  stocks: StockMention[];
  sectors: SectorMention[];
  hasFinancialContent: boolean;
  overallRelevance: number; // 0-1 relevance to financial markets
}

export class StockSectorDetectionService {
  private stockDatabase: Map<string, { company: string; sector: string; aliases: string[] }>;
  private sectorKeywords: Map<string, string[]>;
  private financialTerms: Set<string>;
  private readonly tickerStoplist: Set<string>;
  private readonly nicknameMap: Map<string, string>;

  constructor() {
    this.stockDatabase = new Map();
    this.sectorKeywords = new Map();
    this.financialTerms = new Set();
    this.tickerStoplist = new Set(['DD', 'ATH', 'YOLO']);
    this.nicknameMap = new Map([
      ['the mouse', 'DIS'],
      ['j-pow', 'SPY'],
      ['jpow', 'SPY'],
      ['zuck', 'META'],
    ]);
    this.initializeStockDatabase();
    this.initializeSectorKeywords();
    this.initializeFinancialTerms();
  }

  private initializeStockDatabase() {
    // Comprehensive stock database covering S&P 500 top constituents + popular stocks
    const stocks = [
      // ── Technology ──
      { symbol: 'AAPL', company: 'Apple Inc.', sector: 'Technology', aliases: ['Apple', 'AAPL', 'iPhone', 'iPad', 'Mac', 'MacBook', 'Apple Vision'] },
      { symbol: 'MSFT', company: 'Microsoft Corporation', sector: 'Technology', aliases: ['Microsoft', 'MSFT', 'Windows', 'Azure', 'Office', 'Copilot'] },
      { symbol: 'GOOGL', company: 'Alphabet Inc.', sector: 'Technology', aliases: ['Google', 'GOOGL', 'GOOG', 'Alphabet', 'YouTube', 'Android', 'Waymo', 'Gemini AI'] },
      { symbol: 'AMZN', company: 'Amazon.com Inc.', sector: 'Technology', aliases: ['Amazon', 'AMZN', 'AWS', 'Prime', 'Alexa'] },
      { symbol: 'META', company: 'Meta Platforms Inc.', sector: 'Technology', aliases: ['Meta', 'META', 'Facebook', 'Instagram', 'WhatsApp', 'Threads', 'Oculus'] },
      { symbol: 'TSLA', company: 'Tesla Inc.', sector: 'Technology', aliases: ['Tesla', 'TSLA', 'Elon', 'Model 3', 'Model Y', 'Cybertruck', 'FSD'] },
      { symbol: 'NVDA', company: 'NVIDIA Corporation', sector: 'Technology', aliases: ['NVIDIA', 'NVDA', 'AI chips', 'GPU', 'GeForce', 'CUDA', 'H100', 'Blackwell'] },
      { symbol: 'NFLX', company: 'Netflix Inc.', sector: 'Technology', aliases: ['Netflix', 'NFLX'] },
      { symbol: 'AVGO', company: 'Broadcom Inc.', sector: 'Technology', aliases: ['Broadcom', 'AVGO'] },
      { symbol: 'ADBE', company: 'Adobe Inc.', sector: 'Technology', aliases: ['Adobe', 'ADBE', 'Photoshop'] },
      { symbol: 'CRM', company: 'Salesforce Inc.', sector: 'Technology', aliases: ['Salesforce', 'CRM'] },
      { symbol: 'AMD', company: 'Advanced Micro Devices Inc.', sector: 'Technology', aliases: ['AMD', 'Ryzen', 'Radeon', 'EPYC'] },
      { symbol: 'INTC', company: 'Intel Corporation', sector: 'Technology', aliases: ['Intel', 'INTC'] },
      { symbol: 'ORCL', company: 'Oracle Corporation', sector: 'Technology', aliases: ['Oracle', 'ORCL'] },
      { symbol: 'CSCO', company: 'Cisco Systems Inc.', sector: 'Technology', aliases: ['Cisco', 'CSCO'] },
      { symbol: 'IBM', company: 'International Business Machines', sector: 'Technology', aliases: ['IBM', 'Watson'] },
      { symbol: 'NOW', company: 'ServiceNow Inc.', sector: 'Technology', aliases: ['ServiceNow', 'NOW'] },
      { symbol: 'QCOM', company: 'Qualcomm Inc.', sector: 'Technology', aliases: ['Qualcomm', 'QCOM', 'Snapdragon'] },
      { symbol: 'TXN', company: 'Texas Instruments Inc.', sector: 'Technology', aliases: ['Texas Instruments', 'TXN'] },
      { symbol: 'INTU', company: 'Intuit Inc.', sector: 'Technology', aliases: ['Intuit', 'INTU', 'TurboTax', 'QuickBooks'] },
      { symbol: 'AMAT', company: 'Applied Materials Inc.', sector: 'Technology', aliases: ['Applied Materials', 'AMAT'] },
      { symbol: 'MU', company: 'Micron Technology Inc.', sector: 'Technology', aliases: ['Micron', 'MU'] },
      { symbol: 'LRCX', company: 'Lam Research Corp.', sector: 'Technology', aliases: ['Lam Research', 'LRCX'] },
      { symbol: 'KLAC', company: 'KLA Corporation', sector: 'Technology', aliases: ['KLA', 'KLAC'] },
      { symbol: 'SNPS', company: 'Synopsys Inc.', sector: 'Technology', aliases: ['Synopsys', 'SNPS'] },
      { symbol: 'CDNS', company: 'Cadence Design Systems', sector: 'Technology', aliases: ['Cadence', 'CDNS'] },
      { symbol: 'PANW', company: 'Palo Alto Networks', sector: 'Technology', aliases: ['Palo Alto', 'PANW'] },
      { symbol: 'CRWD', company: 'CrowdStrike Holdings', sector: 'Technology', aliases: ['CrowdStrike', 'CRWD'] },
      { symbol: 'SNOW', company: 'Snowflake Inc.', sector: 'Technology', aliases: ['Snowflake', 'SNOW'] },
      { symbol: 'PLTR', company: 'Palantir Technologies', sector: 'Technology', aliases: ['Palantir', 'PLTR'] },
      { symbol: 'SHOP', company: 'Shopify Inc.', sector: 'Technology', aliases: ['Shopify', 'SHOP'] },
      { symbol: 'SQ', company: 'Block Inc.', sector: 'Technology', aliases: ['Block', 'Square', 'SQ', 'Cash App'] },
      { symbol: 'UBER', company: 'Uber Technologies', sector: 'Technology', aliases: ['Uber', 'UBER'] },
      { symbol: 'ABNB', company: 'Airbnb Inc.', sector: 'Technology', aliases: ['Airbnb', 'ABNB'] },
      { symbol: 'NET', company: 'Cloudflare Inc.', sector: 'Technology', aliases: ['Cloudflare', 'NET'] },
      { symbol: 'DDOG', company: 'Datadog Inc.', sector: 'Technology', aliases: ['Datadog', 'DDOG'] },
      { symbol: 'ZS', company: 'Zscaler Inc.', sector: 'Technology', aliases: ['Zscaler', 'ZS'] },
      { symbol: 'MRVL', company: 'Marvell Technology', sector: 'Technology', aliases: ['Marvell', 'MRVL'] },
      { symbol: 'ARM', company: 'Arm Holdings', sector: 'Technology', aliases: ['Arm', 'ARM'] },
      { symbol: 'SMCI', company: 'Super Micro Computer', sector: 'Technology', aliases: ['Super Micro', 'SMCI', 'Supermicro'] },
      { symbol: 'DELL', company: 'Dell Technologies', sector: 'Technology', aliases: ['Dell', 'DELL'] },
      { symbol: 'HPE', company: 'Hewlett Packard Enterprise', sector: 'Technology', aliases: ['HPE', 'Hewlett Packard'] },
      { symbol: 'MSTR', company: 'MicroStrategy Incorporated', sector: 'Technology', aliases: ['MicroStrategy', 'MSTR'] },

      // ── Financial Services ──
      { symbol: 'JPM', company: 'JPMorgan Chase & Co.', sector: 'Financial Services', aliases: ['JPMorgan', 'JPM', 'Chase', 'JP Morgan'] },
      { symbol: 'BAC', company: 'Bank of America Corp', sector: 'Financial Services', aliases: ['Bank of America', 'BAC', 'BofA'] },
      { symbol: 'WFC', company: 'Wells Fargo & Company', sector: 'Financial Services', aliases: ['Wells Fargo', 'WFC'] },
      { symbol: 'GS', company: 'Goldman Sachs Group Inc.', sector: 'Financial Services', aliases: ['Goldman Sachs', 'GS', 'Goldman'] },
      { symbol: 'MS', company: 'Morgan Stanley', sector: 'Financial Services', aliases: ['Morgan Stanley', 'MS'] },
      { symbol: 'V', company: 'Visa Inc.', sector: 'Financial Services', aliases: ['Visa'] },
      { symbol: 'MA', company: 'Mastercard Inc.', sector: 'Financial Services', aliases: ['Mastercard', 'MA'] },
      { symbol: 'BRK.B', company: 'Berkshire Hathaway', sector: 'Financial Services', aliases: ['Berkshire', 'Berkshire Hathaway', 'BRK', 'Buffett', 'Warren Buffett'] },
      { symbol: 'BLK', company: 'BlackRock Inc.', sector: 'Financial Services', aliases: ['BlackRock', 'BLK'] },
      { symbol: 'SCHW', company: 'Charles Schwab Corp.', sector: 'Financial Services', aliases: ['Schwab', 'Charles Schwab', 'SCHW'] },
      { symbol: 'C', company: 'Citigroup Inc.', sector: 'Financial Services', aliases: ['Citigroup', 'Citi'] },
      { symbol: 'AXP', company: 'American Express Co.', sector: 'Financial Services', aliases: ['American Express', 'AXP', 'Amex'] },
      { symbol: 'PYPL', company: 'PayPal Holdings Inc.', sector: 'Financial Services', aliases: ['PayPal', 'PYPL'] },
      { symbol: 'COIN', company: 'Coinbase Global Inc.', sector: 'Financial Services', aliases: ['Coinbase', 'COIN'] },
      { symbol: 'HOOD', company: 'Robinhood Markets Inc.', sector: 'Financial Services', aliases: ['Robinhood', 'HOOD'] },
      { symbol: 'SOFI', company: 'SoFi Technologies Inc.', sector: 'Financial Services', aliases: ['SoFi', 'SOFI'] },

      // ── Healthcare ──
      { symbol: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare', aliases: ['Johnson & Johnson', 'JNJ', 'J&J'] },
      { symbol: 'UNH', company: 'UnitedHealth Group Inc.', sector: 'Healthcare', aliases: ['UnitedHealth', 'UNH', 'United Health'] },
      { symbol: 'LLY', company: 'Eli Lilly and Company', sector: 'Healthcare', aliases: ['Eli Lilly', 'LLY', 'Lilly', 'Mounjaro', 'Zepbound'] },
      { symbol: 'PFE', company: 'Pfizer Inc.', sector: 'Healthcare', aliases: ['Pfizer', 'PFE'] },
      { symbol: 'MRNA', company: 'Moderna Inc.', sector: 'Healthcare', aliases: ['Moderna', 'MRNA', 'mRNA'] },
      { symbol: 'ABBV', company: 'AbbVie Inc.', sector: 'Healthcare', aliases: ['AbbVie', 'ABBV', 'Humira'] },
      { symbol: 'TMO', company: 'Thermo Fisher Scientific', sector: 'Healthcare', aliases: ['Thermo Fisher', 'TMO'] },
      { symbol: 'ABT', company: 'Abbott Laboratories', sector: 'Healthcare', aliases: ['Abbott', 'ABT'] },
      { symbol: 'DHR', company: 'Danaher Corporation', sector: 'Healthcare', aliases: ['Danaher', 'DHR'] },
      { symbol: 'BMY', company: 'Bristol-Myers Squibb', sector: 'Healthcare', aliases: ['Bristol-Myers', 'BMY', 'Bristol Myers'] },
      { symbol: 'AMGN', company: 'Amgen Inc.', sector: 'Healthcare', aliases: ['Amgen', 'AMGN'] },
      { symbol: 'GILD', company: 'Gilead Sciences Inc.', sector: 'Healthcare', aliases: ['Gilead', 'GILD'] },
      { symbol: 'CVS', company: 'CVS Health Corporation', sector: 'Healthcare', aliases: ['CVS', 'CVS Health'] },
      { symbol: 'ISRG', company: 'Intuitive Surgical Inc.', sector: 'Healthcare', aliases: ['Intuitive Surgical', 'ISRG', 'da Vinci'] },
      { symbol: 'NVO', company: 'Novo Nordisk A/S', sector: 'Healthcare', aliases: ['Novo Nordisk', 'NVO', 'Ozempic', 'Wegovy'] },

      // ── Energy ──
      { symbol: 'XOM', company: 'Exxon Mobil Corporation', sector: 'Energy', aliases: ['Exxon', 'XOM', 'ExxonMobil'] },
      { symbol: 'CVX', company: 'Chevron Corporation', sector: 'Energy', aliases: ['Chevron', 'CVX'] },
      { symbol: 'COP', company: 'ConocoPhillips', sector: 'Energy', aliases: ['ConocoPhillips', 'COP'] },
      { symbol: 'SLB', company: 'Schlumberger Limited', sector: 'Energy', aliases: ['Schlumberger', 'SLB'] },
      { symbol: 'EOG', company: 'EOG Resources Inc.', sector: 'Energy', aliases: ['EOG', 'EOG Resources'] },
      { symbol: 'OXY', company: 'Occidental Petroleum', sector: 'Energy', aliases: ['Occidental', 'OXY'] },
      { symbol: 'MPC', company: 'Marathon Petroleum Corp.', sector: 'Energy', aliases: ['Marathon Petroleum', 'MPC'] },
      { symbol: 'VLO', company: 'Valero Energy Corp.', sector: 'Energy', aliases: ['Valero', 'VLO'] },
      { symbol: 'ENPH', company: 'Enphase Energy Inc.', sector: 'Energy', aliases: ['Enphase', 'ENPH'] },
      { symbol: 'FSLR', company: 'First Solar Inc.', sector: 'Energy', aliases: ['First Solar', 'FSLR'] },

      // ── Consumer Staples ──
      { symbol: 'KO', company: 'The Coca-Cola Company', sector: 'Consumer Staples', aliases: ['Coca-Cola', 'KO', 'Coke'] },
      { symbol: 'PEP', company: 'PepsiCo Inc.', sector: 'Consumer Staples', aliases: ['Pepsi', 'PEP', 'PepsiCo'] },
      { symbol: 'WMT', company: 'Walmart Inc.', sector: 'Consumer Staples', aliases: ['Walmart', 'WMT'] },
      { symbol: 'COST', company: 'Costco Wholesale Corp.', sector: 'Consumer Staples', aliases: ['Costco', 'COST'] },
      { symbol: 'PG', company: 'Procter & Gamble Co.', sector: 'Consumer Staples', aliases: ['Procter & Gamble', 'PG', 'P&G'] },
      { symbol: 'PM', company: 'Philip Morris International', sector: 'Consumer Staples', aliases: ['Philip Morris', 'PM'] },
      { symbol: 'MO', company: 'Altria Group Inc.', sector: 'Consumer Staples', aliases: ['Altria', 'MO'] },
      { symbol: 'MDLZ', company: 'Mondelez International', sector: 'Consumer Staples', aliases: ['Mondelez', 'MDLZ'] },
      { symbol: 'CL', company: 'Colgate-Palmolive Co.', sector: 'Consumer Staples', aliases: ['Colgate', 'CL', 'Colgate-Palmolive'] },
      { symbol: 'KHC', company: 'Kraft Heinz Company', sector: 'Consumer Staples', aliases: ['Kraft Heinz', 'KHC', 'Kraft'] },

      // ── Consumer Discretionary ──
      { symbol: 'HD', company: 'The Home Depot Inc.', sector: 'Consumer Discretionary', aliases: ['Home Depot', 'HD'] },
      { symbol: 'MCD', company: 'McDonald\'s Corporation', sector: 'Consumer Discretionary', aliases: ['McDonald\'s', 'MCD', 'McDonalds'] },
      { symbol: 'NKE', company: 'Nike Inc.', sector: 'Consumer Discretionary', aliases: ['Nike', 'NKE'] },
      { symbol: 'SBUX', company: 'Starbucks Corporation', sector: 'Consumer Discretionary', aliases: ['Starbucks', 'SBUX'] },
      { symbol: 'TGT', company: 'Target Corporation', sector: 'Consumer Discretionary', aliases: ['Target', 'TGT'] },
      { symbol: 'LOW', company: 'Lowe\'s Companies Inc.', sector: 'Consumer Discretionary', aliases: ['Lowe\'s', 'LOW', 'Lowes'] },
      { symbol: 'BKNG', company: 'Booking Holdings Inc.', sector: 'Consumer Discretionary', aliases: ['Booking', 'BKNG', 'Priceline'] },
      { symbol: 'CMG', company: 'Chipotle Mexican Grill', sector: 'Consumer Discretionary', aliases: ['Chipotle', 'CMG'] },
      { symbol: 'F', company: 'Ford Motor Company', sector: 'Consumer Discretionary', aliases: ['Ford', 'F150'] },
      { symbol: 'GM', company: 'General Motors Company', sector: 'Consumer Discretionary', aliases: ['General Motors', 'GM'] },
      { symbol: 'RIVN', company: 'Rivian Automotive Inc.', sector: 'Consumer Discretionary', aliases: ['Rivian', 'RIVN'] },
      { symbol: 'LCID', company: 'Lucid Group Inc.', sector: 'Consumer Discretionary', aliases: ['Lucid', 'LCID', 'Lucid Motors'] },
      { symbol: 'GME', company: 'GameStop Corp.', sector: 'Consumer Discretionary', aliases: ['GameStop', 'GME', 'game stop'] },
      { symbol: 'AMC', company: 'AMC Entertainment Holdings Inc.', sector: 'Consumer Discretionary', aliases: ['AMC', 'movie theater'] },

      // ── Industrials ──
      { symbol: 'CAT', company: 'Caterpillar Inc.', sector: 'Industrials', aliases: ['Caterpillar', 'CAT'] },
      { symbol: 'BA', company: 'The Boeing Company', sector: 'Industrials', aliases: ['Boeing', 'BA'] },
      { symbol: 'HON', company: 'Honeywell International', sector: 'Industrials', aliases: ['Honeywell', 'HON'] },
      { symbol: 'UPS', company: 'United Parcel Service', sector: 'Industrials', aliases: ['UPS', 'United Parcel'] },
      { symbol: 'RTX', company: 'RTX Corporation', sector: 'Industrials', aliases: ['RTX', 'Raytheon'] },
      { symbol: 'LMT', company: 'Lockheed Martin Corp.', sector: 'Industrials', aliases: ['Lockheed Martin', 'LMT', 'Lockheed'] },
      { symbol: 'GE', company: 'GE Aerospace', sector: 'Industrials', aliases: ['GE', 'General Electric', 'GE Aerospace'] },
      { symbol: 'DE', company: 'Deere & Company', sector: 'Industrials', aliases: ['Deere', 'John Deere', 'DE'] },
      { symbol: 'MMM', company: '3M Company', sector: 'Industrials', aliases: ['3M', 'MMM'] },
      { symbol: 'FDX', company: 'FedEx Corporation', sector: 'Industrials', aliases: ['FedEx', 'FDX'] },

      // ── Communication Services ──
      { symbol: 'DIS', company: 'The Walt Disney Company', sector: 'Communication Services', aliases: ['Disney', 'DIS', 'Walt Disney', 'Disney+'] },
      { symbol: 'CMCSA', company: 'Comcast Corporation', sector: 'Communication Services', aliases: ['Comcast', 'CMCSA', 'Xfinity', 'NBCUniversal'] },
      { symbol: 'T', company: 'AT&T Inc.', sector: 'Communication Services', aliases: ['AT&T', 'ATT'] },
      { symbol: 'VZ', company: 'Verizon Communications', sector: 'Communication Services', aliases: ['Verizon', 'VZ'] },
      { symbol: 'TMUS', company: 'T-Mobile US Inc.', sector: 'Communication Services', aliases: ['T-Mobile', 'TMUS'] },
      { symbol: 'SPOT', company: 'Spotify Technology', sector: 'Communication Services', aliases: ['Spotify', 'SPOT'] },
      { symbol: 'RBLX', company: 'Roblox Corporation', sector: 'Communication Services', aliases: ['Roblox', 'RBLX'] },
      { symbol: 'SNAP', company: 'Snap Inc.', sector: 'Communication Services', aliases: ['Snap', 'SNAP', 'Snapchat'] },
      { symbol: 'PINS', company: 'Pinterest Inc.', sector: 'Communication Services', aliases: ['Pinterest', 'PINS'] },
      { symbol: 'ROKU', company: 'Roku Inc.', sector: 'Communication Services', aliases: ['Roku', 'ROKU'] },

      // ── Materials ──
      { symbol: 'LIN', company: 'Linde plc', sector: 'Materials', aliases: ['Linde', 'LIN'] },
      { symbol: 'APD', company: 'Air Products and Chemicals', sector: 'Materials', aliases: ['Air Products', 'APD'] },
      { symbol: 'SHW', company: 'Sherwin-Williams Company', sector: 'Materials', aliases: ['Sherwin-Williams', 'SHW'] },
      { symbol: 'FCX', company: 'Freeport-McMoRan Inc.', sector: 'Materials', aliases: ['Freeport', 'FCX', 'Freeport-McMoRan'] },
      { symbol: 'NEM', company: 'Newmont Corporation', sector: 'Materials', aliases: ['Newmont', 'NEM'] },
      { symbol: 'NUE', company: 'Nucor Corporation', sector: 'Materials', aliases: ['Nucor', 'NUE'] },

      // ── Real Estate ──
      { symbol: 'AMT', company: 'American Tower Corp.', sector: 'Real Estate', aliases: ['American Tower', 'AMT'] },
      { symbol: 'PLD', company: 'Prologis Inc.', sector: 'Real Estate', aliases: ['Prologis', 'PLD'] },
      { symbol: 'CCI', company: 'Crown Castle Inc.', sector: 'Real Estate', aliases: ['Crown Castle', 'CCI'] },
      { symbol: 'O', company: 'Realty Income Corp.', sector: 'Real Estate', aliases: ['Realty Income', 'O'] },
      { symbol: 'SPG', company: 'Simon Property Group', sector: 'Real Estate', aliases: ['Simon Property', 'SPG'] },

      // ── Utilities ──
      { symbol: 'NEE', company: 'NextEra Energy Inc.', sector: 'Utilities', aliases: ['NextEra', 'NEE', 'NextEra Energy'] },
      { symbol: 'DUK', company: 'Duke Energy Corporation', sector: 'Utilities', aliases: ['Duke Energy', 'DUK'] },
      { symbol: 'SO', company: 'Southern Company', sector: 'Utilities', aliases: ['Southern Company', 'SO'] },
      { symbol: 'D', company: 'Dominion Energy Inc.', sector: 'Utilities', aliases: ['Dominion Energy', 'Dominion'] },
      { symbol: 'AEP', company: 'American Electric Power', sector: 'Utilities', aliases: ['AEP', 'American Electric'] },

      // ── ETFs ──
      { symbol: 'SPY', company: 'SPDR S&P 500 ETF', sector: 'ETF', aliases: ['SPY', 'S&P 500', 'SP500', 'SPX'] },
      { symbol: 'QQQ', company: 'Invesco QQQ Trust', sector: 'ETF', aliases: ['QQQ', 'NASDAQ', 'NDX'] },
      { symbol: 'VTI', company: 'Vanguard Total Stock Market ETF', sector: 'ETF', aliases: ['VTI', 'Total Market'] },
      { symbol: 'VOO', company: 'Vanguard S&P 500 ETF', sector: 'ETF', aliases: ['VOO'] },
      { symbol: 'IWM', company: 'iShares Russell 2000 ETF', sector: 'ETF', aliases: ['IWM', 'Russell 2000'] },
      { symbol: 'DIA', company: 'SPDR Dow Jones ETF', sector: 'ETF', aliases: ['DIA', 'Dow Jones', 'DJIA'] },
      { symbol: 'ARKK', company: 'ARK Innovation ETF', sector: 'ETF', aliases: ['ARKK', 'ARK', 'Cathie Wood'] },
      { symbol: 'XLF', company: 'Financial Select Sector SPDR', sector: 'ETF', aliases: ['XLF'] },
      { symbol: 'XLE', company: 'Energy Select Sector SPDR', sector: 'ETF', aliases: ['XLE'] },
      { symbol: 'XLK', company: 'Technology Select Sector SPDR', sector: 'ETF', aliases: ['XLK'] },
      { symbol: 'XLV', company: 'Health Care Select Sector SPDR', sector: 'ETF', aliases: ['XLV'] },
      { symbol: 'GLD', company: 'SPDR Gold Shares', sector: 'ETF', aliases: ['GLD', 'gold ETF'] },
      { symbol: 'SLV', company: 'iShares Silver Trust', sector: 'ETF', aliases: ['SLV', 'silver ETF'] },
      { symbol: 'TLT', company: 'iShares 20+ Year Treasury Bond ETF', sector: 'ETF', aliases: ['TLT', 'treasury bonds'] },
      { symbol: 'VGT', company: 'Vanguard Information Technology ETF', sector: 'ETF', aliases: ['VGT'] },
      { symbol: 'SCHD', company: 'Schwab US Dividend Equity ETF', sector: 'ETF', aliases: ['SCHD', 'dividend ETF'] },
    ];

    stocks.forEach(stock => {
      this.stockDatabase.set(stock.symbol, {
        company: stock.company,
        sector: stock.sector,
        aliases: stock.aliases
      });
    });
  }

  private initializeSectorKeywords() {
    this.sectorKeywords.set('Technology', [
      'tech', 'software', 'AI', 'artificial intelligence', 'machine learning', 'cloud', 'SaaS',
      'semiconductor', 'chip', 'silicon valley', 'startup', 'unicorn', 'IPO tech', 'digital transformation',
      'cybersecurity', 'fintech', 'blockchain', 'cryptocurrency', 'bitcoin', 'ethereum', 'NFT', 'metaverse'
    ]);

    this.sectorKeywords.set('Financial Services', [
      'bank', 'banking', 'credit', 'loan', 'mortgage', 'interest rates', 'fed', 'federal reserve',
      'insurance', 'fintech', 'payment', 'credit card', 'debit card', 'ATM', 'financial services',
      'investment banking', 'trading', 'broker', 'wealth management', 'asset management'
    ]);

    this.sectorKeywords.set('Healthcare', [
      'healthcare', 'pharma', 'pharmaceutical', 'biotech', 'medical', 'hospital', 'drug',
      'vaccine', 'clinical trial', 'FDA', 'medicine', 'treatment', 'therapy', 'disease',
      'COVID', 'pandemic', 'health insurance', 'medical device', 'genomics'
    ]);

    this.sectorKeywords.set('Energy', [
      'oil', 'gas', 'energy', 'petroleum', 'crude', 'renewable', 'solar', 'wind', 'nuclear',
      'coal', 'natural gas', 'shale', 'fracking', 'OPEC', 'pipeline', 'refinery', 'drilling',
      'green energy', 'clean energy', 'electric vehicle', 'EV', 'battery'
    ]);

    this.sectorKeywords.set('Consumer Staples', [
      'consumer goods', 'retail', 'food', 'beverage', 'grocery', 'supermarket', 'restaurant',
      'brand', 'consumer spending', 'disposable income', 'inflation', 'supply chain'
    ]);

    this.sectorKeywords.set('Consumer Discretionary', [
      'retail', 'e-commerce', 'fashion', 'luxury', 'automotive', 'car', 'entertainment',
      'media', 'gaming', 'streaming', 'travel', 'hotel', 'airline', 'leisure'
    ]);

    this.sectorKeywords.set('Real Estate', [
      'real estate', 'REIT', 'property', 'housing', 'mortgage', 'construction', 'home',
      'commercial real estate', 'residential', 'rent', 'lease', 'property management'
    ]);

    this.sectorKeywords.set('Utilities', [
      'utility', 'electric', 'electricity', 'power', 'grid', 'water', 'gas utility',
      'renewable energy', 'infrastructure', 'dividend', 'regulated utility'
    ]);

    this.sectorKeywords.set('Industrials', [
      'industrial', 'manufacturing', 'aerospace', 'defense', 'logistics', 'shipping',
      'railroad', 'trucking', 'construction', 'machinery', 'automation', 'robotics',
      'supply chain', 'freight', 'airline', 'aviation', 'military', 'contractor'
    ]);

    this.sectorKeywords.set('Materials', [
      'materials', 'mining', 'steel', 'aluminum', 'copper', 'gold', 'silver',
      'lithium', 'rare earth', 'chemicals', 'fertilizer', 'packaging', 'lumber',
      'cement', 'concrete', 'commodities', 'raw materials', 'metals'
    ]);

    this.sectorKeywords.set('Communication Services', [
      'telecom', 'telecommunications', 'streaming', 'social media', 'advertising',
      'digital advertising', 'gaming', 'esports', 'media', 'content', 'broadband',
      'wireless', '5G', 'cable', 'network', 'internet service'
    ]);
  }

  private initializeFinancialTerms() {
    const terms = [
      // Market terms
      'stock', 'share', 'equity', 'bond', 'ETF', 'mutual fund', 'dividend', 'yield',
      'bull market', 'bear market', 'correction', 'crash', 'rally', 'volatility',
      'earnings', 'revenue', 'profit', 'loss', 'margin', 'P/E ratio', 'market cap',
      
      // Trading terms
      'buy', 'sell', 'hold', 'long', 'short', 'calls', 'puts', 'options', 'futures',
      'leverage', 'margin', 'portfolio', 'position', 'allocation', 'diversification',
      
      // Economic terms
      'inflation', 'deflation', 'GDP', 'unemployment', 'interest rate', 'fed', 'QE',
      'recession', 'expansion', 'economic growth', 'fiscal policy', 'monetary policy',
      
      // Investment terms
      'investment', 'investor', 'analyst', 'upgrade', 'downgrade', 'target price',
      'valuation', 'overvalued', 'undervalued', 'growth', 'value', 'momentum'
    ];

    terms.forEach(term => this.financialTerms.add(term.toLowerCase()));
  }

  public detectStocksAndSectors(text: string): DetectionResult {
    const normalizedText = text.toLowerCase();
    const result: DetectionResult = {
      stocks: [],
      sectors: [],
      hasFinancialContent: false,
      overallRelevance: 0
    };

    // Check for financial relevance
    const financialTermCount = Array.from(this.financialTerms).reduce((count, term) => {
      return count + (normalizedText.includes(term) ? 1 : 0);
    }, 0);

    result.hasFinancialContent = financialTermCount > 0;
    result.overallRelevance = Math.min(financialTermCount / 10, 1); // Max relevance of 1

    // Detect stock mentions
    const stockMentions = new Map<string, StockMention>();
    const cashtagMentions = this.extractCashtagMentions(text);
    
    for (const [symbol, stockInfo] of this.stockDatabase.entries()) {
      let mentions = 0;
      const contexts: string[] = [];

      // Check for symbol mention (case sensitive for stock symbols)
      const symbolRegex = new RegExp(`\\b${symbol}\\b`, 'g');
      const symbolMatches = text.match(symbolRegex);
      if (symbolMatches) {
        mentions += symbolMatches.length;
        contexts.push(...this.extractContext(text, symbol));
      }

      // Explicit cashtag mentions ($TSLA) with WSB stop-list filtering.
      const cashtagCount = cashtagMentions.get(symbol) || 0;
      if (cashtagCount > 0) {
        mentions += cashtagCount;
        contexts.push(...this.extractContext(text, `$${symbol}`));
      }

      // Check for company name and aliases (case insensitive)
      stockInfo.aliases.forEach(alias => {
        const aliasRegex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const aliasMatches = normalizedText.match(aliasRegex);
        if (aliasMatches) {
          mentions += aliasMatches.length;
          contexts.push(...this.extractContext(text, alias));
        }
      });

      if (mentions > 0) {
        const confidence = this.calculateStockConfidence(text, symbol, stockInfo);
        stockMentions.set(symbol, {
          symbol,
          company: stockInfo.company,
          sector: stockInfo.sector,
          mentions,
          contexts: [...new Set(contexts)], // Remove duplicates
          confidence
        });
      }
    }

    // Add nickname-based symbol mapping for WSB slang.
    for (const [nickname, symbol] of this.nicknameMap.entries()) {
      const nicknameRegex = new RegExp(`\\b${nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const nicknameMatches = normalizedText.match(nicknameRegex);
      if (!nicknameMatches || nicknameMatches.length === 0) continue;

      const stockInfo = this.stockDatabase.get(symbol);
      if (!stockInfo) continue;

      const existing = stockMentions.get(symbol);
      const nicknameContexts = this.extractContext(text, nickname);
      if (existing) {
        existing.mentions += nicknameMatches.length;
        existing.contexts = [...new Set([...existing.contexts, ...nicknameContexts])];
        existing.confidence = Math.min(1, existing.confidence + 0.1);
      } else {
        stockMentions.set(symbol, {
          symbol,
          company: stockInfo.company,
          sector: stockInfo.sector,
          mentions: nicknameMatches.length,
          contexts: [...new Set(nicknameContexts)],
          confidence: 0.7,
        });
      }
    }

    result.stocks = Array.from(stockMentions.values()).sort((a, b) => b.mentions - a.mentions);

    // Detect sector mentions
    const sectorMentions = new Map<string, SectorMention>();
    
    for (const [sector, keywords] of this.sectorKeywords.entries()) {
      let mentions = 0;
      const contexts: string[] = [];
      const relatedStocks: string[] = [];

      keywords.forEach(keyword => {
        const keywordRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const keywordMatches = normalizedText.match(keywordRegex);
        if (keywordMatches) {
          mentions += keywordMatches.length;
          contexts.push(...this.extractContext(text, keyword));
        }
      });

      // Add stocks from this sector that were mentioned
      result.stocks.forEach(stock => {
        if (stock.sector === sector) {
          relatedStocks.push(stock.symbol);
          mentions += stock.mentions * 0.5; // Boost sector score for mentioned stocks
        }
      });

      if (mentions > 0) {
        const confidence = this.calculateSectorConfidence(text, sector, keywords);
        sectorMentions.set(sector, {
          sector,
          mentions: Math.round(mentions),
          relatedStocks,
          contexts: [...new Set(contexts)],
          confidence
        });
      }
    }

    result.sectors = Array.from(sectorMentions.values()).sort((a, b) => b.mentions - a.mentions);

    return result;
  }

  private extractCashtagMentions(text: string): Map<string, number> {
    const matches = text.matchAll(/\$([A-Z]{1,5})\b/g);
    const counts = new Map<string, number>();
    for (const match of matches) {
      const symbol = (match[1] || '').toUpperCase();
      if (!symbol || this.tickerStoplist.has(symbol)) continue;
      counts.set(symbol, (counts.get(symbol) || 0) + 1);
    }
    return counts;
  }

  private extractContext(text: string, term: string, contextWordRadius: number = 20): string[] {
    const contexts: string[] = [];
    const termRegex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let match;

    while ((match = termRegex.exec(text)) !== null) {
      const leftPart = text.slice(0, match.index);
      const rightStart = match.index + match[0].length;
      const rightPart = text.slice(rightStart);
      const leftWords = leftPart.split(/\s+/).filter(Boolean);
      const rightWords = rightPart.split(/\s+/).filter(Boolean);
      const anchorWords = match[0].split(/\s+/).filter(Boolean);
      const contextWords = [
        ...leftWords.slice(-contextWordRadius),
        ...anchorWords,
        ...rightWords.slice(0, contextWordRadius),
      ];
      const context = contextWords.join(' ').trim();
      
      if (context.length > term.length + 10) { // Only add meaningful context
        contexts.push(context);
      }
    }

    return contexts.slice(0, 3); // Limit to 3 contexts per term
  }

  private calculateStockConfidence(text: string, symbol: string, stockInfo: { company: string; sector: string; aliases: string[] }): number {
    let confidence = 0.5; // Base confidence

    // Boost if symbol appears in uppercase (more likely to be intentional)
    if (text.includes(symbol)) {
      confidence += 0.3;
    }

    // Boost if company name appears
    if (text.toLowerCase().includes(stockInfo.company.toLowerCase())) {
      confidence += 0.2;
    }

    // Boost if financial context is present
    const hasFinancialContext = Array.from(this.financialTerms).some(term => 
      text.toLowerCase().includes(term)
    );
    
    if (hasFinancialContext) {
      confidence += 0.2;
    }

    // Reduce if the mention might be ambiguous
    const ambiguousTerms = ['a', 'an', 'the', 'i', 'me', 'my', 'we', 'us', 'v', 'c', 'go', 'on', 'at'];
    if (ambiguousTerms.includes(symbol.toLowerCase())) {
      confidence -= 0.3;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private calculateSectorConfidence(text: string, sector: string, keywords: string[]): number {
    let confidence = 0.3; // Base confidence

    // Count matching keywords
    const matchCount = keywords.reduce((count, keyword) => {
      return count + (text.toLowerCase().includes(keyword) ? 1 : 0);
    }, 0);

    confidence += (matchCount / keywords.length) * 0.5;

    // Boost if financial context is present
    const hasFinancialContext = Array.from(this.financialTerms).some(term => 
      text.toLowerCase().includes(term)
    );
    
    if (hasFinancialContext) {
      confidence += 0.2;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  public getTopStocks(limit: number = 50): string[] {
    return Array.from(this.stockDatabase.keys()).slice(0, limit);
  }

  public getAllSectors(): string[] {
    return Array.from(this.sectorKeywords.keys());
  }

  public getStockInfo(symbol: string): { company: string; sector: string; aliases: string[] } | null {
    return this.stockDatabase.get(symbol) || null;
  }
}

export const stockSectorDetectionService = new StockSectorDetectionService();