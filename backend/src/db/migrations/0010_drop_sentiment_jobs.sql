-- Sprint cleanup: retire the legacy sentiment job queue.
-- Reddit sentiment is processed directly from unanalyzed posts/comments by redditSentimentAnalyzer.

DROP TABLE IF EXISTS "sentiment_jobs";
