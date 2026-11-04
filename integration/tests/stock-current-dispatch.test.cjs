const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { readCustomerShipments } = load('customerShipmentLedger.js');
const { approveBorrow, dispatchReserved } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { prepareWarehouseDispatch } = require('../prototypes/stock-current-state/warehouse-dispatch-plan.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const lines = ['A', 'B'].map(id => ({ taskId: id, orderId: 'O', sourceLineId: 'L-' + id, barcode: id, packing: '12', quantity: 40,
    sources: [{ sourceTaskId: 'S-' + id, quantity: 40 }] }));
  const shipment = { id: 'SHIP', company: 'NCT', customerId: 'C', currency: 'USD', status: 'REQUESTED', lines };
  const base = { description: 'SHIP', image: 'C', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', actorType: 'STAFF', initiatedByStaffId: 'W', initiatedByStaffName: 'LAW', activityTime: '2026-10-22T05:00:00Z' };
  const requested = { ...base, _id: 'REQ', title: 'REQ', details: { beforeRevision: '', shipment: copy(shipment) } };
  const invoice = { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 };
  const invoiced = { ...base, _id: 'INV', title: 'INV', details: { beforeRevision: 'REQ', shipment: { ...copy(shipment), status: 'INVOICED', invoice } } };
  const priorShipment = readCustomerShipments([requested, invoiced])[0];
  const event = { ...base, _id: 'OUT', title: 'OUT', details: { beforeRevision: 'INV', shipment: { ...copy(invoiced.details.shipment), status: 'DISPATCHED', dispatch: { reference: 'CONTAINER-1' } } } };
  assert.equal(readCustomerShipments([requested, invoiced, event])[0].status, 'DISPATCHED');
  const products = ['A', 'B'].map(id => {
    const identity = { company: 'NCT', barcode: id, packing: '12', ea: 12 }, key = stockKey(identity), pid = hash('NCT', key, 'PURCHASE_SOURCE', 'S-' + id);
    const row = { _version: 'V0', company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'ACTIVE', reviewCodes: [] };
    return { state: { ...identity, complete: true, revision: 0,
      tasks: [{ ...identity, id, customerId: 'C', orderId: 'O', sourceLineId: 'L-' + id, requested: 100, dispatched: 0 }],
      packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { [id]: 50 } },
      sources: [{ ...identity, id: 'S-' + id, ownerTaskId: id, poId: 'PO-' + id, orderId: 'O', sourceLineId: 'L-' + id,
        poValid: true, reviewRequired: false, receiptPolicy: 'EXPLICIT_ONLY', ownerShare: 100, planned: 100, accepted: 100,
        onHand: 100, isolated: 0, available: 20, claims: { [id]: 80 } }], relations: [] },
      rows: { complete: true, transfers: [], positions: [{ ...row, _id: pid, sourceKind: 'PURCHASE_SOURCE', sourceId: 'S-' + id, sourceTaskId: 'S-' + id,
        poId: 'PO-' + id, receiptAccepted: 100, replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 20, reservedUsable: 80 }],
        claims: [{ ...row, _id: hash('NCT', pid, id), positionId: pid, taskId: id, customerId: 'C', orderId: 'O', sourceLineId: 'L-' + id, reservedUsable: 80, isolatedAttributed: 0 }],
        product: { ...row, _id: hash('NCT', key), barcode: id, onHand: 100, isolated: 0, available: 20, reservedUsable: 80, reviewRequired: false } } };
  });
  return { event, priorShipment, products, generation: 0 };
}
test('one immutable invoice dispatch consumes only its reservation; other holds and free stock survive', () => {
  const f = fixture(), before = JSON.stringify(f), result = prepareWarehouseDispatch(f);
  assert.equal(JSON.stringify(f), before); assert.equal(result.states.length, 2);
  for (const state of result.states) {
    const id = state.tasks[0].id;
    assert.deepEqual([state.sources[0].accepted, state.sources[0].onHand, state.sources[0].available, state.sources[0].claims[id], state.tasks[0].dispatched, state.packingHolds.heldByTask[id]], [100, 60, 20, 40, 40, 10]);
  }
  const events = result.plan.writes.filter(w => w.after.action === 'CUSTOMER_SHIPMENT_CHANGED');
  assert.equal(events.length, 1); assert.deepEqual(events[0].after.details, f.event.details);
});

test('v2 actual dispatch includes exact existing task cumulative in same plan as physical outflow', () => {
  const f = fixture(); f.planFormat = 'SEGMENTED_V2';
  for (const p of f.products) {
    Object.assign(p.state, { lifecycleVersion: 2, nextBorrowSequence: 1, scope: 'CURRENT_ACTIVE_PRODUCT' });
    p.state.tasks[0].dispatchedOutsideScope = 0; p.state.sources[0].borrowRepaidCumulative = 0;
    Object.assign(p.rows, { scope: 'CURRENT_ACTIVE_PRODUCT', planFormat: 'SEGMENTED_V2' });
    p.rows.positions[0].borrowRepaidCumulative = 0; p.rows.claims[0].dispatchedCumulative = 0;
    Object.assign(p.rows.product, { lifecycleVersion: 2, nextBorrowSequence: 1 });
  }
  f.taskRows = ['A', 'B'].map(id => ({ _id: id, company: 'NCT', _version: 'TASK0', stockCounterSchema: 2,
    stockCounterGeneration: 0, stockDispatchedCumulative: 0, po: 'KEEP', requested: 100 }));
  const result = prepareWarehouseDispatch(f), changes = result.plan.writes.filter(w => w.collection === 'NCTTasks');
  assert.equal(changes.length, 2);
  for (const change of changes) {
    assert.equal(change.before.stockDispatchedCumulative, 0); assert.equal(change.after.stockDispatchedCumulative, 40);
    assert.equal(change.after.stockCounterGeneration, 1); assert.equal(change.after.po, 'KEEP');
  }
  for (const mutate of [x => { x.taskRows.pop(); }, x => { x.taskRows[0].stockDispatchedCumulative = 1; },
    x => { x.taskRows[0].company = 'GHR'; }, x => { x.planFormat = 'PROOF_V1'; }]) {
    const bad = copy(f); mutate(bad); assert.throws(() => prepareWarehouseDispatch(bad));
  }
});
test('loaded/invoiced-only, changed invoice/source, missing reservation or product cannot deduct stock', () => {
  for (const mutate of [f => { f.event.details.shipment.status = 'INVOICED'; }, f => { f.event.details.shipment.invoice.amountCents = 999; },
    f => { f.event.details.shipment.lines[0].sources[0].quantity = 41; }, f => { f.products[0].state.packingHolds.heldByTask.A = 0; },
    f => { f.products.pop(); }, f => { f.priorShipment.status = 'REQUESTED'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => prepareWarehouseDispatch(f));
  }
});
test('borrower actual dispatch does not clear future replacement or lender ownership', () => {
  const state = fixture().products[0].state; state.packingHolds.heldByTask.A = 0;
  state.tasks.push({ company: 'NCT', barcode: 'A', packing: '12', ea: 12, id: 'X', customerId: 'OTHER', requested: 30, dispatched: 0 }); state.packingHolds.heldByTask.X = 0;
  state.sources.push({ ...copy(state.sources[0]), id: 'S-X', ownerTaskId: 'X', poId: 'PO-X', accepted: 0, onHand: 0, available: 0, claims: {} });
  const borrowed = approveBorrow(state, { expectedRevision: 0, id: 'REL', lenderSourceId: 'S-A', replacementSourceId: 'S-X', borrowerTaskId: 'X', quantity: 30, approvedBy: 'P', reason: 'Fill container' }).after;
  borrowed.packingHolds.heldByTask.X = 30;
  const result = dispatchReserved(borrowed, { expectedRevision: 1, lines: [{ taskId: 'X', quantity: 30, sources: [{ sourceTaskId: 'S-A', quantity: 30 }] }] }).after;
  assert.equal(result.tasks[1].dispatched, 30); assert.equal(result.relations[0].repaid, 0); assert.equal(result.relations[0].quantity, 30);
  assert.equal(result.sources[0].claims.A, 50); assert.equal(result.sources[1].accepted, 0);
});
test('partial multi-product outflow is hidden and resumed once with original dispatch identity', async () => {
  const f = fixture(), result = prepareWarehouseDispatch(f), db = new Map(); let fail = true;
  for (const product of f.products) for (const [c, rows] of [['StockPositions', product.rows.positions], ['StockClaims', product.rows.claims], ['StockProducts', [product.rows.product]]]) for (const row of rows) db.set(c + ':' + row._id, copy(row));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, row) => {
    if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row);
  }, compareAndSet: async (c, id, v, row) => {
    if (c === 'StockProducts' && row.barcode === 'B' && fail) { fail = false; throw Error('Interrupted outflow'); }
    if (db.get(c + ':' + id)?._version !== v) throw Error('CAS conflict'); db.set(c + ':' + id, copy(row)); return copy(row);
  }, compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store }); await protocol.initialize(); let prepares = 0;
  const request = { requestId: '11111111-1111-4111-8111-111111111111', memberId: 'W', input: f.event.details,
    prepare: async () => { prepares++; return result.plan; } };
  await assert.rejects(protocol.commit(request), /Interrupted/);
  await assert.rejects(protocol.readSnapshot(async () => [...db.values()]), /pending/);
  await protocol.commit(request); await protocol.commit(request); assert.equal(prepares, 1);
  const snapshot = await protocol.readSnapshot(async () => [...db.values()]);
  assert.equal(snapshot.rows.filter(r => r.sourceKind === 'PURCHASE_SOURCE').reduce((n, r) => n + r.onHand, 0), 120);
  assert.equal(snapshot.rows.filter(r => r.action === 'CUSTOMER_SHIPMENT_CHANGED').length, 1);
});
