-- ============================================================
-- V-Tix Lite: Cloudflare D1 SQL Schema for Promoter Accounts
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

-- Orders Table (with 12-digit order ID)
CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY, -- Randomly generated 12-digit number (e.g. '839201948572')
    event_id TEXT NOT NULL,
    promoter_id TEXT,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    items_json TEXT NOT NULL,
    base_total REAL NOT NULL,
    fees_json TEXT,
    total_amount REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);

-- Individual Scannable Tickets Table (Associated with 12-digit Order ID)
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id TEXT PRIMARY KEY, -- Unique pass ID (e.g. '839201948572-01')
    order_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    ticket_tier_name TEXT NOT NULL,
    price REAL NOT NULL,
    note TEXT,
    check_in_status TEXT DEFAULT 'valid', -- 'valid' | 'checked_in'
    checked_in_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_check_in_status ON tickets(check_in_status);

-- Seed default promoter account for initial local testing
INSERT OR IGNORE INTO promoter_accounts (id, name, organization_name, phone_number, email, password_hash)
VALUES (
    'promoter-demo-1',
    'Tyler Vance',
    'V-Tix Live Productions',
    '(555) 019-2834',
    'promoter@vtix.com',
    'password123'
);

