/**
 * Cloudflare Pages Function: /api/tickets/send-email
 * Sends purchased ticket confirmation and pass links to customers via Resend REST API.
 */

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: JSON_HEADERS
    });
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return onRequestOptions();
    }
    if (context.request.method === 'POST') {
        return onRequestPost(context);
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: JSON_HEADERS
    });
}

export async function onRequestPost(context) {
    try {
        const rawApiKey = context.env?.RESEND_API_KEY ||
            context.env?.resend_api_key ||
            context.env?.RESEND_KEY ||
            context.env?.resend_key ||
            context.env?.RESEND ||
            (typeof globalThis !== 'undefined' && (globalThis.RESEND_API_KEY || globalThis.resend_api_key || globalThis.RESEND));
        const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : null;

        if (!apiKey) {
            const envKeys = Object.keys(context.env || {});
            const globalKeys = typeof globalThis !== 'undefined'
                ? Object.keys(globalThis).filter(k => k.toLowerCase().includes('resend'))
                : [];
            const availableKeys = [...new Set([...envKeys, ...globalKeys])].filter(k => k !== 'ASSETS');
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `RESEND_API_KEY not found. Available variables: [${availableKeys.join(', ')}]. Please verify variable name and trigger a redeployment in Cloudflare.`
                }),
                { status: 503, headers: JSON_HEADERS }
            );
        }

        let body;
        try {
            body = await context.request.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid JSON request body.' }),
                { status: 400, headers: JSON_HEADERS }
            );
        }

        const {
            orderId,
            eventTitle,
            eventDate,
            eventLocation,
            customerName,
            customerEmail,
            items = [],
            baseTotal = 0,
            fees = [],
            total = 0,
            ticketUrl,
            googleCalendarUrl
        } = body;

        if (!customerEmail || !orderId || !eventTitle) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing required order details.' }),
                { status: 400, headers: JSON_HEADERS }
            );
        }

        // From email: custom domain if defined in Cloudflare env, otherwise defaults to verified donotreply@ticketlite.ca
        const fromEmail = context.env?.RESEND_FROM_EMAIL || 'Ticket Lite <donotreply@ticketlite.ca>';

        // Build itemized table rows
        const itemsRows = items.map(item => `
            <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); color: #ffffff;">
                    <strong>${escapeHtml(item.name)}</strong>
                    ${item.note ? `<div style="font-size: 12px; color: #94a3b8;">${escapeHtml(item.note)}</div>` : ''}
                </td>
                <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: center; color: #94a3b8;">
                    ${item.quantity}
                </td>
                <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: right; color: #ffffff; font-weight: bold;">
                    $${(item.price * item.quantity).toFixed(2)}
                </td>
            </tr>
        `).join('');

        const feesRows = fees.map(fee => `
            <tr>
                <td colspan="2" style="padding: 6px 0; color: #94a3b8; font-size: 13px;">${escapeHtml(fee.name)}</td>
                <td style="padding: 6px 0; text-align: right; color: #94a3b8; font-size: 13px;">$${fee.amount.toFixed(2)}</td>
            </tr>
        `).join('');

        const subtotalRow = fees.length > 0 ? `
            <tr>
                <td colspan="2" style="padding: 10px 0 6px; color: #94a3b8; font-size: 13px; border-top: 1px solid rgba(255,255,255,0.06);">Subtotal</td>
                <td style="padding: 10px 0 6px; text-align: right; color: #ffffff; font-size: 13px; border-top: 1px solid rgba(255,255,255,0.06);">$${Number(baseTotal).toFixed(2)}</td>
            </tr>
        ` : '';

        const finalTicketUrl = ticketUrl || 'https://ticketlite.ca/portal';

        const htmlEmail = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Tickets for ${escapeHtml(eventTitle)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b0f19; padding: 30px 10px;">
        <tr>
            <td align="center">
                <!-- Main Container -->
                <table role="presentation" width="100%" style="max-width: 600px; background-color: #151c2e; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                    <!-- Top Gradient Header Bar -->
                    <tr>
                        <td style="height: 6px; background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);"></td>
                    </tr>

                    <!-- Header Content -->
                    <tr>
                        <td style="padding: 32px 32px 20px; text-align: center;">
                            <div style="font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #a855f7; margin-bottom: 8px;">
                                🎟️ TICKET LITE • ORDER CONFIRMATION
                            </div>
                            <h1 style="margin: 0 0 12px; color: #ffffff; font-size: 26px; line-height: 1.3; font-weight: 800;">
                                You're going to ${escapeHtml(eventTitle)}!
                            </h1>
                            <p style="margin: 0; color: #94a3b8; font-size: 15px;">
                                Hi ${escapeHtml(customerName || 'there')}, your tickets are ready and secured.
                            </p>
                        </td>
                    </tr>

                    <!-- Order ID Highlight Box -->
                    <tr>
                        <td style="padding: 0 32px 24px;">
                            <div style="background-color: #0d1322; border: 1px dashed #334155; border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                                    12-Digit Order Confirmation ID
                                </div>
                                <div style="font-size: 22px; font-weight: 800; color: #38bdf8; font-family: monospace; letter-spacing: 2px;">
                                    ${escapeHtml(orderId)}
                                </div>
                            </div>
                        </td>
                    </tr>

                    <!-- Primary CTA Button: Access Tickets -->
                    <tr>
                        <td style="padding: 0 32px 28px; text-align: center;">
                            <a href="${finalTicketUrl}" style="display: block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); color: #ffffff; text-decoration: none; padding: 16px 28px; border-radius: 10px; font-weight: 700; font-size: 16px; letter-spacing: 0.3px; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);">
                                📱 View & Access Digital Tickets & QR Codes
                            </a>
                            <div style="font-size: 12px; color: #64748b; margin-top: 10px;">
                                Instant contactless smartphone entry • No printouts needed
                            </div>
                        </td>
                    </tr>

                    <!-- Event Details Card -->
                    <tr>
                        <td style="padding: 0 32px 24px;">
                            <div style="background-color: #0d1322; border-radius: 12px; padding: 20px; border: 1px solid #1e293b;">
                                <div style="font-weight: 700; color: #ffffff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
                                    📍 Event Details
                                </div>
                                <table width="100%" cellspacing="0" cellpadding="0" border="0">
                                    <tr>
                                        <td style="padding: 6px 0; color: #94a3b8; font-size: 14px; width: 80px;">Event:</td>
                                        <td style="padding: 6px 0; color: #ffffff; font-weight: 600; font-size: 14px;">${escapeHtml(eventTitle)}</td>
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

                    ${googleCalendarUrl ? `
                    <!-- 1-Tap Calendar Link -->
                    <tr>
                        <td style="padding: 0 32px 24px; text-align: center;">
                            <a href="${googleCalendarUrl}" style="display: inline-block; background-color: #1e293b; color: #38bdf8; border: 1px solid #334155; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
                                📅 Add Event to Google Calendar
                            </a>
                        </td>
                    </tr>` : ''}

                    <!-- Itemized Order Receipt -->
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
                                        <td style="padding-top: 14px; text-align: right; font-size: 18px; font-weight: 800; color: #38bdf8;">$${Number(total).toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
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

        // Send request to Resend REST API
        const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [customerEmail],
                subject: `🎟️ Your Tickets for ${eventTitle} (Order #${orderId})`,
                html: htmlEmail
            })
        });

        const resendData = await resendRes.json();

        if (!resendRes.ok) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: resendData.message || resendData.error || 'Failed to send email via Resend.'
                }),
                { status: resendRes.status, headers: JSON_HEADERS }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                id: resendData.id,
                recipient: customerEmail
            }),
            { status: 200, headers: JSON_HEADERS }
        );
    } catch (err) {
        return new Response(
            JSON.stringify({
                success: false,
                error: err.message || 'Internal server error while sending email.'
            }),
            { status: 500, headers: JSON_HEADERS }
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
