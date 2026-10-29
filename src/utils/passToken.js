/**
 * passToken.js - Cryptographic HMAC-SHA256 Ticket Pass Token Utilities.
 *
 * Pass tokens are minted exclusively on the server using Web Crypto HMAC-SHA256
 * (signPassToken / verifyPassToken in functions/_shared/security.js) with PASS_SECRET.
 * No signing keys or non-cryptographic hashes exist in client code.
 */

export { signPassToken, verifyPassToken } from '../../functions/_shared/security.js';

/**
 * Returns the server-issued HMAC-SHA256 pass token attached to a verified order.
 * Never mints unsigned or client-keyed tokens in the browser.
 */
export function getServerPassToken(order) {
    if (!order || typeof order.passToken !== 'string') return '';
    const token = order.passToken.trim();
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[0-9a-f]{64}$/i.test(parts[1])) {
        return '';
    }
    return token;
}
