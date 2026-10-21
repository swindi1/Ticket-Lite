import Stripe from 'stripe';
import { getSecurityHeaders } from '../../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequestGet(context) {
    const headers = getSecurityHeaders(context.request);
    return new Response(
        JSON.stringify({
            status: 'active',
            service: 'Ticket Lite Stripe Webhook Handler',
            webhookEndpoint: '/api/stripe/webhook',
            supportedEvents: ['checkout.session.completed', 'payment_intent.succeeded']
        }),
        { status: 200, headers }
    );
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return onRequestOptions(context);
    }
    if (context.request.method === 'GET') {
        return onRequestGet(context);
    }
    if (context.request.method === 'POST') {
        return onRequestPost(context);
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: getSecurityHeaders(context.request)
    });
}

export async function onRequestPost(context) {
    const headers = getSecurityHeaders(context.request);

    try {
        const rawApiKey = context.env?.STRIPE_SECRET_KEY ||
            context.env?.stripe_secret_key ||
            context.env?.STRIPE_KEY ||
            (typeof globalThis !== 'undefined' && (globalThis.STRIPE_SECRET_KEY || globalThis.stripe_secret_key));
        const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim().replace(/^["']|["']$/g, '') : null;

        const rawWebhookSecret = context.env?.STRIPE_WEBHOOK_SECRET ||
            context.env?.stripe_webhook_secret ||
            (typeof globalThis !== 'undefined' && (globalThis.STRIPE_WEBHOOK_SECRET || globalThis.stripe_webhook_secret));
        const webhookSecret = typeof rawWebhookSecret === 'string' ? rawWebhookSecret.trim().replace(/^["']|["']$/g, '') : null;

        const signature = context.request.headers.get('stripe-signature');
        const rawBody = await context.request.text();

        let event;

        if (apiKey && webhookSecret && signature) {
            const stripe = new Stripe(apiKey, {
                httpClient: Stripe.createFetchHttpClient(),
                apiVersion: '2025-02-24.acacia'
            });

            try {
                // SubtleCrypto provider required for Cloudflare Workers / workerd runtime
                event = await stripe.webhooks.constructEventAsync(
                    rawBody,
                    signature,
                    webhookSecret,
                    undefined,
                    Stripe.createSubtleCryptoProvider()
                );
            } catch (err) {
                console.error('Stripe webhook signature verification failed:', err.message);
                return new Response(
                    JSON.stringify({ error: `Webhook signature verification failed: ${err.message}` }),
                    { status: 400, headers }
                );
            }
        } else {
            // Unverified test mode (e.g. testing endpoint before webhook secret is configured)
            try {
                event = JSON.parse(rawBody || '{}');
            } catch {
                return new Response(
                    JSON.stringify({ error: 'Invalid JSON payload' }),
                    { status: 400, headers }
                );
            }
        }

        // Process webhook events
        const eventType = event.type || 'unknown';
        let orderId = null;
        let eventId = null;
        let emailSent = false;

        if (eventType === 'checkout.session.completed') {
            const session = event.data?.object || {};
            const metadata = session.metadata || {};
            orderId = metadata.orderId || session.client_reference_id;
            eventId = metadata.eventId;

            const customerEmail = metadata.customerEmail || session.customer_details?.email || session.customer_email;
            const customerName = metadata.customerName || session.customer_details?.name || 'Valued Customer';
            const eventTitle = metadata.eventTitle || 'Your Event';
            const total = (session.amount_total || 0) / 100;

            let parsedItems = [];
            try {
                if (metadata.itemsJson) {
                    parsedItems = JSON.parse(metadata.itemsJson);
                }
            } catch {
                parsedItems = [];
            }

            let parsedFees = [];
            try {
                if (metadata.feesJson) {
                    parsedFees = JSON.parse(metadata.feesJson);
                }
            } catch {
                parsedFees = [];
            }

            // If customer email is available, trigger ticket confirmation email via internal endpoint
            if (customerEmail && orderId) {
                try {
                    const origin = new URL(context.request.url).origin;
                    const ticketUrl = `${origin}/tickets/${encodeURIComponent(orderId)}`;

                    const resendApiKey = context.env?.RESEND_API_KEY ||
                        (typeof globalThis !== 'undefined' && globalThis.RESEND_API_KEY);

                    if (resendApiKey) {
                        const emailPayload = {
                            orderId,
                            eventTitle,
                            eventDate: metadata.eventDate || '',
                            eventLocation: metadata.eventLocation || '',
                            customerName,
                            customerEmail,
                            items: parsedItems,
                            baseTotal: total - parsedFees.reduce((s, f) => s + (f.amount || 0), 0),
                            fees: parsedFees,
                            total,
                            ticketUrl
                        };

                        const emailRes = await fetch(`${origin}/api/tickets/send-email`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(emailPayload)
                        });

                        if (emailRes.ok) {
                            emailSent = true;
                        }
                    }
                } catch (emailErr) {
                    console.warn('Webhook email trigger notice:', emailErr.message);
                }
            }
        }

        return new Response(
            JSON.stringify({
                received: true,
                eventType,
                orderId,
                eventId,
                emailSent,
                timestamp: new Date().toISOString()
            }),
            { status: 200, headers }
        );
    } catch (err) {
        console.error('Error handling Stripe webhook:', err);
        return new Response(
            JSON.stringify({ error: err.message || 'Internal webhook error' }),
            { status: 500, headers }
        );
    }
}
