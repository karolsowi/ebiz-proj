-- Sprint B follow-up: scope API response cache by user when data is private

DROP INDEX IF EXISTS "api_cache_endpoint_hash_source_idx";

ALTER TABLE "api_response_cache"
  ADD COLUMN IF NOT EXISTS "user_id" VARCHAR(64) NOT NULL DEFAULT 'public';

CREATE UNIQUE INDEX IF NOT EXISTS "api_cache_user_endpoint_hash_source_idx"
  ON "api_response_cache" ("user_id", "endpoint", "param_hash", "source");

CREATE INDEX IF NOT EXISTS "api_cache_user_id_idx"
  ON "api_response_cache" ("user_id");
