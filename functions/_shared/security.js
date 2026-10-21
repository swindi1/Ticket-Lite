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

export async function hashPassword(password, customSaltHex = null) {
    let saltHex = customSaltHex;
    if (!saltHex) {
        const saltBytes = new Uint8Array(16);
        crypto.getRandomValues(saltBytes);
        saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(`${saltHex}:${password}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password, storedHash) {
    if (!storedHash) return false;

    if (storedHash.includes(':')) {
        const [saltHex, expectedHashHex] = storedHash.split(':');
        const computed = await hashPassword(password, saltHex);
        const [, computedHashHex] = computed.split(':');
        return computedHashHex === expectedHashHex;
    }

    return password === storedHash;
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
