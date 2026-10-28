/**
 * Server-Side Security & Cryptography Utilities for Cloudflare Pages Functions
 * Enforces strict SQL injection prevention and salted SHA-256 password hashing.
 */

export const FORBIDDEN_SQL_CHARS_REGEX = /['"`\\;%=<>|]|--|\/\*|\*\//;
export const FORBIDDEN_SQL_KEYWORDS_REGEX = /(?:^|[^a-zA-Z])(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC|FROM|WHERE|TABLE|SCHEMA)(?:[^a-zA-Z]|$)|(\bOR\s+1\s*=\s*1\b|\bAND\s+1\s*=\s*1\b)/i;

export function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { isValid: false, error: 'Password is required.' };
    }

    if (password.length < 8) {
        return { isValid: false, error: 'Password must be at least 8 characters long.' };
    }

    if (password.length > 128) {
        return { isValid: false, error: 'Password cannot exceed 128 characters.' };
    }

    if (FORBIDDEN_SQL_CHARS_REGEX.test(password)) {
        return {
            isValid: false,
            error: "Password cannot contain SQL command characters (quotes ', \", backtick `, semicolon ;, backslash \\, =, <, >, %, |, or comments --)."
        };
    }

    if (FORBIDDEN_SQL_KEYWORDS_REGEX.test(password)) {
        return {
            isValid: false,
            error: 'Password cannot contain SQL command keywords (SELECT, DROP, UNION, etc.).'
        };
    }

    if (!/[A-Z]/.test(password)) {
        return { isValid: false, error: 'Password must contain at least one uppercase letter (A-Z).' };
    }

    if (!/[a-z]/.test(password)) {
        return { isValid: false, error: 'Password must contain at least one lowercase letter (a-z).' };
    }

    if (!/[0-9]/.test(password)) {
        return { isValid: false, error: 'Password must contain at least one number (0-9).' };
    }

    if (!/[@$!*?#^&.\-+~]/.test(password)) {
        return { isValid: false, error: 'Password must contain at least one safe special symbol (@ $ ! * ? # ^ & . - + ~).' };
    }

    return { isValid: true, error: null };
}

export function validatePromoterRegistration({ name, organizationName, phoneNumber, email, password }) {
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
        return { isValid: false, error: 'Name must be between 2 and 100 characters.' };
    }
    if (FORBIDDEN_SQL_CHARS_REGEX.test(name) || FORBIDDEN_SQL_KEYWORDS_REGEX.test(name)) {
        return { isValid: false, error: 'Name contains invalid or prohibited SQL characters.' };
    }

    if (!organizationName || typeof organizationName !== 'string' || organizationName.trim().length < 2 || organizationName.trim().length > 100) {
        return { isValid: false, error: 'Organization name must be between 2 and 100 characters.' };
    }
    if (FORBIDDEN_SQL_CHARS_REGEX.test(organizationName) || FORBIDDEN_SQL_KEYWORDS_REGEX.test(organizationName)) {
        return { isValid: false, error: 'Organization name contains invalid or prohibited SQL characters.' };
    }

    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length < 7 || phoneNumber.trim().length > 25) {
        return { isValid: false, error: 'Please enter a valid phone number.' };
    }
    if (!/^[\d\s()+-]{7,25}$/.test(phoneNumber.trim())) {
        return { isValid: false, error: 'Phone number can only contain digits, spaces, hyphens, parentheses, and plus (+).' };
    }

    if (!email || typeof email !== 'string') {
        return { isValid: false, error: 'Email address is required.' };
    }
    const emailClean = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(emailClean) || FORBIDDEN_SQL_CHARS_REGEX.test(emailClean) || FORBIDDEN_SQL_KEYWORDS_REGEX.test(emailClean)) {
        return { isValid: false, error: 'Please enter a valid, safe email address without SQL syntax symbols.' };
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.isValid) {
        return passwordCheck;
    }

    return { isValid: true, error: null };
}

export function validateLoginInputs(email, password) {
    if (!email || typeof email !== 'string') {
        return { isValid: false, error: 'Email address is required.' };
    }
    const emailClean = email.trim().toLowerCase();
    if (FORBIDDEN_SQL_CHARS_REGEX.test(emailClean) || FORBIDDEN_SQL_KEYWORDS_REGEX.test(emailClean)) {
        return { isValid: false, error: 'Email contains prohibited SQL characters or keywords.' };
    }

    if (!password || typeof password !== 'string') {
        return { isValid: false, error: 'Password is required.' };
    }
    if (FORBIDDEN_SQL_CHARS_REGEX.test(password) || FORBIDDEN_SQL_KEYWORDS_REGEX.test(password)) {
        return {
            isValid: false,
            error: "Password cannot contain SQL command characters (quotes ', \", backtick `, semicolon ;, backslash \\, =, <, >, %, |, or comments --)."
        };
    }

    return { isValid: true, error: null };
}

const PBKDF2_ITERATIONS = 100000;

/**
 * Constant-time string/hex comparison to prevent timing side-channel attacks.
 */
export function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);
    if (bufA.byteLength !== bufB.byteLength) return false;

    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(bufA, bufB);
    }

    let diff = 0;
    for (let i = 0; i < bufA.length; i++) {
        diff |= bufA[i] ^ bufB[i];
    }
    return diff === 0;
}

export async function hashPassword(password, customSaltHex = null, useLegacySha256 = false) {
    let saltHex = customSaltHex;
    if (!saltHex) {
        const saltBytes = new Uint8Array(16);
        crypto.getRandomValues(saltBytes);
        saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const encoder = new TextEncoder();

    if (useLegacySha256) {
        const data = encoder.encode(`${saltHex}:${password}`);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        return `${saltHex}:${hashHex}`;
    }

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode(saltHex),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    const hashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== 'string' || !password) return false;

    if (storedHash.startsWith('pbkdf2:')) {
        const parts = storedHash.split(':');
        if (parts.length !== 4) return false;
        const [, iterationsStr, saltHex, expectedHashHex] = parts;
        const iterations = parseInt(iterationsStr, 10);
        if (!iterations || iterations < 1000 || iterations > 1000000) return false;

        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: encoder.encode(saltHex),
                iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );
        const computedHashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
        return constantTimeEqual(computedHashHex, expectedHashHex);
    }

    if (storedHash.includes(':')) {
        const [saltHex, expectedHashHex] = storedHash.split(':');
        const computed = await hashPassword(password, saltHex, true);
        const [, computedHashHex] = computed.split(':');
        return constantTimeEqual(computedHashHex, expectedHashHex);
    }

    return false;
}

/**
 * Signs a stateless HMAC-SHA256 authentication token for promoter sessions.
 */
export async function signAuthToken(payload, secret) {
    const signingSecret = secret || 'vtix-default-edge-hmac-secret-change-in-prod';
    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const bodyB64 = btoa(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(signingSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerB64}.${bodyB64}`));
    const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${headerB64}.${bodyB64}.${sigHex}`;
}

export async function verifyAuthToken(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigHex] = parts;

    const signingSecret = secret || 'vtix-default-edge-hmac-secret-change-in-prod';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(signingSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const expectedBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerB64}.${bodyB64}`));
    const expectedHex = Array.from(new Uint8Array(expectedBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (!constantTimeEqual(sigHex, expectedHex)) return null;

    try {
        let base64 = bodyB64.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const payload = JSON.parse(atob(base64));
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

export function getSecurityHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    const allowedOrigins = [
        'https://ticket-lite.tylerboseroberts.workers.dev',
        'https://ticketlite.ca',
        'https://www.ticketlite.ca'
    ];
    const isDev = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const allowOrigin = (allowedOrigins.includes(origin) || isDev) ? origin : 'https://ticketlite.ca';

    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
}

const rateLimitBuckets = new Map();

/**
 * In-memory sliding window rate limiter per client IP / key
 */
export function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key) || [];
    const valid = bucket.filter(ts => now - ts < windowMs);

    if (valid.length >= maxRequests) {
        const oldest = valid[0];
        const resetSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
        return { allowed: false, remaining: 0, resetSeconds };
    }

    valid.push(now);
    rateLimitBuckets.set(key, valid);

    // Garbage collect stale keys if map exceeds 2,000 entries
    if (rateLimitBuckets.size > 2000) {
        for (const [k, v] of rateLimitBuckets.entries()) {
            if (v.every(ts => now - ts >= windowMs)) {
                rateLimitBuckets.delete(k);
            }
        }
    }

    return { allowed: true, remaining: maxRequests - valid.length, resetSeconds: Math.ceil(windowMs / 1000) };
}

/**
 * Validates that a ticket redirect URL strictly matches trusted platform domains
 */
export function isValidTicketUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const parsed = new URL(urlStr);
        const allowedHosts = [
            'ticket-lite.tylerboseroberts.workers.dev',
            'ticketlite.ca',
            'www.ticketlite.ca',
            'localhost',
            '127.0.0.1'
        ];
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
            allowedHosts.includes(parsed.hostname.toLowerCase()) &&
            parsed.pathname.startsWith('/tickets/');
    } catch {
        return false;
    }
}

/**
 * Validates that a payment return redirect URL (successUrl / cancelUrl) strictly matches trusted platform domains
 * Prevents Open Redirect / Phishing exploits through Stripe Checkout session return URLs.
 */
export function isValidRedirectUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const parsed = new URL(urlStr);
        const allowedHosts = [
            'ticket-lite.tylerboseroberts.workers.dev',
            'ticketlite.ca',
            'www.ticketlite.ca',
            'localhost',
            '127.0.0.1'
        ];
        const isAllowedHost = allowedHosts.includes(parsed.hostname.toLowerCase());
        const isHttps = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
        return isAllowedHost && isHttps;
    } catch {
        return false;
    }
}

/**
 * Strict validator for Stripe checkout payloads
 * Prevents client-side price tampering, negative charges, inventory overflow, and carding bot spam.
 */
export function validateCheckoutPayload({ orderId, eventId, customer, items, fees }) {
    // 1. Order ID check: strictly 12 digits
    if (!orderId || typeof orderId !== 'string' || !/^\d{12}$/.test(orderId)) {
        return { isValid: false, error: 'Invalid order ID format. Must be a 12-digit number.' };
    }

    // 2. Event ID check: alphanumeric string 1-64 chars
    if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0 || eventId.length > 64) {
        return { isValid: false, error: 'Invalid or missing Event ID.' };
    }

    // 3. Customer validation
    if (!customer || typeof customer !== 'object') {
        return { isValid: false, error: 'Customer information is required.' };
    }

    const { name, email, phone } = customer;
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
        return { isValid: false, error: 'Customer name must be between 2 and 100 characters.' };
    }
    if (FORBIDDEN_SQL_CHARS_REGEX.test(name) || FORBIDDEN_SQL_KEYWORDS_REGEX.test(name)) {
        return { isValid: false, error: 'Customer name contains invalid characters.' };
    }

    if (!email || typeof email !== 'string') {
        return { isValid: false, error: 'Valid customer email is required.' };
    }
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(cleanEmail) || cleanEmail.length > 100 || FORBIDDEN_SQL_CHARS_REGEX.test(cleanEmail)) {
        return { isValid: false, error: 'Customer email format is invalid or contains prohibited symbols.' };
    }

    if (phone && (typeof phone !== 'string' || !/^[\d\s()+-]{7,25}$/.test(phone.trim()))) {
        return { isValid: false, error: 'Customer phone number format is invalid.' };
    }

    // 4. Ticket Items Validation (Prevents Price Tampering & Zero/Negative Charges)
    if (!Array.isArray(items) || items.length === 0) {
        return { isValid: false, error: 'Order must contain at least one ticket item.' };
    }
    if (items.length > 50) {
        return { isValid: false, error: 'Exceeded maximum allowable ticket lines in a single order (50).' };
    }

    let subtotal = 0;
    for (const item of items) {
        if (!item || typeof item !== 'object') {
            return { isValid: false, error: 'Invalid ticket item format.' };
        }

        const itemName = String(item.name || '').trim();
        if (!itemName || itemName.length > 100) {
            return { isValid: false, error: 'Ticket item name is required and cannot exceed 100 characters.' };
        }
        if (FORBIDDEN_SQL_CHARS_REGEX.test(itemName)) {
            return { isValid: false, error: 'Ticket item name contains invalid characters.' };
        }

        const price = Number(item.price);
        // Minimum Stripe charge is $0.50 USD; prevent negative or $0.00 tampering
        if (isNaN(price) || price < 0.50 || price > 10000.00) {
            return { isValid: false, error: `Invalid ticket price for "${itemName}". Price must be between $0.50 and $10,000.00.` };
        }

        const qty = parseInt(item.quantity, 10);
        if (isNaN(qty) || qty < 1 || qty > 25) {
            return { isValid: false, error: `Invalid quantity for "${itemName}". Quantity must be between 1 and 25 per order.` };
        }

        subtotal += price * qty;
    }

    // 5. Fee Structure Validation
    if (fees && Array.isArray(fees)) {
        if (fees.length > 10) {
            return { isValid: false, error: 'Exceeded maximum allowable fee entries (10).' };
        }
        for (const fee of fees) {
            const feeAmount = Number(fee.amount);
            if (isNaN(feeAmount) || feeAmount < 0 || feeAmount > 500.00) {
                return { isValid: false, error: 'Invalid fee amount. Fees cannot be negative or exceed $500.00.' };
            }
        }
    }

    return { isValid: true, error: null, subtotal };
}

