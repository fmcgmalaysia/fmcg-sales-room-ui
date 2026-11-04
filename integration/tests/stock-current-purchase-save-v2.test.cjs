const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createPurchaseStockPreparation } = require('../prototypes/stock-current-state/purchase-stock-preparation.cjs');
const { createCurrentPurchaseSave } = require('../prototypes/stock-current-state/current-department-saves.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const filename = require.resolve('./stock-current-purchase-preparation.test.cjs');
const fixtureSource = fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}');
const fixtures = vm.runInNewContext(fixtureSource + '\n({fixture,sourceFixture});', { require: createRequire(filename), Buffer, Map });
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(source = false) {
  const f = source ? await fixtures.sourceFixture() : fixtures.fixture(), db = f.f.rows;
  const store = { read: async (c, id) => copy(db.get(c + '/' + id) || null), insert: async (c, row) => {
    if (db.has(c + '/' + row._id)) throw Error('Duplicate'); db.set(c + '/' + row._id, copy(row)); return copy(row);
  }, compareAndSet: async (c, id, version, row) => {
    if (db.get(c + '/' + id)?._version !== version) throw Error('Conflict'); db.set(c + '/' + id, copy(row)); return copy(row);
  }, compareAndRemove: async (c, id, attempt) => { if (db.get(c + '/' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + '/' + id); } };
  const protocol = createSegmentedFencedProof({ store, domainWrites: true, stepsPerInvocation: 100 }); await protocol.initialize();
  Object.assign(db.get('NCTActivity/' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  const [raw] = [...db.entries()].filter(([key]) => key.startsWith('NCTTasks/')).map(([, row]) => row);
  for (const [id, row] of db) if (id.startsWith('NCTTasks/')) Object.assign(row, { stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: 0 });
  const context = require('./load-master-module.cjs')('purchaseProjection.js').projectPurchaseWorkspace({ company: 'NCT', staff: {},
    orders: [...db.entries()].filter(([k]) => k.startsWith('NCTOrders/')).map(([, r]) => r),
    tasks: [...db.entries()].filter(([k]) => k.startsWith('NCTTasks/')).map(([, r]) => r),
    activity: [...db.entries()].filter(([k]) => k.startsWith('NCTActivity/')).map(([, r]) => r), suppliers: [] });
  const task = context.tasks.find(t => t.id === raw._id), identity = { company: 'NCT', barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
  db.set('StockProducts/' + hash('NCT', key), { ...identity, _id: hash('NCT', key), _version: 'P0', stockKey: key,
    lifecycleVersion: 2, nextBorrowSequence: 1, revision: 0, checkpointGeneration: 0,
    status: 'CLOSED', reviewCodes: [], reviewRequired: false, onHand: 0, available: 0, reservedUsable: 0, isolated: 0 });
  const items = { query: c => { const filters = []; let limit; const q = { eq: (key, value) => { filters.push(row => row[key] === value); return q; },
    gt: (key, value) => { filters.push(row => row[key] > value); return q; }, ascending: () => q, limit: n => { limit = n; return q; }, find: async () => {
      const rows = [...db.entries()].filter(([key, row]) => key.startsWith(c + '/') && filters.every(fn => fn(row))).map(([, row]) => copy(row)).sort((a, b) => a._id.localeCompare(b._id));
      return { items: rows.slice(0, limit), totalCount: rows.length }; } }; return q; } };
  const deps = { ...f.deps, protocol, store, items, readCurrentTaskRows: async (_company, ids) => ids.map(id => copy(db.get('NCTTasks/' + id))) };
  const coverage = Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }]));
  return { ...f, db, deps, protocol, coverage, key, save: createCurrentPurchaseSave({ company: 'NCT', protocol, store, items, coverage, authorityDependencies: deps }) };
}
test('concrete current Purchase EDIT uses scoped lifecycle plus unchanged original validation and once-only retry', async () => {
  const f = await fixture(), request = { ...f.request, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 };
  assert.equal((await f.save(request)).stockGeneration, 1); await f.save(request);
  assert.equal(f.f.task().lpCtn, 20); assert.equal(f.f.task().stockDispatchedCumulative, 0);
  assert.equal([...f.db.values()].filter(row => row.action === 'PURCHASE_PRICE_SAVED').length, 1);
  assert.equal(f.db.get('StockProducts/' + hash('NCT', f.key)).lifecycleVersion, 2);
  assert.equal(f.counts().tablesRead, 1);
});
test('current ADD_SOURCE initializes only new task checkpoint, no copied receipt or customer demand', async () => {
  const f = await fixture(true), before = JSON.stringify([...f.db]);
  const prepared = await createPurchaseStockPreparation(f.deps)(f.request);
  const newTask = prepared.plan.writes.find(w => w.collection === 'NCTTasks' && w.before === null).after;
  assert.equal(newTask.stockCounterSchema, 2); assert.equal(newTask.stockDispatchedCumulative, 0);
  assert.equal(newTask.stockCounterGeneration, 1); assert.equal(newTask.purchaseQtyInCtn, 0);
  assert.equal(prepared.states[0].lifecycleVersion, 2);
  assert.equal(prepared.states[0].sources.length, 1, 'unrelated closed original PO need not enter this operational scope');
  assert.equal(prepared.states[0].sources[0].id, newTask._id);
  assert.equal(prepared.plan.writes.some(w => w.collection === 'StockClaims'), false);
  assert.equal(JSON.stringify([...f.db]), before);
  const request = { ...f.request, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0 };
  const result = await f.save(request);
  assert.equal(result.sourceTaskId, newTask._id); assert.equal(result.parentTaskId, f.request.input.parentTaskId);
  assert.deepEqual(await f.save(request), result);
  assert.equal([...f.db.values()].filter(r => r._id === result.sourceTaskId).length, 1);
});
test('current missing checkpoint/task counter and unconnected operations cannot fall back to old writer', async () => {
  const f = await fixture(); delete f.f.task().stockCounterSchema;
  await assert.rejects(createPurchaseStockPreparation(f.deps)(f.request), /checkpoint/);
  const g = await fixture(); g.db.delete('StockProducts/' + hash('NCT', g.key));
  await assert.rejects(createPurchaseStockPreparation(g.deps)(g.request), /product checkpoint/);
  for (const operation of ['REORDER', 'SPECIAL', 'ARCHIVE', 'ASSIGN']) await assert.rejects(g.save({ ...g.request, operation }), /Supported/);
});

async function quantityFixture() {
  const f = await fixture(), employees = await f.deps.readStaffRecords();
  f.deps.readStaffRecords = async () => employees.map(row => ({ ...row, role: 'SUPER ADMIN' }));
  // Both authentication and preparation read this exact server-owned function.
  f.save = createCurrentPurchaseSave({ company: 'NCT', protocol: f.protocol, store: f.deps.store,
    items: f.deps.items, coverage: f.coverage, authorityDependencies: f.deps });
  f.request = { company: 'NCT', requestId: f.request.requestId, operation: 'QTY', stockProtocol: 1,
    stockBuild: 'TEST', stockGeneration: 0, input: { taskId: f.f.id,
      version: f.deps.taskEditVersion(f.f.task()), quantity: 240, reason: 'Original administrator commitment reduction' } };
  return f;
}
test('original Super Admin QTY reduces only procurement commitment once, not Sales demand or physical stock', async () => {
  const f = await quantityFixture(), prepared = await createPurchaseStockPreparation(f.deps)(f.request);
  assert.equal(prepared.states[0].tasks.find(t => t.id === f.f.id).requested, 250);
  assert.equal(prepared.plan.writes.some(w => ['StockPositions','StockClaims'].includes(w.collection)), false);
  const saved = await f.save(f.request); assert.equal(saved.stockGeneration, 1);
  assert.equal(saved.operation, 'QTY'); assert.deepEqual(copy(saved.taskIds), [f.f.id]);
  assert.equal(f.f.task().purchaseQtyInCtn, 240); assert.equal(f.f.task().stockDispatchedCumulative, 0);
  const workspace = f.f.workspace(); assert.equal(workspace.tasks.find(t => t.id === f.f.id).requested, 250);
  const events = [...f.db.values()].filter(r => r.action === 'PURCHASE_QTY_REDUCED');
  assert.equal(events.length, 1); assert.equal(events[0].details.authorizedRole, 'SUPER ADMIN');
  assert.equal(events[0].initiatedByStaffId, 'P'); assert.deepEqual(await f.save(f.request), saved);
});
test('current QTY retains original role, version, invoice, receipt and reduction-only protections', async () => {
  for (const variant of ['role','version','invoice','receipt','increase','zero','reason']) {
    const f = await quantityFixture();
    if (variant === 'role') f.deps.readStaffRecords = async () => [{ title: 'P', description: 'M', staffEmail: 'purchase@example.test',
      staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['PURCHASE'], role: 'PURCHASE' }];
    if (variant === 'version') f.request.input.version = 'OLD';
    if (variant === 'invoice') f.db.get('NCTOrders/O0').salesInvoiceNumber = 'INV';
    if (variant === 'receipt') { f.f.task().receivedQtyInCtn = 245; f.request.input.version = f.deps.taskEditVersion(f.f.task()); }
    if (variant === 'increase') f.request.input.quantity = 251;
    if (variant === 'zero') f.request.input.quantity = 0;
    if (variant === 'reason') f.request.input.reason = '';
    const before = copy(f.f.task());
    await assert.rejects(f.save(f.request), undefined, variant); assert.deepEqual(copy(f.f.task()), before);
    assert.equal([...f.db.values()].some(r => r.action === 'PURCHASE_QTY_REDUCED'), false);
    assert.equal((await f.protocol.readControl()).generation, 0);
  }
});
test('interrupted QTY resumes exact original plan; revoked administrator cannot replay a committed result', async () => {
  const f = await quantityFixture(), originalCas = f.deps.store.compareAndSet; let interrupted = false;
  f.deps.store.compareAndSet = async (collection, id, version, row) => {
    if (!interrupted && collection === 'StockProducts') { interrupted = true; throw Error('Interrupted QTY checkpoint'); }
    return originalCas(collection, id, version, row);
  };
  await assert.rejects(f.save(f.request), /Interrupted QTY checkpoint/);
  assert.equal(f.f.task().purchaseQtyInCtn, 240);
  await assert.rejects(f.protocol.readSnapshot(() => 'not actionable'), /pending/i);
  const result = await f.save(f.request); assert.equal(result.stockGeneration, 1);
  assert.equal([...f.db.values()].filter(r => r.action === 'PURCHASE_QTY_REDUCED').length, 1);
  f.deps.readStaffRecords = async () => [{ title: 'P', description: 'M', staffEmail: 'purchase@example.test', staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['PURCHASE'], role: 'PURCHASE' }];
  await assert.rejects(f.save(f.request), /Only Super Admin/);
});

test('GHR original administrator QTY uses only its company tables and keeps the same demand semantics', async () => {
  const f = await quantityFixture(), db = f.db, taskId = f.f.id;
  for (const [key, row] of [...db]) {
    if (/^NCT(Orders|Tasks)\//.test(key) || key === 'NCTActivity/R') {
      const mapped = key.replace(/^NCT(Orders|Tasks)\//, 'NCT$11/').replace('NCTActivity/R', 'NCTActivity1/R');
      db.set(mapped, { ...copy(row), company: 'GHR' });
    }
  }
  const identity = { company: 'GHR', barcode: 'B0', packing: '16EA', ea: 16 }, key = stockKey(identity), id = hash('GHR', key);
  db.set('StockProducts/'+id, { ...identity, _id: id, _version: 'G0', stockKey: key, lifecycleVersion: 2,
    nextBorrowSequence: 1, revision: 0, checkpointGeneration: 0, status: 'CLOSED', reviewCodes: [], reviewRequired: false,
    onHand: 0, available: 0, reservedUsable: 0, isolated: 0 });
  const protocol = createSegmentedFencedProof({ company: 'GHR', store: f.deps.store, domainWrites: true, stepsPerInvocation: 100 });
  await protocol.initialize(); Object.assign(db.get('NCTActivity1/'+protocol.ids.controlId), {
    mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  const deps = { ...f.deps, company: 'GHR', protocol,
    readTables: async company => { assert.equal(company, 'GHR'); return Object.fromEntries(
      ['NCTOrders1','NCTTasks1','NCTActivity1','PurchaseOrders','SharedSuppliers'].map(c => [c,
        [...db].filter(([k]) => k.startsWith(c+'/')).map(([,r]) => copy(r))])); },
    readCurrentTaskRows: async (company, ids) => { assert.equal(company, 'GHR'); return ids.map(id => copy(db.get('NCTTasks1/'+id))); } };
  const save = createCurrentPurchaseSave({ company: 'GHR', protocol, items: deps.items, store: deps.store,
    coverage: f.coverage, authorityDependencies: deps }), original = copy(db.get('NCTTasks/'+taskId));
  const result = await save({ ...f.request, company: 'GHR' });
  assert.equal(result.company, 'GHR'); assert.equal(db.get('NCTTasks1/'+taskId).purchaseQtyInCtn, 240);
  assert.deepEqual(copy(db.get('NCTTasks/'+taskId)), original); assert.equal((await f.protocol.readControl()).generation, 0);
  assert.equal([...db].filter(([k,r]) => k.startsWith('NCTActivity1/') && r.action === 'PURCHASE_QTY_REDUCED').length, 1);
});

async function borrowingQuantityFixture() {
  const f = await quantityFixture(), a = f.f.id, b = f.f.second;
  f.f.task().ourPoNumber = 'PO-A';
  const other = f.f.task(b); Object.assign(other, { company: 'NCT', _version: 'B0', purchaseQtyInCtn: 100, ourPoNumber: 'PO-B' });
  Object.assign(f.db.get('NCTOrders/O1'), { customerId: 'OTHER_CUSTOMER', description: 'B0', orderQtyInCtn: 100 });
  const event = (id, task, total) => ({ _id: id, title: id, description: 'ORDER', image: task.imageAltText, imageAltText: task.title,
    action: 'PURCHASE_PLAN_SAVED', result: 'SAVED', activityTime: '2026-10-22T00:00:00Z',
    details: { beforeRevision: '', totalCtn: total, extraCtn: 0, transportMode: 'SUPPLIER_DELIVER' } });
  f.db.set('NCTActivity/PLAN-A', event('PLAN-A', f.f.task(), 250));
  f.db.set('NCTActivity/PLAN-B', event('PLAN-B', other, 100));
  for (const [id, sourceId, totalCtn] of [['SHARE-A',a,250],['SHARE-B',b,100]]) f.db.set('NCTActivity/'+id, {
    _id: id, title: id, description: 'ORDER', imageAltText: sourceId, action: 'PURCHASE_SOURCE_SHARES_SAVED', result: 'SAVED',
    details: { beforeRevision: '', shares: [{ taskId: sourceId, totalCtn, customerCtn: 100 }] } });
  f.db.set('NCTActivity/RECEIPT-B', { _id: 'RECEIPT-B', title: 'RECEIPT-B', description: hash('NCT','PURCHASE_ORDER',[b]),
    action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED', activityTime: '2026-10-22T01:00:00Z', details: { beforeRevision: '', lines: [
      { taskId: b, orderId: 'ORDER', sourceLineId: 'L1', beforeAccepted: 0, beforeRejected: 0, accepted: 100, rejected: 0 } ] } });
  const base = { company: 'NCT', stockKey: f.key, revision: 0, status: 'ACTIVE', _version: 'S0', reviewCodes: [] },
    position = hash('NCT',f.key,'PURCHASE_SOURCE',b), relationId = hash('NCT','STOCK_TRANSFER_CURRENT','REL');
  f.db.set('StockPositions/'+position, { ...base, _id: position, sourceTaskId: b, poId: hash('NCT','PURCHASE_ORDER',[b]),
    receiptAccepted: 100, borrowRepaidCumulative: 0, replacementReceived: 0, supplierReturned: 0, dispatched: 0,
    onHand: 100, isolated: 0, available: 0, reservedUsable: 100 });
  for (const [taskId, customerId, qty] of [[a,'C',30],[b,'OTHER_CUSTOMER',70]]) {
    const id = hash('NCT',position,taskId); f.db.set('StockClaims/'+id, { ...base, _id: id, positionId: position,
      taskId, customerId, orderId: 'ORDER', sourceLineId: taskId === a ? 'L0' : 'L1',
      reservedUsable: qty, isolatedAttributed: 0, dispatchedCumulative: 0 });
  }
  f.db.set('NCTActivity/'+relationId, { ...base, _id: relationId, title: 'REL', action: 'STOCK_TRANSFER_CURRENT',
    lenderSourceId: b, replacementSourceId: a, repaidQuantity: 0, participantTaskIds: [b,a], details: { relation: {
      id: 'REL', sequence: 1, lenderSourceId: b, replacementSourceId: a, lenderTaskId: b, borrowerTaskId: a,
      quantity: 30, repaid: 0, returned: 0, approvedBy: 'P', reason: 'Approved first shipment' } } });
  Object.assign(f.db.get('StockProducts/'+hash('NCT',f.key)), { status: 'ACTIVE', nextBorrowSequence: 2,
    onHand: 100, reservedUsable: 100 });
  f.request.input.version = f.deps.taskEditVersion(f.f.task()); return { ...f, relationId };
}
test('administrator QTY cannot erase approved future repayment; allowed reduction preserves both current ownership and debt', async () => {
  const bad = await borrowingQuantityFixture(); bad.request.input.quantity = 25;
  await assert.rejects(bad.save(bad.request), /saved supplier customer shares/);
  assert.equal(bad.f.task().purchaseQtyInCtn, 250);
  const f = await borrowingQuantityFixture(), stock = copy([...f.db].filter(([k]) => /^Stock(Positions|Claims)\//.test(k))),
    relation = copy(f.db.get('NCTActivity/'+f.relationId));
  const result = await f.save(f.request); assert.equal(result.stockGeneration, 1);
  assert.deepEqual([...f.db].filter(([k]) => /^Stock(Positions|Claims)\//.test(k)), stock);
  assert.deepEqual(f.db.get('NCTActivity/'+f.relationId), relation);
  assert.equal(f.f.task().purchaseQtyInCtn, 240);
});
