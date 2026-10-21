import Stripe from 'stripe';
import { getSecurityHeaders, checkRateLimit } from '../../_shared/security.js';

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
        // Rate limiting: 20 checkout attempts per 5 minutes per IP
        const clientIp = context.request.headers.get('CF-Connecting-IP') ||
            context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            '127.0.0.1';
        const rateCheck = checkRateLimit(`stripe-checkout:${clientIp}`, 20, 5 * 60 * 1000);
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
            eventTitle,
            eventDate,
            eventLocation,
            customer,
            items = [],
            fees = [],
            successUrl,
            cancelUrl
        } = body;

        if (!orderId || !eventId || !customer?.email || items.length === 0) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing required order details (orderId, eventId, customer, items).' }),
                { status: 400, headers }
            );
        }

        const rawApiKey = context.env?.STRIPE_SECRET_KEY ||
            context.env?.stripe_secret_key ||
            context.env?.STRIPE_KEY ||
            (typeof globalThis !== 'undefined' && (globalThis.STRIPE_SECRET_KEY || globalThis.stripe_secret_key));
        const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim().replace(/^["']|["']$/g, '') : null;

        const origin = context.request.headers.get('Origin') || 'https://ticketlite.ca';

        // Fallback / mock simulation if Stripe secret key is not set yet in Cloudflare
        if (!apiKey) {
            return new Response(
                JSON.stringify({
                    success: true,
                    mode: 'mock',
                    message: 'Stripe secret key not configured in Cloudflare environment. Running in instant-confirmation test mode.',
                    orderId,
                    mockCheckout: true
                }),
                { status: 200, headers }
            );
        }

        // Initialize Stripe with Cloudflare Workers fetch client
        const stripe = new Stripe(apiKey, {
            httpClient: Stripe.createFetchHttpClient(),
            apiVersion: '2025-02-24.acacia'
        });

        // Build Stripe line items
        const lineItems = items.map(item => ({
            price_data: {
                currency: 'usd',
                product_data: {
                    name: `${eventTitle || 'Event Ticket'} - ${item.name}`,
                    description: item.note ? String(item.note).slice(0, 500) : undefined
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: Math.max(1, parseInt(item.quantity) || 1)
        }));

        // Add fee line items if applicable
        if (Array.isArray(fees)) {
            fees.forEach(fee => {
                const amountCents = Math.round(Number(fee.amount) * 100);
                if (amountCents > 0) {
                    lineItems.push({
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: fee.name || 'Service & Processing Fee'
                            },
                            unit_amount: amountCents
                        },
                        quantity: 1
                    });
                }
            });
        }

        const safeSuccessUrl = successUrl || `${origin}/event/${encodeURIComponent(eventId)}?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(orderId)}&payment=success`;
        const safeCancelUrl = cancelUrl || `${origin}/event/${encodeURIComponent(eventId)}?payment=cancelled`;

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: customer.email.trim().toLowerCase(),
            line_items: lineItems,
            mode: 'payment',
            success_url: safeSuccessUrl,
            cancel_url: safeCancelUrl,
            client_reference_id: orderId,
            metadata: {
                orderId,
                eventId: String(eventId),
                eventTitle: String(eventTitle || ''),
                eventDate: String(eventDate || ''),
                eventLocation: String(eventLocation || ''),
                customerName: String(customer.name || ''),
                customerEmail: String(customer.email || ''),
                customerPhone: String(customer.phone || ''),
                itemsJson: JSON.stringify(items).slice(0, 500),
                feesJson: JSON.stringify(fees).slice(0, 500)
            }
        });

        return new Response(
            JSON.stringify({
                success: true,
                mode: 'live',
                url: session.url,
                sessionId: session.id,
                orderId
            }),
            { status: 200, headers }
        );
    } catch (err) {
        return new Response(
            JSON.stringify({
                success: false,
                error: err.message || 'Failed to initialize Stripe checkout session.'
            }),
            { status: 500, headers }
        );
    }
}
