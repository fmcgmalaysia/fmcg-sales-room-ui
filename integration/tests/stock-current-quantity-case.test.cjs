const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createQuantityCasePreparation } = require('../prototypes/stock-current-state/quantity-case-preparation.cjs');
const { originalProductState } = require('../prototypes/stock-current-state/original-product-state.cjs');
const { approveBorrow, relationRemaining } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { createQuantityCaseOperations, projectQuantityCases, quantityCasesVersion } = load('purchaseQuantityCases.js');
const { requirePurchaseStaff } = load('purchaseProjection.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { readAllocations } = load('plannerAllocation.js'), { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(borrowed = false) {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity), ids = borrowed ? ['T', 'A'] : ['T'];
  const context = { company: 'NCT', activity: [], customers: ids.map(id => ({ id: 'C' + id, name: id })), suppliers: [{ id: 'SUP', name: 'Supplier' }],
    tasks: ids.map(id => ({ ...identity, id, orderId: 'O' + id, sourceLineId: 'L' + id, customerId: 'C' + id, supplierId: 'SUP', name: 'Item',
      ord: id === 'T' ? 110 : 100, requested: id === 'T' ? 110 : 100, inc: 999, po: 'PO' + id, lpPc: 1, lpCtn: 12, disc1: 0, disc2: 0, disc3: 0, history: [],
      procurement: { totalCtn: 100, customerCtn: 100, revision: 'P0' }, warehouse: id === 'T' ? { accepted: 90, hasPhysicalReceipt: true, issue: true } : null })) };
  const orders = projectPurchaseOrders({ company: 'NCT', workspace: context, records: [] }), po = orders.find(row => row.taskIds.includes('T'));
  context.activity.push({ _id: 'RCV', title: 'RCV', description: po.id, action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED',
    activityTime: '2026-10-22T05:00:00Z', details: { lines: [{ taskId: 'T', planned: 100, accepted: 90, issue: true }] } });
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] }, positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'T');
  const rows = { complete: true, positions: [{ ...base, _id: positionId, sourceTaskId: 'T', poId: po.id, receiptAccepted: 90,
    replacementReceived: 0, dispatched: 0, onHand: 90, isolated: 0, available: 0, reservedUsable: 90 }], claims: [{ ...base,
    _id: hash('NCT', positionId, 'T'), positionId, taskId: 'T', customerId: 'CT', reservedUsable: 90, isolatedAttributed: 0 }],
    transfers: [], product: { ...base, _id: hash('NCT', key), onHand: 90, isolated: 0, available: 0, reservedUsable: 90, reviewRequired: false } };
  if (borrowed) {
    const state = originalProductState({ company: 'NCT', context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld }).buildState(rows);
    const after = approveBorrow(state, { expectedRevision: 0, id: 'R', lenderSourceId: 'T', replacementSourceId: 'A', borrowerTaskId: 'A',
      quantity: 20, approvedBy: 'P', reason: 'Fill container' }).after;
    rows.claims[0].reservedUsable = 70; rows.claims.push({ ...base, _id: hash('NCT', positionId, 'A'), positionId, taskId: 'A', customerId: 'CA', reservedUsable: 20, isolatedAttributed: 0 });
    rows.product.revision = 1;
    rows.transfers.push({ ...base, _id: hash('NCT', 'STOCK_TRANSFER_CURRENT', 'R'), action: 'STOCK_TRANSFER_CURRENT', result: 'SAVED', details: { relation: after.relations[0] } });
    context.activity.push(...rows.transfers);
  }
  const db = new Map();
  for (const [c, values] of [['StockPositions', rows.positions], ['StockClaims', rows.claims], ['StockProducts', [rows.product]], ['NCTActivity', context.activity]])
    for (const row of values) db.set(c + ':' + row._id, copy(row));
  const member = { _id: 'M', loginEmail: 'purchase@example.test', status: 'APPROVED' }, employee = { title: 'P', description: 'M', staffEmail: member.loginEmail,
    staffName: 'Purchase', staffStatus: 'ACTIVE', departments: ['PURCHASE'] }; let contextReads = 0, staffReads = 0;
  const deps = { company: 'NCT', readMember: async () => member, readStaffRecords: async () => { staffReads++; return [employee]; }, requirePurchaseStaff,
    readContext: async (company, staff) => { contextReads++; assert.equal(staff.memberId, 'M'); return { ...copy(context), activity: [...db.entries()].filter(([id]) => id.startsWith('NCTActivity:')).map(([, row]) => copy(row)) }; },
    readPurchaseRecords: async () => [], projectPurchaseOrders, createQuantityCaseOperations, projectQuantityCases, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now: () => new Date('2026-10-22T06:00:00Z'), protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) },
    store: { read: async (c, id) => copy(db.get(c + ':' + id) || null) }, items: { query: c => { const filters = [], q = {
      eq: (k, v) => { filters.push([k, v]); return q; }, ascending: () => q, limit: () => q, find: async () => {
        const items = [...db.entries()].filter(([id, row]) => id.startsWith(c + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => copy(row));
        return { items, totalCount: items.length }; } }; return q; } } };
  const request = kind => ({ company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111', staff: { staffId: 'FORGED' }, input: {
    action: 'DECIDE', id: projectQuantityCases(context, context.activity).find(row => row.kind === kind).id, version: quantityCasesVersion(context, context.activity),
    customerDecision: 'STOP', supplierDecision: 'CREDIT', reason: 'Supplier shortage decision', customerMessage: 'Await separate customer arrangement' } });
  return { deps, db, context, request, counts: () => ({ contextReads, staffReads }) };
}

test('unplaced and receipt decisions use original case authority without cancelling demand or releasing stock', async () => {
  for (const kind of ['UNPLACED', 'RECEIPT']) {
    const f = fixture(), before = JSON.stringify([...f.db]), result = await createQuantityCasePreparation(f.deps)(f.request(kind));
    const event = result.plan.writes[0].after;
    assert.equal(event.action, 'PURCHASE_QUANTITY_CASE_DECIDED'); assert.equal(event.initiatedByStaffId, 'P'); assert.equal(event.details.quantity, 10);
    assert.equal(event.details.supplierDecision, kind === 'UNPLACED' ? 'NOT_APPLICABLE' : 'CREDIT'); assert.equal(result.plan.writes.length, 2);
    assert.equal(result.state.tasks[0].requested, 110); assert.equal(result.state.sources[0].onHand, 90); assert.deepEqual(result.state.sources[0].claims, { T: 90 });
    assert.equal(JSON.stringify([...f.db]), before);
  }
});

test('STOP/CREDIT leaves the approved borrowing promise and both customer claims untouched', async () => {
  const f = fixture(true), result = await createQuantityCasePreparation(f.deps)(f.request('RECEIPT'));
  assert.equal(relationRemaining(result.state.relations[0]), 20); assert.deepEqual(result.state.sources.find(s => s.id === 'T').claims, { T: 70, A: 20 });
  assert.equal(result.plan.writes.some(w => ['StockPositions', 'StockClaims'].includes(w.collection)), false);
});

test('stale case/date/message checks, foreign company and original Purchase permission remain', async () => {
  for (const patch of [{ version: 'OLD' }, { customerDecision: 'WAIT', expectedDate: '2026-02-30' }, { customerMessage: '' }]) {
    const f = fixture(), request = f.request('RECEIPT'); await assert.rejects(createQuantityCasePreparation(f.deps)({ ...request, input: { ...request.input, ...patch } }));
  }
  const f = fixture(); f.deps.readMember = async () => ({ _id: 'M', status: 'PENDING' });
  await assert.rejects(createQuantityCasePreparation(f.deps)(f.request('RECEIPT'))); assert.deepEqual(f.counts(), { contextReads: 0, staffReads: 0 });
  const g = fixture(); g.deps.readStaffRecords = async () => []; await assert.rejects(createQuantityCasePreparation(g.deps)(g.request('RECEIPT'))); assert.equal(g.counts().contextReads, 0);
  const h = fixture(); await assert.rejects(createQuantityCasePreparation(h.deps)({ ...h.request('RECEIPT'), company: 'GHR' })); assert.equal(h.counts().contextReads, 0);
});

test('same decision common fence replay advances once, no physical release or duplicate business event', async () => {
  const f = fixture(true), store = { ...f.deps.store };
  store.insert = async (c, row) => { if (f.db.has(c + ':' + row._id)) throw Error('Duplicate'); f.db.set(c + ':' + row._id, copy(row)); return copy(row); };
  store.compareAndSet = async (c, id, version, row) => { if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row); };
  store.compareAndRemove = async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); f.db.delete(c + ':' + id); };
  const protocol = createFencedProof({ store }); await protocol.initialize(); f.deps.store = store; f.deps.protocol = protocol;
  const request = f.request('RECEIPT'), service = createQuantityCasePreparation(f.deps), command = { requestId: request.requestId, memberId: 'M', input: request,
    prepare: async () => (await service(request)).plan };
  await protocol.commit(command); await protocol.commit(command);
  assert.equal((await protocol.readSnapshot(async () => null)).generation, 1);
  assert.equal([...f.db.values()].filter(row => row.action === 'PURCHASE_QUANTITY_CASE_DECIDED').length, 1);
  assert.equal([...f.db.entries()].find(([id]) => id.startsWith('StockProducts:'))[1].onHand, 90);
});
