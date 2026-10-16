/**
 * promoterDb.js - Database access layer for Promoter Accounts.
 * Structured to map 1:1 with the Cloudflare D1 SQL schema defined in schema.sql.
 *
 * Currently backed by browser persistence (vtix_sql_promoter_accounts) with async signatures,
 * making it ready to be swapped with Cloudflare Workers / D1 API endpoints (`/api/...`).
 */

const STORAGE_KEY = 'vtix_sql_promoter_accounts';

const SEED_PROMOTERS = [
    {
        id: 'promoter-demo-1',
        name: 'Tyler Vance',
        organization_name: 'Ticket Lite Live Productions',
        phone_number: '(555) 019-2834',
        email: 'promoter@vtix.com',
        password_hash: 'password123',
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
     */
    async createPromoter({ name, organizationName, phoneNumber, email, password }) {
        const accounts = getAccountsTable();
        const normalizedEmail = email.trim().toLowerCase();

        if (accounts.some(a => a.email.toLowerCase() === normalizedEmail)) {
            throw new Error('An account with this email address already exists.');
        }

        const newAccount = {
            id: `promoter_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            name: name.trim(),
            organization_name: organizationName.trim(),
            phone_number: phoneNumber.trim(),
            email: normalizedEmail,
            password_hash: password, // In production with Cloudflare D1, hash via crypto.subtle.digest('SHA-256', ...)
            created_at: new Date().toISOString()
        };

        accounts.push(newAccount);
        saveAccountsTable(accounts);
        return newAccount;
    },

    /**
     * Validate promoter credentials
     */
    async authenticate(email, password) {
        const account = await this.findByEmail(email);
        if (!account) {
            throw new Error('No promoter account found with this email.');
        }
        if (account.password_hash !== password) {
            throw new Error('Incorrect password. Please try again.');
        }
        return account;
    }
};
