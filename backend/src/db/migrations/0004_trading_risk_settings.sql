CREATE TABLE IF NOT EXISTS trading_risk_settings (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES trading_accounts(id),
  max_position_size_percent DECIMAL(8, 4) NOT NULL DEFAULT 20,
  daily_loss_limit DECIMAL(18, 2) NOT NULL DEFAULT 2000,
  per_trade_risk_percent DECIMAL(8, 4) NOT NULL DEFAULT 2,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS trading_risk_settings_account_id_idx
  ON trading_risk_settings(account_id);
