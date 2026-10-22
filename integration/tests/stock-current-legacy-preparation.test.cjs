const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { originalProductState } = require('../prototypes/stock-current-state/original-product-state.cjs');
const { approveBorrow, correctAccepted, dispatchReserved } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { guardProcurementStock } = require('../prototypes/stock-current-state/procurement-stock-guard.cjs');
const { readPreparation, projectPreparation } = load('warehousePreparation.js'), { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js'), { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function event(id = 'PREP1', beforeRevision = '', prepared = true, loaded = 0) {
  return { _id: id, title: id, description: 'PREP-B', imageAltText: 'B', action: 'WAREHOUSE_PREPARATION_SAVED', result: 'SAVED',
    activityTime: '2026-10-22T00:00:00Z', initiatedByStaffId: 'W', initiatedByStaffName: 'Warehouse',
    details: { beforeRevision, state: { id: 'PREP-B', taskId: 'B', customerId: 'CB', company: 'NCT', quantity: 100, prepared, loaded, signature: 'ORIGINAL', photos: [] } } };
}
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity);
  const context = { company: 'NCT', activity: [event()], tasks: ['A', 'B'].map(id => ({ ...identity, id, customerId: 'C' + id, orderId: 'O' + id,
    sourceLineId: 'L' + id, requested: 100, ord: 100, inc: id === 'B' ? 100 : 0, po: 'PO' + id, procurement: { totalCtn: 100, customerCtn: 100 },
    warehouse: id === 'B' ? { hasPhysicalReceipt: true, accepted: 100 } : null })) };
  const args = { company: 'NCT', context, identity, orders: ['A', 'B'].map(id => ({ company: 'NCT', id: 'P' + id, number: 'PO' + id, taskIds: [id] })),
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation };
  const rows = { positions: [{ sourceTaskId: 'B', onHand: 100, isolated: 0, available: 0 }],
    claims: [{ positionId: hash('NCT', key, 'PURCHASE_SOURCE', 'B'), taskId: 'B', reservedUsable: 100, isolatedAttributed: 0 }], transfers: [], product: null };
  return { args, rows, state: () => originalProductState(args).buildState(rows) };
}
const approval = { expectedRevision: 0, id: 'R', lenderSourceId: 'B', replacementSourceId: 'A', borrowerTaskId: 'A', quantity: 20, approvedBy: 'P', reason: 'Fill container' };
test('original prepared/loaded facts block borrowing and correction even without new packing or invoice hold', () => {
  const f = fixture(), state = f.state();
  assert.equal(state.packingHolds.heldByTask.B, 0); assert.equal(state.packingHolds.legacyBlockedByTask.B, true);
  assert.throws(() => approveBorrow(state, approval), /holds lender/);
  assert.throws(() => correctAccepted(state, { expectedRevision: 0, sourceId: 'B', cumulativeAccepted: 99, reason: 'Recount' }), /Packing/);
  const after = copy(state); after.sources[1].ownerShare = 99;
  assert.throws(() => guardProcurementStock({ before: state, after }), /Legacy Warehouse/);
});
test('latest authorized reversal clears guard; stale signature or loaded evidence does not auto-clear it', () => {
  const f = fixture(), first = f.state().packingHolds.version;
  f.args.context.activity.push(event('PREP2', 'PREP1', false, 0));
  const state = f.state(); assert.equal(state.packingHolds.legacyBlockedByTask.B, false); assert.notEqual(state.packingHolds.version, first);
  assert.equal(approveBorrow(state, approval).after.relations.length, 1);
  f.args.context.activity = [event('PREP1', '', false, 20)]; f.args.context.activity[0].details.state.signature = 'OLD-SIGNATURE';
  assert.equal(f.state().packingHolds.legacyBlockedByTask.B, true);
});
test('legacy invoice and preparation do not invent double quantity hold or block official invoice dispatch', () => {
  const f = fixture(), lines = [{ taskId: 'B', quantity: 100, sources: [{ sourceTaskId: 'B', quantity: 100 }] }];
  f.args.context.activity.push(...['REQUESTED', 'INVOICED'].map((status, i) => ({ _id: 'SHIP' + i, title: 'SHIP' + i, description: 'SHIP',
    action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T01:00:00Z', details: { beforeRevision: i ? 'SHIP0' : '',
      shipment: { id: 'SHIP', company: 'NCT', customerId: 'CB', currency: 'USD', status, lines,
        ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}) } } })));
  const state = f.state(); assert.equal(state.packingHolds.heldByTask.B, 100); assert.equal(state.packingHolds.legacyBlockedByTask.B, true);
  const shipped = dispatchReserved(state, { expectedRevision: 0, lines }).after;
  assert.equal(shipped.sources[1].onHand, 0); assert.equal(shipped.tasks[1].dispatched, 100); assert.equal(shipped.packingHolds.heldByTask.B, 0);
});
test('missing parser or malformed/foreign legacy record blocks rather than dropping old preparation evidence', () => {
  const f = fixture(); delete f.args.readPreparation; assert.throws(() => f.state(), /parser required/);
  const g = fixture(); g.args.context.activity[0].details.state.company = 'GHR'; assert.throws(() => g.state(), /facts require review/);
  const h = fixture(); h.args.context.activity[0].details.state.prepared = 'false'; assert.throws(() => h.state(), /facts require review/);
});

test('only original matching batch/signature and full dispatched range retire a legacy guard', () => {
  const f = fixture(); f.args.projectPreparation = projectPreparation;
  const row = projectPreparation({ ...f.args.context, activity: [] }).find(r => r.taskId === 'B');
  const record = f.args.context.activity[0]; record.description = row.id; record.details.state.id = row.id;
  record.details.state.signature = row.signature; record.details.state.loaded = 100;
  const lines = [{ taskId: 'B', quantity: 100, sources: [{ sourceTaskId: 'B', quantity: 100 }] }];
  f.args.context.activity.push(...['REQUESTED', 'INVOICED', 'DISPATCHED'].map((status, i) => ({ _id: 'SHIP' + i, title: 'SHIP' + i, description: 'SHIP',
    action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T01:00:00Z', details: { beforeRevision: i ? 'SHIP' + (i - 1) : '',
      shipment: { id: 'SHIP', company: 'NCT', customerId: 'CB', currency: 'USD', status, lines,
        ...(i ? { invoice: { number: 'INV', amountCents: 100, currency: 'USD', rateToMyr: 4 } } : {}) } } })));
  f.rows.positions[0].onHand = 0; f.rows.claims[0].reservedUsable = 0;
  assert.equal(f.state().packingHolds.legacyBlockedByTask.B, false);
  record.details.state.signature = 'STALE'; assert.equal(f.state().packingHolds.legacyBlockedByTask.B, true);
  delete f.args.projectPreparation; assert.equal(f.state().packingHolds.legacyBlockedByTask.B, true);
});
