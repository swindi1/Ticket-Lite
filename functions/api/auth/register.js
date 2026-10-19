import { validatePromoterRegistration, hashPassword } from '../../_shared/security.js';

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

export async function onRequestPost(context) {
    try {
        let body;
        try {
            body = await context.request.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }

        const { name, organizationName, phoneNumber, email, password } = body;

        // 1. Strict SQL-injection validation & password policy
        const validation = validatePromoterRegistration({ name, organizationName, phoneNumber, email, password });
        if (!validation.isValid) {
            return new Response(JSON.stringify({ error: validation.error }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }

        // 2. Verify Cloudflare D1 database binding
        const db = context.env?.DB;
        if (!db) {
            return new Response(
                JSON.stringify({ error: 'Cloudflare D1 Database binding (DB) is not attached.' }),
                { status: 503, headers: JSON_HEADERS }
            );
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 3. Query existing accounts with prepared statement (parameterized SQL injection defense)
        const existing = await db
            .prepare('SELECT id FROM promoter_accounts WHERE email = ?')
            .bind(normalizedEmail)
            .first();

        if (existing) {
            return new Response(
                JSON.stringify({ error: 'An account with this email address already exists.' }),
                { status: 409, headers: JSON_HEADERS }
            );
        }

        // 4. Generate salted SHA-256 hash
        const passwordHash = await hashPassword(password);
        const promoterId = `promoter_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
        const nowIso = new Date().toISOString();

        // 5. Insert new promoter account using prepared statement
        await db
            .prepare(
                'INSERT INTO promoter_accounts (id, name, organization_name, phone_number, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )
            .bind(
                promoterId,
                name.trim(),
                organizationName.trim(),
                phoneNumber.trim(),
                normalizedEmail,
                passwordHash,
                nowIso,
                nowIso
            )
            .run();

        const promoterAccount = {
            id: promoterId,
            name: name.trim(),
            organization_name: organizationName.trim(),
            phone_number: phoneNumber.trim(),
            email: normalizedEmail,
            created_at: nowIso
        };

        return new Response(JSON.stringify({ success: true, promoter: promoterAccount }), {
            status: 201,
            headers: JSON_HEADERS
        });
    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal server error during registration.' }),
            { status: 500, headers: JSON_HEADERS }
        );
    }
}
