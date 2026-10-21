/**
 * passToken.js - Portable ticket pass serialization and decoding.
 * Allows digital ticket passes to be opened across any device or email client
 * without requiring pre-existing local storage on the new device.
 */

export function encodePassToken(order) {
    if (!order || !order.orderId) return '';

    try {
        const payload = {
            orderId: String(order.orderId),
            eventId: String(order.eventId || '1'),
            eventTitle: order.eventTitle || 'Live Event',
            eventDate: order.eventDate || '',
            eventLocation: order.eventLocation || '',
            eventPalette: order.eventPalette || null,
            customer: order.customer || {},
            items: order.items || [],
            baseTotal: Number(order.baseTotal) || 0,
            fees: order.fees || [],
            total: Number(order.total) || 0,
            tickets: order.tickets || []
        };

        const json = JSON.stringify(payload);
        const utf8Bytes = new TextEncoder().encode(json);
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
    if (!token || typeof token !== 'string') return null;

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

        const json = new TextDecoder().decode(bytes);
        const data = JSON.parse(json);

        if (!data || !data.orderId) return null;
        return data;
    } catch (err) {
        console.error('Failed to decode ticket pass token:', err);
        return null;
    }
}
