/**
 * emailService.js - Client-side service to trigger ticket confirmation emails via /api/tickets/send-email.
 * The server verifies the order against Cloudflare D1 (payment_status = 'paid') and uses canonical order data.
 */

import { getGoogleCalendarUrl } from '../utils/calendar';
import { getServerPassToken } from '../utils/passToken';

export const emailService = {
    /**
     * Requests a ticket confirmation email resend for a verified paid order.
     */
    async sendTicketConfirmationEmail(order, event, origin = null) {
        if (!order || !order.orderId) {
            return { success: false, error: 'Valid Order ID is required.' };
        }

        const siteOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://ticketlite.ca');
        const passToken = getServerPassToken(order);
        const ticketUrl = passToken
            ? `${siteOrigin}/tickets/${order.orderId}?pass=${encodeURIComponent(passToken)}`
            : `${siteOrigin}/tickets/${order.orderId}`;

        const googleCalUrl = getGoogleCalendarUrl({
            title: order.eventTitle || event?.title,
            description: `Digital Tickets for ${order.eventTitle || event?.title}`,
            location: event?.location || 'Venue',
            date: event?.date,
            ticketUrl
        });

        let authToken = null;
        try {
            const savedPromoter = localStorage.getItem('vtix_current_promoter');
            if (savedPromoter) {
                authToken = JSON.parse(savedPromoter)?.token || null;
            }
        } catch {
            authToken = null;
        }

        try {
            const res = await fetch('/api/tickets/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    orderId: order.orderId,
                    passToken,
                    googleCalendarUrl: googleCalUrl
                })
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                return {
                    success: false,
                    error: data.error || `Server responded with status ${res.status}`
                };
            }

            return {
                success: true,
                id: data.id,
                recipient: data.recipient
            };
        } catch (err) {
            return {
                success: false,
                error: err.message || 'Network error while attempting to dispatch email.'
            };
        }
    }
};
