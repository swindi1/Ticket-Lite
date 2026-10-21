/**
 * emailService.js - Client-side service to trigger ticket emails via Resend API
 */

import { getGoogleCalendarUrl } from '../utils/calendar';
import { encodePassToken } from '../utils/passToken';

export const emailService = {
    /**
     * Sends ticket confirmation email to customer upon successful checkout.
     */
    async sendTicketConfirmationEmail(order, event, origin = null) {
        if (!order || !order.customer?.email) {
            return { success: false, error: 'No customer email provided.' };
        }

        const siteOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://ticketlite.ca');
        const passToken = encodePassToken({
            ...order,
            eventTitle: order.eventTitle || event?.title,
            eventDate: order.eventDate || event?.date,
            eventLocation: order.eventLocation || event?.location,
            eventPalette: order.eventPalette || event?.palette
        });
        const ticketUrl = passToken
            ? `${siteOrigin}/tickets/${order.orderId}?pass=${passToken}`
            : `${siteOrigin}/tickets/${order.orderId}`;

        const googleCalUrl = getGoogleCalendarUrl({
            title: order.eventTitle || event?.title,
            description: `Digital Tickets for ${order.eventTitle || event?.title}`,
            location: event?.location || 'Venue',
            date: event?.date,
            ticketUrl
        });

        const payload = {
            orderId: order.orderId,
            eventTitle: order.eventTitle || event?.title,
            eventDate: event?.date || '',
            eventLocation: event?.location || '',
            customerName: order.customer.name,
            customerEmail: order.customer.email.trim(),
            items: order.items || [],
            baseTotal: order.baseTotal || 0,
            fees: order.fees || [],
            total: order.total || 0,
            ticketUrl,
            googleCalendarUrl: googleCalUrl
        };

        try {
            const res = await fetch('/api/tickets/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                let errorMsg = data.error;
                if (!errorMsg) {
                    if (res.status === 405) {
                        errorMsg = 'API endpoint not supported on this preview host (405). Please ensure you are viewing the live Cloudflare Pages URL.';
                    } else {
                        errorMsg = `Server responded with status ${res.status}`;
                    }
                }
                return {
                    success: false,
                    error: errorMsg
                };
            }

            return {
                success: true,
                id: data.id,
                recipient: data.recipient
            };
        } catch (err) {
            console.warn('Ticket email fetch exception (expected in pure local offline dev):', err);
            return {
                success: false,
                error: err.message || 'Network error while attempting to dispatch email.'
            };
        }
    }
};
