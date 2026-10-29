import {
    getSecurityHeaders,
    authenticateRequest,
    validateCurrency,
    toCents
} from '../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

function formatDbEvent(row) {
    if (!row) return null;
    let palette = null;
    let tickets = [];
    let fees = [];
    try {
        palette = row.palette_json ? JSON.parse(row.palette_json) : null;
    } catch {
        palette = null;
    }
    try {
        tickets = row.tickets_json ? JSON.parse(row.tickets_json) : [];
    } catch {
        tickets = [];
    }
    try {
        fees = row.fees_json ? JSON.parse(row.fees_json) : [];
    } catch {
        fees = [];
    }

    return {
        id: row.id,
        promoterId: row.promoter_id,
        title: row.title,
        date: row.date || '',
        location: row.location || '',
        currency: row.currency || 'cad',
        stripeAccountId: row.stripe_account_id || null,
        image: row.image_url || null,
        palette,
        tickets: tickets.map(t => ({
            ...t,
            priceCents: Number.isInteger(t.price_cents) ? t.price_cents : toCents(t.price || 0),
            price: Number.isInteger(t.price_cents) ? t.price_cents / 100 : (Number(t.price) || 0)
        })),
        fees,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
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

    try {
        const url = new URL(context.request.url);
        const eventId = url.searchParams.get('id');

        if (eventId) {
            const row = await db
                .prepare('SELECT * FROM events WHERE id = ?')
                .bind(eventId)
                .first();
            if (!row) {
                return new Response(JSON.stringify({ error: 'Event not found.' }), { status: 404, headers });
            }
            return new Response(JSON.stringify({ event: formatDbEvent(row) }), { status: 200, headers });
        }

        const result = await db
            .prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 100')
            .all();
        const events = (result?.results || []).map(formatDbEvent);
        return new Response(JSON.stringify({ events }), { status: 200, headers });
    } catch (err) {
        console.error('Error fetching events from D1:', err);
        return new Response(JSON.stringify({ error: 'Failed to load events.' }), { status: 500, headers });
    }
}

export async function onRequestPost(context) {
    const headers = getSecurityHeaders(context.request);
    const promoterClaims = await authenticateRequest(context);
    if (!promoterClaims) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized: valid promoter session token is required.' }),
            { status: 401, headers }
        );
    }

    const db = context.env?.DB;
    if (!db) {
        return new Response(
            JSON.stringify({ error: 'Database binding (DB) is not configured.' }),
            { status: 503, headers }
        );
    }

    try {
        const body = await context.request.json();
        const eventId = body.id && /^[a-zA-Z0-9_-]{1,64}$/.test(String(body.id))
            ? String(body.id)
            : `evt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

        const title = String(body.title || '').trim().slice(0, 120);
        if (!title) {
            return new Response(JSON.stringify({ error: 'Event title is required.' }), { status: 400, headers });
        }

        const currency = validateCurrency(body.currency || 'cad');
        if (!currency) {
            return new Response(JSON.stringify({ error: 'Unsupported event currency.' }), { status: 400, headers });
        }

        let stripeAccountId = null;
        if (body.stripeAccountId && typeof body.stripeAccountId === 'string' && body.stripeAccountId.trim() !== '') {
            if (!/^acct_[a-zA-Z0-9]{8,32}$/.test(body.stripeAccountId.trim())) {
                return new Response(
                    JSON.stringify({ error: 'Invalid Stripe Connect account ID (must start with acct_).' }),
                    { status: 400, headers }
                );
            }
            stripeAccountId = body.stripeAccountId.trim();
        }

        if (!Array.isArray(body.tickets) || body.tickets.length === 0) {
            return new Response(
                JSON.stringify({ error: 'At least one ticket tier is required.' }),
                { status: 400, headers }
            );
        }

        const sanitizedTickets = [];
        for (let i = 0; i < body.tickets.length; i++) {
            const t = body.tickets[i];
            const tierName = String(t?.name || '').trim().slice(0, 100);
            const priceCents = Number.isInteger(t?.price_cents)
                ? t.price_cents
                : toCents(t?.price);
            const quantity = parseInt(t?.quantity, 10);

            if (!tierName || !Number.isInteger(priceCents) || priceCents < 50 || priceCents > 1000000) {
                return new Response(
                    JSON.stringify({ error: `Invalid ticket tier price for "${tierName || 'tier'}". Must be between $0.50 and $10,000.00.` }),
                    { status: 400, headers }
                );
            }
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
                return new Response(
                    JSON.stringify({ error: `Invalid ticket capacity for "${tierName}".` }),
                    { status: 400, headers }
                );
            }

            sanitizedTickets.push({
                id: t.id || `t_${Date.now()}_${i}`,
                name: tierName,
                price_cents: priceCents,
                price: priceCents / 100,
                quantity,
                note: String(t?.note || '').slice(0, 1000),
                onSaleDate: t?.onSaleDate || null,
                timezone: String(t?.timezone || 'UTC').slice(0, 40)
            });
        }

        const sanitizedFees = (Array.isArray(body.fees) ? body.fees : []).slice(0, 10).map((f, idx) => ({
            id: f?.id || `f_${Date.now()}_${idx}`,
            name: String(f?.name || 'Service Fee').trim().slice(0, 60),
            amount: Math.max(0, Number(f?.amount) || 0),
            type: ['fixed_per_transaction', 'fixed_per_ticket', 'percentage'].includes(f?.type)
                ? f.type
                : 'fixed_per_transaction'
        }));

        const nowIso = new Date().toISOString();

        await db
            .prepare(`
                INSERT INTO events (
                    id, promoter_id, title, date, location, currency, stripe_account_id,
                    image_url, palette_json, tickets_json, fees_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    date = excluded.date,
                    location = excluded.location,
                    currency = excluded.currency,
                    stripe_account_id = excluded.stripe_account_id,
                    image_url = excluded.image_url,
                    palette_json = excluded.palette_json,
                    tickets_json = excluded.tickets_json,
                    fees_json = excluded.fees_json,
                    updated_at = excluded.updated_at
                WHERE events.promoter_id = excluded.promoter_id
            `)
            .bind(
                eventId,
                promoterClaims.sub,
                title,
                String(body.date || '').slice(0, 80),
                String(body.location || '').slice(0, 120),
                currency,
                stripeAccountId,
                body.image ? String(body.image) : null,
                body.palette ? JSON.stringify(body.palette) : null,
                JSON.stringify(sanitizedTickets),
                JSON.stringify(sanitizedFees),
                nowIso,
                nowIso
            )
            .run();

        const savedRow = await db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first();
        return new Response(
            JSON.stringify({ success: true, event: formatDbEvent(savedRow) }),
            { status: 201, headers }
        );
    } catch (err) {
        console.error('Error saving event in D1:', err);
        return new Response(JSON.stringify({ error: 'Failed to save event.' }), { status: 500, headers });
    }
}

export async function onRequestDelete(context) {
    const headers = getSecurityHeaders(context.request);
    const promoterClaims = await authenticateRequest(context);
    if (!promoterClaims) {
        return new Response(
            JSON.stringify({ error: 'Unauthorized: valid promoter session token is required.' }),
            { status: 401, headers }
        );
    }

    const db = context.env?.DB;
    if (!db) {
        return new Response(
            JSON.stringify({ error: 'Database binding (DB) is not configured.' }),
            { status: 503, headers }
        );
    }

    try {
        const url = new URL(context.request.url);
        const eventId = url.searchParams.get('id');
        if (!eventId) {
            return new Response(JSON.stringify({ error: 'Event ID is required.' }), { status: 400, headers });
        }

        const existing = await db.prepare('SELECT promoter_id FROM events WHERE id = ?').bind(eventId).first();
        if (!existing) {
            return new Response(JSON.stringify({ error: 'Event not found.' }), { status: 404, headers });
        }
        if (existing.promoter_id !== promoterClaims.sub) {
            return new Response(JSON.stringify({ error: 'Forbidden: you do not own this event.' }), { status: 403, headers });
        }

        await db.prepare('DELETE FROM events WHERE id = ? AND promoter_id = ?').bind(eventId, promoterClaims.sub).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    } catch (err) {
        console.error('Error deleting event from D1:', err);
        return new Response(JSON.stringify({ error: 'Failed to delete event.' }), { status: 500, headers });
    }
}

export async function onRequest(context) {
    const method = context.request.method;
    if (method === 'OPTIONS') return onRequestOptions(context);
    if (method === 'GET') return onRequestGet(context);
    if (method === 'POST' || method === 'PUT') return onRequestPost(context);
    if (method === 'DELETE') return onRequestDelete(context);
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: getSecurityHeaders(context.request)
    });
}

