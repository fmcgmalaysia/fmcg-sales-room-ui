const { test } = require('node:test');
const assert = require('node:assert/strict');
const mapper = import('../../backend/nctSubmissionPayload.js');
const input = () => ({
  order: { orderId: 'ORDER', customerId: 'CUSTOMER', companyName: 'TEST CUSTOMER', currency: 'MYR',
    status: 'CONFIRMED', isComplete: true, confirmedBy: 'BUYER', confirmedAt: '2026-10-09T11:00:00Z' },
  lines: [{ orderId: 'ORDER', customerId: 'CUSTOMER', lineId: 'L001', barcode: '0012345678901',
    itemName: 'PRODUCT', packingSize: '195.5G x16', eaPerCtn: 16, lockedUnitPriceEa: 14.66,
    lockedUnitPrice: 234.56, quantityCtn: 100, effectiveRequestedQtyCtn: 250, currency: 'MYR' }],
  staff: { staffId: 'TEST-STAFF', title: 'TEST NAME' }, currentAdminRate: { currency: 'MYR', rateToMyr: 1, active: true },
  submittedAt: '2026-10-09T12:00:00Z', submissionId: 'STABLE-ID', history: [{ previousQty: 100, newQty: 250 }]
});
test('maps current 250 cartons while preserving original 100 and its history', async () => {
  const { buildNctSubmission } = await mapper; const original = input(), result = buildNctSubmission(original);
  assert.equal(result.lines[0].qtyCtn, 250); assert.equal(result.sourceSnapshot.lines[0].quantityCtn, 100);
  assert.equal(result.sourceSnapshot.history[0].newQty, 250); assert.equal(original.lines[0].quantityCtn, 100);
});
test('uses locked EA and selling price per piece without importing selling price per carton', async () => {
  const { buildNctSubmission } = await mapper; const result = buildNctSubmission(input());
  assert.equal(result.lines[0].sellingPricePc, 14.66); assert.equal(result.lines[0].eaPerCtn, 16);
  assert.equal(Object.hasOwn(result.lines[0], 'sellingPriceCtn'), false);
  assert.equal(result.lines[0].sellingPricePc * result.lines[0].eaPerCtn, 234.56);
});
test('does not guess missing locked EA or replace it with current catalogue data', async () => {
  const { buildNctSubmission } = await mapper; const value = input(); delete value.lines[0].eaPerCtn;
  assert.throws(() => buildNctSubmission(value), /locked EA/);
});
test('requires the current Admin FX registry instead of sheet or default rates', async () => {
  const { buildNctSubmission } = await mapper; const value = input(); value.currentAdminRate.active = false;
  assert.throws(() => buildNctSubmission(value), /Admin FX/);
  value.currentAdminRate = { currency: 'SGD', rateToMyr: 3.1 };
  assert.throws(() => buildNctSubmission(value), /Admin FX/);
});
test('refuses receipt-only, incomplete or already transferred orders', async () => {
  const { buildNctSubmission } = await mapper;
  for (const change of [{ receiptOnly: true }, { isComplete: false }, { destination: 'NCT' }]) {
    const value = input(); Object.assign(value.order, change); assert.throws(() => buildNctSubmission(value));
  }
});
test('source line identity and currency cannot be mixed between orders', async () => {
  const { buildNctSubmission } = await mapper; const value = input(); value.lines[0].customerId = 'OTHER';
  assert.throws(() => buildNctSubmission(value), /identity mismatch/);
  value.lines[0].customerId = 'CUSTOMER'; value.lines[0].currency = 'SGD';
  assert.throws(() => buildNctSubmission(value), /currency mismatch/);
});
