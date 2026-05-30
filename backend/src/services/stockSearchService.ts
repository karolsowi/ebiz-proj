import { getAlphaVantageClientForUser, getFinnhubClientForUser } from './credentialResolver.js';
import { getApiKeysOwnerUserId } from '../constants/integration.js';

export interface StockSearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  marketOpen: string;
  marketClose: string;
  timezone: string;
  currency: string;
  matchScore: string;
  exchange?: string;
  sector?: string;
  industry?: string;
}

export interface StockProfile {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  marketCap: number;
  employees?: number | undefined;
  website?: string | undefined;
  logo?: string | undefined;
  exchange: string;
  currency: string;
  country: string;
  ipo?: string | undefined;
  finnhubIndustry?: string | undefined;
}

class StockSearchService {
  private searchCache = new Map<string, { data: StockSearchResult[], timestamp: number }>();
  private profileCache = new Map<string, { data: StockProfile, timestamp: number }>();
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  private async resolveClients(userId?: string) {
    const resolvedUserId = userId ?? getApiKeysOwnerUserId();
    const [alphaVantage, finnhub] = await Promise.all([
      getAlphaVantageClientForUser(resolvedUserId),
      getFinnhubClientForUser(resolvedUserId),
    ]);
    return { alphaVantage, finnhub };
  }

  /**
   * Search for stocks using multiple APIs with intelligent fallback
   */
  async searchStocks(query: string, limit: number = 20, userId?: string): Promise<StockSearchResult[]> {
    if (!query || query.trim().length < 1) {
      return [];
    }

    const cacheKey = `${query.toLowerCase()}_${limit}`;
    const cached = this.searchCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }

    try {
      let results: StockSearchResult[] = [];
      const { alphaVantage: alphaClient, finnhub: finnhubClient } = await this.resolveClients(userId);

      // Try Alpha Vantage first (more comprehensive search)
      if (alphaClient) {
      try {
        console.log(`🔍 Searching stocks with Alpha Vantage: "${query}"`);
        const avResults = await alphaClient.searchSymbols(query);

        results = avResults.map(result => ({
          symbol: result.symbol,
          name: result.name,
          type: result.type,
          region: result.region,
          marketOpen: result.marketOpen,
          marketClose: result.marketClose,
          timezone: result.timezone,
          currency: result.currency,
          matchScore: result.matchScore,
          exchange: result.region // Approximate exchange info
        }));

        console.log(`✅ Alpha Vantage found ${results.length} results for "${query}"`);
      } catch (error) {
        console.warn(`Alpha Vantage search failed for "${query}":`, error);
      }
      }

      // If Alpha Vantage didn't provide enough results, try Finnhub
      if (finnhubClient && results.length < 5) {
        try {
          console.log(`🔍 Supplementing search with Finnhub: "${query}"`);
          const profile = await finnhubClient.getCompanyProfile(query.toUpperCase());

          if (profile && profile.name) {
            const finnhubResult: StockSearchResult = {
              symbol: query.toUpperCase(),
              name: profile.name,
              type: 'Common Stock',
              region: profile.country || 'United States',
              marketOpen: '09:30',
              marketClose: '16:00',
              timezone: 'UTC-04',
              currency: profile.currency || 'USD',
              matchScore: query.toUpperCase() === profile.ticker ? '1.0' : '0.8',
              exchange: profile.exchange,
              sector: profile.finnhubIndustry
            };

            // Add if not already in results
            if (!results.find(r => r.symbol === finnhubResult.symbol)) {
              results.unshift(finnhubResult);
            }
          }
        } catch (error) {
          console.warn(`Finnhub search failed for "${query}":`, error);
        }
      }

      // If still no results, provide fuzzy matching from our known stocks
      if (results.length === 0) {
        results = this.getFuzzyMatches(query, limit);
      }

      // Cache successful results
      if (results.length > 0) {
        this.searchCache.set(cacheKey, {
          data: results.slice(0, limit),
          timestamp: Date.now()
        });
      }

      return results.slice(0, limit);
    } catch (error) {
      console.error(`Stock search failed for "${query}":`, error);
      return this.getFuzzyMatches(query, limit);
    }
  }

  /**
   * Get detailed company profile for a stock
   */
  async getStockProfile(symbol: string, userId?: string): Promise<StockProfile | null> {
    const cacheKey = symbol.toUpperCase();
    const cached = this.profileCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }

    try {
      let profile: StockProfile | null = null;
      const { alphaVantage: alphaClient, finnhub: finnhubClient } = await this.resolveClients(userId);

      // Try Alpha Vantage first for comprehensive company overview
      if (alphaClient) {
      try {
        console.log(`📊 Getting company profile from Alpha Vantage: ${symbol}`);
        const avOverview = await alphaClient.getCompanyOverview(symbol);

        profile = {
          symbol: avOverview.symbol,
          name: avOverview.name,
          description: avOverview.description,
          sector: avOverview.sector,
          industry: avOverview.industry,
          marketCap: avOverview.marketCap,
          employees: avOverview.fullTimeEmployees || undefined,
          exchange: avOverview.exchange,
          currency: 'USD',
          country: 'United States',
          website: avOverview.officialSite
        };

        console.log(`✅ Alpha Vantage profile retrieved for ${symbol}`);
      } catch (error) {
        console.warn(`Alpha Vantage profile failed for ${symbol}:`, error);
      }
      }

      // If Alpha Vantage failed, try Finnhub
      if (!profile && finnhubClient) {
        try {
          console.log(`📊 Getting company profile from Finnhub: ${symbol}`);
          const fhProfile = await finnhubClient.getCompanyProfile(symbol);

          if (fhProfile && fhProfile.name) {
            profile = {
              symbol: symbol.toUpperCase(),
              name: fhProfile.name,
              description: fhProfile.weburl ? `Company website: ${fhProfile.weburl}` : '',
              sector: fhProfile.finnhubIndustry || 'Unknown',
              industry: fhProfile.finnhubIndustry || 'Unknown',
              marketCap: fhProfile.marketCapitalization || 0,
              employees: undefined,
              website: fhProfile.weburl,
              logo: fhProfile.logo,
              exchange: fhProfile.exchange,
              currency: fhProfile.currency || 'USD',
              country: fhProfile.country || 'Unknown',
              ipo: fhProfile.ipo,
              finnhubIndustry: fhProfile.finnhubIndustry
            };

            console.log(`✅ Finnhub profile retrieved for ${symbol}`);
          }
        } catch (error) {
          console.warn(`Finnhub profile failed for ${symbol}:`, error);
        }
      }

      // Cache successful results
      if (profile) {
        this.profileCache.set(cacheKey, {
          data: profile,
          timestamp: Date.now()
        });
      }

      return profile;
    } catch (error) {
      console.error(`Failed to get profile for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get fuzzy matches from known popular stocks when API search fails
   */
  private getFuzzyMatches(query: string, limit: number): StockSearchResult[] {
    const popularStocks = [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology' },
      { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', sector: 'Technology' },
      { symbol: 'GOOG', name: 'Alphabet Inc. Class C', sector: 'Technology' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology' },
      { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology' },
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Discretionary' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. Class B', sector: 'Financial Services' },
      { symbol: 'UNH', name: 'UnitedHealth Group Incorporated', sector: 'Healthcare' },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services' },
      { symbol: 'V', name: 'Visa Inc.', sector: 'Financial Services' },
      { symbol: 'PG', name: 'Procter & Gamble Company', sector: 'Consumer Staples' },
      { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy' },
      { symbol: 'HD', name: 'Home Depot Inc.', sector: 'Consumer Discretionary' },
      { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy' },
      { symbol: 'MA', name: 'Mastercard Incorporated', sector: 'Financial Services' },
      { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare' },
      { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare' },
      { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology' },
      { symbol: 'KO', name: 'Coca-Cola Company', sector: 'Consumer Staples' },
      { symbol: 'LLY', name: 'Eli Lilly and Company', sector: 'Healthcare' },
      { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer Staples' },
      { symbol: 'TMO', name: 'Thermo Fisher Scientific Inc.', sector: 'Healthcare' },
      { symbol: 'COST', name: 'Costco Wholesale Corporation', sector: 'Consumer Staples' },
      { symbol: 'MRK', name: 'Merck & Co. Inc.', sector: 'Healthcare' },
      { symbol: 'BAC', name: 'Bank of America Corporation', sector: 'Financial Services' },
      { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Communication Services' },
      { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Staples' }
    ];

    const queryLower = query.toLowerCase();

    return popularStocks
      .filter(stock =>
        stock.symbol.toLowerCase().includes(queryLower) ||
        stock.name.toLowerCase().includes(queryLower) ||
        stock.sector.toLowerCase().includes(queryLower)
      )
      .map(stock => ({
        symbol: stock.symbol,
        name: stock.name,
        type: 'Common Stock',
        region: 'United States',
        marketOpen: '09:30',
        marketClose: '16:00',
        timezone: 'UTC-04',
        currency: 'USD',
        matchScore: stock.symbol.toLowerCase() === queryLower ? '1.0' : '0.5',
        sector: stock.sector
      }))
      .slice(0, limit);
  }

  /**
   * Clear cache entries
   */
  clearCache(): void {
    this.searchCache.clear();
    this.profileCache.clear();
  }
}

export const stockSearchService = new StockSearchService();