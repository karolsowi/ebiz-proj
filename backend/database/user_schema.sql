-- User Management Tables with Encryption Support

-- Main users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT, -- For future authentication
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    avatar TEXT,
    phone_number VARCHAR(50),
    timezone VARCHAR(100) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    bio TEXT,
    date_joined TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    email_verified BOOLEAN DEFAULT FALSE,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret TEXT, -- Encrypted TOTP secret
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User settings (encrypted storage)
CREATE TABLE IF NOT EXISTS user_settings (
    user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_data TEXT NOT NULL, -- Encrypted JSON blob
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys (encrypted storage)
CREATE TABLE IF NOT EXISTS user_api_keys (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    service VARCHAR(50) NOT NULL, -- 'alpaca', 'alphavantage', 'finnhub', etc.
    encrypted_api_key TEXT NOT NULL, -- Encrypted API key
    encrypted_secret_key TEXT, -- Encrypted secret key (if applicable)
    metadata JSONB, -- Additional metadata (paper trading, etc.)
    is_active BOOLEAN DEFAULT TRUE,
    last_used TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Security settings and 2FA backup codes
CREATE TABLE IF NOT EXISTS user_security (
    user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    backup_codes TEXT[], -- Array of encrypted backup codes
    recovery_email VARCHAR(255),
    password_reset_token TEXT,
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trusted devices for 2FA
CREATE TABLE IF NOT EXISTS user_trusted_devices (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    device_fingerprint TEXT NOT NULL, -- Browser/device fingerprint
    ip_address INET,
    location VARCHAR(255),
    user_agent TEXT,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Login history for security monitoring
CREATE TABLE IF NOT EXISTS user_login_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address INET,
    location VARCHAR(255),
    user_agent TEXT,
    device_info JSONB,
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_session_data TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log for sensitive operations
CREATE TABLE IF NOT EXISTS user_audit_log (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL, -- 'profile_update', 'api_key_added', etc.
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_service ON user_api_keys(user_id, service);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON user_api_keys(user_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_login_history_user_time ON user_login_history(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON user_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON user_audit_log(user_id, timestamp DESC);

-- Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply the trigger to relevant tables
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at 
    BEFORE UPDATE ON user_settings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_security_updated_at 
    BEFORE UPDATE ON user_security 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert a default user for development
INSERT INTO users (
    id, email, first_name, last_name, timezone, language, 
    bio, email_verified, two_factor_enabled
) VALUES (
    'user_123',
    'randomuser@pimjo.com',
    'Karol',
    'Nowak',
    'Europe/Warsaw',
    'en',
    'Investment enthusiast and trader focused on long-term value creation.',
    TRUE,
    FALSE
) ON CONFLICT (id) DO NOTHING;

-- Insert default settings for the user
INSERT INTO user_settings (user_id, settings_data) VALUES (
    'user_123',
    '{"theme":"system","language":"en","timezone":"Europe/Warsaw","currency":"USD","dateFormat":"MM/DD/YYYY","numberFormat":"en-US","defaultChartType":"candlestick","refreshInterval":30,"emailNotifications":true,"pushNotifications":true,"tradingAlerts":true,"priceAlerts":true,"newsAlerts":false,"marketUpdates":true,"dataSharing":false,"analyticsTracking":true,"profileVisibility":"private","paperTradingMode":true,"confirmOrders":true,"autoSavePositions":true,"riskWarnings":true,"dataRetention":365,"autoBackup":true,"exportFormat":"json"}'
) ON CONFLICT (user_id) DO NOTHING;