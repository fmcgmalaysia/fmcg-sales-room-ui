const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const load = require('./load-master-module.cjs');
const { createOperationPractice, BUILD, IDS } = require('../prototypes/stock-current-state/operation-practice.cjs');
const portable = require('../prototypes/stock-current-state/practice-crypto.cjs');
const fixture = () => createOperationPractice({ shipment: load('customerShipmentPlan.js'), batches: load('shipmentBatchAllocation.js') });
const id = n => String(n).padStart(8, '0') + '-2026-4250-8250-000000000001';
function borrow(p, n = 1, quantity = 10) { const q = p.options(IDS.A); return { type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: id(n),
  operation: 'BORROW_APPROVE', stockProtocol: 1, stockBuild: BUILD, stockGeneration: q.stockCurrent.stockGeneration,
  input: { borrowerTaskId: IDS.A, lenderSourceId: IDS.B, replacementSourceId: IDS.A, quantity, expectedRevision: q.expectedRevision, reason: 'Test shortage' } }; }
const row = (p, id = IDS.A) => p.workspace().tasks.find(t => t.id === id);
function split(p, first = 40, second = 60) { const read = p.salesRead(); return { type: 'SALES_ROOM_SHIPMENT_REQUEST', company: 'NCT', requestId: id(5), action: 'PLAN',
  input: { version: read.planVersion, customerId: 'EXAMPLE-A', orderId: 'ORDER-A', reason: 'Two containers', stockCurrent: read.stockCurrent,
    batches: [{ label: 'First', lines: [{ taskId: IDS.A, quantity: first }] }, { label: 'Second', lines: [{ taskId: IDS.A, quantity: second }] }] } }; }
test('portable IDs use standard SHA-256 for UTF8 and byte vectors, identical to original Node crypto', () => {
  for (const value of ['', 'abc', '借货\u0000🧪', 'a'.repeat(1000), Uint8Array.from({ length: 256 }, (_, i) => i)])
    assert.equal(portable.createHash('sha256').update(value).digest('hex'), crypto.createHash('sha256').update(value).digest('hex'));
});
test('same approval rules quote at most10 for100/90/80 and no20 for100/80/80', () => {
  const p = fixture(); assert.equal(p.options(IDS.A).options[0].maximumQuantity, 10); assert.equal(p.options(IDS.C).options.length, 0);
  assert.equal(p.inspect().cmsWrites, false); assert.equal(p.inspect().activationReady, false);
});
test('actual approval moves claims, RCV stays80; exact save replay cannot duplicate transfer', async () => {
  const p = fixture(), request = borrow(p), result = await p.execute(request);
  assert.equal(row(p).stockActualReceived, 80); assert.equal(row(p).stockAllocatedCumulative, 90); assert.equal(row(p, IDS.B).stockAllocatedCumulative, 90);
  assert.equal(row(p).stockBorrowedOutstanding, 10); assert.equal(row(p).stockTransferOutstanding, true); assert.equal(row(p, IDS.B).stockTransferOutstanding, true);
  assert.equal(p.options(IDS.A).options.length, 0); assert.deepEqual(await p.execute(request), result);
  await assert.rejects(p.execute({ ...request, input: { ...request.input, quantity: 9 } }), /identity conflict/);
  assert.equal(p.inspect().states[0].relations.length, 1);
});
test('partial5 then remaining5 auto repay without incrementing borrower ALLOC twice; both halos settle', async () => {
  const p = fixture(); await p.execute(borrow(p)); p.receive(IDS.A, 85);
  assert.equal(row(p).stockAllocatedCumulative, 90); assert.equal(row(p).stockActualReceived, 85); assert.equal(row(p).stockBorrowedOutstanding, 5);
  assert.equal(row(p, IDS.B).stockAllocatedCumulative, 95); assert.equal(p.relations({ view: 'OUTSTANDING' }).items[0].repaid, 5);
  p.receive(IDS.A, 90); assert.equal(row(p).stockAllocatedCumulative, 90); assert.equal(row(p, IDS.B).stockAllocatedCumulative, 100);
  assert.equal(row(p).stockTransferOutstanding, false); assert.equal(row(p, IDS.B).stockTransferOutstanding, false);
  assert.equal(p.relations({ view: 'OUTSTANDING' }).total, 0);
  const state = p.inspect().states[0]; assert.equal(state.sources.reduce((n, s) => n + s.onHand, 0), 190);
});
test('original split validator saves40/60 and original batch projector separates received and borrowed allocations', async () => {
  const p = fixture(); const receipt = await p.execute(split(p)); assert.equal(receipt.planId, p.workspace().shipmentPlans[0].id);
  assert.deepEqual(row(p).stockAllocatedBatches.map(b => [b.demand, b.allocated]), [[40, 40], [60, 40]]);
  await p.execute(borrow(p)); assert.deepEqual(row(p).stockAllocatedBatches.map(b => b.allocated), [40, 50]);
  assert.deepEqual(row(p).stockReceiptBatches.map(b => b.received), [40, 40]); assert.equal(row(p).requested, 100); assert.equal(row(p).procurement.customerCtn, 90);
});
test('invalid split99 and excessive borrowing11 are rejected before test state changes', async () => {
  const p = fixture(), before = p.inspect(); await assert.rejects(p.execute(split(p, 40, 59)), /preserve/);
  await assert.rejects(p.execute(borrow(p, 8, 11)), /Insufficient/); assert.deepEqual(p.inspect(), before);
});
test('a new stale request cannot apply after another test save; invalid receipt cannot erase obligations', async () => {
  const p = fixture(), stale = borrow(p, 2); await p.execute(borrow(p));
  await assert.rejects(p.execute(stale), /changed/); const before = p.inspect();
  for (const quantity of [79, 91, 80.5, '90', NaN]) assert.throws(() => p.receive(IDS.A, quantity));
  assert.deepEqual(p.inspect(), before);
});
test('actual arrangement validator records PENDING_SUPPORT without physical movement, invoice or hold', async () => {
  const p = fixture(), before = p.inspect().states, ws = p.workspace();
  await p.execute({ type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: id(9), operation: 'ARRANGE_AVAILABLE', stockProtocol: 1, stockBuild: BUILD,
    stockGeneration: ws.stockCurrent.stockGeneration, input: { taskId: IDS.A, batchId: '', quantity: 80, expectedRevision: '', reason: 'Arrange existing cartons' } });
  assert.deepEqual(p.inspect().states, before); assert.equal(row(p).stockArrangements[0].status, 'PENDING_SUPPORT');
  assert.equal(p.inspect().activity.some(e => /INVOICE|DISPATCH/.test(e.action)), false);
});
test('moved and archived test rows retain stable relationship identities and remain in outstanding view', async () => {
  const p = fixture(); await p.execute(borrow(p)); p.move();
  assert.equal(p.workspace().tasks.findIndex(t => t.id === IDS.A), 1); p.archive(IDS.A);
  assert.equal(row(p).archived, true); assert.equal(p.relations({ view: 'OUTSTANDING' }).items[0].borrowerTaskId, IDS.A);
  assert.throws(() => p.options(IDS.A), /Archived/); p.receive(IDS.A, 90); assert.equal(p.relations({ view: 'OUTSTANDING' }).total, 0);
});
