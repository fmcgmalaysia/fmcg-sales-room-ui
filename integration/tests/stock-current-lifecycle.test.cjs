const test = require('node:test'), assert = require('node:assert/strict');
const { validate, approveBorrow, receive, correctAccepted, dispatch } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const identity = { company: 'NCT', barcode: '0001', packing: '24x1', ea: 24 };
function fixture() {
  return { ...identity, complete: true, revision: 0, lifecycleVersion: 2, nextBorrowSequence: 501,
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { A: 0, B: 0 } },
    tasks: ['A', 'B'].map(id => ({ ...identity, id, customerId: 'CUSTOMER-' + id, requested: 100, dispatched: 0 })),
    sources: ['A', 'B'].map(id => ({ ...identity, id: 'S-' + id, ownerTaskId: id, poId: 'PO-' + id,
      poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: 100, planned: id === 'A' ? 150 : 100,
      accepted: id === 'A' ? 0 : 100, onHand: id === 'A' ? 0 : 100, isolated: 0, available: 0,
      borrowRepaidCumulative: 0, claims: { [id]: id === 'A' ? 0 : 100 } })), relations: [] };
}
const source = (s, id) => s.sources.find(r => r.id === 'S-' + id);
const borrow = (s, extra = {}) => approveBorrow(s, { expectedRevision: s.revision, id: 'R', quantity: 20, lenderSourceId: 'S-B',
  replacementSourceId: 'S-A', borrowerTaskId: 'A', approvedBy: 'PURCHASE', reason: 'Fill container', ...extra }).after;
const recv = (s, qty) => receive(s, { expectedRevision: s.revision, sourceId: 'S-A', cumulativeAccepted: qty }).after;
test('closed20repayment omitted from working set still leaves owner80 and FOC50 on later130receipt', () => {
  let s = borrow(fixture()); s = recv(s, 20);
  assert.equal(s.relations[0].repaid, 20); assert.equal(source(s, 'A').borrowRepaidCumulative, 20);
  s.relations = []; // Current working set no longer needs this settled relationship.
  s = recv(s, 150);
  assert.equal(source(s, 'A').claims.A, 80); assert.equal(source(s, 'A').claims.B, 20);
  assert.equal(source(s, 'A').available, 50); assert.equal(source(s, 'A').onHand, 150);
});
test('new borrowing uses persisted high-water, never reused max(empty history)+1', () => {
  const s = borrow(fixture()); assert.equal(s.relations[0].sequence, 501); assert.equal(s.nextBorrowSequence, 502);
  let next = recv(s, 20); next.relations = [];
  next = borrow(next, { id: 'R2', quantity: 10 });
  assert.equal(next.relations[0].sequence, 502); assert.equal(next.nextBorrowSequence, 503);
});
test('correction must reload the affected CLOSED repayment; omitted evidence refuses without mutation', () => {
  const full = recv(borrow(fixture()), 20), missing = structuredClone(full); missing.relations = [];
  const snapshot = JSON.stringify(missing);
  assert.throws(() => correctAccepted(missing, { expectedRevision: missing.revision, sourceId: 'S-A', cumulativeAccepted: 5, reason: 'Receipt counted wrongly' }), /shipped, isolated or unrelated/);
  assert.equal(JSON.stringify(missing), snapshot);
  const corrected = correctAccepted(full, { expectedRevision: full.revision, sourceId: 'S-A', cumulativeAccepted: 5, reason: 'Receipt counted wrongly' }).after;
  assert.equal(source(corrected, 'A').borrowRepaidCumulative, 5); assert.equal(corrected.relations[0].repaid, 5);
  const final = recv(corrected, 150); assert.equal(source(final, 'A').available, 50); assert.equal(source(final, 'A').claims.A, 80);
});
test('borrower shipped does not erase repayment counter or reopen customer FOC capacity', () => {
  let s = borrow(fixture()); s = dispatch(s, { expectedRevision: s.revision, taskId: 'A', sourceId: 'S-B', quantity: 20 }).after;
  s = recv(s, 20); s.relations = []; s = recv(s, 150);
  assert.equal(s.tasks[0].dispatched, 20); assert.equal(source(s, 'A').claims.A, 80);
  assert.equal(source(s, 'A').borrowRepaidCumulative, 20); assert.equal(source(s, 'A').available, 50);
});
test('missing/unverified counters, reused sequences and overflow fail closed; no partial-history fallback', () => {
  const a = fixture(); delete source(a, 'A').borrowRepaidCumulative; assert.throws(() => validate(a), /checkpoint/);
  const b = borrow(fixture()); b.nextBorrowSequence = 501; assert.throws(() => validate(b), /sequence/);
  const c = recv(borrow(fixture()), 20); source(c, 'A').borrowRepaidCumulative = 0; assert.throws(() => validate(c), /checkpoint/);
  const d = fixture(); d.nextBorrowSequence = Number.MAX_SAFE_INTEGER; assert.throws(() => borrow(d), /exhausted/);
});
