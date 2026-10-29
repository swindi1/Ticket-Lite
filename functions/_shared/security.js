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

export async function hashPassword(password, customSaltHex = null) {
    let saltHex = customSaltHex;
    if (!saltHex) {
        const saltBytes = new Uint8Array(16);
        crypto.getRandomValues(saltBytes);
        saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

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

    if (!storedHash.startsWith('pbkdf2:')) {
        return false;
    }

    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const [, iterationsStr, saltHex, expectedHashHex] = parts;
    const iterations = parseInt(iterationsStr, 10);
    if (!iterations || iterations < 10000 || iterations > 1000000) return false;

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

function isValidSecret(secret) {
    return typeof secret === 'string' && secret.trim().length >= 16;
}

export function getAuthSecret(env) {
    const raw = env?.AUTH_SECRET || env?.JWT_SECRET;
    return isValidSecret(raw) ? raw.trim() : null;
}

export function getPassSecret(env) {
    const raw = env?.PASS_SECRET || env?.AUTH_SECRET;
    return isValidSecret(raw) ? raw.trim() : null;
}

function encodeBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(b64Url) {
    let base64 = b64Url.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

/**
 * Signs a stateless HMAC-SHA256 authentication token for promoter sessions.
 * Fails closed if secret is missing or shorter than 16 characters.
 */
export async function signAuthToken(payload, secret) {
    if (!isValidSecret(secret)) {
        throw new Error('AUTH_SECRET is not configured or is too short (minimum 16 characters).');
    }
    const signingSecret = secret.trim();
    const encoder = new TextEncoder();
    const headerB64 = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const bodyB64 = encodeBase64Url(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    }));

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

/**
 * Verifies an HMAC-SHA256 authentication token in constant time.
 * Fails closed (returns null) if secret is missing, signature mismatches, or token is expired.
 */
export async function verifyAuthToken(token, secret) {
    if (!token || typeof token !== 'string' || !isValidSecret(secret)) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigHex] = parts;

    const signingSecret = secret.trim();
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
        const payload = JSON.parse(decodeBase64Url(bodyB64));
        if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

/**
 * Extracts and verifies the promoter session token from Authorization header or vtix_session cookie.
 * Fails closed (returns null) if AUTH_SECRET is not set or token is invalid.
 */
export async function authenticateRequest(context) {
    const secret = getAuthSecret(context?.env);
    if (!secret) return null;

    const request = context?.request;
    if (!request) return null;

    let token = null;
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    } else {
        const cookieHeader = request.headers.get('Cookie') || '';
        const match = cookieHeader.match(/(?:^|;\s*)vtix_session=([^;]+)/);
        if (match) {
            token = match[1].trim();
        }
    }

    if (!token) return null;
    return verifyAuthToken(token, secret);
}

/**
 * Cryptographically signs a ticket pass payload on the server using Web Crypto HMAC-SHA256.
 * Fails closed (throws error) if secret is missing.
 */
export async function signPassToken(order, secret) {
    if (!isValidSecret(secret)) {
        throw new Error('PASS_SECRET / AUTH_SECRET is not configured for signing ticket passes.');
    }
    if (!order || !/^\d{12}$/.test(String(order.orderId || ''))) {
        throw new Error('Invalid orderId for pass token signing.');
    }

    const payload = {
        orderId: String(order.orderId),
        eventId: String(order.eventId || '').slice(0, 64),
        eventTitle: String(order.eventTitle || 'Live Event').slice(0, 120),
        eventDate: String(order.eventDate || '').slice(0, 80),
        eventLocation: String(order.eventLocation || '').slice(0, 120),
        currency: String(order.currency || 'cad').toLowerCase(),
        customer: {
            name: String(order.customer?.name || '').slice(0, 100),
            email: String(order.customer?.email || '').slice(0, 100)
        },
        items: (Array.isArray(order.items) ? order.items : []).slice(0, 50).map(item => ({
            name: String(item?.name || 'Ticket').slice(0, 100),
            priceCents: Math.max(0, Math.round(Number(item?.priceCents ?? (Number(item?.price) || 0) * 100))),
            price: Math.max(0, Number(item?.price) || (Number(item?.priceCents) || 0) / 100),
            quantity: Math.max(1, Math.min(25, parseInt(item?.quantity, 10) || 1)),
            note: String(item?.note || '').slice(0, 300)
        })),
        baseTotalCents: Math.max(0, Math.round(Number(order.baseTotalCents ?? (Number(order.baseTotal) || 0) * 100))),
        totalCents: Math.max(0, Math.round(Number(order.totalCents ?? (Number(order.total) || 0) * 100))),
        tickets: (Array.isArray(order.tickets) ? order.tickets : []).slice(0, 50).map(t => ({
            ticketId: String(t?.ticketId || '').slice(0, 32),
            name: String(t?.name || t?.ticket_tier_name || 'General Admission').slice(0, 100),
            priceCents: Math.max(0, Math.round(Number(t?.priceCents ?? t?.price_cents ?? (Number(t?.price) || 0) * 100))),
            price: Math.max(0, Number(t?.price) || (Number(t?.priceCents ?? t?.price_cents) || 0) / 100),
            note: String(t?.note || '').slice(0, 300),
            checkInStatus: t?.checkInStatus === 'checked_in' || t?.check_in_status === 'checked_in' ? 'checked_in' : 'valid',
            checkedInAt: t?.checkedInAt || t?.checked_in_at || null
        })),
        iat: Math.floor(Date.now() / 1000)
    };

    const payloadB64 = encodeBase64Url(JSON.stringify(payload));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret.trim()),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`vtix-pass-v2.${payloadB64}`));
    const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${payloadB64}.${sigHex}`;
}

/**
 * Cryptographically verifies a server-signed HMAC-SHA256 pass token.
 * Fails closed (returns null) if secret is missing or signature does not match.
 */
export async function verifyPassToken(token, secret) {
    if (!token || typeof token !== 'string' || token.length > 16384 || !isValidSecret(secret)) {
        return null;
    }
    const parts = token.trim().split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigHex] = parts;
    if (!payloadB64 || !/^[0-9a-f]{64}$/i.test(sigHex)) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret.trim()),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const expectedBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`vtix-pass-v2.${payloadB64}`));
    const expectedHex = Array.from(new Uint8Array(expectedBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (!constantTimeEqual(sigHex.toLowerCase(), expectedHex)) {
        return null;
    }

    try {
        const data = JSON.parse(decodeBase64Url(payloadB64));
        if (!data || !/^\d{12}$/.test(String(data.orderId || ''))) {
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

export const SUPPORTED_CURRENCIES = ['cad', 'usd', 'eur', 'gbp', 'aud'];

export function validateCurrency(currency) {
    if (!currency || typeof currency !== 'string') return 'cad';
    const clean = currency.trim().toLowerCase();
    return SUPPORTED_CURRENCIES.includes(clean) ? clean : null;
}

export function toCents(amountDollars) {
    const num = Number(amountDollars);
    if (!Number.isFinite(num)) return NaN;
    return Math.round(num * 100);
}

/**
 * Server-side canonical checkout calculator.
 * Verifies every requested ticket tier AND fee against the authoritative D1 event record
 * using integer cents math. Fails closed on any unknown tier, price mismatch, or fee mismatch.
 */
export function computeCanonicalCheckout(dbEvent, requestedItems, clientFees = null) {
    if (!dbEvent || typeof dbEvent !== 'object') {
        return { isValid: false, error: 'Event not found in database.' };
    }

    let canonicalTickets;
    try {
        canonicalTickets = typeof dbEvent.tickets_json === 'string'
            ? JSON.parse(dbEvent.tickets_json)
            : dbEvent.tickets;
    } catch {
        return { isValid: false, error: 'Corrupted event ticket configuration in database.' };
    }

    if (!Array.isArray(canonicalTickets) || canonicalTickets.length === 0) {
        return { isValid: false, error: 'Event has no configured ticket tiers.' };
    }

    let canonicalFees = [];
    if (dbEvent.fees_json || dbEvent.fees) {
        try {
            canonicalFees = typeof dbEvent.fees_json === 'string'
                ? JSON.parse(dbEvent.fees_json)
                : dbEvent.fees;
            if (!Array.isArray(canonicalFees)) canonicalFees = [];
        } catch {
            return { isValid: false, error: 'Corrupted event fee configuration in database.' };
        }
    }

    if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
        return { isValid: false, error: 'Order must contain at least one ticket item.' };
    }

    const verifiedItems = [];
    let baseTotalCents = 0;
    let totalTicketCount = 0;

    for (const reqItem of requestedItems) {
        const reqName = String(reqItem?.name || '').trim();
        const matchedTier = canonicalTickets.find(
            t => String(t?.name || '').trim().toLowerCase() === reqName.toLowerCase()
        );
        if (!matchedTier) {
            return { isValid: false, error: `Unknown ticket tier "${reqName}".` };
        }

        const canonicalPriceCents = Number.isInteger(matchedTier.price_cents)
            ? matchedTier.price_cents
            : toCents(matchedTier.price);

        if (!Number.isInteger(canonicalPriceCents) || canonicalPriceCents < 50 || canonicalPriceCents > 1000000) {
            return { isValid: false, error: `Invalid canonical price for "${matchedTier.name}".` };
        }

        // Reject if client attempted to tamper with the unit price
        if (reqItem.price !== undefined || reqItem.priceCents !== undefined) {
            const clientCents = Number.isInteger(reqItem.priceCents)
                ? reqItem.priceCents
                : toCents(reqItem.price);
            if (clientCents !== canonicalPriceCents) {
                return {
                    isValid: false,
                    error: `Price mismatch for "${matchedTier.name}": expected ${(canonicalPriceCents / 100).toFixed(2)}.`
                };
            }
        }

        const qty = parseInt(reqItem.quantity, 10);
        if (!Number.isInteger(qty) || qty < 1 || qty > 25) {
            return { isValid: false, error: `Invalid quantity for "${matchedTier.name}".` };
        }

        const maxCapacity = parseInt(matchedTier.quantity, 10);
        if (Number.isInteger(maxCapacity) && maxCapacity > 0 && qty > maxCapacity) {
            return { isValid: false, error: `Requested quantity exceeds available capacity for "${matchedTier.name}".` };
        }

        baseTotalCents += canonicalPriceCents * qty;
        totalTicketCount += qty;
        verifiedItems.push({
            id: matchedTier.id || reqName,
            name: String(matchedTier.name).trim(),
            note: String(matchedTier.note || '').slice(0, 300),
            priceCents: canonicalPriceCents,
            price: canonicalPriceCents / 100,
            quantity: qty
        });
    }

    // Server-side canonical fee calculation in integer cents
    const verifiedFees = [];
    let totalFeesCents = 0;

    for (const feeRule of canonicalFees) {
        if (!feeRule || !feeRule.name) continue;
        const rawRate = Number(feeRule.amount);
        if (!Number.isFinite(rawRate) || rawRate < 0) continue;

        let feeCents = 0;
        if (feeRule.type === 'percentage') {
            feeCents = Math.round((baseTotalCents * rawRate) / 100);
        } else if (feeRule.type === 'fixed_per_ticket') {
            feeCents = toCents(rawRate) * totalTicketCount;
        } else {
            feeCents = toCents(rawRate);
        }

        if (feeCents > 0) {
            verifiedFees.push({
                name: String(feeRule.name).trim().slice(0, 60),
                type: feeRule.type || 'fixed_per_transaction',
                amountCents: feeCents,
                amount: feeCents / 100
            });
            totalFeesCents += feeCents;
        }
    }

    // If client supplied fees, verify they match the server's canonical fee total
    if (Array.isArray(clientFees)) {
        const clientFeesCents = clientFees.reduce((sum, f) => {
            const c = Number.isInteger(f?.amountCents) ? f.amountCents : toCents(f?.amount || 0);
            return sum + (Number.isFinite(c) ? c : -100000);
        }, 0);
        if (Math.abs(clientFeesCents - totalFeesCents) > 1) {
            return {
                isValid: false,
                error: `Fee tampering or mismatch detected: expected ${(totalFeesCents / 100).toFixed(2)} in fees.`
            };
        }
    }

    const totalAmountCents = baseTotalCents + totalFeesCents;
    const currency = validateCurrency(dbEvent.currency || 'cad') || 'cad';

    return {
        isValid: true,
        error: null,
        currency,
        verifiedItems,
        verifiedFees,
        baseTotalCents,
        totalFeesCents,
        totalAmountCents
    };
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

