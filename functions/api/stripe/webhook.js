import Stripe from 'stripe';
import { getSecurityHeaders, getPassSecret, signPassToken, toCents } from '../../_shared/security.js';
import { dispatchTicketConfirmationEmail } from '../tickets/send-email.js';

// In-memory fast-path cache supplementing D1 durable idempotency
const processedEventIds = new Map();

function isDuplicateEventInMemory(eventId) {
    if (!eventId) return false;
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;

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
    return new Response(
        JSON.stringify({
            status: 'active',
            service: 'Ticket Lite Stripe Webhook Handler',
            webhookEndpoint: '/api/stripe/webhook',
            signatureVerificationEnforced: true,
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
        const rawApiKey = context.env?.STRIPE_SECRET_KEY || context.env?.stripe_secret_key;
        const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim().replace(/^["']|["']$/g, '') : null;

        const rawWebhookSecret = context.env?.STRIPE_WEBHOOK_SECRET || context.env?.stripe_webhook_secret;
        const webhookSecret = typeof rawWebhookSecret === 'string' ? rawWebhookSecret.trim().replace(/^["']|["']$/g, '') : null;

        const db = context.env?.DB;
        if (!db) {
            return new Response(
                JSON.stringify({ error: 'Database binding (DB) is not configured. Cannot persist webhook order.' }),
                { status: 503, headers }
            );
        }

        const passSecret = getPassSecret(context.env);
        if (!passSecret) {
            return new Response(
                JSON.stringify({ error: 'PASS_SECRET / AUTH_SECRET is not configured. Cannot sign ticket passes.' }),
                { status: 503, headers }
            );
        }

        const signature = context.request.headers.get('stripe-signature');
        const rawBody = await context.request.text();

        // Security Defense 1: Strictly reject unsigned payloads
        if (!webhookSecret) {
            return new Response(
                JSON.stringify({
                    error: 'STRIPE_WEBHOOK_SECRET not configured. Unsigned webhook processing is disabled.'
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
                JSON.stringify({ error: 'Webhook signature verification failed.' }),
                { status: 400, headers }
            );
        }

        // Security Defense 3: Durable Idempotency Protection in D1 + In-Memory Fast Path
        const existingWebhook = await db
            .prepare('SELECT id FROM stripe_webhook_events WHERE event_id = ?')
            .bind(event.id)
            .first();

        if (existingWebhook || isDuplicateEventInMemory(event.id)) {
            return new Response(
                JSON.stringify({ received: true, duplicate: true, eventId: event.id }),
                { status: 200, headers }
            );
        }

        const eventType = event.type || 'unknown';
        let orderId = null;
        let eventId = null;
        let emailSent = false;

        if (eventType === 'checkout.session.completed') {
            const session = event.data?.object || {};
            if (session.payment_status && session.payment_status !== 'paid') {
                return new Response(
                    JSON.stringify({ received: true, status: session.payment_status, ignored: true }),
                    { status: 200, headers }
                );
            }

            const metadata = session.metadata || {};
            orderId = String(metadata.orderId || session.client_reference_id || '').trim();
            eventId = String(metadata.eventId || '').trim();
            const promoterId = metadata.promoterId || null;

            const rawCustomerEmail = metadata.customerEmail || session.customer_details?.email || session.customer_email;
            const customerEmail = typeof rawCustomerEmail === 'string' ? rawCustomerEmail.trim().toLowerCase() : '';
            const customerName = String(metadata.customerName || session.customer_details?.name || 'Valued Customer').trim();
            const customerPhone = metadata.customerPhone || session.customer_details?.phone || null;
            const eventTitle = metadata.eventTitle || 'Your Event';
            const eventDate = metadata.eventDate || '';
            const eventLocation = metadata.eventLocation || '';
            const currency = String(session.currency || metadata.currency || 'cad').toLowerCase();

            const totalAmountCents = Number.isInteger(session.amount_total)
                ? session.amount_total
                : parseInt(metadata.totalAmountCents || '0', 10) || 0;

            const isEmailValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(customerEmail);
            const isOrderIdValid = /^\d{12}$/.test(orderId);

            if (!isEmailValid || !isOrderIdValid || !eventId) {
                console.error(`Invalid session metadata in webhook: orderId=${orderId}, eventId=${eventId}, email=${customerEmail}`);
                return new Response(
                    JSON.stringify({ error: 'Session metadata missing valid 12-digit orderId, eventId, or customer email.' }),
                    { status: 400, headers }
                );
            }

            // Look up any pre-created pending order in D1 first so we have full un-truncated items/fees JSON
            const existingOrder = await db
                .prepare('SELECT items_json, fees_json, base_total_cents, promoter_id FROM orders WHERE order_id = ?')
                .bind(orderId)
                .first();

            let parsedItems = [];
            try {
                if (existingOrder?.items_json) {
                    parsedItems = JSON.parse(existingOrder.items_json);
                } else if (metadata.itemsJson) {
                    parsedItems = JSON.parse(metadata.itemsJson);
                }
            } catch {
                parsedItems = [];
            }

            let parsedFees = [];
            try {
                if (existingOrder?.fees_json) {
                    parsedFees = JSON.parse(existingOrder.fees_json);
                } else if (metadata.feesJson) {
                    parsedFees = JSON.parse(metadata.feesJson);
                }
            } catch {
                parsedFees = [];
            }

            const feesTotalCents = parsedFees.reduce((sum, f) => {
                const c = Number.isInteger(f?.amountCents) ? f.amountCents : toCents(f?.amount || 0);
                return sum + (Number.isFinite(c) ? c : 0);
            }, 0);

            const baseTotalCents = Number.isInteger(existingOrder?.base_total_cents)
                ? existingOrder.base_total_cents
                : (parseInt(metadata.baseTotalCents || '0', 10) || Math.max(0, totalAmountCents - feesTotalCents));

            const nowIso = new Date().toISOString();

            // Build individual scannable ticket rows for D1 `tickets` table
            const generatedTickets = [];
            let counter = 1;
            for (const item of parsedItems) {
                const qty = Math.max(1, parseInt(item?.quantity, 10) || 1);
                const priceCents = Number.isInteger(item?.priceCents) ? item.priceCents : toCents(item?.price || 0);
                for (let q = 0; q < qty; q++) {
                    generatedTickets.push({
                        ticketId: `${orderId}-${String(counter).padStart(2, '0')}`,
                        name: String(item?.name || 'General Admission').slice(0, 100),
                        priceCents,
                        price: priceCents / 100,
                        note: String(item?.note || '').slice(0, 300),
                        checkInStatus: 'valid',
                        checkedInAt: null
                    });
                    counter++;
                }
            }

            // Mint server-side HMAC-SHA256 signed pass token
            const signedPassToken = await signPassToken({
                orderId,
                eventId,
                eventTitle,
                eventDate,
                eventLocation,
                currency,
                customer: { name: customerName, email: customerEmail },
                items: parsedItems,
                baseTotalCents,
                totalCents: totalAmountCents,
                tickets: generatedTickets
            }, passSecret);

            // Persist authoritative paid order in D1 `orders` table
            await db
                .prepare(`
                    INSERT INTO orders (
                        order_id, event_id, promoter_id, customer_name, customer_email, customer_phone,
                        currency, items_json, base_total_cents, fees_json, total_amount_cents,
                        stripe_session_id, stripe_payment_intent_id, pass_token, payment_status, created_at, paid_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)
                    ON CONFLICT(order_id) DO UPDATE SET
                        payment_status = 'paid',
                        stripe_session_id = excluded.stripe_session_id,
                        stripe_payment_intent_id = excluded.stripe_payment_intent_id,
                        total_amount_cents = excluded.total_amount_cents,
                        pass_token = excluded.pass_token,
                        paid_at = excluded.paid_at
                `)
                .bind(
                    orderId,
                    eventId,
                    existingOrder?.promoter_id || promoterId || null,
                    customerName,
                    customerEmail,
                    customerPhone,
                    currency,
                    JSON.stringify(parsedItems),
                    baseTotalCents,
                    JSON.stringify(parsedFees),
                    totalAmountCents,
                    session.id || null,
                    typeof session.payment_intent === 'string' ? session.payment_intent : null,
                    signedPassToken,
                    nowIso,
                    nowIso
                )
                .run();

            // Persist individual scannable tickets in D1 `tickets` table
            for (const ticket of generatedTickets) {
                await db
                    .prepare(`
                        INSERT OR IGNORE INTO tickets (
                            ticket_id, order_id, event_id, ticket_tier_name, price_cents, note, check_in_status, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 'valid', ?)
                    `)
                    .bind(
                        ticket.ticketId,
                        orderId,
                        eventId,
                        ticket.name,
                        ticket.priceCents,
                        ticket.note,
                        nowIso
                    )
                    .run();
            }

            // Record webhook event in D1 `stripe_webhook_events` for durable idempotency
            await db
                .prepare(
                    'INSERT OR IGNORE INTO stripe_webhook_events (id, event_type, event_id, stripe_session_id, order_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
                )
                .bind(
                    crypto.randomUUID(),
                    eventType,
                    event.id,
                    session.id || null,
                    orderId,
                    rawBody.slice(0, 10000)
                )
                .run();

            // Dispatch confirmation email directly with the server-signed HMAC pass link
            const origin = new URL(context.request.url).origin;
            const ticketUrl = `${origin}/tickets/${encodeURIComponent(orderId)}?pass=${encodeURIComponent(signedPassToken)}`;

            const emailResult = await dispatchTicketConfirmationEmail(context.env, {
                orderId,
                eventTitle,
                eventDate,
                eventLocation,
                customerName,
                customerEmail,
                currency,
                items: parsedItems,
                baseTotalCents,
                fees: parsedFees,
                totalAmountCents,
                ticketUrl
            });
            emailSent = !!emailResult.success;
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
