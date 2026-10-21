const test = require('node:test'), assert = require('node:assert/strict');
const { validate, approveBorrow, receive, dispatch, procurementOutstanding, taskCoverage, cumulativeTargets } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const identity = { company: 'NCT', barcode: '0001', packing: '24x1', ea: 24 };
function fixture() {
  return { ...identity, complete: true, revision: 0,
    tasks: ['A', 'B', 'C'].map(id => ({ ...identity, id, customerId: 'CUSTOMER-' + id, requested: 100, dispatched: 0 })),
    sources: ['A', 'B', 'C'].map(id => ({ ...identity, id: 'S-' + id, ownerTaskId: id, poId: 'PO-' + id,
      poValid: true, reviewRequired: false, planned: 100, accepted: id === 'A' ? 0 : 100,
      onHand: id === 'A' ? 0 : 100, isolated: 0, available: 0, claims: { [id]: id === 'A' ? 0 : 100 }, held: {} })), relations: [] };
}
const approval = (state, extra = {}) => ({ expectedRevision: state.revision, id: 'REL-1', quantity: 30,
  lenderSourceId: 'S-B', replacementSourceId: 'S-A', borrowerTaskId: 'A', approvedBy: 'PURCHASER-1', reason: 'Fill container', ...extra });
const borrow = (s, extra) => approveBorrow(s, approval(s, extra)).after;
const recv = (s, qty, id = 'S-A') => receive(s, { expectedRevision: s.revision, sourceId: id, cumulativeAccepted: qty }).after;
const send = (s, taskId, sourceId, qty) => dispatch(s, { expectedRevision: s.revision, taskId, sourceId, quantity: qty }).after;
const source = (s, id) => s.sources.find(row => row.id === 'S-' + id);

test('approve transfers physical claims and binds future capacity without changing PO or onHand', () => {
  const before = fixture(), saved = JSON.stringify(before), after = borrow(before);
  assert.equal(JSON.stringify(before), saved);
  assert.equal(source(after, 'B').onHand, 100);
  assert.deepEqual(source(after, 'B').claims, { B: 70, A: 30 });
  assert.equal(source(after, 'A').accepted, 0);
  assert.equal(source(after, 'A').planned, 100);
  assert.equal(after.relations[0].repaid, 0);
});
test('borrower dispatch then partial20/full100 receipt repays B first and caps A at70', () => {
  let s = send(borrow(fixture()), 'A', 'S-B', 30);
  assert.equal(procurementOutstanding(s, 'A')[0].remaining, 30);
  s = recv(s, 20);
  assert.equal(source(s, 'A').claims.B, 20);
  assert.equal(source(s, 'A').claims.A, 0);
  assert.equal(procurementOutstanding(s, 'B')[0].remaining, 10);
  s = recv(s, 100);
  assert.deepEqual(source(s, 'A').claims, { A: 70, B: 30 });
  assert.deepEqual(procurementOutstanding(s, 'A'), []);
  assert.equal(s.tasks.find(t => t.id === 'A').dispatched, 30);
  assert.equal(s.sources.reduce((n, row) => n + row.onHand, 0), 270);
});
test('fully shipped borrower remains completed while future receipt goes entirely to lender', () => {
  let s = borrow(fixture(), { quantity: 100 });
  s = send(s, 'A', 'S-B', 100);
  assert.equal(s.tasks[0].dispatched, s.tasks[0].requested);
  assert.equal(procurementOutstanding(s, 'A')[0].remaining, 100);
  s = recv(s, 100);
  assert.equal(source(s, 'A').claims.B, 100);
  assert.equal(source(s, 'A').claims.A, 0);
  assert.equal(s.tasks[0].requested, 100);
});
test('same PO number retains distinct source identities and does not double receive', () => {
  const s = fixture(); source(s, 'A').poId = source(s, 'B').poId = 'SHARED-PO';
  const after = recv(borrow(s), 30);
  assert.equal(source(after, 'B').accepted, 100);
  assert.equal(source(after, 'A').accepted, 30);
  assert.equal(source(after, 'A').claims.B, 30);
});
test('one future supply cannot cover two borrowings beyond its remaining capacity', () => {
  const first = borrow(fixture(), { quantity: 70 });
  assert.throws(() => borrow(first, { id: 'REL-2', lenderSourceId: 'S-C', quantity: 31 }), /Insufficient/);
  const second = borrow(first, { id: 'REL-2', lenderSourceId: 'S-C', quantity: 30 });
  const after = recv(second, 80);
  assert.equal(after.relations[0].repaid, 70);
  assert.equal(after.relations[1].repaid, 10);
});
test('stale competing approval is rejected; duplicate relation is not another transfer', () => {
  const first = borrow(fixture());
  assert.throws(() => approveBorrow(first, approval(first, { expectedRevision: 0, id: 'REL-2' })), /Snapshot changed/);
  assert.throws(() => borrow(first), /Approval evidence/);
});
test('cumulative receipt replay has zero quantity effect', () => {
  const once = recv(borrow(fixture()), 20), twice = recv(once, 20);
  assert.deepEqual(twice.sources, once.sources);
  assert.deepEqual(twice.relations, once.relations);
});
test('missing PO, company/spec mismatch, unknown balance and incomplete snapshots reject', () => {
  for (const mutate of [s => { source(s, 'A').poValid = false; }, s => { source(s, 'A').poId = ''; },
    s => { source(s, 'A').company = 'GHR'; }, s => { source(s, 'A').packing = '12x1'; },
    s => { source(s, 'B').reviewRequired = true; }, s => { s.complete = false; }]) {
    const s = fixture(); mutate(s); assert.throws(() => borrow(s));
  }
});
test('packing held donor and borrower remain blocked by conservative first-version guards', () => {
  let s = fixture(); source(s, 'B').held.B = 80;
  assert.throws(() => borrow(s), /Insufficient/);
  s = fixture(); source(s, 'B').claims = { B: 90, A: 10 }; source(s, 'B').held.A = 10;
  assert.throws(() => borrow(s), /unheld/);
});
test('isolation cannot be borrowed and overdelivery cannot be counted', () => {
  const s = fixture(); source(s, 'B').claims.B = 20; source(s, 'B').isolated = 80;
  assert.throws(() => borrow(s), /Insufficient/);
  assert.throws(() => recv(fixture(), 101), /accepted receipt/);
});
test('demand cancellation or PO reduction cannot silently erase replacement obligations', () => {
  const s = borrow(fixture());
  const reducedPo = structuredClone(s); source(reducedPo, 'A').planned = 29;
  assert.throws(() => validate(reducedPo), /Future supply/);
  const cancelledLender = structuredClone(s); cancelledLender.tasks.find(t => t.id === 'B').requested = 70;
  assert.throws(() => validate(cancelledLender), /coverage/);
  assert.throws(() => receive(recv(s, 20), { expectedRevision: 2, sourceId: 'S-A', cumulativeAccepted: 10 }), /accepted receipt/);
});
test('new ordinary receipts leave demand promised by other replacements unfilled', () => {
  const s = fixture();
  s.sources.push({ ...structuredClone(source(s, 'B')), id: 'S-B2', poId: 'PO-B2', accepted: 0, onHand: 0, claims: { B: 0 } });
  const after = recv(borrow(s), 30, 'S-B2');
  assert.equal(source(after, 'B2').claims.B, 0);
  assert.equal(source(after, 'B2').available, 30);
  assert.equal(procurementOutstanding(after, 'B')[0].remaining, 30);
});
test('coverage display separates fulfilled delivery, physical stock and unresolved transfer', () => {
  const s = send(borrow(fixture(), { quantity: 100 }), 'A', 'S-B', 100);
  const view = taskCoverage(s, 'A');
  assert.equal(view.deliveryQuantityComplete, true);
  assert.equal(view.reservedUsable, 0);
  assert.equal(view.transfers[0].remaining, 100);
  assert.equal(taskCoverage(s, 'B').pendingReplacement, 100);
  assert.equal(taskCoverage(s, 'B').reservedUsable, 0);
});
test('cumulative allocation preserves shipped source quantities after automatic repayment', () => {
  let s = send(borrow(fixture()), 'A', 'S-B', 30);
  s = recv(s, 100);
  assert.deepEqual(cumulativeTargets(s, 'S-B'), [{ taskId: 'A', quantity: 30 }, { taskId: 'B', quantity: 70 }]);
  assert.deepEqual(cumulativeTargets(s, 'S-A'), [{ taskId: 'A', quantity: 70 }, { taskId: 'B', quantity: 30 }]);
  const bad = structuredClone(s); source(bad, 'B').dispatchedByTask.A = 0;
  assert.throws(() => validate(bad), /provenance/);
});
test('enumerated receipt schedules conserve stock and per-customer total coverage', () => {
  for (const quantity of [1, 30, 70, 100]) {
    for (const sent of [0, Math.floor(quantity / 2), quantity]) {
      let s = borrow(fixture(), { quantity });
      if (sent) s = send(s, 'A', 'S-B', sent);
      for (const received of [0, 1, 20, 50, 100]) {
        s = recv(s, received);
        assert.equal(s.sources.reduce((n, row) => n + row.onHand, 0), 200 + received - sent);
        assert.equal(s.relations[0].repaid, Math.min(quantity, received));
        for (const id of ['A', 'B', 'C']) {
          const v = taskCoverage(s, id);
          assert.equal(v.dispatched + v.reservedUsable + v.pendingReplacement + v.uncovered, v.requested);
        }
      }
    }
  }
});
