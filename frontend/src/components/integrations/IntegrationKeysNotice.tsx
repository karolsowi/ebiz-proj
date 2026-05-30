import { Link } from 'react-router-dom';

type IntegrationKeysNoticeProps = {
  service: 'alpaca' | 'reddit' | 'news';
  title?: string;
  description?: string;
};

const COPY: Record<
  IntegrationKeysNoticeProps['service'],
  { title: string; description: string }
> = {
  alpaca: {
    title: 'Alpaca API keys not configured',
    description:
      'Connect your own Alpaca paper trading keys to view account data, positions, and place orders. Data from other users is never shown.',
  },
  reddit: {
    title: 'Reddit API keys not configured',
    description:
      'You can browse shared sentiment data already stored in the app. To fetch new posts from Reddit, add your own API keys.',
  },
  news: {
    title: 'News API keys not configured',
    description:
      'Headlines and sentiment charts use shared data already in the database. To pull new articles from providers, add NewsData.io and/or Finnhub keys.',
  },
};

export default function IntegrationKeysNotice({
  service,
  title,
  description,
}: IntegrationKeysNoticeProps) {
  const defaults = COPY[service];

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/20">
      <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
        {title ?? defaults.title}
      </h3>
      <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
        {description ?? defaults.description}
      </p>
      <Link
        to="/account/authentication"
        className="mt-4 inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
      >
        Add API keys
      </Link>
    </div>
  );
}
