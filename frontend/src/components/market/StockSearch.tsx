import { useState, useRef, useEffect, useCallback } from "react";

interface StockSearchProps {
  onSymbolSelect: (symbol: string) => void;
  selectedSymbol: string;
}

interface SearchResult {
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
}

const POPULAR_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'BAC', name: 'Bank of America Corp.' },
  { symbol: 'WFC', name: 'Wells Fargo & Company' },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc.' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'PFE', name: 'Pfizer Inc.' },
  { symbol: 'UNH', name: 'UnitedHealth Group Inc.' },
  { symbol: 'PG', name: 'Procter & Gamble Co.' },
  { symbol: 'KO', name: 'Coca-Cola Company' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'HD', name: 'Home Depot Inc.' },
  { symbol: 'MCD', name: 'McDonald\'s Corporation' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF' }
];

export default function StockSearch({ onSymbolSelect, selectedSymbol }: StockSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<SearchResult[]>(POPULAR_STOCKS.map(stock => ({
    symbol: stock.symbol,
    name: stock.name,
    type: 'Common Stock',
    region: 'United States',
    marketOpen: '09:30',
    marketClose: '16:00',
    timezone: 'UTC-04',
    currency: 'USD',
    matchScore: '1.0'
  })));
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search function
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setFilteredStocks(POPULAR_STOCKS.map(stock => ({
        symbol: stock.symbol,
        name: stock.name,
        type: 'Common Stock',
        region: 'United States',
        marketOpen: '09:30',
        marketClose: '16:00',
        timezone: 'UTC-04',
        currency: 'USD',
        matchScore: '1.0'
      })));
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const response = await fetch(`http://localhost:3001/api/market/search/${encodeURIComponent(query)}?limit=15`);
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }
      
      const results = await response.json();
      setSearchResults(results);
      setFilteredStocks(results);

      if (results.length === 0) {
        setSearchError(`No stocks found for "${query}"`);
      }
    } catch (error) {
      console.error('Search error:', error);
      setSearchError('Search failed. Please try again.');
      
      // Fallback to local filtering of popular stocks
      const localResults = POPULAR_STOCKS.filter(stock =>
        stock.symbol.toLowerCase().includes(query.toLowerCase()) ||
        stock.name.toLowerCase().includes(query.toLowerCase())
      ).map(stock => ({
        symbol: stock.symbol,
        name: stock.name,
        type: 'Common Stock',
        region: 'United States',
        marketOpen: '09:30',
        marketClose: '16:00',
        timezone: 'UTC-04',
        currency: 'USD',
        matchScore: '0.5'
      }));
      
      setFilteredStocks(localResults);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for debounced search
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(searchTerm);
    }, 300); // 300ms debounce

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm, performSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStockSelect = (symbol: string) => {
    onSymbolSelect(symbol);
    setSearchTerm('');
    setIsDropdownOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsDropdownOpen(true);
  };

  const handleInputFocus = () => {
    setIsDropdownOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Search Stocks
        </h2>
        
        {/* Search Input */}
        <div className="relative" ref={searchRef}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              placeholder="Search by symbol or company name (e.g., AAPL, Apple)"
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {/* Dropdown */}
          {isDropdownOpen && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-80 overflow-y-auto">
              {isSearching ? (
                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500 mr-2"></div>
                  Searching...
                </div>
              ) : searchError ? (
                <div className="px-4 py-3 text-sm text-red-600 dark:text-red-400">
                  {searchError}
                </div>
              ) : filteredStocks.length > 0 ? (
                <>
                  {searchTerm.trim() === '' && (
                    <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                      Popular Stocks
                    </div>
                  )}
                  {searchTerm.trim() !== '' && searchResults.length > 0 && (
                    <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                      Search Results ({searchResults.length})
                    </div>
                  )}
                  {filteredStocks.map((stock, index) => (
                    <button
                      key={`${stock.symbol}-${index}`}
                      onClick={() => handleStockSelect(stock.symbol)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-600 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {stock.symbol}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {stock.name}
                          </div>
                          {stock.sector && (
                            <div className="text-xs text-gray-400 dark:text-gray-500">
                              {stock.sector} • {stock.region}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          {stock.matchScore && parseFloat(stock.matchScore) > 0.8 && (
                            <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                              {Math.round(parseFloat(stock.matchScore) * 100)}%
                            </div>
                          )}
                          {selectedSymbol === stock.symbol && (
                            <div className="text-green-600 dark:text-green-400">
                              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              ) : searchTerm.trim() !== '' ? (
                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                  No stocks found matching "{searchTerm}"
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Current Selection */}
      {selectedSymbol && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Currently Viewing</div>
              <div className="font-medium text-gray-900 dark:text-white">
                {selectedSymbol}
                {POPULAR_STOCKS.find(s => s.symbol === selectedSymbol) && (
                  <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                    - {POPULAR_STOCKS.find(s => s.symbol === selectedSymbol)?.name}
                  </span>
                )}
              </div>
            </div>
            <div className="text-green-600 dark:text-green-400">
              <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Quick Access Buttons */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quick Access</h3>
        <div className="flex flex-wrap gap-2">
          {['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'SPY'].map((symbol) => (
            <button
              key={symbol}
              onClick={() => handleStockSelect(symbol)}
              className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                selectedSymbol === symbol
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500'
              }`}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
} 