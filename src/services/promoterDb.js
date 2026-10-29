/**
 * promoterDb.js - Client API layer for Promoter Accounts.
 * Communicates with Cloudflare Pages Functions (/api/auth/login and /api/auth/register)
 * backed by Cloudflare D1 and PBKDF2-SHA256 / HMAC-SHA256 session tokens.
 */

import {
    validatePromoterRegistration,
    validateLoginInputs
} from '../utils/security';

export const promoterDb = {
    /**
     * Registers a new promoter account in Cloudflare D1 via /api/auth/register.
     */
    async createPromoter({ name, organizationName, phoneNumber, email, password, stripeAccountId, defaultCurrency }) {
        const validation = validatePromoterRegistration({ name, organizationName, phoneNumber, email, password });
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        const normalizedEmail = email.trim().toLowerCase();

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                name,
                organizationName,
                phoneNumber,
                email: normalizedEmail,
                password,
                stripeAccountId: stripeAccountId || null,
                defaultCurrency: defaultCurrency || 'cad'
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Registration failed (HTTP ${res.status}).`);
        }

        return {
            ...data.promoter,
            token: data.token || null
        };
    },

    /**
     * Authenticates promoter credentials against Cloudflare D1 via /api/auth/login.
     */
    async authenticate(email, password) {
        const validation = validateLoginInputs(email, password);
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        const normalizedEmail = email.trim().toLowerCase();

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email: normalizedEmail, password })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Authentication failed (HTTP ${res.status}).`);
        }

        return {
            ...data.promoter,
            token: data.token || null
        };
    }
};
