CREATE MATERIALIZED VIEW IF NOT EXISTS sentiment_momentum_24_48h AS
WITH agg AS (
  SELECT
    symbol,
    source,
    timeframe,
    AVG(
      CASE
        WHEN updated_at >= (NOW() - INTERVAL '24 hours')
        THEN CAST(average_sentiment AS DOUBLE PRECISION)
        ELSE NULL
      END
    ) AS sentiment_24h,
    AVG(
      CASE
        WHEN updated_at < (NOW() - INTERVAL '24 hours')
          AND updated_at >= (NOW() - INTERVAL '48 hours')
        THEN CAST(average_sentiment AS DOUBLE PRECISION)
        ELSE NULL
      END
    ) AS sentiment_prev_24h,
    SUM(
      CASE
        WHEN updated_at >= (NOW() - INTERVAL '24 hours')
        THEN COALESCE(total_mentions, 0)
        ELSE 0
      END
    ) AS mentions_24h,
    SUM(
      CASE
        WHEN updated_at < (NOW() - INTERVAL '24 hours')
          AND updated_at >= (NOW() - INTERVAL '48 hours')
        THEN COALESCE(total_mentions, 0)
        ELSE 0
      END
    ) AS mentions_prev_24h,
    AVG(
      CASE
        WHEN updated_at >= (NOW() - INTERVAL '24 hours')
        THEN CAST(confidence_score AS DOUBLE PRECISION)
        ELSE NULL
      END
    ) AS confidence_24h
  FROM sentiment_scores
  WHERE updated_at >= (NOW() - INTERVAL '48 hours')
  GROUP BY symbol, source, timeframe
)
SELECT
  symbol,
  source,
  timeframe,
  COALESCE(sentiment_24h, 0)::NUMERIC(8, 4) AS sentiment_24h,
  COALESCE(sentiment_prev_24h, 0)::NUMERIC(8, 4) AS sentiment_prev_24h,
  (COALESCE(sentiment_24h, 0) - COALESCE(sentiment_prev_24h, 0))::NUMERIC(8, 4) AS momentum_score,
  mentions_24h,
  mentions_prev_24h,
  COALESCE(confidence_24h, 0)::NUMERIC(8, 4) AS confidence_24h,
  NOW() AS computed_at
FROM agg;

CREATE UNIQUE INDEX IF NOT EXISTS sentiment_momentum_24_48h_uniq_idx
  ON sentiment_momentum_24_48h (symbol, source, timeframe);

CREATE INDEX IF NOT EXISTS sentiment_momentum_24_48h_momentum_idx
  ON sentiment_momentum_24_48h (momentum_score DESC);
