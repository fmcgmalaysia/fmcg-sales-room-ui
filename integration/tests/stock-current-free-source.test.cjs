const test = require('node:test'), assert = require('node:assert/strict');
const { originalProductState } = require('../prototypes/stock-current-state/original-product-state.cjs');
const { validate, receive, approveBorrow, correctAccepted } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
function fixture(share = 0) {
  const context = { company: 'NCT', activity: [], tasks: [{ ...identity, id: 'FREE', specialPurchase: true, po: 'PO1',
    orderId: 'O', sourceLineId: 'L', procurement: { totalCtn: 20, customerCtn: share }, warehouse: null }] };
  return { company: 'NCT', identity, context, orders: [{ company: 'NCT', id: 'P', number: 'PO1', taskIds: ['FREE'] }],
    readAllocations: () => [], readCustomerShipments: () => [], readPackingLists: () => [], packingHeld: () => 0 };
}
test('confirmed zero-share PO source receives into free stock without invented customer task', () => {
  const authority = originalProductState(fixture()), before = authority.buildState({ positions: [], claims: [], transfers: [], product: null });
  assert.equal(before.sources[0].ownerTaskId, null); assert.equal(before.tasks.length, 0); validate(before);
  const after = receive(before, { expectedRevision: 0, sourceId: 'FREE', cumulativeAccepted: 20 }).after;
  assert.equal(after.sources[0].available, 20); assert.equal(after.sources[0].onHand, 20);
  assert.deepEqual(after.sources[0].claims, {}); assert.deepEqual(after.relations, []);
  const corrected = correctAccepted(after, { expectedRevision: 1, sourceId: 'FREE', cumulativeAccepted: 15, reason: 'Recount' }).after;
  assert.equal(corrected.sources[0].available, 15);
});
test('missing owner only allowed with explicit saved zero share and free-only receipt policy', () => {
  for (const share of [null, undefined, 1]) {
    const args = fixture(); args.context.tasks[0].procurement.customerCtn = share;
    assert.throws(() => originalProductState(args), /customer share/);
  }
  const f = fixture(), before = originalProductState(f).buildState({ positions: [], claims: [], transfers: [], product: null });
  before.sources[0].receiptPolicy = 'OWNER_DEMAND'; assert.throws(() => validate(before), /Source identity/);
});
test('free stock source cannot create a borrowing relationship or future repayment promise', () => {
  const before = originalProductState(fixture()).buildState({ positions: [], claims: [], transfers: [], product: null });
  const state = receive(before, { expectedRevision: 0, sourceId: 'FREE', cumulativeAccepted: 20 }).after;
  state.tasks.push({ ...identity, id: 'A', customerId: 'CA', requested: 20, dispatched: 0 });
  state.packingHolds.heldByTask.A = 0;
  state.sources.push({ ...identity, id: 'SA', ownerTaskId: 'A', poId: 'PA', poValid: true, reviewRequired: false,
    receiptPolicy: 'OWNER_DEMAND', ownerShare: 20, planned: 20, accepted: 0, onHand: 0, isolated: 0, available: 0, claims: {} });
  validate(state);
  assert.throws(() => approveBorrow(state, { expectedRevision: 1, id: 'R', lenderSourceId: 'FREE', replacementSourceId: 'SA',
    borrowerTaskId: 'A', quantity: 10, approvedBy: 'P', reason: 'Fill' }), /Eligible/);
});
