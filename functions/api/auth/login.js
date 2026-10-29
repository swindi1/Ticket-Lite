import { validateLoginInputs, verifyPassword, signAuthToken, getAuthSecret, getSecurityHeaders, checkRateLimit } from '../../_shared/security.js';

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: getSecurityHeaders(context?.request)
    });
}

export async function onRequestPost(context) {
    const headers = getSecurityHeaders(context.request);
    try {
        // 1. IP Rate Limiting: max 5 login attempts per 5 minutes to prevent brute-force credential stuffing
        const clientIp = context.request.headers.get('CF-Connecting-IP') ||
            context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            '127.0.0.1';
        const rateCheck = checkRateLimit(`login:${clientIp}`, 5, 5 * 60 * 1000);
        if (!rateCheck.allowed) {
            return new Response(
                JSON.stringify({
                    error: `Too many login attempts. Please wait ${rateCheck.resetSeconds} seconds before trying again.`
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

        const { email, password } = body;

        // 2. Validate inputs against SQL injection attempts
        const validation = validateLoginInputs(email, password);
        if (!validation.isValid) {
            return new Response(JSON.stringify({ error: validation.error }), {
                status: 400,
                headers
            });
        }

        // 3. Verify Cloudflare D1 database binding and AUTH_SECRET (fail closed)
        const db = context.env?.DB;
        if (!db) {
            return new Response(
                JSON.stringify({ error: 'Cloudflare D1 Database binding (DB) is not attached.' }),
                { status: 503, headers }
            );
        }

        const authSecret = getAuthSecret(context.env);
        if (!authSecret) {
            return new Response(
                JSON.stringify({ error: 'Authentication secret (AUTH_SECRET) is not configured on the server.' }),
                { status: 503, headers }
            );
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 4. Query promoter account using prepared statement
        const account = await db
            .prepare('SELECT id, name, organization_name, phone_number, email, password_hash, stripe_account_id, default_currency, created_at FROM promoter_accounts WHERE email = ?')
            .bind(normalizedEmail)
            .first();

        // Anti-Enumeration: Return identical error message whether account exists or password is wrong
        if (!account) {
            return new Response(
                JSON.stringify({ error: 'Invalid email or password.' }),
                { status: 401, headers }
            );
        }

        // 5. Cryptographic password verification (strictly PBKDF2-SHA256)
        const isMatch = await verifyPassword(password, account.password_hash);
        if (!isMatch) {
            return new Response(
                JSON.stringify({ error: 'Invalid email or password.' }),
                { status: 401, headers }
            );
        }

        const promoterAccount = {
            id: account.id,
            name: account.name,
            organization_name: account.organization_name,
            phone_number: account.phone_number,
            email: account.email,
            stripe_account_id: account.stripe_account_id || null,
            default_currency: account.default_currency || 'cad',
            created_at: account.created_at
        };

        const token = await signAuthToken({ sub: account.id, email: account.email }, authSecret);

        return new Response(JSON.stringify({ success: true, promoter: promoterAccount, token }), {
            status: 200,
            headers: {
                ...headers,
                'Set-Cookie': `vtix_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
            }
        });
    } catch (err) {
        console.error('Authentication error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error during authentication.' }),
            { status: 500, headers }
        );
    }
}
