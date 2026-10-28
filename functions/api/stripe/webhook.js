import Stripe from 'stripe';
import { getSecurityHeaders } from '../../_shared/security.js';

// Idempotency tracking map: event.id -> timestamp (prevents replay attacks and duplicate ticket processing)
const processedEventIds = new Map();

function isDuplicateEvent(eventId) {
    if (!eventId) return false;
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;

    // Prune stale entries
    if (processedEventIds.size > 2000) {
        for (const [id, ts] of processedEventIds.entries()) {
            if (now - ts > twoHoursMs) {
                processedEventIds.delete(id);
            }
        }
    }

    if (processedEventIds.has(eventId)) {
        return true;
    }

    processedEventIds.set(eventId, now);
    return false;
}

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequestGet(context) {
    const headers = getSecurityHeaders(context.request);
    const hasSecret = !!(context.env?.STRIPE_WEBHOOK_SECRET || context.env?.stripe_webhook_secret);

    return new Response(
        JSON.stringify({
            status: 'active',
            service: 'Ticket Lite Stripe Webhook Handler',
            webhookEndpoint: '/api/stripe/webhook',
            signatureVerificationEnforced: true,
            secretConfigured: hasSecret,
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

        // Security Defense 1: Strictly reject unsigned payloads if secret or key is configured
        if (!webhookSecret) {
            return new Response(
                JSON.stringify({
                    error: 'STRIPE_WEBHOOK_SECRET not configured. Unsigned webhook processing is disabled to prevent forged transaction exploits.',
                    instructions: 'Configure STRIPE_WEBHOOK_SECRET in Cloudflare Dashboard Variables to activate live verified webhooks.'
                }),
                { status: 503, headers }
            );
        }

        if (!signature) {
            return new Response(
                JSON.stringify({ error: 'Missing stripe-signature header. Unauthorized webhook request rejected.' }),
                { status: 401, headers }
            );
        }

        // Security Defense 2: Cryptographic Signature Verification via Web Crypto (SubtleCrypto)
        const stripe = new Stripe(apiKey || 'sk_dummy_for_verification', {
            httpClient: Stripe.createFetchHttpClient(),
            apiVersion: '2025-02-24.acacia'
        });

        let event;
        try {
            // constructEventAsync verifies HMAC-SHA256 signature and validates 300-second timestamp freshness
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

        // Security Defense 3: Idempotency Protection (Prevents Replay Attacks across isolates via D1 + in-memory)
        if (isDuplicateEvent(event.id)) {
            console.warn(`Idempotency notice: Duplicate Stripe webhook event detected: ${event.id}`);
            return new Response(
                JSON.stringify({ received: true, duplicate: true, eventId: event.id }),
                { status: 200, headers }
            );
        }

        const db = context.env?.DB;
        if (db && event.id) {
            try {
                const existingWebhook = await db
                    .prepare('SELECT id FROM stripe_webhook_events WHERE event_id = ?')
                    .bind(event.id)
                    .first();
                if (existingWebhook) {
                    return new Response(
                        JSON.stringify({ received: true, duplicate: true, eventId: event.id }),
                        { status: 200, headers }
                    );
                }
            } catch (dbCheckErr) {
                console.warn('D1 webhook idempotency check notice:', dbCheckErr);
            }
        }

        // Process verified webhook event
        const eventType = event.type || 'unknown';
        let orderId = null;
        let eventId = null;
        let emailSent = false;

        if (eventType === 'checkout.session.completed') {
            const session = event.data?.object || {};
            const metadata = session.metadata || {};
            orderId = metadata.orderId || session.client_reference_id;
            eventId = metadata.eventId;

            const rawCustomerEmail = metadata.customerEmail || session.customer_details?.email || session.customer_email;
            const customerEmail = typeof rawCustomerEmail === 'string' ? rawCustomerEmail.trim().toLowerCase() : '';
            const customerName = metadata.customerName || session.customer_details?.name || 'Valued Customer';
            const eventTitle = metadata.eventTitle || 'Your Event';
            const total = (session.amount_total || 0) / 100;

            // Security Defense 4: Validate Order ID and Email format before executing any downstream ticket generation
            const isEmailValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(customerEmail);
            const isOrderIdValid = /^\d{12}$/.test(String(orderId || ''));

            if (!isEmailValid || !isOrderIdValid) {
                console.error(`Invalid session metadata in webhook: orderId=${orderId}, email=${customerEmail}`);
                return new Response(
                    JSON.stringify({ error: 'Session metadata missing valid 12-digit orderId or customer email.' }),
                    { status: 400, headers }
                );
            }

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

            // Persist webhook event and order record to D1 if bound
            if (db) {
                try {
                    await db
                        .prepare(
                            'INSERT OR IGNORE INTO stripe_webhook_events (id, event_type, event_id, stripe_session_id, order_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
                        )
                        .bind(
                            crypto.randomUUID(),
                            eventType,
                            event.id,
                            session.id || null,
                            String(orderId),
                            rawBody.slice(0, 10000)
                        )
                        .run();
                } catch (logErr) {
                    console.warn('D1 webhook log notice:', logErr);
                }
            }

            // Secure email dispatch pipeline
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
            JSON.stringify({ error: 'Internal webhook processing error.' }),
            { status: 500, headers }
        );
    }
}
