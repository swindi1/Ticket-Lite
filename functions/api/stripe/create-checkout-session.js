import Stripe from 'stripe';
import {
    getSecurityHeaders,
    checkRateLimit,
    validateCheckoutPayload,
    isValidRedirectUrl,
    computeCanonicalCheckout
} from '../../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return onRequestOptions(context);
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
        // 1. IP Rate Limiting: 20 checkout attempts per 5 minutes per IP
        const clientIp = context.request.headers.get('CF-Connecting-IP') ||
            context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            '127.0.0.1';
        const rateCheck = checkRateLimit(`stripe-checkout-ip:${clientIp}`, 20, 5 * 60 * 1000);
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Too many checkout attempts. Please wait ${rateCheck.resetSeconds} seconds before trying again.`
                }),
                {
                    status: 429,
                    headers: { ...headers, 'Retry-After': String(rateCheck.resetSeconds) }
                }
            );
        }

        let body;
        try {
            body = await context.request.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid JSON request body.' }),
                { status: 400, headers }
            );
        }

        const {
            orderId,
            eventId,
            customer,
            items = [],
            fees = [],
            successUrl,
            cancelUrl
        } = body;

        // 2. Input format & anti-tampering validation
        const validation = validateCheckoutPayload({ orderId, eventId, customer, items, fees });
        if (!validation.isValid) {
            return new Response(
                JSON.stringify({ success: false, error: validation.error }),
                { status: 400, headers }
            );
        }

        // 3. Customer Email Rate Limiting
        const cleanEmail = customer.email.trim().toLowerCase();
        const emailRateCheck = checkRateLimit(`stripe-checkout-email:${cleanEmail}`, 6, 5 * 60 * 1000);
        if (!emailRateCheck.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Too many checkout requests for this email address. Please wait ${emailRateCheck.resetSeconds} seconds.`
                }),
                {
                    status: 429,
                    headers: { ...headers, 'Retry-After': String(emailRateCheck.resetSeconds) }
                }
            );
        }

        // 4. Fail-closed check for Stripe API Key (no mock confirmation fallback)
        const rawApiKey = context.env?.STRIPE_SECRET_KEY || context.env?.stripe_secret_key;
        const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim().replace(/^["']|["']$/g, '') : null;
        if (!apiKey) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Payment processing is currently unavailable (STRIPE_SECRET_KEY is not configured).'
                }),
                { status: 503, headers }
            );
        }

        // 5. Fail-closed check for D1 Database and canonical event lookup
        const db = context.env?.DB;
        if (!db) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Database binding (DB) is not configured. Cannot verify event pricing.'
                }),
                { status: 503, headers }
            );
        }

        let dbEvent;
        try {
            dbEvent = await db
                .prepare(`
                    SELECT
                        e.id,
                        e.promoter_id,
                        e.title,
                        e.date,
                        e.location,
                        e.currency,
                        e.stripe_account_id AS event_stripe_account_id,
                        e.tickets_json,
                        e.fees_json,
                        p.stripe_account_id AS promoter_stripe_account_id,
                        p.default_currency AS promoter_currency
                    FROM events e
                    LEFT JOIN promoter_accounts p ON e.promoter_id = p.id
                    WHERE e.id = ?
                `)
                .bind(String(eventId))
                .first();
        } catch (dbErr) {
            console.error('Database error while fetching event for checkout:', dbErr);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Unable to verify event pricing due to a database error.'
                }),
                { status: 500, headers }
            );
        }

        if (!dbEvent) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Event not found in database. Checkout requires a published server event.'
                }),
                { status: 404, headers }
            );
        }

        // 6. Fail-closed server-side canonical price AND fee calculation in integer cents
        const canonical = computeCanonicalCheckout(
            {
                ...dbEvent,
                currency: dbEvent.currency || dbEvent.promoter_currency || 'cad'
            },
            items,
            fees
        );
        if (!canonical.isValid) {
            return new Response(
                JSON.stringify({ success: false, error: canonical.error }),
                { status: 400, headers }
            );
        }

        const {
            currency,
            verifiedItems,
            verifiedFees,
            baseTotalCents,
            totalFeesCents,
            totalAmountCents
        } = canonical;

        // 7. Open Redirect Prevention: Validate success and cancel URLs against allowed platform domains
        const rawOrigin = context.request.headers.get('Origin') || 'https://ticketlite.ca';
        const origin = isValidRedirectUrl(rawOrigin) ? rawOrigin : 'https://ticketlite.ca';

        let safeSuccessUrl = `${origin}/event/${encodeURIComponent(eventId)}?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(orderId)}&payment=success`;
        let safeCancelUrl = `${origin}/event/${encodeURIComponent(eventId)}?payment=cancelled`;

        if (successUrl && isValidRedirectUrl(successUrl)) {
            safeSuccessUrl = successUrl;
        }
        if (cancelUrl && isValidRedirectUrl(cancelUrl)) {
            safeCancelUrl = cancelUrl;
        }

        // 8. Initialize Stripe with Cloudflare Workers fetch client
        const stripe = new Stripe(apiKey, {
            httpClient: Stripe.createFetchHttpClient(),
            apiVersion: '2025-02-24.acacia'
        });

        // 9. Build Stripe line items strictly from server-verified integer cents
        const lineItems = verifiedItems.map(item => ({
            price_data: {
                currency,
                product_data: {
                    name: `${String(dbEvent.title || 'Event Ticket').slice(0, 80)} - ${String(item.name).slice(0, 50)}`,
                    description: item.note ? String(item.note).slice(0, 300) : undefined
                },
                unit_amount: item.priceCents
            },
            quantity: item.quantity
        }));

        verifiedFees.forEach(fee => {
            if (fee.amountCents > 0) {
                lineItems.push({
                    price_data: {
                        currency,
                        product_data: {
                            name: String(fee.name || 'Service & Processing Fee').slice(0, 60)
                        },
                        unit_amount: fee.amountCents
                    },
                    quantity: 1
                });
            }
        });

        // 10. Configure Stripe Connect destination settlement for the promoter
        const destinationAccount = dbEvent.event_stripe_account_id || dbEvent.promoter_stripe_account_id || null;
        if (context.env?.STRIPE_REQUIRE_CONNECT === 'true' && !destinationAccount) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Promoter has not connected a Stripe payout account for this event.'
                }),
                { status: 400, headers }
            );
        }

        const sessionParams = {
            payment_method_types: ['card'],
            customer_email: cleanEmail,
            line_items: lineItems,
            mode: 'payment',
            success_url: safeSuccessUrl,
            cancel_url: safeCancelUrl,
            client_reference_id: orderId,
            metadata: {
                orderId,
                eventId: String(dbEvent.id),
                promoterId: String(dbEvent.promoter_id || ''),
                eventTitle: String(dbEvent.title || '').slice(0, 120),
                eventDate: String(dbEvent.date || '').slice(0, 80),
                eventLocation: String(dbEvent.location || '').slice(0, 120),
                currency,
                customerName: String(customer.name || '').trim().slice(0, 100),
                customerEmail: cleanEmail,
                customerPhone: String(customer.phone || '').trim().slice(0, 25),
                baseTotalCents: String(baseTotalCents),
                totalFeesCents: String(totalFeesCents),
                totalAmountCents: String(totalAmountCents),
                itemsJson: JSON.stringify(verifiedItems).slice(0, 500),
                feesJson: JSON.stringify(verifiedFees).slice(0, 500)
            }
        };

        if (destinationAccount && /^acct_[a-zA-Z0-9]{8,32}$/.test(destinationAccount)) {
            sessionParams.payment_intent_data = {
                transfer_data: {
                    destination: destinationAccount
                },
                ...(totalFeesCents > 0 ? { application_fee_amount: totalFeesCents } : {})
            };
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        // 11. Pre-record order in D1 with payment_status = 'pending' (webhook marks 'paid' upon verified payment)
        await db
            .prepare(`
                INSERT INTO orders (
                    order_id, event_id, promoter_id, customer_name, customer_email, customer_phone,
                    currency, items_json, base_total_cents, fees_json, total_amount_cents,
                    stripe_session_id, stripe_destination_account, payment_status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            `)
            .bind(
                orderId,
                String(dbEvent.id),
                dbEvent.promoter_id || null,
                customer.name.trim(),
                cleanEmail,
                customer.phone ? customer.phone.trim() : null,
                currency,
                JSON.stringify(verifiedItems),
                baseTotalCents,
                JSON.stringify(verifiedFees),
                totalAmountCents,
                session.id,
                destinationAccount,
                new Date().toISOString()
            )
            .run();

        return new Response(
            JSON.stringify({
                success: true,
                mode: 'live',
                url: session.url,
                sessionId: session.id,
                orderId,
                currency,
                totalAmountCents
            }),
            { status: 200, headers }
        );
    } catch (err) {
        console.error('Stripe checkout session error:', err);
        return new Response(
            JSON.stringify({
                success: false,
                error: 'Failed to initialize Stripe checkout session.'
            }),
            { status: 500, headers }
        );
    }
}
