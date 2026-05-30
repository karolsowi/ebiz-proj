import React, { useEffect, useState } from 'react';
import { tradingService, TradeOrder } from '../../services/tradingService';
import { userApiService } from '../../services/userApiService';

interface TradeOrderFormProps {
  onOrderPlaced: () => void;
  onSymbolChange?: (symbol: string) => void;
  defaultSymbol?: string;
}

const TradeOrderForm: React.FC<TradeOrderFormProps> = ({ onOrderPlaced, onSymbolChange, defaultSymbol = '' }) => {
  const [formData, setFormData] = useState<TradeOrder>({
    symbol: defaultSymbol,
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    qty: '',
    limit_price: '',
    stop_price: '',
    extended_hours: false,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOrders, setConfirmOrders] = useState(true);
  const [riskWarnings, setRiskWarnings] = useState(true);

  useEffect(() => {
    userApiService
      .getSettings()
      .then((s) => {
        setConfirmOrders(s.confirmOrders);
        setRiskWarnings(s.riskWarnings);
      })
      .catch(() => {
        /* defaults */
      });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    
    setFormData(prev => ({
      ...prev,
      [name]: newValue,
    }));
    
    if (name === 'symbol' && onSymbolChange) {
      onSymbolChange((value as string).toUpperCase());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate required fields
      if (!formData.symbol || !formData.qty) {
        throw new Error('Symbol and quantity are required');
      }

      if ((formData.type === 'limit' || formData.type === 'stop_limit') && !formData.limit_price) {
        throw new Error('Limit price is required for limit orders');
      }

      if ((formData.type === 'stop' || formData.type === 'stop_limit') && !formData.stop_price) {
        throw new Error('Stop price is required for stop orders');
      }

      if (formData.side === 'buy' && !formData.stop_price) {
        throw new Error('Stop price is required for buy orders so risk controls can calculate per-trade risk');
      }

      if (riskWarnings) {
        const sideLabel = formData.side === 'buy' ? 'BUY' : 'SELL';
        const acknowledged = window.confirm(
          `Risk reminder: You are placing a ${sideLabel} ${formData.type.toUpperCase()} order for ${formData.qty} share(s) of ${formData.symbol.toUpperCase()}. Market orders can fill at unexpected prices. Continue?`
        );
        if (!acknowledged) {
          setLoading(false);
          return;
        }
      }

      if (confirmOrders) {
        const summary = `${formData.side.toUpperCase()} ${formData.qty} ${formData.symbol.toUpperCase()} (${formData.type})`;
        if (!window.confirm(`Place order: ${summary}?`)) {
          setLoading(false);
          return;
        }
      }

      // Clean up the order data
      const orderData: TradeOrder = {
        symbol: formData.symbol.toUpperCase(),
        side: formData.side,
        type: formData.type,
        time_in_force: formData.time_in_force,
        qty: formData.qty,
        extended_hours: formData.extended_hours,
      };

      // Only include price fields if they're relevant
      if (formData.type === 'limit' || formData.type === 'stop_limit') {
        orderData.limit_price = formData.limit_price;
      }
      
      if (formData.stop_price) {
        orderData.stop_price = formData.stop_price;
      }

      const result = await tradingService.placeOrder(orderData);
      console.log('Order placed successfully:', result);
      
      // Reset form
      setFormData({
        symbol: '',
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        qty: '',
        limit_price: '',
        stop_price: '',
        extended_hours: false,
      });

      if (onSymbolChange) {
        onSymbolChange('');
      }

      onOrderPlaced();
    } catch (err) {
      console.error('Error placing order:', err);
      setError(err instanceof Error ? err.message : 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const needsLimitPrice = formData.type === 'limit' || formData.type === 'stop_limit';
  const needsStopPrice = formData.side === 'buy' || formData.type === 'stop' || formData.type === 'stop_limit';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Place Order</h3>

      {riskWarnings && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          Trading involves risk. Orders are checked against your risk limits on the server. Adjust confirmations in Settings.
        </p>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">Order rejected</p>
          <ul className="text-sm text-red-800 dark:text-red-200 list-disc ml-5 space-y-1">
            {error.split(' | ').map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Symbol */}
        <div>
          <label htmlFor="symbol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Symbol
          </label>
          <input
            type="text"
            id="symbol"
            name="symbol"
            value={formData.symbol}
            onChange={handleInputChange}
            placeholder="e.g., AAPL, TSLA"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            required
          />
        </div>

        {/* Side and Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="side" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Side
            </label>
            <select
              id="side"
              name="side"
              value={formData.side}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>

          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Order Type
            </label>
            <select
              id="type"
              name="type"
              value={formData.type}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
              <option value="stop">Stop</option>
              <option value="stop_limit">Stop Limit</option>
            </select>
          </div>
        </div>

        {/* Quantity and Time in Force */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="qty" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Quantity
            </label>
            <input
              type="number"
              id="qty"
              name="qty"
              value={formData.qty}
              onChange={handleInputChange}
              placeholder="0"
              min="0"
              step="1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              required
            />
          </div>

          <div>
            <label htmlFor="time_in_force" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Time in Force
            </label>
            <select
              id="time_in_force"
              name="time_in_force"
              value={formData.time_in_force}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="day">Day</option>
              <option value="gtc">Good Till Canceled</option>
              <option value="ioc">Immediate or Cancel</option>
              <option value="fok">Fill or Kill</option>
            </select>
          </div>
        </div>

        {/* Price Fields */}
        {(needsLimitPrice || needsStopPrice) && (
          <div className="grid grid-cols-2 gap-4">
            {needsLimitPrice && (
              <div>
                <label htmlFor="limit_price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Limit Price ($)
                </label>
                <input
                  type="number"
                  id="limit_price"
                  name="limit_price"
                  value={formData.limit_price}
                  onChange={handleInputChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  required={needsLimitPrice}
                />
              </div>
            )}

            {needsStopPrice && (
              <div>
                <label htmlFor="stop_price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Stop Price ($){formData.side === 'buy' ? ' for Risk' : ''}
                </label>
                <input
                  type="number"
                  id="stop_price"
                  name="stop_price"
                  value={formData.stop_price}
                  onChange={handleInputChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  required={needsStopPrice}
                />
                {formData.side === 'buy' && formData.type !== 'stop' && formData.type !== 'stop_limit' && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Used only for risk validation; the submitted order remains a {formData.type} order.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Extended Hours */}
        <div>
          <label className="flex items-center">
            <input
              type="checkbox"
              name="extended_hours"
              checked={formData.extended_hours}
              onChange={handleInputChange}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 dark:bg-gray-700"
            />
            <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
              Allow extended hours trading
            </span>
          </label>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
            formData.side === 'buy'
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          } ${
            loading ? 'opacity-50 cursor-not-allowed' : ''
          } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
        >
          {loading ? (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Placing Order...
            </div>
          ) : (
            `${formData.side === 'buy' ? 'Buy' : 'Sell'} ${formData.symbol || 'Stock'}`
          )}
        </button>

        {/* Paper Trading Warning */}
        <div className="text-xs text-blue-600 dark:text-blue-400 text-center">
          <span className="inline-flex items-center">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Paper trading - No real money involved
          </span>
        </div>
      </form>
    </div>
  );
};

export default TradeOrderForm;