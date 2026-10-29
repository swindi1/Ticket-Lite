-- ============================================================
-- Ticket Lite: Cloudflare D1 SQL Schema
-- Compatible with Cloudflare Workers, Pages Functions & D1 (SQLite)
-- All monetary amounts are stored as integer minor units (cents)
-- ============================================================

-- Promoter Accounts Table
CREATE TABLE IF NOT EXISTS promoter_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    stripe_account_id TEXT,
    default_currency TEXT NOT NULL DEFAULT 'cad',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast promoter email lookup during authentication
CREATE INDEX IF NOT EXISTS idx_promoter_accounts_email ON promoter_accounts(email);

-- Events Table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    promoter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT,
    location TEXT,
    currency TEXT NOT NULL DEFAULT 'cad',
    stripe_account_id TEXT,
    image_url TEXT,
    palette_json TEXT,
    tickets_json TEXT NOT NULL,
    fees_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (promoter_id) REFERENCES promoter_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_promoter_id ON events(promoter_id);

-- Orders Table (Monetary amounts stored in integer cents; payment_status defaults to 'pending')
CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    promoter_id TEXT,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    currency TEXT NOT NULL DEFAULT 'cad',
    items_json TEXT NOT NULL,
    base_total_cents INTEGER NOT NULL,
    fees_json TEXT,
    total_amount_cents INTEGER NOT NULL,
    stripe_session_id TEXT,
    stripe_payment_intent_id TEXT,
    stripe_destination_account TEXT,
    pass_token TEXT,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_session_id);

-- Stripe Webhook Events Log (Idempotency & Audit Trail)
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    stripe_session_id TEXT,
    order_id TEXT,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhooks_order_id ON stripe_webhook_events(order_id);

-- Individual Scannable Tickets Table (Price stored in integer cents)
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    ticket_tier_name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    note TEXT,
    check_in_status TEXT NOT NULL DEFAULT 'valid',
    checked_in_at DATETIME,
    checked_in_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_check_in_status ON tickets(check_in_status);
