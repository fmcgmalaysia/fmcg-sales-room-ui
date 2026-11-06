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

async function currentFixture(borrowed = false) {
  const f = fixture(borrowed), store = { ...f.deps.store };
  store.insert = async (c, row) => { if (f.db.has(c + ':' + row._id)) throw Error('Duplicate'); f.db.set(c + ':' + row._id, copy(row)); };
  store.compareAndSet = async (c, id, version, row) => { if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); f.db.set(c + ':' + id, copy(row)); };
  store.compareAndRemove = async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); f.db.delete(c + ':' + id); };
  const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
  const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: 1 }); await protocol.initialize();
  Object.assign(f.db.get('NCTActivity:' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  for (const [address, row] of f.db) {
    if (address.startsWith('StockProducts:')) Object.assign(row, { lifecycleVersion: 2, nextBorrowSequence: borrowed ? 2 : 1 });
    if (address.startsWith('StockPositions:')) row.borrowRepaidCumulative = 0;
    if (address.startsWith('StockClaims:')) row.dispatchedCumulative = 0;
    if (row.action === 'STOCK_TRANSFER_CURRENT') { const r = row.details.relation; Object.assign(row, {
      participantTaskIds: [r.borrowerTaskId, r.lenderTaskId], lenderSourceId: r.lenderSourceId, replacementSourceId: r.replacementSourceId, repaidQuantity: r.repaid }); }
  }
  // These CLOSED records are deliberately outside this operational authority.
  // A full historical product read would incorrectly pull them into this save.
  const product = [...f.db.values()].find(r => r.lifecycleVersion === 2);
  for (let i = 0; i < 15; i++) f.db.set('StockPositions:CLOSED-' + i, { _id: 'CLOSED-' + i, company: 'NCT', stockKey: product.stockKey, status: 'CLOSED' });
  const items = { query: c => { const filters = []; let limit = 50; const q = {
    eq: (k, v) => { filters.push(row => row[k] === v); return q; }, gt: (k, v) => { filters.push(row => row[k] > v); return q; },
    ascending: () => q, limit: n => { limit = n; return q; }, find: async () => {
      const rows = [...f.db.entries()].filter(([address, row]) => address.startsWith(c + ':') && filters.every(fn => fn(row)))
        .map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id)); return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  Object.assign(f.deps, { store, protocol, items, readCurrentTaskRows: async (_company, ids) => ids.map(id => ({ _id: id, company: 'NCT', _version: 'TASK0',
    description: 'O' + id, imageAltText: 'L' + id, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 })) });
  const save = require('../prototypes/stock-current-state/current-department-saves.cjs').createCurrentQuantityCaseSave({ company: 'NCT', store, protocol, items,
    authorityDependencies: f.deps, coverage: Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }])) });
  return { ...f, save, request: kind => ({ ...f.request(kind), stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 }) };
}

test('concrete v2 shortage decision excludes lifetime CLOSED sources and preserves physical stock and borrowing after STOP/CREDIT', async () => {
  for (const borrowed of [false, true]) {
    const f = await currentFixture(borrowed), request = f.request('RECEIPT');
    const balances = JSON.stringify([...f.db].filter(([id, r]) => /^(StockPositions|StockClaims):/.test(id) || r.action === 'STOCK_TRANSFER_CURRENT'));
    let result = await f.save(request), attempts = 1; assert.equal(result.pending, true);
    while (result.pending && attempts++ < 15) result = await f.save(request);
    assert.equal(result.ok, true); assert.equal(result.caseId, request.input.id); assert.equal(result.stockGeneration, 1);
    assert.equal((await f.save(request)).caseId, result.caseId);
    assert.equal(f.counts().contextReads, 1);
    assert.equal(JSON.stringify([...f.db].filter(([id, r]) => /^(StockPositions|StockClaims):/.test(id) || r.action === 'STOCK_TRANSFER_CURRENT')), balances);
    assert.equal([...f.db.values()].filter(r => r.action === 'PURCHASE_QUANTITY_CASE_DECIDED').length, 1);
    if (borrowed) assert.equal(relationRemaining([...f.db.values()].find(r => r.action === 'STOCK_TRANSFER_CURRENT').details.relation), 20);
  }
});

test('v2 shortage decision refuses missing raw task checkpoints and reauthorizes a completed replay', async () => {
  const f = await currentFixture(); f.deps.readCurrentTaskRows = async () => [];
  // The constructed service captured its private reader; construct a new service to
  // test missing dependency output, not a browser replacement of that dependency.
  const { createQuantityCasePreparation } = require('../prototypes/stock-current-state/quantity-case-preparation.cjs');
  await assert.rejects(createQuantityCasePreparation(f.deps)(f.request('RECEIPT')), /Complete exact current task/);
  const g = await currentFixture(), request = g.request('RECEIPT'); let result;
  do { result = await g.save(request); } while (result.pending);
  // Authentication callbacks are captured privately; change the original member's
  // status instead, which the captured readMember callback returns freshly.
  const member = await g.deps.readMember(); member.status = 'PENDING';
  await assert.rejects(g.save(request));
  assert.equal([...g.db.values()].filter(r => r.action === 'PURCHASE_QUANTITY_CASE_DECIDED').length, 1);
});
