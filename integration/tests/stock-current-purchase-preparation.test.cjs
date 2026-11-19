const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), load = require('./load-master-module.cjs');
const { createPurchaseStockPreparation } = require('../prototypes/stock-current-state/purchase-stock-preparation.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { createPurchaseSourceOperations, purchaseSourcesVersion } = load('purchaseSources.js');
const { createPurchaseOperations } = load('purchaseOperations.js'), { taskEditVersion } = load('purchaseTaskIdentity.js');
const { requirePurchaseStaff, projectPurchaseWorkspace } = load('purchaseProjection.js'), { operationId } = load('purchaseOperationJournal.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js'), { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js'), { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const copy = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(require.resolve('./purchase-operations.test.cjs'), 'utf8');
const originalFixture = vm.runInNewContext('(' + source.slice(source.indexOf('function fixture(){'), source.indexOf("\ntest('submitted PO blocks")) + ')', { Map, copy, createPurchaseOperations, taskEditVersion, projectPurchaseWorkspace });
function fixture() {
  const f = originalFixture(); f.task().company = 'NCT'; f.task()._version = 'T0';
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'purchase@example.test' };
  const employee = { title: 'P', description: 'M', staffEmail: member.loginEmail, staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['PURCHASE'] };
  let tablesRead = 0, staffRead = 0, queries = 0;
  const deps = { company: 'NCT', readMember: async () => member, readStaffRecords: async () => { staffRead++; return [employee]; }, requirePurchaseStaff,
    readTables: async (company, staff) => { tablesRead++; assert.equal(company, 'NCT'); assert.equal(staff.memberId, 'M');
      return Object.fromEntries(await Promise.all(['NCTOrders', 'NCTTasks', 'NCTActivity', 'SharedSuppliers', 'PurchaseOrders'].map(async c => [c, await f.store.all(c)]))); },
    protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) },
    items: { query: () => { const q = { eq: () => q, ascending: () => q, limit: () => q, find: async () => { queries++; return { items: [], totalCount: 0 }; } }; return q; } },
    store: { read: async () => null }, createPurchaseOperations, createPurchaseSourceOperations, taskEditVersion, operationId, projectPurchaseWorkspace, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, now: () => new Date('2026-10-22T09:00:00Z') };
  const request = { company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111', operation: 'EDIT', staff: { staffId: 'FORGED' },
    input: { edits: [{ taskId: f.id, version: taskEditVersion(f.task()), changes: { lpCtn: 20 } }] } };
  return { f, deps, request, counts: () => ({ tablesRead, staffRead, queries }) };
}
test('real Purchase auth/prepare/projectors and scoped current reads compose one plan without writes', async () => {
  const { f, deps, request, counts } = fixture(), before = JSON.stringify([...f.rows]);
  const saved = await createPurchaseStockPreparation(deps)(request);
  assert.equal(saved.memberId, 'M'); assert.equal(saved.plan.writes.find(w => w.after.action === 'PURCHASE_PRICE_SAVED').after.initiatedByStaffId, 'P');
  assert.equal(saved.plan.writes.filter(w => w.collection === 'StockProducts').length, 1);
  assert.deepEqual(counts(), { tablesRead: 1, staffRead: 1, queries: 3 });
  assert.equal(JSON.stringify([...f.rows]), before);
});
test('pending and wrong-department members never read private Purchase domain or stock rows', async () => {
  for (const variant of ['pending', 'warehouse']) {
    const f = fixture();
    if (variant === 'pending') f.deps.readMember = async () => ({ _id: 'M', status: 'PENDING', loginEmail: 'purchase@example.test' });
    else f.deps.readStaffRecords = async () => [{ title: 'W', description: 'M', staffEmail: 'purchase@example.test', staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] }];
    await assert.rejects(createPurchaseStockPreparation(f.deps)(f.request));
    assert.equal(f.counts().tablesRead, 0); assert.equal(f.counts().queries, 0);
    if (variant === 'pending') assert.equal(f.counts().staffRead, 0);
  }
});
test('pending protocol barrier and original invoice lock stop preparation before current stock reads', async () => {
  const pending = fixture(); pending.deps.protocol.readSnapshot = async () => { throw Error('Pending'); };
  await assert.rejects(createPurchaseStockPreparation(pending.deps)(pending.request), /Pending/); assert.equal(pending.counts().tablesRead, 0);
  const locked = fixture(); locked.f.rows.get('NCTOrders/O0').salesInvoiceNumber = 'INV';
  await assert.rejects(createPurchaseStockPreparation(locked.deps)(locked.request), /locked/); assert.equal(locked.counts().queries, 0);
});

test('original Purchase task/event and stock checkpoint recover as one plan after interrupted save', async () => {
  const f = fixture(); let interrupted = false;
  const read = async (c, id) => copy(f.f.rows.get(c + '/' + id) || null);
  const save = async (c, row, version, insert) => {
    if (c === 'StockProducts' && !interrupted) { interrupted = true; throw Error('Injected checkpoint interruption'); }
    const prior = await read(c, row._id);
    if (insert ? prior !== null : prior?._version !== version) throw Error('Conditional conflict');
    f.f.rows.set(c + '/' + row._id, copy(row)); return copy(row);
  };
  const store = { read, insert: (c, row) => save(c, row, null, true), compareAndSet: (c, id, v, row) => save(c, row, v, false),
    compareAndRemove: async (c, id, attempt) => { if ((await read(c, id))?.attempt !== attempt) throw Error('Wrong execution'); f.f.rows.delete(c + '/' + id); } };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize();
  f.deps.protocol = protocol; f.deps.store = store;
  const prepare = createPurchaseStockPreparation(f.deps), command = { requestId: f.request.requestId, memberId: 'M', input: f.request,
    prepare: async () => (await prepare(f.request)).plan };
  await assert.rejects(protocol.commit(command), /Injected/);
  assert.equal(f.f.task().lpCtn, 20);
  await assert.rejects(protocol.readSnapshot(async () => 'hidden'), /pending/i);
  await protocol.commit(command); await protocol.commit(command);
  assert.equal(f.counts().tablesRead, 1);
  assert.equal([...f.f.rows.values()].filter(r => r.action === 'PURCHASE_PRICE_SAVED').length, 1);
  const result = await protocol.readSnapshot(async () => f.f.task().lpCtn);
  assert.equal(result.generation, 1); assert.equal(result.rows, 20);
});

test('another request, legacy or changed preparation lock is never hidden or deleted', async () => {
  for (const variant of ['foreign', 'legacy', 'changed']) {
    const f = fixture(), id = hash('NCT/PURCHASE', 'LOCK');
    const lock = { _id: id, company: 'NCT', owner: hash('NCT/PURCHASE', f.request.requestId, 'M'), attempt: 'ATTEMPT' };
    if (variant === 'foreign') lock.owner = 'OTHER';
    if (variant === 'legacy') { lock.action = 'PURCHASE_OPERATION_LOCK'; lock.details = { owner: lock.owner }; }
    f.f.rows.set('NCTActivity/' + id, lock);
    f.deps.store.read = async () => variant === 'changed' ? { ...lock, attempt: 'OTHER' } : copy(lock);
    await assert.rejects(createPurchaseStockPreparation(f.deps)(f.request), /not owned/);
    assert.deepEqual(f.f.rows.get('NCTActivity/' + id), lock);
    assert.equal(f.counts().queries, 0);
  }
});

async function sourceFixture() {
  const f = fixture();
  await f.f.operate({ ...f.f.base, operation: 'PLAN', input: { taskId: f.f.id, version: taskEditVersion(f.f.task()),
    transportMode: 'SUPPLIER_DELIVER', planRevision: '', totalCtn: 100, reason: 'First supplier',
    costing: { schema: 1, mode: 'NORMAL', moneySource: 'PRICES', paidCtn: 100, freeCtn: 0, prices: { lpPc: 1, lpCtn: 16, disc1: 0, disc2: 0, disc3: 0 } } } });
  await f.f.operate({ ...f.f.base, requestId: '22222222-2222-4222-8222-222222222222', operation: 'PO', input: {
    taskIds: [f.f.id], versions: f.f.versions(), poNumber: 'NCT-PO-ORIGINAL' } });
  f.request = { company: 'NCT', requestId: '33333333-3333-4333-8333-333333333333', operation: 'ADD_SOURCE',
    staff: { canAddPurchaseSource: false, staffId: 'FORGED' }, input: { action: 'ADD_SOURCE', parentTaskId: f.f.id,
      version: purchaseSourcesVersion(f.f.workspace()), supplierId: 'S', poNumber: 'NCT-PO-SECOND', quantity: 20,
      transportMode: 'SUPPLIER_DELIVER', prices: { lpPc: 1, lpCtn: 16, disc1: 0, disc2: 0, disc3: 0 }, reason: 'Second supplier' } };
  return f;
}
test('actual original ADD_SOURCE feeds stock composition without new receipt or customer demand', async () => {
  const f = await sourceFixture(), before = JSON.stringify([...f.f.rows]);
  const result = await createPurchaseStockPreparation(f.deps)(f.request);
  const task = result.plan.writes.find(w => w.collection === 'NCTTasks').after;
  assert.equal(task.procurementSource, true); assert.equal(task.purchaseQtyInCtn, 0); assert.equal(task.company, 'NCT');
  const events = result.plan.writes.filter(w => w.collection === 'NCTActivity').map(w => w.after);
  assert.equal(events.filter(e => e.action === 'PURCHASE_SOURCE_ADDED').length, 1);
  assert.equal(events.every(e => e.initiatedByStaffId === 'P'), true);
  assert.equal(result.states[0].tasks.find(t => t.id === f.f.id).requested, 250);
  assert.equal(result.states[0].sources.length, 2);
  assert.equal(result.states[0].sources.reduce((n, s) => n + s.onHand, 0), 0);
  assert.equal(result.plan.writes.some(w => w.collection === 'StockClaims'), false);
  assert.equal(JSON.stringify([...f.f.rows]), before);
});
test('original source version, transport, supplier, PO uniqueness and invoice protections remain', async () => {
  for (const variant of ['version', 'transport', 'supplier', 'po', 'invoice']) {
    const f = await sourceFixture();
    if (variant === 'version') f.request.input.version = 'OLD';
    if (variant === 'transport') f.request.input.transportMode = '';
    if (variant === 'supplier') f.request.input.supplierId = 'UNKNOWN';
    if (variant === 'po') f.request.input.poNumber = 'NCT-PO-ORIGINAL';
    if (variant === 'invoice') f.f.rows.get('NCTOrders/O0').salesInvoiceNumber = 'INV';
    const before = JSON.stringify([...f.f.rows]);
    await assert.rejects(createPurchaseStockPreparation(f.deps)(f.request));
    assert.equal(f.counts().queries, 0); assert.equal(JSON.stringify([...f.f.rows]), before);
  }
});

test('original draft source remains nonphysical and FOC share stays outside customer commitment', async () => {
  const draft = await sourceFixture(); draft.request.input.draftPlan = true; draft.request.input.poNumber = '';
  const pending = await createPurchaseStockPreparation(draft.deps)(draft.request);
  assert.equal(pending.states[0].sources.length, 1);
  assert.equal(pending.plan.writes.find(w => w.collection === 'NCTTasks').after.ourPoNumber, '');
  assert.equal(pending.plan.writes.some(w => w.collection === 'StockPositions'), false);
  const f = await sourceFixture(); f.request.input.quantity = 170;
  f.request.input.costing = { schema: 1, mode: 'FOC', moneySource: 'PRICES', paidCtn: 150, freeCtn: 20,
    prices: { lpPc: 1, lpCtn: 16, disc1: 0, disc2: 0, disc3: 0 } };
  const result = await createPurchaseStockPreparation(f.deps)(f.request);
  const sourceId = result.plan.writes.find(w => w.collection === 'NCTTasks').after._id;
  const source = result.states[0].sources.find(s => s.id === sourceId);
  assert.equal(source.planned, 170); assert.equal(source.ownerShare, 150);
  assert.equal(source.accepted, 0); assert.equal(source.onHand, 0);
  assert.equal(result.states[0].tasks.find(t => t.id === f.f.id).requested, 250);
});
