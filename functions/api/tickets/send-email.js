import {
    getSecurityHeaders,
    checkRateLimit,
    isValidTicketUrl,
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

/**
 * Internal server-side email dispatcher for verified paid orders.
 */
export async function dispatchTicketConfirmationEmail(env, {
    orderId,
    eventTitle,
    eventDate,
    eventLocation,
    customerName,
    customerEmail,
    currency = 'cad',
    items = [],
    baseTotalCents = 0,
    fees = [],
    totalAmountCents = 0,
    ticketUrl,
    googleCalendarUrl
}) {
    const rawApiKey = env?.RESEND_API_KEY || env?.resend_api_key;
    let apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim().replace(/^["']|["']$/g, '') : null;
    if (apiKey && apiKey.toLowerCase().startsWith('bearer ')) {
        apiKey = apiKey.slice(7).trim();
    }

    if (!apiKey) {
        return {
            success: false,
            status: 503,
            error: 'Email delivery service is not configured on the server.'
        };
    }

    const emailClean = String(customerEmail || '').trim().toLowerCase();
    const cleanOrderId = String(orderId || '').trim();
    const cleanEventTitle = String(eventTitle || '').trim().slice(0, 120).replace(/[\r\n]/g, ' ');
    const currencyUpper = String(currency || 'cad').toUpperCase();

    let finalTicketUrl = 'https://ticketlite.ca/portal';
    if (ticketUrl && isValidTicketUrl(ticketUrl)) {
        finalTicketUrl = ticketUrl;
    } else if (cleanOrderId) {
        finalTicketUrl = `https://ticketlite.ca/tickets/${encodeURIComponent(cleanOrderId)}`;
    }

    let safeCalendarUrl = '';
    if (googleCalendarUrl && typeof googleCalendarUrl === 'string') {
        try {
            const parsedCal = new URL(googleCalendarUrl);
            if (parsedCal.protocol === 'https:' && parsedCal.hostname === 'calendar.google.com') {
                safeCalendarUrl = googleCalendarUrl;
            }
        } catch {
            safeCalendarUrl = '';
        }
    }

    const fromEmail = env?.RESEND_FROM_EMAIL || 'Ticket Lite <donotreply@ticketlite.ca>';

    const safeItems = Array.isArray(items) ? items.slice(0, 50) : [];
    const itemsRows = safeItems.map(item => {
        const qty = Math.max(1, parseInt(item?.quantity, 10) || 1);
        const priceCents = Number.isInteger(item?.priceCents)
            ? item.priceCents
            : Math.round((Number(item?.price) || 0) * 100);
        const lineDollars = ((priceCents * qty) / 100).toFixed(2);
        return `
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); color: #ffffff;">
                    <strong>${escapeHtml(item?.name)}</strong>
                    ${item?.note ? `<div style="font-size: 12px; color: #94a3b8;">${escapeHtml(item.note)}</div>` : ''}
                </td>
                <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: center; color: #94a3b8;">
                    ${qty}
                </td>
                <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: right; color: #ffffff; font-weight: bold;">
                    $${lineDollars} ${escapeHtml(currencyUpper)}
                </td>
            </tr>
        `;
    }).join('');

    const safeFees = Array.isArray(fees) ? fees.slice(0, 10) : [];
    const feesRows = safeFees.map(fee => {
        const feeCents = Number.isInteger(fee?.amountCents)
            ? fee.amountCents
            : Math.round((Number(fee?.amount) || 0) * 100);
        return `
            <tr>
                <td colspan="2" style="padding: 6px 0; color: #94a3b8; font-size: 13px;">${escapeHtml(fee?.name)}</td>
                <td style="padding: 6px 0; text-align: right; color: #94a3b8; font-size: 13px;">$${(Math.max(0, feeCents) / 100).toFixed(2)} ${escapeHtml(currencyUpper)}</td>
            </tr>
        `;
    }).join('');

    const subtotalRow = safeFees.length > 0 ? `
            <tr>
                <td colspan="2" style="padding: 10px 0 6px; color: #94a3b8; font-size: 13px; border-top: 1px solid rgba(255,255,255,0.06);">Subtotal</td>
                <td style="padding: 10px 0 6px; text-align: right; color: #ffffff; font-size: 13px; border-top: 1px solid rgba(255,255,255,0.06);">$${(Math.max(0, Number(baseTotalCents) || 0) / 100).toFixed(2)} ${escapeHtml(currencyUpper)}</td>
            </tr>
        ` : '';

    const htmlEmail = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Tickets for ${escapeHtml(cleanEventTitle)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b0f19; padding: 30px 10px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" style="max-width: 600px; background-color: #151c2e; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                    <tr>
                        <td style="height: 6px; background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);"></td>
                    </tr>
                    <tr>
                        <td style="padding: 32px 32px 20px; text-align: center;">
                            <div style="font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #a855f7; margin-bottom: 8px;">
                                🎟️ TICKET LITE • ORDER CONFIRMATION
                            </div>
                            <h1 style="margin: 0 0 12px; color: #ffffff; font-size: 26px; line-height: 1.3; font-weight: 800;">
                                You're going to ${escapeHtml(cleanEventTitle)}!
                            </h1>
                            <p style="margin: 0; color: #94a3b8; font-size: 15px;">
                                Hi ${escapeHtml(customerName || 'there')}, your tickets are ready and secured.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 32px 24px;">
                            <div style="background-color: #0d1322; border: 1px dashed #334155; border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                                    12-Digit Order Confirmation ID
                                </div>
                                <div style="font-size: 22px; font-weight: 800; color: #38bdf8; font-family: monospace; letter-spacing: 2px;">
                                    ${escapeHtml(cleanOrderId)}
                                </div>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 32px 28px; text-align: center;">
                            <a href="${escapeHtml(finalTicketUrl)}" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); color: #ffffff; text-decoration: none; padding: 16px 28px; border-radius: 10px; font-weight: 700; font-size: 16px; letter-spacing: 0.3px; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);">
                                📱 View & Access Digital Tickets & QR Codes
                            </a>
                            <div style="font-size: 12px; color: #64748b; margin-top: 10px;">
                                Instant contactless smartphone entry • Cryptographically signed pass
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 32px 24px;">
                            <div style="background-color: #0d1322; border-radius: 12px; padding: 20px; border: 1px solid #1e293b;">
                                <div style="font-weight: 700; color: #ffffff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
                                    📍 Event Details
                                </div>
                                <table width="100%" cellspacing="0" cellpadding="0" border="0">
                                    <tr>
                                        <td style="padding: 6px 0; color: #94a3b8; font-size: 14px; width: 80px;">Event:</td>
                                        <td style="padding: 6px 0; color: #ffffff; font-weight: 600; font-size: 14px;">${escapeHtml(cleanEventTitle)}</td>
                                    </tr>
                                    ${eventDate ? `
                                    <tr>
                                        <td style="padding: 6px 0; color: #94a3b8; font-size: 14px;">Date:</td>
                                        <td style="padding: 6px 0; color: #ffffff; font-weight: 600; font-size: 14px;">📅 ${escapeHtml(eventDate)}</td>
                                    </tr>` : ''}
                                    ${eventLocation ? `
                                    <tr>
                                        <td style="padding: 6px 0; color: #94a3b8; font-size: 14px;">Venue:</td>
                                        <td style="padding: 6px 0; color: #ffffff; font-weight: 600; font-size: 14px;">📍 ${escapeHtml(eventLocation)}</td>
                                    </tr>` : ''}
                                </table>
                            </div>
                        </td>
                    </tr>
                    ${safeCalendarUrl ? `
                    <tr>
                        <td style="padding: 0 32px 24px; text-align: center;">
                            <a href="${escapeHtml(safeCalendarUrl)}" style="display: inline-block; background-color: #1e293b; color: #38bdf8; border: 1px solid #334155; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
                                📅 Add Event to Google Calendar
                            </a>
                        </td>
                    </tr>` : ''}
                    <tr>
                        <td style="padding: 0 32px 32px;">
                            <div style="font-weight: 700; color: #ffffff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
                                🧾 Order Summary
                            </div>
                            <table width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse; font-size: 14px;">
                                <thead>
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.15); color: #94a3b8; font-size: 12px; text-transform: uppercase;">
                                        <th align="left" style="padding-bottom: 8px;">Ticket Tier</th>
                                        <th align="center" style="padding-bottom: 8px;">Qty</th>
                                        <th align="right" style="padding-bottom: 8px;">Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsRows}
                                    ${subtotalRow}
                                    ${feesRows}
                                    <tr>
                                        <td colspan="2" style="padding-top: 14px; font-size: 16px; font-weight: 800; color: #ffffff;">Total Paid</td>
                                        <td style="padding-top: 14px; text-align: right; font-size: 18px; font-weight: 800; color: #38bdf8;">$${(Math.max(0, Number(totalAmountCents) || 0) / 100).toFixed(2)} ${escapeHtml(currencyUpper)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px 32px; background-color: #0d1322; border-top: 1px solid #1e293b; text-align: center; color: #64748b; font-size: 12px; line-height: 1.6;">
                            <div>Powered by <strong>Ticket Lite</strong> • Live Event Ticketing & Pass Architecture</div>
                            <div style="margin-top: 4px;">Present your mobile screen at gate check-in for instant scan.</div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    async function postToResend(sender) {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'TicketLite/1.0'
            },
            body: JSON.stringify({
                from: sender,
                to: [emailClean],
                subject: `🎟️ Your Tickets for ${cleanEventTitle} (Order #${cleanOrderId})`,
                html: htmlEmail
            })
        });
        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { raw: text };
        }
        return { res, text, data, sender };
    }

    let result = await postToResend(fromEmail);
    if (!result.res.ok && !fromEmail.includes('onboarding@resend.dev')) {
        const fallbackResult = await postToResend('Ticket Lite <onboarding@resend.dev>');
        if (fallbackResult.res.ok) {
            result = fallbackResult;
        }
    }

    if (!result.res.ok) {
        console.error('Resend API delivery failure:', result.res.status, result.data);
        return {
            success: false,
            status: 502,
            error: 'Failed to send confirmation email.'
        };
    }

    return {
        success: true,
        status: 200,
        id: result.data.id,
        recipient: emailClean
    };
}

/**
 * POST /api/tickets/send-email
 * Strictly authenticated & database-verified:
 * - Caller must either be an authenticated promoter (verifyAuthToken) OR provide a valid
 *   server-signed HMAC passToken for the order.
 * - Order MUST exist in D1 `orders` with `payment_status = 'paid'`.
 * - Recipient email, items, fees, and totals are read exclusively from the D1 `orders` row,
 *   preventing any spoofing or arbitrary content injection.
 */
export async function onRequestPost(context) {
    const headers = getSecurityHeaders(context.request);
    try {
        const clientIp = context.request.headers.get('CF-Connecting-IP') ||
            context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            '127.0.0.1';
        const rateCheck = checkRateLimit(`email:${clientIp}`, 5, 5 * 60 * 1000);
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Too many email delivery requests. Please wait ${rateCheck.resetSeconds} seconds before trying again.`
                }),
                {
                    status: 429,
                    headers: { ...headers, 'Retry-After': String(rateCheck.resetSeconds) }
                }
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

        let body;
        try {
            body = await context.request.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid JSON request body.' }),
                { status: 400, headers }
            );
        }

        const cleanOrderId = String(body.orderId || '').trim();
        if (!/^\d{12}$/.test(cleanOrderId)) {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid 12-digit Order ID.' }),
                { status: 400, headers }
            );
        }

        // Authenticate caller: require either valid promoter JWT or valid server-signed passToken for this orderId
        const promoterClaims = await authenticateRequest(context);
        const passSecret = getPassSecret(context.env);
        const verifiedPass = (!promoterClaims && body.passToken && passSecret)
            ? await verifyPassToken(body.passToken, passSecret)
            : null;

        if (!promoterClaims && (!verifiedPass || String(verifiedPass.orderId) !== cleanOrderId)) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Unauthorized: valid authentication token or signed order pass token is required to resend ticket emails.'
                }),
                { status: 401, headers }
            );
        }

        // Look up canonical paid order from D1 (never trust client-supplied email/items/totals)
        const dbOrder = await db
            .prepare(`
                SELECT
                    o.order_id,
                    o.event_id,
                    o.promoter_id,
                    o.customer_name,
                    o.customer_email,
                    o.currency,
                    o.items_json,
                    o.base_total_cents,
                    o.fees_json,
                    o.total_amount_cents,
                    o.pass_token,
                    o.payment_status,
                    e.title AS event_title,
                    e.date AS event_date,
                    e.location AS event_location
                FROM orders o
                LEFT JOIN events e ON o.event_id = e.id
                WHERE o.order_id = ?
            `)
            .bind(cleanOrderId)
            .first();

        if (!dbOrder || dbOrder.payment_status !== 'paid') {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Paid order not found in database.'
                }),
                { status: 404, headers }
            );
        }

        // If authenticated as a promoter, ensure they own the event/order
        if (promoterClaims && dbOrder.promoter_id && dbOrder.promoter_id !== promoterClaims.sub) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Forbidden: you do not have permission to access this order.'
                }),
                { status: 403, headers }
            );
        }

        const recipientRateCheck = checkRateLimit(`email-recipient:${dbOrder.customer_email}`, 3, 10 * 60 * 1000);
        if (!recipientRateCheck.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Too many emails sent for this order recently. Please wait ${recipientRateCheck.resetSeconds} seconds.`
                }),
                {
                    status: 429,
                    headers: { ...headers, 'Retry-After': String(recipientRateCheck.resetSeconds) }
                }
            );
        }

        const items = JSON.parse(dbOrder.items_json || '[]');
        const fees = JSON.parse(dbOrder.fees_json || '[]');

        let passToken = dbOrder.pass_token;
        if (!passToken && passSecret) {
            const dbTickets = await db
                .prepare('SELECT ticket_id, ticket_tier_name, price_cents, note, check_in_status, checked_in_at FROM tickets WHERE order_id = ?')
                .bind(cleanOrderId)
                .all();
            passToken = await signPassToken({
                orderId: cleanOrderId,
                eventId: dbOrder.event_id,
                eventTitle: dbOrder.event_title || 'Live Event',
                eventDate: dbOrder.event_date || '',
                eventLocation: dbOrder.event_location || '',
                currency: dbOrder.currency || 'cad',
                customer: { name: dbOrder.customer_name, email: dbOrder.customer_email },
                items,
                baseTotalCents: dbOrder.base_total_cents,
                totalCents: dbOrder.total_amount_cents,
                tickets: dbTickets?.results || []
            }, passSecret);
        }

        const origin = new URL(context.request.url).origin;
        const ticketUrl = passToken
            ? `${origin}/tickets/${encodeURIComponent(cleanOrderId)}?pass=${encodeURIComponent(passToken)}`
            : `${origin}/tickets/${encodeURIComponent(cleanOrderId)}`;

        const dispatchResult = await dispatchTicketConfirmationEmail(context.env, {
            orderId: cleanOrderId,
            eventTitle: dbOrder.event_title || 'Live Event',
            eventDate: dbOrder.event_date || '',
            eventLocation: dbOrder.event_location || '',
            customerName: dbOrder.customer_name,
            customerEmail: dbOrder.customer_email,
            currency: dbOrder.currency || 'cad',
            items,
            baseTotalCents: dbOrder.base_total_cents,
            fees,
            totalAmountCents: dbOrder.total_amount_cents,
            ticketUrl,
            googleCalendarUrl: body.googleCalendarUrl
        });

        return new Response(
            JSON.stringify({
                success: dispatchResult.success,
                id: dispatchResult.id,
                recipient: dispatchResult.recipient,
                error: dispatchResult.error
            }),
            { status: dispatchResult.status || 200, headers }
        );
    } catch (err) {
        console.error('Error sending ticket email:', err);
        return new Response(
            JSON.stringify({
                success: false,
                error: 'Internal server error while sending email.'
            }),
            { status: 500, headers }
        );
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
