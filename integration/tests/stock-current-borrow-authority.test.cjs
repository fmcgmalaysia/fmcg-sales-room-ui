const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createBorrowingAuthority } = require('../prototypes/stock-current-state/borrowing-authority.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js');
const { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js');
const { packingHeld } = load('packingListModel.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { operationId } = load('purchaseOperationJournal.js');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { transferId } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { createBorrowingStockReader } = require('../prototypes/stock-current-state/borrowing-stock-reader.cjs');
const { readPreparation } = load('warehousePreparation.js');
const { approveBorrow } = require('../prototypes/stock-current-state/borrowing-model.cjs');
const { createCurrentBorrowingSave, createCurrentWarehouseReceiptSave } = require('../prototypes/stock-current-state/current-department-saves.cjs');
const { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } = load('warehouseReceiving.js');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const member = { _id: 'M1', loginEmail: 'purchase@example.test', status: 'APPROVED' };
const staff = { title: 'P1', description: 'M1', staffEmail: member.loginEmail, staffName: 'DEMO', staffStatus: 'ACTIVE', role: 'STAFF', departments: ['PURCHASE'] };
const request = { company: 'NCT', requestId: '11111111-2222-4333-8444-555555555555', kind: 'APPROVE',
  input: { expectedRevision: 0, borrowerTaskId: 'A', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 30, reason: 'Customer A shipment' } };
function fixture() {
  const context = { company: 'NCT', activity: [], suppliers: [{ id: 'SUP', name: 'Demo Supplier' }], customers: ['A', 'B'].map(id => ({ id: 'C-' + id, name: id })),
    tasks: ['A', 'B'].map(id => ({ id, customerId: 'C-' + id, orderId: 'O-' + id, sourceLineId: 'L-' + id,
      barcode: '1', name: 'Demo', packing: '24x1', ea: 24, requested: 100, ord: 100, po: 'PO-' + id, supplierId: 'SUP',
      lpCtn: 10, lpPc: 10 / 24, disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: 100, customerCtn: 100 },
      warehouse: id === 'B' ? { hasPhysicalReceipt: true, accepted: 100 } : null })) };
  const calls = [];
  const deps = { readMember: async () => member, readStaffRecords: async () => [staff], requirePurchaseStaff,
    readContext: async (company, verified) => { calls.push({ company, verified }); return context; },
    readPurchaseRecords: async () => [], projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
    readTransfer: async () => null, now: () => new Date('2026-10-22T01:00:00Z') };
  return { context, calls, deps };
}
test('uses original Purchase auth and PO projector; ignores forged browser actor and permission flags', async () => {
  const f = fixture();
  const result = await createBorrowingAuthority(f.deps)({ ...request, input: { ...request.input, approvedBy: 'FORGED', poValid: true, complete: true } });
  assert.equal(result.input.approvedBy, 'P1'); assert.equal(result.event.initiatedByStaffId, 'P1');
  assert.equal(result.memberId, 'M1'); assert.equal(result.identity.company, 'NCT');
  assert.equal(Object.hasOwn(result.input, 'poValid'), false);
  assert.equal(f.calls[0].verified.memberId, 'M1');
  const state = result.buildState({ positions: [], claims: [], product: null, transfers: [] });
  assert.equal(state.sources.find(s => s.id === 'B').accepted, 100);
  assert.equal(state.sources.find(s => s.id === 'A').poId, operationId('NCT', 'PURCHASE_ORDER', ['A']));
});
test('Warehouse/Support only staff cannot approve borrowing and no context is read', async () => {
  for (const department of ['WAREHOUSE', 'SUPPORT', 'PLANNER']) {
    const f = fixture();
    await assert.rejects(createBorrowingAuthority({ ...f.deps, readStaffRecords: async () => [{ ...staff, departments: [department] }] })(request), /not authorized/);
    assert.equal(f.calls.length, 0);
  }
});
test('unapproved member rejects before reading private staff records', async () => {
  const f = fixture(); let staffReads = 0;
  await assert.rejects(createBorrowingAuthority({ ...f.deps, readMember: async () => ({ ...member, status: 'PENDING' }),
    readStaffRecords: async () => { staffReads++; return [staff]; } })(request), /approved Master staff/);
  assert.equal(staffReads, 0); assert.equal(f.calls.length, 0);
});

test('real authority preserves legacy Warehouse preparation guard before approving borrowing', async () => {
  const f = fixture(); f.deps.readPreparation = readPreparation;
  f.context.activity.push({ _id: 'PREP', title: 'PREP', description: 'PREP-B', action: 'WAREHOUSE_PREPARATION_SAVED', result: 'SAVED',
    activityTime: '2026-10-22T00:00:00Z', initiatedByStaffId: 'W', details: { beforeRevision: '', state: {
      id: 'PREP-B', taskId: 'B', customerId: 'C-B', company: 'NCT', quantity: 100, loaded: 0, prepared: true, photos: [] } } });
  const result = await createBorrowingAuthority(f.deps)(request), id = operationId('NCT', stockKey(result.identity), 'PURCHASE_SOURCE', 'B');
  const state = result.buildState({ positions: [{ sourceTaskId: 'B', onHand: 100, isolated: 0, available: 0 }],
    claims: [{ positionId: id, taskId: 'B', reservedUsable: 100 }], transfers: [], product: null });
  assert.equal(state.packingHolds.legacyBlockedByTask.B, true);
  assert.throws(() => approveBorrow(state, result.input), /holds lender/);
});
test('missing PO, draft plan, invoice lock, foreign context and unknown customer share reject', async () => {
  for (const mutate of [f => { f.context.tasks[0].po = ''; }, f => { f.context.tasks[0].procurement.draftPlan = true; },
    f => { f.context.tasks[1].salesInvoiceNumber = 'INV'; }, f => { f.context.company = 'GHR'; },
    f => { f.context.tasks[0].procurement.customerCtn = null; }]) {
    const f = fixture(); mutate(f); await assert.rejects(createBorrowingAuthority(f.deps)(request));
  }
});
test('state assembler uses exact current claims instead of copying legacy task inc', async () => {
  const f = fixture(); f.context.tasks[0].inc = 9999;
  const authority = await createBorrowingAuthority(f.deps)(request), key = stockKey(authority.identity), positionId = operationId('NCT', key, 'PURCHASE_SOURCE', 'B');
  const state = authority.buildState({ positions: [{ sourceTaskId: 'B', onHand: 100, isolated: 0, available: 0 }],
    claims: [{ positionId, taskId: 'B', reservedUsable: 100 }], transfers: [], product: { revision: 0 } });
  assert.equal(state.sources[0].claims.A, undefined);
  assert.equal(state.sources[1].claims.B, 100);
  assert.equal(state.tasks[0].dispatched, 0);
});

test('scoped state retains task20dispatched from omitted CLOSED sources and never buys/allocates it again', async () => {
  const f = fixture(), authority = await createBorrowingAuthority(f.deps)(request), key = stockKey(authority.identity);
  const positionId = operationId('NCT', key, 'PURCHASE_SOURCE', 'B');
  const state = authority.buildState({ scope: 'CURRENT_ACTIVE_PRODUCT', sourceTaskIds: ['A', 'B'], generation: 0,
    positions: [{ sourceTaskId: 'B', onHand: 100, isolated: 0, available: 0, borrowRepaidCumulative: 0 }],
    claims: [{ positionId, taskId: 'B', reservedUsable: 100, dispatchedCumulative: 0 }], transfers: [],
    product: { lifecycleVersion: 2, nextBorrowSequence: 5, revision: 0 },
    taskRows: f.context.tasks.map(t => ({ _id: t.id, company: 'NCT', _version: 'T0', description: t.orderId, imageAltText: t.sourceLineId,
      stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: t.id === 'A' ? 20 : 0 })) });
  assert.equal(state.tasks[0].dispatched, 20); assert.equal(state.tasks[0].dispatchedOutsideScope, 20);
  let next = approveBorrow(state, authority.input).after;
  next = require('../prototypes/stock-current-state/borrowing-model.cjs').receive(next, { expectedRevision: next.revision, sourceId: 'A', cumulativeAccepted: 100 }).after;
  const own = next.sources.find(s => s.id === 'A'); assert.equal(own.claims.A, 50); assert.equal(own.claims.B, 30); assert.equal(own.available, 20);
  assert.equal(next.tasks[0].dispatched, 20);
});
test('return authority resolves stable server relationship and does not trust browser borrower IDs', async () => {
  const f = fixture(), relation = { id: 'R1', borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 30, repaid: 0 };
  const result = await createBorrowingAuthority({ ...f.deps, readTransfer: async () => ({ _id: transferId('NCT', 'R1'), company: 'NCT', stockKey: stockKey({ company: 'NCT', barcode: '1', packing: '24x1', ea: 24 }), action: 'STOCK_TRANSFER_CURRENT', details: { relation } }) })({
    ...request, kind: 'RETURN', input: { ...request.input, relationId: 'R1', borrowerTaskId: 'WRONG' } });
  assert.equal(result.input.relationId, 'R1'); assert.equal(result.input.approvedBy, 'P1');
  assert.equal(Object.hasOwn(result.input, 'borrowerTaskId'), false);
});
test('reader invokes server state assembler inside snapshot barrier after current-row reads', async () => {
  let assembled = false, barrier = false;
  const f = fixture(), original = createBorrowingAuthority(f.deps);
  const authority = await original(request), raw = authority.buildState;
  authority.buildState = rows => { assert.equal(barrier, true); assembled = true; return raw(rows); };
  const q = {}; for (const method of ['eq', 'ascending', 'limit']) q[method] = () => q;
  q.find = async () => ({ items: [], totalCount: 0 });
  await assert.rejects(createBorrowingStockReader({ company: 'NCT', items: { query: () => q }, store: { read: async () => null },
    protocol: { readSnapshot: async fn => { barrier = true; const rows = await fn(); barrier = false; return { generation: 0, rows }; } },
    readAuthority: async () => authority })(), /Physical balance|provenance conflict|snapshot missing/);
  assert.equal(assembled, true);
});
test('real auth/PO parsers plus current snapshot produce a single approved borrowing save plan', async () => {
  const f = fixture(), authority = createBorrowingAuthority(f.deps);
  const key = stockKey({ company: 'NCT', barcode: '1', packing: '24x1', ea: 24 });
  const positionId = operationId('NCT', key, 'PURCHASE_SOURCE', 'B');
  const base = { company: 'NCT', stockKey: key, revision: 0, status: 'ACTIVE', _version: 'V0', reviewCodes: [] };
  const position = { ...base, _id: positionId, sourceTaskId: 'B', poId: operationId('NCT', 'PURCHASE_ORDER', ['B']), receiptAccepted: 100,
    replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 0, reservedUsable: 100 };
  const claim = { ...base, _id: operationId('NCT', positionId, 'B'), positionId, taskId: 'B', customerId: 'C-B',
    reservedUsable: 100, isolatedAttributed: 0 };
  const product = { ...base, _id: operationId('NCT', key), onHand: 100, isolated: 0, available: 0, reservedUsable: 100 };
  const all = { StockPositions: [position], StockClaims: [claim], StockProducts: [product], NCTActivity: [] };
  const deps = { company: 'NCT', readAuthority: () => authority(request),
    store: { read: async (collection, id) => all[collection].find(row => row._id === id) || null },
    protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) }, items: { query: collection => {
      const filters = {}; const q = { eq: (k, v) => { filters[k] = v; return q; }, ascending: () => q, limit: () => q,
        find: async () => { const selected = all[collection].filter(row => Object.entries(filters).every(([k, v]) => row[k] === v)); return { items: selected, totalCount: selected.length }; } }; return q;
    } } };
  const result = await createBorrowingStockReader(deps)();
  assert.equal(result.plan.writes[0].after.initiatedByStaffId, 'P1');
  assert.equal(result.plan.writes.find(w => w.collection === 'StockClaims' && w.after.taskId === 'A').after.reservedUsable, 30);
  assert.equal(result.state.sources.find(s => s.id === 'B').claims.B, 70);
  // Existing legacy shipment reservation is part of the same task hold protection.
  f.context.activity.push({ _id: 'SE', title: 'SE', description: 'SHIP', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED',
    activityTime: '2026-10-22T00:00:00Z', details: { beforeRevision: '', shipment: { id: 'SHIP', company: 'NCT', customerId: 'C-B', currency: 'USD', status: 'REQUESTED',
      lines: [{ taskId: 'B', quantity: 10, sources: [{ sourceTaskId: 'B', quantity: 10 }] }] } } });
  await assert.rejects(createBorrowingStockReader(deps)(), /Packing task holds lender/);
});

for (const segmented of [false, true]) test(`concrete ${segmented ? 'v2 scoped' : 'v1'} Purchase/receipt commands approve, return and automatically repay without duplicating PO or physical stock`, async () => {
  const f = fixture(), copy = value => JSON.parse(JSON.stringify(value)), db = new Map();
  const key = stockKey({ company: 'NCT', barcode: '1', packing: '24x1', ea: 24 }), positionId = operationId('NCT', key, 'PURCHASE_SOURCE', 'B');
  const base = { company: 'NCT', stockKey: key, revision: 0, status: 'ACTIVE', _version: 'V0', reviewCodes: [] };
  const seed = (collection, row) => db.set(collection + ':' + row._id, copy(row));
  seed('StockPositions', { ...base, _id: positionId, sourceTaskId: 'B', poId: operationId('NCT', 'PURCHASE_ORDER', ['B']), receiptAccepted: 100,
    replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 0, reservedUsable: 100,
    ...(segmented ? { borrowRepaidCumulative: 0 } : {}) });
  seed('StockClaims', { ...base, _id: operationId('NCT', positionId, 'B'), positionId, taskId: 'B', customerId: 'C-B', reservedUsable: 100, isolatedAttributed: 0,
    ...(segmented ? { dispatchedCumulative: 0 } : {}) });
  seed('StockProducts', { ...base, _id: operationId('NCT', key), onHand: 100, isolated: 0, available: 0, reservedUsable: 100,
    ...(segmented ? { lifecycleVersion: 2, nextBorrowSequence: 51 } : {}) });
  if (segmented) for (const task of f.context.tasks) Object.assign(task, { stockCounterSchema: 2, stockCommitVersion: 'T0', stockDispatchedCumulative: 0 });
  if (segmented) f.deps.readCurrentTaskRows = async (company, ids, verified) => {
    assert.equal(company, 'NCT'); assert.ok(verified.memberId);
    return ids.map(id => { const task = f.context.tasks.find(t => t.id === id); return { _id: id, company, _version: 'T0',
      description: task.orderId, imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 }; });
  };
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); seed(c, row); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('CAS conflict'); seed(c, row); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id); }
  };
  const items = { query: collection => { const filters = []; let limit = 1000; const q = {
    eq: (k, v) => { filters.push(['eq', k, v]); return q; }, gt: (k, v) => { filters.push(['gt', k, v]); return q; },
    ascending: () => q, limit: n => { limit = n; return q; },
    find: async () => { const selected = [...db].filter(([address, row]) => address.startsWith(collection + ':')
      && filters.every(([method, k, v]) => method === 'eq' ? row[k] === v : row[k] > v)).map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id));
      return { items: selected.slice(0, limit), totalCount: selected.length }; } }; return q; } };
  const protocol = segmented ? require('../prototypes/stock-current-state/segmented-fenced-proof.cjs').createSegmentedFencedProof({ store, stepsPerInvocation: 100 }) : createFencedProof({ store });
  await protocol.initialize();
  Object.assign(db.get(protocol.ids.journal + ':' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', ...(segmented ? { transferIndexVersion: 2 } : {}) });
  f.deps.readTransfer = async (company, id) => store.read('NCTActivity', transferId(company, id));
  const coverage = Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }]));
  if (segmented) {
    const options = require('../prototypes/stock-current-state/purchase-borrow-options.cjs').createPurchaseBorrowOptions({ company: 'NCT', items, store, protocol, authorityDependencies: f.deps });
    const before = JSON.stringify([...db]);
    const quoted = await options('NCT', { borrowerTaskId: 'A', approvedBy: 'FORGED', poValid: true });
    assert.equal(quoted.options.length, 1); assert.equal(quoted.options[0].maximumQuantity, 100);
    assert.equal(quoted.options[0].lenderSourceId, 'B'); assert.equal(quoted.options[0].replacementSourceId, 'A');
    assert.equal(quoted.options[0].lenderPoNumber, 'PO-B'); assert.equal(quoted.stockCurrent.stockGeneration, 0);
    assert.equal(JSON.stringify([...db]), before, 'quoting must not reserve, approve or write anything');
  }
  const save = createCurrentBorrowingSave({ company: 'NCT', items, store, protocol, coverage, authorityDependencies: f.deps });
  const command = { ...request, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 };
  const readsBeforeSave = f.calls.length;
  await save(command); await save(command); assert.equal(f.calls.length, readsBeforeSave + 1);
  const relation = [...db.values()].find(row => row.action === 'STOCK_TRANSFER_CURRENT').details.relation;
  assert.equal(db.get('StockClaims:' + operationId('NCT', positionId, 'A')).reservedUsable, 30);
  assert.equal(db.get('StockClaims:' + operationId('NCT', positionId, 'B')).reservedUsable, 70);
  await assert.rejects(save({ ...command, kind: 'RETURN' }), /identity reused/);
  await save({ ...command, requestId: '22222222-2222-4333-8444-555555555555', kind: 'RETURN', stockGeneration: 1,
    input: { expectedRevision: 1, relationId: relation.id, quantity: 30, reason: 'Unused goods restored' } });
  assert.equal(db.get('StockClaims:' + operationId('NCT', positionId, 'B')).reservedUsable, 100);
  assert.equal(db.get('StockProducts:' + operationId('NCT', key)).onHand, 100);
  assert.equal([...db.values()].filter(row => row.action === 'STOCK_TRANSFER_CURRENT').length, 1);
  assert.equal([...db.values()].find(row => row.action === 'STOCK_TRANSFER_CURRENT').status, 'CLOSED');
  assert.deepEqual(f.context.tasks.map(task => task.po), ['PO-A', 'PO-B']); assert.equal((await protocol.readControl()).generation, 2);
  await save({ ...command, requestId: '33333333-2222-4333-8444-555555555555', stockGeneration: 2, input: { ...request.input, expectedRevision: 2 } });
  const warehouseMember = { _id: 'WM', status: 'APPROVED', loginEmail: 'warehouse@example.test' };
  const warehouseEmployee = { title: 'W', description: 'WM', staffEmail: warehouseMember.loginEmail, staffName: 'Warehouse', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] };
  const authorityDependencies = { ...f.deps, readMember: async () => warehouseMember, readStaffRecords: async () => [warehouseEmployee],
    requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations };
  const receive = createCurrentWarehouseReceiptSave({ company: 'NCT', items, store, protocol, coverage, authorityDependencies });
  const orders = projectWarehouseOrders({ company: 'NCT', purchaseOrders: projectPurchaseOrders({ company: 'NCT', workspace: f.context, records: [] }),
    tasks: f.context.tasks, activity: f.context.activity }), ownPo = orders.find(po => po.lines.some(line => line.taskId === 'A'));
  const receipt = { requestId: '44444444-2222-4333-8444-555555555555', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 3,
    input: { id: ownPo.id, version: ownPo.version, action: 'RECEIVE', lines: [{ taskId: 'A', accepted: 100, rejected: 0, kind: 'DELIVERY', reason: '' }] } };
  await receive(receipt); await receive(receipt);
  const currentRelations = [...db.values()].filter(row => row.action === 'STOCK_TRANSFER_CURRENT');
  assert.equal(currentRelations.length, 2); assert.equal(currentRelations.every(row => row.status === 'CLOSED'), true);
  assert.equal(currentRelations.find(row => row.details.relation.id !== relation.id).details.relation.repaid, 30);
  assert.equal(db.get('StockProducts:' + operationId('NCT', key)).onHand, 200);
  assert.equal(db.get('StockProducts:' + operationId('NCT', key)).reservedUsable, 200);
  const claimTotals = id => [...db.entries()].filter(([address, row]) => address.startsWith('StockClaims:') && row.taskId === id).reduce((n, [, row]) => n + row.reservedUsable, 0);
  assert.equal(claimTotals('A'), 100); assert.equal(claimTotals('B'), 100);
  assert.deepEqual(f.context.tasks.map(task => task.po), ['PO-A', 'PO-B']); assert.equal((await protocol.readControl()).generation, 4);
});
