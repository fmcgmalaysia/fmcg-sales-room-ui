const test = require('node:test'), assert = require('node:assert/strict');
const { originalProductState } = require('../prototypes/stock-current-state/original-product-state.cjs');
const { prepareBorrowingReceipt } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { createCurrentQuery } = require('../prototypes/stock-current-state/current-query.cjs');
const clone = row => JSON.parse(JSON.stringify(row));
function fixture(company = 'NCT') {
  const identity = { company, barcode: '9550000000001', packing: '12 x 1', ea: 12 };
  const poId = '68b79f067a54175e65affb0b0a75b801', poNumber = company + '-20261023-017';
  const context = { company, activity: [], tasks: [{ ...identity, id: 'TASK', name: 'Product', customerId: 'CUSTOMER',
    orderId: 'ORDER', sourceLineId: 'LINE', po: poNumber, requested: 100, procurement: { totalCtn: 100, customerCtn: 100 } }] };
  const builder = originalProductState({ company, context, identity, orders: [{ company, id: poId, number: poNumber, taskIds: ['TASK'] }],
    readAllocations: () => [], readCustomerShipments: () => [], readPackingLists: () => [], packingHeld: () => 0,
    readPreparation: () => new Map(), projectPreparation: () => [] });
  const rows = { complete: true, positions: [], claims: [], transfers: [], product: null };
  const event = { _id: 'RECEIPT', title: 'RECEIPT', description: poId, action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED',
    activityTime: '2026-10-23T08:00:00.000Z', initiatedByStaffId: 'WAREHOUSE',
    details: { company, lines: [{ taskId: 'TASK', orderId: 'ORDER', sourceLineId: 'LINE', planned: 100,
      beforeAccepted: 0, accepted: 20, beforeRejected: 0, rejected: 0, kind: 'PARTIAL', reason: 'Received' }] } };
  return { company, identity, builder, state: builder.buildState(rows), rows, event, generation: 0, poId, poNumber };
}
function materialize(rows, plan) {
  const next = clone(rows);
  for (const { collection, after } of plan.writes) {
    const row = { ...clone(after), _version: 'V1' };
    if (collection === 'StockProducts') next.product = row;
    else if (collection === 'StockPositions' || collection === 'StockClaims') {
      const target = collection === 'StockPositions' ? next.positions : next.claims;
      const index = target.findIndex(prior => prior._id === row._id);
      if (index < 0) target.push(row); else target[index] = row;
    }
  }
  return next;
}
for (const company of ['NCT', 'GHR']) test(company + ' new receipt retains authoritative readable PO number through current stock detail projection', async () => {
  const f = fixture(company);
  assert.equal(f.builder.sources[0].poNumber, f.poNumber);
  const prepared = prepareBorrowingReceipt(f), position = prepared.plan.writes.find(row => row.collection === 'StockPositions').after;
  assert.equal(position.poId, f.poId); assert.equal(position.poNumber, f.poNumber);
  assert.equal(position.receiptAccepted, 20); assert.equal(position.onHand, 20); assert.equal(position.reservedUsable, 20); assert.equal(position.available, 0);
  assert.deepEqual(prepared.plan.writes[0].after.details, f.event.details);
  const query = { eq() { return query; }, ascending() { return query; }, skip() { return query; }, limit() { return query; },
    find: async () => ({ totalCount: 1, items: [{ ...position, stockCommitVersion: 'PRIVATE', lpCtn: 99 }] }) };
  const view = await createCurrentQuery({ company, items: { query: collection => { assert.equal(collection, 'StockPositions'); return query; } } })
    .queryPositions({ company, page: 0, pageSize: 50, stockKey: position.stockKey, status: 'ACTIVE', consistentRead: true });
  assert.equal(view.items[0].poNumber, f.poNumber); assert.equal(view.items[0].poId, f.poId);
  assert.equal(Object.hasOwn(view.items[0], 'stockCommitVersion'), false); assert.equal(Object.hasOwn(view.items[0], 'lpCtn'), false);
});
test('later receipt keeps source label while all stable identities, accepted quantities and ownership remain original', () => {
  const f = fixture(), first = prepareBorrowingReceipt(f), rows = materialize(f.rows, first.plan), event = clone(f.event);
  event._id = event.title = 'RECEIPT2'; event.details.lines[0].beforeAccepted = 20; event.details.lines[0].accepted = 40;
  const second = prepareBorrowingReceipt({ state: first.state, rows, event, generation: 1 });
  const before = rows.positions[0], position = second.plan.writes.find(row => row.collection === 'StockPositions').after;
  assert.equal(position._id, before._id); assert.equal(position.sourceTaskId, before.sourceTaskId); assert.equal(position.poId, f.poId);
  assert.equal(position.poNumber, f.poNumber); assert.equal(position.receiptAccepted, 40); assert.equal(position.reservedUsable, 40);
  assert.equal(second.state.tasks[0].requested, 100); assert.equal(second.state.sources[0].planned, 100);
  assert.equal(second.state.relations.length, 0);
});
test('missing optional label never erases an existing label and browser event text cannot override the authoritative source', () => {
  const f = fixture(), first = prepareBorrowingReceipt(f), rows = materialize(f.rows, first.plan), event = clone(f.event), state = clone(first.state);
  delete state.sources[0].poNumber;
  event._id = event.title = 'RECEIPT2'; event.details.lines[0].beforeAccepted = 20; event.details.lines[0].accepted = 40;
  event.details.lines[0].poNumber = 'UNTRUSTED';
  const second = prepareBorrowingReceipt({ state, rows, event, generation: 1 });
  assert.equal(second.plan.writes.find(row => row.collection === 'StockPositions').after.poNumber, f.poNumber);
});
