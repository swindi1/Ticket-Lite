/**
 * stripeService.js - Client-side service to communicate with Stripe Checkout & Webhook APIs
 */

export const stripeService = {
    /**
     * Initializes Stripe Checkout session on serverless backend.
     * If live keys are configured, redirects buyer to Stripe's secure checkout page.
     * If keys are not configured or in dev, returns mock confirmation for seamless testing.
     */
    async createCheckoutSession({ orderId, event, customer, items, fees, successUrl, cancelUrl }) {
        try {
            const payload = {
                orderId,
                eventId: event?.id,
                eventTitle: event?.title,
                eventDate: event?.date,
                eventLocation: event?.location,
                customer,
                items,
                fees,
                successUrl,
                cancelUrl
            };

            const res = await fetch('/api/stripe/create-checkout-session', {
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
                    error: data.error || `Stripe checkout initiation failed with status ${res.status}`
                };
            }

            return data;
        } catch (err) {
            console.warn('Stripe checkout fetch error:', err);
            return {
                success: false,
                error: err.message || 'Network error while connecting to Stripe checkout.'
            };
        }
    },

    /**
     * Checks status of Stripe Webhook endpoint
     */
    async checkWebhookStatus() {
        try {
            const res = await fetch('/api/stripe/webhook');
            return await res.json();
        } catch (err) {
            return { status: 'offline', error: err.message };
        }
    }
};
