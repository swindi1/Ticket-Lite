import { validatePromoterRegistration, hashPassword, getSecurityHeaders, checkRateLimit } from '../../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequestPost(context) {
    const headers = getSecurityHeaders(context.request);
    try {
        // Rate limiting: max 3 registrations per 10 minutes per client IP to mitigate automated spam bots
        const clientIp = context.request.headers.get('CF-Connecting-IP') ||
            context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            '127.0.0.1';
        const rateCheck = checkRateLimit(`register:${clientIp}`, 3, 10 * 60 * 1000);
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({
                    error: `Too many registration attempts. Please wait ${rateCheck.resetSeconds} seconds before trying again.`
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
            return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
                status: 400,
                headers
            });
        }

        const { name, organizationName, phoneNumber, email, password } = body;

        // 1. Strict SQL-injection validation & password policy
        const validation = validatePromoterRegistration({ name, organizationName, phoneNumber, email, password });
        if (!validation.isValid) {
            return new Response(JSON.stringify({ error: validation.error }), {
                status: 400,
                headers
            });
        }

        // 2. Verify Cloudflare D1 database binding
        const db = context.env?.DB;
        if (!db) {
            return new Response(
                JSON.stringify({ error: 'Cloudflare D1 Database binding (DB) is not attached.' }),
                { status: 503, headers }
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
                { status: 409, headers }
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
            headers
        });
    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal server error during registration.' }),
            { status: 500, headers }
        );
    }
}
