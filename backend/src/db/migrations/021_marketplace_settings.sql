-- Create marketplace_settings table
CREATE TABLE IF NOT EXISTS marketplace_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    commission_percent DECIMAL(5, 2) DEFAULT 10.00,
    gateway_bearer VARCHAR(20) DEFAULT 'Institution', -- 'Platform' or 'Institution'
    min_payout DECIMAL(10, 2) DEFAULT 1000.00,
    settlement_cycle VARCHAR(20) DEFAULT 'Weekly', -- 'Daily', 'Weekly', 'Monthly'
    auto_settlement BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_id CHECK (id = 1)
);

-- Pre-populate default row
INSERT INTO marketplace_settings (id, commission_percent, gateway_bearer, min_payout, settlement_cycle, auto_settlement)
VALUES (1, 10.00, 'Institution', 1000.00, 'Weekly', FALSE)
ON CONFLICT (id) DO NOTHING;
