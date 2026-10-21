-- ============================================================
-- Ticket Lite: Cloudflare D1 SQL Schema for Promoter Accounts
-- Compatible with Cloudflare Workers, Pages Functions & D1 (SQLite)
-- ============================================================

-- Promoter Accounts Table
CREATE TABLE IF NOT EXISTS promoter_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast promoter email lookup during authentication
CREATE INDEX IF NOT EXISTS idx_promoter_accounts_email ON promoter_accounts(email);

-- Events Table (prepared for Cloudflare D1 migration)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    promoter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT,
    location TEXT,
    image_url TEXT,
    palette_json TEXT,
    tickets_json TEXT,
    fees_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (promoter_id) REFERENCES promoter_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_promoter_id ON events(promoter_id);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    promoter_id TEXT,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    items_json TEXT NOT NULL,
    base_total REAL NOT NULL,
    fees_json TEXT,
    total_amount REAL NOT NULL,
    stripe_session_id TEXT,
    stripe_payment_intent_id TEXT,
    payment_status TEXT DEFAULT 'paid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_session_id);

-- Stripe Webhook Events Log
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

-- Individual Scannable Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    ticket_tier_name TEXT NOT NULL,
    price REAL NOT NULL,
    note TEXT,
    check_in_status TEXT DEFAULT 'valid',
    checked_in_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_check_in_status ON tickets(check_in_status);

-- Seed default promoter account for initial testing (password: password123)
-- Stored using salted SHA-256 format: "salt:hash"
INSERT OR IGNORE INTO promoter_accounts (id, name, organization_name, phone_number, email, password_hash)
VALUES (
    'promoter-demo-1',
    'Tyler Vance',
    'Ticket Lite Live Productions',
    '(555) 019-2834',
    'promoter@vtix.com',
    '4f8a1c92b5e7d360a8f1e2d3c4b5a697:7e03ec0aae59f677aa33a7f3cf46251c6cb6ce0a4168dd7df3357e0a113e6d42'
);

