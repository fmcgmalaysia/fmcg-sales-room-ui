const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createShortageStockPreparation } = require('../prototypes/stock-current-state/shortage-stock-preparation.cjs');
const { originalProductState } = require('../prototypes/stock-current-state/original-product-state.cjs');
const { currentAllocationContext } = require('../prototypes/stock-current-state/current-allocation-context.cjs');
const { approveBorrow, relationRemaining } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { readAllocations } = load('plannerAllocation.js'), { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const { createShortageOperations, shortageVersion } = load('purchaseShortage.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(borrowed = false) {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity), ids = borrowed ? ['T', 'A'] : ['T'];
  const context = { company: 'NCT', activity: [], suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: ids.map(id => ({ id: 'C-' + id, name: id })),
    tasks: ids.map(id => ({ ...identity, id, customerId: 'C-' + id, orderId: 'O-' + id, sourceLineId: 'L-' + id, name: 'Item', ord: 100, requested: 100,
      inc: 999, editVersion: 'TASK0', po: 'PO-' + id, supplierId: 'SUP', lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [],
      procurement: { totalCtn: 100, customerCtn: 100, revision: 'P0' }, warehouse: id === 'T' ? { hasPhysicalReceipt: true, accepted: 90, issue: false } : null })) };
  const orders = projectPurchaseOrders({ company: 'NCT', workspace: context, records: [] }), positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'T');
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
  const rows = { complete: true, positions: [{ ...base, _id: positionId, sourceTaskId: 'T', poId: orders.find(p => p.taskIds.includes('T')).id,
    receiptAccepted: 90, replacementReceived: 0, dispatched: 0, onHand: 90, available: 0, isolated: 0, reservedUsable: 90 }],
    claims: [{ ...base, _id: hash('NCT', positionId, 'T'), positionId, taskId: 'T', customerId: 'C-T', reservedUsable: 90, isolatedAttributed: 0 }],
    product: { ...base, _id: hash('NCT', key), onHand: 90, available: 0, isolated: 0, reservedUsable: 90, reviewRequired: false }, transfers: [] };
  const builder = () => originalProductState({ company: 'NCT', context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld });
  if (borrowed) {
    const state = approveBorrow(builder().buildState(rows), { expectedRevision: 0, id: 'R', quantity: 20, lenderSourceId: 'T', replacementSourceId: 'A',
      borrowerTaskId: 'A', approvedBy: 'P', reason: 'Fill container' }).after;
    rows.claims[0].reservedUsable = 70;
    rows.claims.push({ ...base, _id: hash('NCT', positionId, 'A'), positionId, taskId: 'A', customerId: 'C-A', reservedUsable: 20, isolatedAttributed: 0 });
    rows.product.revision = 1;
    rows.transfers.push({ ...base, _id: hash('NCT', 'STOCK_TRANSFER_CURRENT', 'R'), action: 'STOCK_TRANSFER_CURRENT', result: 'SAVED', details: { relation: state.relations[0] } });
    context.activity = rows.transfers;
  }
  const db = new Map();
  for (const [c, values] of [['StockPositions', rows.positions], ['StockClaims', rows.claims], ['StockProducts', [rows.product]], ['NCTActivity', rows.transfers]])
    for (const row of values) db.set(c + ':' + row._id, copy(row));
  const workspace = currentAllocationContext({ context, state: builder().buildState(rows), readAllocations }), taskId = borrowed ? 'A' : 'T';
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'purchase@example.test' };
  const employee = { title: 'P', description: 'M', staffEmail: member.loginEmail, staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['PURCHASE'] };
  let privateReads = 0, staffReads = 0;
  const deps = { company: 'NCT', readMember: async () => member, readStaffRecords: async () => { staffReads++; return [employee]; }, requirePurchaseStaff,
    readContext: async (company, staff) => { privateReads++; assert.equal(staff.memberId, 'M'); return copy(context); }, readPurchaseRecords: async () => [],
    projectPurchaseOrders, createShortageOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, now: () => new Date('2026-10-22T12:00:00Z'),
    protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) }, store: { read: async (c, id) => copy(db.get(c + ':' + id) || null) },
    items: { query: c => { const filters = [], q = { eq: (k, v) => { filters.push([k, v]); return q; }, ascending: () => q, limit: () => q,
      find: async () => { const items = [...db.entries()].filter(([id, row]) => id.startsWith(c + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => copy(row)); return { items, totalCount: items.length }; } }; return q; } } };
  const request = { company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111', staff: { staffId: 'FORGED' }, input: {
    taskId, version: shortageVersion(workspace.tasks.find(t => t.id === taskId), context.activity), customerDecision: 'STOP', supplierDecision: 'CREDIT',
    reason: 'Supplier confirmed shortage', customerMessage: 'Await further customer arrangement' } };
  return { db, context, deps, request, counts: () => ({ privateReads, staffReads }) };
}
test('original shortage uses current cumulative ownership, keeps demand, stock and finance responsibility separate', async () => {
  const f = fixture(), before = JSON.stringify([...f.db]), result = await createShortageStockPreparation(f.deps)(f.request);
  const event = result.plan.writes.find(w => w.after.action === 'PURCHASE_SHORTAGE_DECIDED').after;
  assert.equal(event.details.shortCtn, 10); assert.equal(event.details.allocatedCtn, 90);
  assert.equal(event.details.financeRequired, true); assert.equal(event.initiatedByStaffId, 'P');
  assert.equal(result.plan.writes.length, 2); assert.equal(result.state.sources[0].onHand, 90);
  assert.equal(result.state.tasks[0].requested, 100); assert.equal(JSON.stringify([...f.db]), before);
});
test('STOP/CREDIT cannot repay or erase an approved borrowing promise or release its stock', async () => {
  const f = fixture(true), result = await createShortageStockPreparation(f.deps)(f.request);
  assert.equal(relationRemaining(result.state.relations[0]), 20);
  assert.equal(result.state.sources.find(s => s.id === 'A').planned, 100);
  assert.deepEqual(result.state.sources.find(s => s.id === 'T').claims, { T: 70, A: 20 });
  assert.equal(result.plan.writes.some(w => ['StockClaims', 'StockPositions'].includes(w.collection)), false);
});
test('original stale version/date/customer-message checks and server permission stay enforced', async () => {
  for (const patch of [{ version: 'OLD' }, { supplierDecision: 'REPLENISH', expectedDate: '2026-02-30' }, { customerMessage: '' }]) {
    const f = fixture(); await assert.rejects(createShortageStockPreparation(f.deps)({ ...f.request, input: { ...f.request.input, ...patch } }));
  }
  const f = fixture(); f.deps.readMember = async () => ({ _id: 'M', status: 'PENDING', loginEmail: 'purchase@example.test' });
  await assert.rejects(createShortageStockPreparation(f.deps)(f.request)); assert.deepEqual(f.counts(), { privateReads: 0, staffReads: 0 });
  const g = fixture(); g.deps.readStaffRecords = async () => [{ title: 'W', description: 'M', staffEmail: 'purchase@example.test', staffName: 'W', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] }];
  await assert.rejects(createShortageStockPreparation(g.deps)(g.request)); assert.equal(g.counts().privateReads, 0);
});
