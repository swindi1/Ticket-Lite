import {
    validateCheckoutPayload,
    isValidRedirectUrl,
    hashPassword,
    verifyPassword,
    signAuthToken,
    verifyAuthToken
} from '../../functions/_shared/security.js';
import { encodePassToken, decodePassToken } from '../../src/utils/passToken.js';
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

// Test 8: Valid Legitimate Order Payload
const testValidOrder = validateCheckoutPayload({
    orderId: '987654321098',
    eventId: 'event-101',
    customer: { name: 'Tyler Vance', email: 'promoter@vtix.com', phone: '555-019-2834' },
    items: [
        { name: 'General Admission', price: 45.00, quantity: 2 },
        { name: 'VIP Pass', price: 120.00, quantity: 1 }
    ],
    fees: [
        { name: 'Platform Fee', amount: 2.50 }
    ]
});
assert('Validates legitimate order successfully', testValidOrder.isValid === true && testValidOrder.subtotal === 210.00);

// Test 9: PBKDF2-SHA256 Password Hashing & Constant-Time Verification
const pbkdf2Hash = await hashPassword('SafePass123!');
assert('Generates PBKDF2 password hash format', pbkdf2Hash.startsWith('pbkdf2:100000:'));
assert('Verifies valid PBKDF2 password', (await verifyPassword('SafePass123!', pbkdf2Hash)) === true);
assert('Rejects wrong PBKDF2 password', (await verifyPassword('WrongPass123!', pbkdf2Hash)) === false);
assert('Rejects plaintext fallback match', (await verifyPassword('plaintext', 'plaintext')) === false);

// Test 10: Signed Session Token (HMAC-SHA256)
const jwt = await signAuthToken({ sub: 'promoter-1', email: 'promoter@vtix.com' }, 'test-secret-key');
const verifiedJwt = await verifyAuthToken(jwt, 'test-secret-key');
const forgedJwt = await verifyAuthToken(jwt + 'a', 'test-secret-key');
assert('Signs and verifies valid HMAC-SHA256 session token', verifiedJwt?.sub === 'promoter-1');
assert('Rejects tampered HMAC-SHA256 session token', forgedJwt === null);

// Test 11: Pass Token Integrity & Anti-Forgery
const validPassToken = encodePassToken({
    orderId: '987654321098',
    eventId: '1',
    eventTitle: 'Neon Nights',
    customer: { name: 'Tyler', email: 'promoter@vtix.com' },
    items: [{ name: 'VIP', price: 150, quantity: 1 }],
    total: 150
});
const decodedPass = decodePassToken(validPassToken);
assert('Decodes valid integrity-signed pass token', decodedPass?.orderId === '987654321098');
const rawFakeToken = btoa(JSON.stringify({ orderId: '987654321098', items: [{ name: 'Free VIP', price: 0 }] }));
assert('Rejects unsigned/forged pass token', decodePassToken(rawFakeToken) === null);

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
