import {
    getSecurityHeaders,
    authenticateRequest,
    verifyPassToken,
    getPassSecret
} from '../../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequestPost(context) {
    const headers = getSecurityHeaders(context.request);

    // 1. Fail-closed promoter authentication check via verifyAuthToken
    const promoterClaims = await authenticateRequest(context);
    if (!promoterClaims) {
        return new Response(
            JSON.stringify({
                success: false,
                error: 'Unauthorized: only authenticated venue staff / promoters can check in tickets.'
            }),
            { status: 401, headers }
        );
    }

    const db = context.env?.DB;
    if (!db) {
        return new Response(
            JSON.stringify({
                success: false,
                error: 'Database binding (DB) is not configured.'
            }),
            { status: 503, headers }
        );
    }

    try {
        const body = await context.request.json();
        const orderId = String(body.orderId || '').trim();
        const ticketId = String(body.ticketId || '').trim();
        const passToken = body.passToken ? String(body.passToken).trim() : '';

        if (!/^\d{12}$/.test(orderId) || !/^\d{12}-\d{2,4}$/.test(ticketId)) {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid orderId or ticketId format.' }),
                { status: 400, headers }
            );
        }

        // 2. If passToken is provided (from scanned QR), cryptographically verify its HMAC-SHA256 signature
        if (passToken) {
            const passSecret = getPassSecret(context.env);
            if (!passSecret) {
                return new Response(
                    JSON.stringify({ success: false, error: 'PASS_SECRET / AUTH_SECRET is not configured on the server.' }),
                    { status: 503, headers }
                );
            }
            const verifiedPass = await verifyPassToken(passToken, passSecret);
            if (!verifiedPass || String(verifiedPass.orderId) !== orderId) {
                return new Response(
                    JSON.stringify({ success: false, error: 'Forged or invalid pass token signature rejected.' }),
                    { status: 401, headers }
                );
            }
        }

        // 3. Look up the ticket and its parent order in D1
        const record = await db
            .prepare(`
                SELECT
                    t.ticket_id,
                    t.order_id,
                    t.event_id,
                    t.ticket_tier_name,
                    t.check_in_status,
                    t.checked_in_at,
                    o.payment_status,
                    o.promoter_id
                FROM tickets t
                INNER JOIN orders o ON t.order_id = o.order_id
                WHERE t.ticket_id = ? AND t.order_id = ?
            `)
            .bind(ticketId, orderId)
            .first();

        if (!record) {
            return new Response(
                JSON.stringify({ success: false, error: 'Ticket not found in database.' }),
                { status: 404, headers }
            );
        }

        if (record.payment_status !== 'paid') {
            return new Response(
                JSON.stringify({ success: false, error: 'Cannot check in an unpaid ticket order.' }),
                { status: 400, headers }
            );
        }

        if (record.promoter_id && record.promoter_id !== promoterClaims.sub) {
            return new Response(
                JSON.stringify({ success: false, error: 'Forbidden: you are not the organizer for this event.' }),
                { status: 403, headers }
            );
        }

        if (record.check_in_status === 'checked_in') {
            return new Response(
                JSON.stringify({
                    success: false,
                    alreadyCheckedIn: true,
                    checkedInAt: record.checked_in_at,
                    error: `Ticket #${ticketId} has already been checked in.`
                }),
                { status: 409, headers }
            );
        }

        const nowIso = new Date().toISOString();
        const updateRes = await db
            .prepare(`
                UPDATE tickets
                SET check_in_status = 'checked_in', checked_in_at = ?, checked_in_by = ?
                WHERE ticket_id = ? AND order_id = ? AND check_in_status = 'valid'
            `)
            .bind(nowIso, promoterClaims.sub, ticketId, orderId)
            .run();

        if (!updateRes.meta || updateRes.meta.changes === 0) {
            return new Response(
                JSON.stringify({
                    success: false,
                    alreadyCheckedIn: true,
                    error: `Ticket #${ticketId} was already checked in.`
                }),
                { status: 409, headers }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                ticketId,
                orderId,
                checkInStatus: 'checked_in',
                checkedInAt: nowIso
            }),
            { status: 200, headers }
        );
    } catch (err) {
        console.error('Error checking in ticket:', err);
        return new Response(
            JSON.stringify({ success: false, error: 'Internal server error during ticket check-in.' }),
            { status: 500, headers }
        );
    }
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') return onRequestOptions(context);
    if (context.request.method === 'POST') return onRequestPost(context);
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: getSecurityHeaders(context.request)
    });
}

