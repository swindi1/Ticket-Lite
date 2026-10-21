import { validateCheckoutPayload, isValidRedirectUrl } from '../../functions/_shared/security.js';

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

console.log(`\n========================================`);
console.log(`TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
console.log(`========================================`);

if (testsFailed > 0) {
    process.exit(1);
}
