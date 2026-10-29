import {
    validateCheckoutPayload,
    isValidRedirectUrl,
    hashPassword,
    verifyPassword,
    signAuthToken,
    verifyAuthToken,
    signPassToken,
    verifyPassToken,
    computeCanonicalCheckout
} from '../../functions/_shared/security.js';
import { sanitizeCssColor, sanitizeImageUrl, generateSecureOrderId } from '../../src/utils/security.js';

console.log('🔒 RUNNING STRIPE SECURITY & VULNERABILITY AUDIT TEST SUITE...\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(description, condition) {
    if (condition) {
        console.log(`✅ PASS: ${description}`);
        testsPassed++;
    } else {
        console.error(`❌ FAIL: ${description}`);
        testsFailed++;
    }
}

// Test 1: Price Tampering (Negative price)
const testNegativePrice = validateCheckoutPayload({
    orderId: '123456789012',
    eventId: 'event-1',
    customer: { name: 'Alice Smith', email: 'alice@example.com' },
    items: [{ name: 'VIP Ticket', price: -50.00, quantity: 1 }]
});
assert('Rejects negative ticket price', testNegativePrice.isValid === false && testNegativePrice.error.includes('Invalid ticket price'));

// Test 2: Price Tampering (Penny price $0.01 lower than Stripe minimum $0.50)
const testPennyPrice = validateCheckoutPayload({
    orderId: '123456789012',
    eventId: 'event-1',
    customer: { name: 'Alice Smith', email: 'alice@example.com' },
    items: [{ name: 'VIP Ticket', price: 0.01, quantity: 1 }]
});
assert('Rejects price below minimum charge limit ($0.50)', testPennyPrice.isValid === false);

// Test 3: SQL Injection in Order ID
const testSqlInjectionOrderId = validateCheckoutPayload({
    orderId: "' OR '1'='1",
    eventId: 'event-1',
    customer: { name: 'Alice Smith', email: 'alice@example.com' },
    items: [{ name: 'GA Ticket', price: 50.00, quantity: 1 }]
});
assert('Rejects SQL injection in orderId', testSqlInjectionOrderId.isValid === false);

// Test 4: SQL Injection in Customer Name
const testSqlInjectionName = validateCheckoutPayload({
    orderId: '123456789012',
    eventId: 'event-1',
    customer: { name: 'DROP TABLE orders;--', email: 'alice@example.com' },
    items: [{ name: 'GA Ticket', price: 50.00, quantity: 1 }]
});
assert('Rejects SQL commands in customer name', testSqlInjectionName.isValid === false);

// Test 5: Quantity Overflow / Inventory Tampering (1000 tickets)
const testExcessiveQuantity = validateCheckoutPayload({
    orderId: '123456789012',
    eventId: 'event-1',
    customer: { name: 'Alice Smith', email: 'alice@example.com' },
    items: [{ name: 'GA Ticket', price: 50.00, quantity: 1000 }]
});
assert('Rejects quantity over maximum allowed (25)', testExcessiveQuantity.isValid === false);

// Test 6: Zero Quantity
const testZeroQuantity = validateCheckoutPayload({
    orderId: '123456789012',
    eventId: 'event-1',
    customer: { name: 'Alice Smith', email: 'alice@example.com' },
    items: [{ name: 'GA Ticket', price: 50.00, quantity: 0 }]
});
assert('Rejects zero quantity', testZeroQuantity.isValid === false);

// Test 7: Open Redirect Protection (Untrusted domain)
assert('Rejects phishing external redirect URL', isValidRedirectUrl('https://evil-phishing-site.com/steal-login') === false);
assert('Rejects javascript: URI scheme', isValidRedirectUrl('javascript:alert(1)') === false);
assert('Allows trusted ticketlite.ca redirect URL', isValidRedirectUrl('https://ticketlite.ca/event/1?payment=success') === true);
assert('Allows trusted workers.dev redirect URL', isValidRedirectUrl('https://ticket-lite.tylerboseroberts.workers.dev/event/1?payment=success') === true);

// Test 8: Fail-Closed Canonical D1 Price & Fee Verification (Integer Cents)
const mockDbEvent = {
    id: 'event-101',
    currency: 'cad',
    tickets_json: JSON.stringify([
        { id: 't1', name: 'General Admission', price_cents: 4500, quantity: 100 },
        { id: 't2', name: 'VIP Pass', price_cents: 12000, quantity: 50 }
    ]),
    fees_json: JSON.stringify([
        { id: 'f1', name: 'Platform Fee', amount: 2.50, type: 'fixed_per_transaction' },
        { id: 'f2', name: 'Processing Fee', amount: 5, type: 'percentage' }
    ])
};

const canonicalValid = computeCanonicalCheckout(
    mockDbEvent,
    [
        { name: 'General Admission', price: 45.00, quantity: 2 },
        { name: 'VIP Pass', price: 120.00, quantity: 1 }
    ],
    [
        { name: 'Platform Fee', amount: 2.50 },
        { name: 'Processing Fee', amount: 10.50 }
    ]
);
assert(
    'Computes canonical D1 prices and fees in integer cents ($210.00 base + $13.00 fees = 22300 cents CAD)',
    canonicalValid.isValid === true &&
        canonicalValid.currency === 'cad' &&
        canonicalValid.baseTotalCents === 21000 &&
        canonicalValid.totalFeesCents === 1300 &&
        canonicalValid.totalAmountCents === 22300
);

const canonicalPriceTampered = computeCanonicalCheckout(
    mockDbEvent,
    [{ name: 'VIP Pass', price: 0.50, quantity: 1 }]
);
assert('Rejects client price tampering against D1 event ($0.50 for $120.00 VIP)', canonicalPriceTampered.isValid === false);

const canonicalFeeTampered = computeCanonicalCheckout(
    mockDbEvent,
    [{ name: 'General Admission', price: 45.00, quantity: 1 }],
    [{ name: 'Platform Fee', amount: 0.00 }]
);
assert('Rejects client fee tampering against D1 event ($0.00 fees)', canonicalFeeTampered.isValid === false);

const canonicalMissingEvent = computeCanonicalCheckout(null, [{ name: 'GA', price: 45, quantity: 1 }]);
assert('Fails closed when event is missing from D1', canonicalMissingEvent.isValid === false);

// Test 9: PBKDF2-SHA256 Password Hashing & Constant-Time Verification
const pbkdf2Hash = await hashPassword('SafePass123!');
assert('Generates PBKDF2 password hash format', pbkdf2Hash.startsWith('pbkdf2:100000:'));
assert('Verifies valid PBKDF2 password', (await verifyPassword('SafePass123!', pbkdf2Hash)) === true);
assert('Rejects wrong PBKDF2 password', (await verifyPassword('WrongPass123!', pbkdf2Hash)) === false);
assert('Rejects legacy single-round SHA-256 hash', (await verifyPassword('password123', '4f8a1c92b5e7d360a8f1e2d3c4b5a697:7e03ec0aae59f677aa33a7f3cf46251c6cb6ce0a4168dd7df3357e0a113e6d42')) === false);
assert('Rejects plaintext fallback match', (await verifyPassword('plaintext', 'plaintext')) === false);

// Test 10: Signed Session Token (HMAC-SHA256, Fail-Closed Without Secret)
const testSecret = 'super-secret-production-hmac-key-2026';
const jwt = await signAuthToken({ sub: 'promoter-1', email: 'promoter@vtix.com' }, testSecret);
const verifiedJwt = await verifyAuthToken(jwt, testSecret);
const forgedJwt = await verifyAuthToken(jwt + 'a', testSecret);
const missingSecretJwt = await verifyAuthToken(jwt, '');
let missingSecretSignThrew = false;
try {
    await signAuthToken({ sub: 'promoter-1' }, '');
} catch {
    missingSecretSignThrew = true;
}
assert('Signs and verifies valid HMAC-SHA256 session token', verifiedJwt?.sub === 'promoter-1');
assert('Rejects tampered HMAC-SHA256 session token', forgedJwt === null);
assert('Fails closed in verifyAuthToken when secret is missing', missingSecretJwt === null);
assert('Fails closed in signAuthToken when secret is missing', missingSecretSignThrew === true);

// Test 11: Server-Issued HMAC-SHA256 Pass Token & Anti-Forgery
const validPassToken = await signPassToken({
    orderId: '987654321098',
    eventId: 'event-101',
    eventTitle: 'Neon Nights',
    currency: 'cad',
    customer: { name: 'Tyler', email: 'buyer@example.com' },
    items: [{ name: 'VIP', priceCents: 15000, quantity: 1 }],
    baseTotalCents: 15000,
    totalCents: 15000
}, testSecret);
const decodedPass = await verifyPassToken(validPassToken, testSecret);
assert('Verifies valid server-signed HMAC-SHA256 pass token', decodedPass?.orderId === '987654321098' && decodedPass?.totalCents === 15000);

const wrongKeyPass = await signPassToken({
    orderId: '987654321098',
    eventId: 'event-101',
    eventTitle: 'Forged Event',
    totalCents: 0
}, 'attacker-guessed-secret-key-000000');
assert('Rejects pass token signed with wrong HMAC secret', (await verifyPassToken(wrongKeyPass, testSecret)) === null);
assert('Fails closed on verifyPassToken when secret is missing', (await verifyPassToken(validPassToken, '')) === null);

// Test 12: CSS & Image URL Sanitization + CSPRNG Order ID
assert('Sanitizes malicious CSS injection in color', sanitizeCssColor('rgb(0,0,0); background:url(evil)', 'rgb(1, 2, 3)') === 'rgb(1, 2, 3)');
assert('Allows valid rgb() CSS color', sanitizeCssColor('rgb(236, 72, 153)') === 'rgb(236, 72, 153)');
assert('Rejects CSS injection in image URL', sanitizeImageUrl('https://example.com/a.png"); background:red;') === null);
assert('Generates valid 12-digit CSPRNG orderId', /^\d{12}$/.test(generateSecureOrderId()));

console.log(`\n========================================`);
console.log(`TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
console.log(`========================================`);

if (testsFailed > 0) {
    process.exit(1);
}
