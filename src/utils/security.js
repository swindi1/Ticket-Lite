/**
 * Security & Cryptography Utilities for Ticket Lite
 * Re-exports shared validation and PBKDF2 password hashing utilities
 * and provides client-side sanitization and CSPRNG helpers.
 */

export {
    FORBIDDEN_SQL_CHARS_REGEX,
    FORBIDDEN_SQL_KEYWORDS_REGEX,
    validatePassword,
    validatePromoterRegistration,
    validateLoginInputs,
    hashPassword,
    verifyPassword,
    constantTimeEqual
} from '../../functions/_shared/security.js';

/**
 * Generates a cryptographically random 12-digit numeric Order ID (100,000,000,000 to 999,999,999,999)
 * using Web Crypto CSPRNG instead of Math.random().
 */
export function generateSecureOrderId() {
    const randomBytes = new Uint32Array(12);
    crypto.getRandomValues(randomBytes);
    const firstDigit = 1 + (randomBytes[0] % 9);
    let result = String(firstDigit);
    for (let i = 1; i < 12; i++) {
        result += String(randomBytes[i] % 10);
    }
    return result;
}

/**
 * Strictly validates and sanitizes a CSS color value (rgb/rgba/hex/var) to prevent CSS style injection.
 */
export function sanitizeCssColor(color, fallback = 'rgb(236, 72, 153)') {
    if (!color || typeof color !== 'string') return fallback;
    const trimmed = color.trim();
    if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(trimmed)) {
        return trimmed;
    }
    if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/.test(trimmed)) {
        return trimmed;
    }
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
        return trimmed;
    }
    if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(trimmed)) {
        return trimmed;
    }
    return fallback;
}

/**
 * Validates that an image source is a safe data:image/* URI or https/http/relative URL
 * without quotes or parentheses that could break out of a CSS url(...) context.
 */
export function sanitizeImageUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const trimmed = urlStr.trim();
    if (/['"()\\;\r\n]/.test(trimmed)) return null;
    if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
        return trimmed;
    }
    if (/^(https?:\/\/|\/)[a-zA-Z0-9._~:/?#[\]@!$&*+,;=%-]+$/.test(trimmed)) {
        return trimmed;
    }
    return null;
}
