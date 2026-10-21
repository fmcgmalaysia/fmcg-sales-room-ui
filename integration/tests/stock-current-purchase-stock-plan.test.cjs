const test = require('node:test'), assert = require('node:assert/strict');
const { preparePurchaseStock } = require('../prototypes/stock-current-state/purchase-stock-plan.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { approveBorrow } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 };
  const state = { ...identity, complete: true, revision: 0, tasks: [{ ...identity, id: 'T', customerId: 'C', requested: 100, dispatched: 0 }],
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { T: 0 } },
    sources: [{ ...identity, id: 'T', ownerTaskId: 'T', poId: 'P0', poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND',
      ownerShare: 100, planned: 100, accepted: 0, onHand: 0, isolated: 0, available: 0, claims: {} }], relations: [] };
  const key = stockKey(state), before = { _id: 'T', company: 'NCT', _version: 'T0', purchaseQtyInCtn: 100 };
  const event = { _id: 'E', title: 'E', company: 'NCT', action: 'PURCHASE_PLAN_SAVED', result: 'SAVED', activityTime: '2026-10-22', initiatedByStaffId: 'P', details: { taskId: 'T' } };
  return { company: 'NCT', generation: 0, domainPlan: { writes: [{ collection: 'NCTTasks', before, after: { ...before, purchaseQtyInCtn: 120 } },
    { collection: 'NCTActivity', before: null, after: event }] }, products: [{ state, after: { ...copy(state), sources: [{ ...copy(state.sources[0]), planned: 120 }] },
    rows: { complete: true, positions: [], claims: [], transfers: [], product: null } }], key };
}
test('original task, event and product checkpoint compose once without manufacturing receipt or claims', () => {
  const f = fixture(), before = JSON.stringify(f), saved = preparePurchaseStock(f);
  assert.equal(saved.plan.writes.length, 4);
  assert.equal(saved.plan.writes.filter(w => w.after._id === 'E').length, 1);
  assert.deepEqual(saved.plan.writes.find(w => w.collection === 'NCTTasks'), f.domainPlan.writes[0]);
  assert.equal(saved.plan.writes.some(w => w.collection === 'StockClaims'), false);
  const p = saved.plan.writes.find(w => w.collection === 'StockProducts');
  assert.equal(p.after.onHand, 0); assert.equal(p.after.revision, 1);
  assert.equal(JSON.stringify(f), before);
});
test('unreceived existing source PO change updates exact position identity but never physical quantities', () => {
  const f = fixture(), product = f.products[0], id = hash('NCT', f.key, 'PURCHASE_SOURCE', 'T');
  product.rows.positions.push({ _id: id, _version: 'S0', company: 'NCT', stockKey: f.key, revision: 0, status: 'CLOSED', sourceTaskId: 'T',
    poId: 'P0', receiptAccepted: 0, replacementReceived: 0, dispatched: 0, onHand: 0, isolated: 0, available: 0, reservedUsable: 0 });
  product.after.sources[0].poId = 'P1';
  const write = preparePurchaseStock(f).plan.writes.find(w => w.collection === 'StockPositions');
  assert.equal(write.before.poId, 'P0'); assert.equal(write.after.poId, 'P1'); assert.equal(write.after.onHand, 0);
});
test('missing, duplicate, unrelated or foreign products cannot bypass complete task coverage', () => {
  for (const mutate of [f => { f.products = []; }, f => { f.products.push(copy(f.products[0])); },
    f => { f.domainPlan.writes[0].after._id = 'OTHER'; }, f => { f.products[0].state.company = 'GHR'; },
    f => { f.domainPlan.writes.push(copy(f.domainPlan.writes[1])); }]) {
    const f = fixture(); mutate(f); assert.throws(() => preparePurchaseStock(f));
  }
});
test('Purchase does not gain Sales demand editing or silently release customer reservations', () => {
  for (const mutate of [p => { p.after.tasks[0].requested = 120; }, p => { p.after.tasks.push({ ...p.after.tasks[0], id: 'NEW' }); p.after.packingHolds.heldByTask.NEW = 0; }]) {
    const f = fixture(); mutate(f.products[0]); assert.throws(() => preparePurchaseStock(f), /Procurement/);
  }
});
test('approved replacement commitment still blocks composed original Purchase quantity reduction', () => {
  const f = fixture(), p = f.products[0], donor = { ...copy(p.state.sources[0]), id: 'D', ownerTaskId: 'D', poId: 'PD', accepted: 100, onHand: 100, claims: { D: 100 } };
  p.state.tasks.push({ ...copy(p.state.tasks[0]), id: 'D', customerId: 'CD' }); p.state.packingHolds.heldByTask.D = 0; p.state.sources.push(donor);
  const borrowed = approveBorrow(p.state, { expectedRevision: 0, id: 'R', quantity: 30, lenderSourceId: 'D', replacementSourceId: 'T', borrowerTaskId: 'T', approvedBy: 'P', reason: 'Fill' }).after;
  p.state = borrowed; p.after = copy(borrowed); p.after.sources[0].ownerShare = 20; p.after.sources[0].planned = 20;
  assert.throws(() => preparePurchaseStock(f), /Future supply|replacement supply/);
});
