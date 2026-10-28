/**
 * passToken.js - Portable ticket pass serialization, integrity verification, and decoding.
 * Allows digital ticket passes to be opened across any device or email client
 * with tamper detection and strict field sanitization.
 */

import { sanitizeCssColor } from './security.js';

const PASS_INTEGRITY_SALT = 'vtix-pass-integrity-v1-8f92c1d4';

function computeIntegrityTag(jsonStr) {
    // FNV-1a dual 32-bit keyed digest (deterministic synchronous integrity tag for URL tokens)
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const input = `${PASS_INTEGRITY_SALT}:${jsonStr}`;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        h1 ^= ch;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= ch + (i & 0xff);
        h2 = Math.imul(h2, 0x85ebca6b);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function sanitizePalette(palette) {
    if (!palette || typeof palette !== 'object') return null;
    return {
        dominant: sanitizeCssColor(palette.dominant),
        palette: Array.isArray(palette.palette)
            ? palette.palette.slice(0, 6).map(c => sanitizeCssColor(c))
            : []
    };
}

export function encodePassToken(order) {
    if (!order || !order.orderId || !/^\d{12}$/.test(String(order.orderId))) return '';

    try {
        const payload = {
            orderId: String(order.orderId),
            eventId: String(order.eventId || '1').slice(0, 64),
            eventTitle: String(order.eventTitle || 'Live Event').slice(0, 120),
            eventDate: String(order.eventDate || '').slice(0, 80),
            eventLocation: String(order.eventLocation || '').slice(0, 120),
            eventPalette: sanitizePalette(order.eventPalette),
            customer: {
                name: String(order.customer?.name || '').slice(0, 100),
                email: String(order.customer?.email || '').slice(0, 100)
            },
            items: (Array.isArray(order.items) ? order.items : []).slice(0, 50).map(item => ({
                name: String(item?.name || 'Ticket').slice(0, 100),
                price: Math.max(0, Number(item?.price) || 0),
                quantity: Math.max(1, Math.min(25, parseInt(item?.quantity, 10) || 1)),
                note: String(item?.note || '').slice(0, 300)
            })),
            baseTotal: Math.max(0, Number(order.baseTotal) || 0),
            fees: (Array.isArray(order.fees) ? order.fees : []).slice(0, 10).map(fee => ({
                name: String(fee?.name || 'Fee').slice(0, 60),
                amount: Math.max(0, Number(fee?.amount) || 0)
            })),
            total: Math.max(0, Number(order.total) || 0),
            tickets: (Array.isArray(order.tickets) ? order.tickets : []).slice(0, 50).map(t => ({
                ticketId: String(t?.ticketId || '').slice(0, 32),
                name: String(t?.name || 'General Admission').slice(0, 100),
                price: Math.max(0, Number(t?.price) || 0),
                note: String(t?.note || '').slice(0, 300),
                checkInStatus: t?.checkInStatus === 'checked_in' ? 'checked_in' : 'valid',
                checkedInAt: t?.checkedInAt || null
            }))
        };

        const json = JSON.stringify(payload);
        const sig = computeIntegrityTag(json);
        const envelope = JSON.stringify({ d: payload, s: sig });

        const utf8Bytes = new TextEncoder().encode(envelope);
        let binary = '';
        for (let i = 0; i < utf8Bytes.length; i++) {
            binary += String.fromCharCode(utf8Bytes[i]);
        }

        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    } catch (err) {
        console.error('Failed to encode ticket pass token:', err);
        return '';
    }
}

export function decodePassToken(token) {
    if (!token || typeof token !== 'string' || token.length > 16384) return null;

    try {
        let base64 = token.trim().replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }

        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        const rawJson = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(rawJson);

        // Require signed envelope with valid integrity tag
        if (!parsed || typeof parsed !== 'object' || !parsed.d || !parsed.s) {
            return null;
        }

        const expectedSig = computeIntegrityTag(JSON.stringify(parsed.d));
        if (parsed.s !== expectedSig) {
            console.warn('Rejected tampered ticket pass token.');
            return null;
        }

        const data = parsed.d;
        if (!data || !/^\d{12}$/.test(String(data.orderId || ''))) {
            return null;
        }

        return {
            ...data,
            eventPalette: sanitizePalette(data.eventPalette)
        };
    } catch (err) {
        console.error('Failed to decode ticket pass token:', err);
        return null;
    }
}
