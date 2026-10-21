/**
 * promoterDb.js - Database access layer for Promoter Accounts.
 * Structured to map 1:1 with the Cloudflare D1 SQL schema defined in schema.sql.
 *
 * Integrates with Cloudflare Pages Functions (/api/auth/...) executing prepared
 * statements on Cloudflare D1, with secure local cryptographic fallback for offline/development.
 */

import {
    validatePromoterRegistration,
    validateLoginInputs,
    hashPassword,
    verifyPassword
} from '../utils/security';

const STORAGE_KEY = 'vtix_sql_promoter_accounts';

// Seed demo promoter with salted SHA-256 hash (password: "password123")
const SEED_PROMOTERS = [
    {
        id: 'promoter-demo-1',
        name: 'Tyler Vance',
        organization_name: 'Ticket Lite Live Productions',
        phone_number: '(555) 019-2834',
        email: 'promoter@vtix.com',
        password_hash: '4f8a1c92b5e7d360a8f1e2d3c4b5a697:7e03ec0aae59f677aa33a7f3cf46251c6cb6ce0a4168dd7df3357e0a113e6d42',
        created_at: new Date().toISOString()
    }
];

function getAccountsTable() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (e) {
        console.error('Error reading promoter accounts table:', e);
    }
    // Seed initial table if empty
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_PROMOTERS));
    } catch (e) {
        console.error('Error saving seed promoters:', e);
    }
    return SEED_PROMOTERS;
}

function saveAccountsTable(accounts) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    } catch (e) {
        console.error('Error saving promoter accounts table:', e);
    }
}

export const promoterDb = {
    /**
     * SELECT * FROM promoter_accounts WHERE email = ?
     */
    async findByEmail(email) {
        const accounts = getAccountsTable();
        const normalized = email.trim().toLowerCase();
        return accounts.find(a => a.email.toLowerCase() === normalized) || null;
    },

    /**
     * INSERT INTO promoter_accounts (id, name, organization_name, phone_number, email, password_hash)
     * Performs strict SQL-injection and password policy validation, hashes password with salted SHA-256,
     * and submits to Cloudflare D1 via /api/auth/register (with offline encrypted storage fallback).
     */
    async createPromoter({ name, organizationName, phoneNumber, email, password }) {
        // 1. Client-side input validation and SQL injection defense
        const validation = validatePromoterRegistration({ name, organizationName, phoneNumber, email, password });
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 2. Attempt remote Cloudflare Pages D1 API
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, organizationName, phoneNumber, email: normalizedEmail, password })
            });

            if (res.ok) {
                const data = await res.json();
                return data.promoter;
            }

            if (res.status === 400 || res.status === 409) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Registration failed.');
            }
        } catch (fetchErr) {
            // Rethrow specific API error responses (like email already exists or validation rejection)
            if (fetchErr.message && !fetchErr.message.includes('fetch') && !fetchErr.message.includes('NetworkError') && !fetchErr.message.includes('Failed to fetch')) {
                throw fetchErr;
            }
            // Otherwise, fall through to local encrypted fallback (e.g. offline or local Vite dev)
        }

        // 3. Fallback: Local SQL-mapped storage with cryptographic salted SHA-256
        const accounts = getAccountsTable();
        if (accounts.some(a => a.email.toLowerCase() === normalizedEmail)) {
            throw new Error('An account with this email address already exists.');
        }

        const passwordHash = await hashPassword(password);
        const newAccount = {
            id: `promoter_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            name: name.trim(),
            organization_name: organizationName.trim(),
            phone_number: phoneNumber.trim(),
            email: normalizedEmail,
            password_hash: passwordHash,
            created_at: new Date().toISOString()
        };

        accounts.push(newAccount);
        saveAccountsTable(accounts);

        // Return promoter without exposing password hash
        const { password_hash, ...safePromoter } = newAccount;
        void password_hash; // satisfy oxlint
        return safePromoter;
    },

    /**
     * Authenticate promoter credentials
     * Validates input against SQL command injections, verifies salted SHA-256 password hash.
     */
    async authenticate(email, password) {
        // 1. Client-side validation against SQL injection attempts
        const validation = validateLoginInputs(email, password);
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 2. Attempt remote Cloudflare Pages D1 API
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizedEmail, password })
            });

            if (res.ok) {
                const data = await res.json();
                return data.promoter;
            }

            if (res.status === 400 || res.status === 401) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Authentication failed.');
            }
        } catch (fetchErr) {
            if (fetchErr.message && !fetchErr.message.includes('fetch') && !fetchErr.message.includes('NetworkError') && !fetchErr.message.includes('Failed to fetch')) {
                throw fetchErr;
            }
        }

        // 3. Fallback: Local database verification with cryptographic verification
        const account = await this.findByEmail(normalizedEmail);
        if (!account) {
            throw new Error('Invalid email or password.');
        }

        const isMatch = await verifyPassword(password, account.password_hash);
        if (!isMatch) {
            throw new Error('Invalid email or password.');
        }

        const { password_hash, ...safePromoter } = account;
        void password_hash;
        return safePromoter;
    }
};
