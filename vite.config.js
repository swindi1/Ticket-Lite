import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Local dev middleware plugin:
 * Handles /api/tickets/send-email during local development (npm run dev)
 * so that Vite doesn't reject POST requests with 405 Method Not Allowed.
 */
function localApiDevPlugin() {
    return {
        name: 'local-api-dev-plugin',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (req.url && req.url.startsWith('/api/tickets/send-email')) {
                    if (req.method === 'OPTIONS') {
                        res.statusCode = 204;
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
                        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                        return res.end();
                    }
                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => {
                            body += chunk;
                        });
                        req.on('end', async () => {
                            try {
                                const parsed = JSON.parse(body || '{}');

                                // Check if local process.env.RESEND_API_KEY is present
                                const apiKey = process.env.RESEND_API_KEY;
                                if (apiKey) {
                                    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Ticket Lite <donotreply@ticketlite.ca>';
                                    const resendRes = await fetch('https://api.resend.com/emails', {
                                        method: 'POST',
                                        headers: {
                                            'Authorization': `Bearer ${apiKey.trim()}`,
                                            'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                            from: fromEmail,
                                            to: [parsed.customerEmail],
                                            subject: `🎟️ Your Tickets for ${parsed.eventTitle} (Order #${parsed.orderId})`,
                                            html: `<p>Your tickets for ${parsed.eventTitle} are confirmed! Order #${parsed.orderId}.</p>`
                                        })
                                    });
                                    const resendData = await resendRes.json();
                                    res.statusCode = resendRes.status;
                                    res.setHeader('Content-Type', 'application/json');
                                    return res.end(JSON.stringify(resendData));
                                }

                                // Dev simulated success response
                                res.statusCode = 200;
                                res.setHeader('Content-Type', 'application/json');
                                return res.end(
                                    JSON.stringify({
                                        success: true,
                                        id: `dev_${Date.now()}`,
                                        recipient: parsed.customerEmail,
                                        devMode: true
                                    })
                                );
                            } catch (e) {
                                res.statusCode = 400;
                                res.setHeader('Content-Type', 'application/json');
                                return res.end(JSON.stringify({ success: false, error: e.message }));
                            }
                        });
                        return;
                    }
                }
                next();
            });
        }
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), localApiDevPlugin()]
});