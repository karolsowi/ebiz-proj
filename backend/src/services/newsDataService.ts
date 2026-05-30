/**
 * NewsData.io fetcher — API key supplied per user via credentialResolver.
 */

const NEWSDATA_BASE_URL = 'https://newsdata.io/api/1/news';

export interface NewsDataArticle {
  title: string;
  headline?: string;
  summary?: string;
  content?: string;
  url: string;
  image?: string;
  imageUrl?: string;
  source: string;
  publishedAt: Date;
  datetime?: number;
  symbols?: string[];
  category?: string;
}

export interface FetchNewsDataOptions {
  symbol?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
  category?: string | undefined;
}

export async function fetchNewsDataArticles(
  apiKey: string,
  options: FetchNewsDataOptions = {}
): Promise<NewsDataArticle[]> {
  if (!apiKey || apiKey === 'demo') {
    return [];
  }

  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const q =
    options.query?.trim() ||
    (options.symbol ? `${options.symbol} stock` : 'financial markets stock');

  const params = new URLSearchParams({
    apikey: apiKey,
    q,
    language: 'en',
    category: 'business',
    size: String(limit),
  });

  const res = await fetch(`${NEWSDATA_BASE_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`NewsData.io HTTP ${res.status}: ${res.statusText}`);
  }

  const body = (await res.json()) as {
    status?: string;
    message?: string;
    results?: Array<{
      title?: string;
      description?: string;
      content?: string;
      link?: string;
      image_url?: string;
      source_id?: string;
      pubDate?: string;
    }>;
  };

  if (body.status !== 'success') {
    throw new Error(body.message || 'NewsData.io API error');
  }

  const symbol = options.symbol?.toUpperCase();

  return (body.results ?? []).map((article) => {
    const publishedAt = article.pubDate ? new Date(article.pubDate) : new Date();
    const title = article.title ?? '';
    const row: NewsDataArticle = {
      title,
      headline: title,
      summary: article.description ?? article.content ?? '',
      content: article.content ?? article.description ?? '',
      url: article.link ?? '',
      source: article.source_id || 'NewsData.io',
      publishedAt,
      datetime: Math.floor(publishedAt.getTime() / 1000),
      symbols: symbol ? [symbol] : [],
      category: options.category || 'business',
    };
    if (article.image_url) {
      row.image = article.image_url;
      row.imageUrl = article.image_url;
    }
    return row;
  });
}
