import {
    getSecurityHeaders,
    authenticateRequest,
    verifyPassToken,
    getPassSecret,
    signPassToken
} from '../../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequestGet(context) {
    const headers = getSecurityHeaders(context.request);
    const db = context.env?.DB;
    if (!db) {
        return new Response(
            JSON.stringify({ error: 'Database binding (DB) is not configured.' }),
            { status: 503, headers }
        );
    }

    const passSecret = getPassSecret(context.env);
    if (!passSecret) {
        return new Response(
            JSON.stringify({ error: 'PASS_SECRET / AUTH_SECRET is not configured on the server.' }),
            { status: 503, headers }
        );
    }

    try {
        const url = new URL(context.request.url);
        const orderId = String(url.searchParams.get('orderId') || '').trim();
        const passParam = url.searchParams.get('pass') || '';
        const sessionIdParam = url.searchParams.get('session_id') || '';

        if (!/^\d{12}$/.test(orderId)) {
            return new Response(
                JSON.stringify({ error: 'Invalid 12-digit Order ID.' }),
                { status: 400, headers }
            );
        }

        const promoterClaims = await authenticateRequest(context);
        let verifiedPass = null;
        if (passParam) {
            verifiedPass = await verifyPassToken(passParam, passSecret);
            if (!verifiedPass || String(verifiedPass.orderId) !== orderId) {
                return new Response(
                    JSON.stringify({ error: 'Invalid or forged ticket pass signature.' }),
                    { status: 401, headers }
                );
            }
        }

        const dbOrder = await db
            .prepare(`
                SELECT
                    o.order_id,
                    o.event_id,
                    o.promoter_id,
                    o.customer_name,
                    o.customer_email,
                    o.customer_phone,
                    o.currency,
                    o.items_json,
                    o.base_total_cents,
                    o.fees_json,
                    o.total_amount_cents,
                    o.stripe_session_id,
                    o.pass_token,
                    o.payment_status,
                    o.created_at,
                    o.paid_at,
                    e.title AS event_title,
                    e.date AS event_date,
                    e.location AS event_location,
                    e.palette_json AS event_palette_json
                FROM orders o
                LEFT JOIN events e ON o.event_id = e.id
                WHERE o.order_id = ?
            `)
            .bind(orderId)
            .first();

        if (!dbOrder || dbOrder.payment_status !== 'paid') {
            return new Response(
                JSON.stringify({ error: 'Paid order not found in database.' }),
                { status: 404, headers }
            );
        }

        // Authorization check: require valid HMAC pass token, matching Stripe session_id, or owning promoter JWT
        const hasSessionMatch = sessionIdParam && dbOrder.stripe_session_id && sessionIdParam === dbOrder.stripe_session_id;
        const isOwningPromoter = promoterClaims && (!dbOrder.promoter_id || dbOrder.promoter_id === promoterClaims.sub);

        if (!verifiedPass && !hasSessionMatch && !isOwningPromoter) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized: a cryptographically signed pass token is required to access this ticket.' }),
                { status: 401, headers }
            );
        }

        const dbTicketsResult = await db
            .prepare('SELECT ticket_id, ticket_tier_name, price_cents, note, check_in_status, checked_in_at FROM tickets WHERE order_id = ? ORDER BY ticket_id ASC')
            .bind(orderId)
            .all();

        const tickets = (dbTicketsResult?.results || []).map(t => ({
            ticketId: t.ticket_id,
            name: t.ticket_tier_name,
            priceCents: t.price_cents,
            price: (t.price_cents || 0) / 100,
            note: t.note || '',
            checkInStatus: t.check_in_status,
            checkedInAt: t.checked_in_at || null
        }));

        const items = JSON.parse(dbOrder.items_json || '[]');
        const fees = JSON.parse(dbOrder.fees_json || '[]');
        let eventPalette = null;
        try {
            eventPalette = dbOrder.event_palette_json ? JSON.parse(dbOrder.event_palette_json) : null;
        } catch {
            eventPalette = null;
        }

        let passToken = dbOrder.pass_token;
        if (!passToken) {
            passToken = await signPassToken({
                orderId: dbOrder.order_id,
                eventId: dbOrder.event_id,
                eventTitle: dbOrder.event_title || 'Live Event',
                eventDate: dbOrder.event_date || '',
                eventLocation: dbOrder.event_location || '',
                currency: dbOrder.currency || 'cad',
                customer: { name: dbOrder.customer_name, email: dbOrder.customer_email },
                items,
                baseTotalCents: dbOrder.base_total_cents,
                totalCents: dbOrder.total_amount_cents,
                tickets
            }, passSecret);
        }

        const orderResponse = {
            orderId: dbOrder.order_id,
            eventId: dbOrder.event_id,
            eventTitle: dbOrder.event_title || 'Live Event',
            eventDate: dbOrder.event_date || '',
            eventLocation: dbOrder.event_location || '',
            eventPalette,
            currency: dbOrder.currency || 'cad',
            customer: {
                name: dbOrder.customer_name,
                email: dbOrder.customer_email,
                phone: dbOrder.customer_phone || ''
            },
            items,
            baseTotalCents: dbOrder.base_total_cents,
            baseTotal: (dbOrder.base_total_cents || 0) / 100,
            fees,
            totalCents: dbOrder.total_amount_cents,
            total: (dbOrder.total_amount_cents || 0) / 100,
            tickets,
            passToken,
            paymentStatus: dbOrder.payment_status,
            createdAt: dbOrder.created_at,
            paidAt: dbOrder.paid_at
        };

        return new Response(JSON.stringify({ success: true, order: orderResponse }), {
            status: 200,
            headers
        });
    } catch (err) {
        console.error('Error verifying ticket order:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error while verifying ticket.' }),
            { status: 500, headers }
        );
    }
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') return onRequestOptions(context);
    if (context.request.method === 'GET') return onRequestGet(context);
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: getSecurityHeaders(context.request)
    });
}

