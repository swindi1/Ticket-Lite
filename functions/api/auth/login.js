import { validateLoginInputs, verifyPassword } from '../../_shared/security.js';

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

        const { email, password } = body;

        // 1. Validate inputs against SQL injection attempts
        const validation = validateLoginInputs(email, password);
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

        // 3. Query promoter account using prepared statement
        const account = await db
            .prepare('SELECT id, name, organization_name, phone_number, email, password_hash, created_at FROM promoter_accounts WHERE email = ?')
            .bind(normalizedEmail)
            .first();

        if (!account) {
            return new Response(
                JSON.stringify({ error: 'No promoter account found with this email.' }),
                { status: 401, headers: JSON_HEADERS }
            );
        }

        // 4. Cryptographic password verification (salted SHA-256)
        const isMatch = await verifyPassword(password, account.password_hash);
        if (!isMatch) {
            return new Response(
                JSON.stringify({ error: 'Incorrect password. Please try again.' }),
                { status: 401, headers: JSON_HEADERS }
            );
        }

        const promoterAccount = {
            id: account.id,
            name: account.name,
            organization_name: account.organization_name,
            phone_number: account.phone_number,
            email: account.email,
            created_at: account.created_at
        };

        return new Response(JSON.stringify({ success: true, promoter: promoterAccount }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal server error during authentication.' }),
            { status: 500, headers: JSON_HEADERS }
        );
    }
}
