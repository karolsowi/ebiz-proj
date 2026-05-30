-- Migration: add calendar reminders table
-- Description: persists personal calendar reminders for authenticated users

CREATE TABLE IF NOT EXISTS calendar_reminders (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    end_at TIMESTAMP WITH TIME ZONE,
    all_day BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calendar_reminders_start_at_idx
    ON calendar_reminders(start_at);

CREATE INDEX IF NOT EXISTS calendar_reminders_created_by_idx
    ON calendar_reminders(created_by);

-- Ensure updated_at trigger function exists.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_calendar_reminders_updated_at ON calendar_reminders;
CREATE TRIGGER update_calendar_reminders_updated_at
    BEFORE UPDATE ON calendar_reminders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
