ALTER TABLE "user_api_keys"
  ADD COLUMN IF NOT EXISTS "api_key_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "secret_key_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "paper_trading" BOOLEAN NOT NULL DEFAULT TRUE;
