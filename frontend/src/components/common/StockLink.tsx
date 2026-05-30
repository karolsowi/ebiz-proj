import { Link } from 'react-router-dom';

interface StockLinkProps {
  symbol: string;
  className?: string;
  showTooltip?: boolean;
}

/**
 * Renders a stock symbol as a clickable link to the stock detail page.
 *
 * Usage: <StockLink symbol="AAPL" />
 */
export default function StockLink({ symbol, className, showTooltip = true }: StockLinkProps) {
  return (
    <Link
      to={`/market/stocks/${symbol}`}
      className={
        className ??
        'font-semibold text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 hover:underline cursor-pointer transition-colors'
      }
      title={showTooltip ? `View ${symbol} details` : undefined}
    >
      {symbol}
    </Link>
  );
}
