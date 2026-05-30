-- Resumable Reddit historical import: cursors + phase per subreddit

CREATE TABLE IF NOT EXISTS reddit_backfill_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  since_ts TIMESTAMPTZ NOT NULL DEFAULT '2020-01-01T00:00:00.000Z',
  min_score INTEGER NOT NULL DEFAULT 50,
  min_comments INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO reddit_backfill_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS reddit_backfill_progress (
  subreddit VARCHAR(100) PRIMARY KEY,
  phase VARCHAR(20) NOT NULL DEFAULT 'top',
  after_top TEXT,
  after_new TEXT,
  top_complete BOOLEAN NOT NULL DEFAULT FALSE,
  new_history_complete BOOLEAN NOT NULL DEFAULT FALSE,
  live_started_at TIMESTAMPTZ,
  last_chunk_at TIMESTAMPTZ,
  listing_calls_total INTEGER NOT NULL DEFAULT 0,
  posts_ingested_total INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reddit_backfill_progress_phase_idx ON reddit_backfill_progress (phase);
