/**
 * emailService.js - Client-side service to trigger ticket emails via Resend API
 */

import { getGoogleCalendarUrl } from '../utils/calendar';

export const emailService = {
    /**
     * Sends ticket confirmation email to customer upon successful checkout.
     */
    async sendTicketConfirmationEmail(order, event, origin = null) {
        if (!order || !order.customer?.email) {
            return { success: false, error: 'No customer email provided.' };
        }

        const siteOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://ticketlite.ca');
        const ticketUrl = `${siteOrigin}/tickets/${order.orderId}`;

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
            console.warn('Ticket email fetch exception (expected in pure local offline dev):', err);
            return {
                success: false,
                error: err.message || 'Network error while attempting to dispatch email.'
            };
        }
    }
};
