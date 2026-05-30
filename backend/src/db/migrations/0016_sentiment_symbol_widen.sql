-- Sector keys (e.g. CONSUMER_DISCRETIONARY, INFORMATION_TECHNOLOGY) exceeded varchar(10).
ALTER TABLE sentiment_scores
  ALTER COLUMN symbol TYPE varchar(64);
