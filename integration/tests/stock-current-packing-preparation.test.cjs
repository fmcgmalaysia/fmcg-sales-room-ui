const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createPackingStockPreparation } = require('../prototypes/stock-current-state/packing-stock-preparation.cjs');
const { requirePackingStaff, projectPackingContext } = load('packingListContext.js');
const { createPackingListOperations, readPackingLists, packingVersion, projectPackingWorkroom } = load('packingListOperations.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js'), { readAllocations } = load('plannerAllocation.js');
const { readCustomerShipments } = load('customerShipmentLedger.js'), { packingHeld } = load('packingListModel.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
function fixture() {
  const identity = { company: 'NCT', barcode: '1', packing: '12x1', ea: 12 }, key = stockKey(identity);
  const context = { company: 'NCT', suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: [{ id: 'C', name: 'Customer' }], allocations: [], activity: [],
    tasks: [{ ...identity, id: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', name: 'Item', requested: 50, ord: 50, inc: 999,
      po: 'PO1', supplierId: 'SUP', lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [], transactionCurrency: 'USD',
      procurement: { totalCtn: 50, customerCtn: 50 }, warehouse: { hasPhysicalReceipt: true, accepted: 50, stock: { availablePhysical: 50 } } }] };
  const list = { id: 'LIST', company: 'NCT', customerId: 'C', customerName: 'Customer', currency: 'USD', revision: 'REV0', status: 'DRAFT',
    lines: [{ taskId: 'T', quantity: 50, packed: 0, loaded: 0, reason: '', photos: [] }] };
  const po = projectPurchaseOrders({ company: 'NCT', workspace: context, records: [] })[0], positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'T');
  const db = new Map(), put = (c, row) => db.set(c + ':' + row._id, copy(row));
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
  put('StockPositions', { ...base, _id: positionId, sourceTaskId: 'T', poId: po.id, receiptAccepted: 50, replacementReceived: 0,
    dispatched: 0, onHand: 50, available: 0, isolated: 0, reservedUsable: 50 });
  put('StockClaims', { ...base, _id: hash('NCT', positionId, 'T'), positionId, taskId: 'T', customerId: 'C', reservedUsable: 50, isolatedAttributed: 0 });
  put('StockProducts', { ...base, _id: hash('NCT', key), onHand: 50, available: 0, isolated: 0, reservedUsable: 50, reviewRequired: false });
  put('NCTActivity', { _id: hash('NCT', 'LIST', 'PACKING_CURRENT'), _version: 'LIST0', company: 'NCT', title: 'LIST', description: 'LIST',
    action: 'SUPPORT_PACKING_LIST_CURRENT', result: 'SAVED', details: { list } });
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'support@example.test' };
  const employee = { title: 'S', description: 'M', staffEmail: member.loginEmail, staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['SUPPORT', 'WAREHOUSE'] };
  let contextReads = 0, staffReads = 0;
  const deps = { company: 'NCT', readMember: async () => member, readStaffRecords: async () => { staffReads++; return [employee]; }, requirePackingStaff,
    readContext: async (company, staff) => { contextReads++; assert.equal(company, 'NCT'); assert.equal(staff.memberId, 'M');
      return { ...copy(context), activity: [...db.entries()].filter(([id]) => id.startsWith('NCTActivity:')).map(([, row]) => copy(row)) }; },
    readPurchaseRecords: async () => [], projectPurchaseOrders, projectPackingContext, createPackingListOperations, readAllocations, readCustomerShipments,
    readPackingLists, packingHeld, now: () => new Date('2026-10-22T11:00:00Z'),
    store: { read: async (c, id) => copy(db.get(c + ':' + id) || null) }, protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) },
    items: { query: c => { const filters = [], q = { eq: (k, v) => { filters.push([k, v]); return q; }, ascending: () => q, limit: () => q,
      find: async () => { const items = [...db.entries()].filter(([id, row]) => id.startsWith(c + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => copy(row)); return { items, totalCount: items.length }; } }; return q; } } };
  const request = { company: 'NCT', department: 'SUPPORT', requestId: '11111111-1111-4111-8111-111111111111', staff: { staffId: 'FORGED' } };
  return { db, context, deps, request, counts: () => ({ contextReads, staffReads }) };
}
test('original auth/PO/packing projectors and current reads prepare exact list plus checkpoint without writes', async () => {
  const f = fixture(), before = JSON.stringify([...f.db]), service = createPackingStockPreparation(f.deps), read = await service.read(f.request);
  assert.equal(read.context.tasks[0].ready, 50); assert.equal(read.memberId, 'M');
  assert.equal(projectPackingWorkroom(read.context, 'WAREHOUSE').lists.length, 0);
  const saved = await service.prepare({ ...f.request, input: { action: 'SEND', id: 'LIST', revision: 'REV0', version: packingVersion(read.context) } });
  assert.equal(saved.plan.writes[0].after.initiatedByStaffId, 'S'); assert.equal(saved.plan.writes[0].after.details.list.status, 'SENT');
  assert.equal(saved.states[0].packingHolds.heldByTask.T, 50); assert.equal(saved.plan.writes.length, 2);
  assert.equal(JSON.stringify([...f.db]), before);
});
test('pending or wrong-department staff fail before private context; photos never allocate files', async () => {
  const f = fixture(); f.deps.readMember = async () => ({ _id: 'M', loginEmail: 'support@example.test', status: 'PENDING' });
  await assert.rejects(createPackingStockPreparation(f.deps).read(f.request)); assert.deepEqual(f.counts(), { contextReads: 0, staffReads: 0 });
  const g = fixture(); g.deps.readStaffRecords = async () => [{ title: 'P', description: 'M', staffEmail: 'support@example.test', staffName: 'P', staffStatus: 'ACTIVE', departments: ['PURCHASE'] }];
  await assert.rejects(createPackingStockPreparation(g.deps).read(g.request)); assert.equal(g.counts().contextReads, 0);
  const h = fixture(); await assert.rejects(createPackingStockPreparation(h.deps).prepare({ ...h.request, input: { action: 'PHOTOS' } }), /non-photo/);
  assert.deepEqual(h.counts(), { contextReads: 0, staffReads: 0 });
});
test('pending barrier, changed stored list and unknown current stock never fall back to legacy Ready', async () => {
  const f = fixture(); f.deps.protocol.readSnapshot = async () => { throw Error('Pending'); };
  await assert.rejects(createPackingStockPreparation(f.deps).read(f.request), /Pending/); assert.equal(f.counts().contextReads, 0);
  const g = fixture(), service = createPackingStockPreparation(g.deps), read = await service.read(g.request), originalRead = g.deps.store.read;
  g.deps.store.read = async (c, id) => { const row = await originalRead(c, id); return row?.action === 'SUPPORT_PACKING_LIST_CURRENT' ? { ...row, details: { list: { ...row.details.list, revision: 'OTHER' } } } : row; };
  await assert.rejects(service.prepare({ ...g.request, input: { action: 'SEND', id: 'LIST', revision: 'REV0', version: packingVersion(read.context) } }), /record changed/);
  const h = fixture(); const product = [...h.db.values()].find(r => r._id === hash('NCT', stockKey(h.context.tasks[0]))); product.reviewRequired = true;
  await assert.rejects(createPackingStockPreparation(h.deps).read(h.request));
});

test('incomplete, review-marked or foreign current rows refuse rather than produce usable quantity', async () => {
  for (const variant of ['missingProduct', 'foreign', 'reviewPosition', 'reviewCodes', 'version']) {
    const f = fixture(), productId = 'StockProducts:' + hash('NCT', stockKey(f.context.tasks[0])), product = f.db.get(productId);
    if (variant === 'missingProduct') f.db.delete(productId);
    if (variant === 'foreign') product.company = 'GHR';
    if (variant === 'reviewCodes') product.reviewCodes = ['UNRECONCILED'];
    if (variant === 'version') delete product._version;
    if (variant === 'reviewPosition') [...f.db.entries()].find(([id]) => id.startsWith('StockPositions:'))[1].reviewRequired = true;
    await assert.rejects(createPackingStockPreparation(f.deps).read(f.request), /review|conflict/i);
  }
});

test('Support SEND then Warehouse START share one fenced list, replay without extra stock movement', async () => {
  const f = fixture(), store = { ...f.deps.store };
  store.insert = async (c, row) => { const id = c + ':' + row._id; if (f.db.has(id)) throw Error('Duplicate'); f.db.set(id, copy(row)); return copy(row); };
  store.compareAndSet = async (c, id, v, row) => { if (f.db.get(c + ':' + id)?._version !== v) throw Error('Conditional conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row); };
  store.compareAndRemove = async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); f.db.delete(c + ':' + id); };
  const protocol = createFencedProof({ store }); await protocol.initialize(); f.deps.protocol = protocol; f.deps.store = store;
  const service = createPackingStockPreparation(f.deps);
  for (const [i, action, department] of [[1, 'SEND', 'SUPPORT'], [2, 'START', 'WAREHOUSE']]) {
    const read = await service.read({ company: 'NCT', department }), list = read.context.lists[0];
    const request = { company: 'NCT', department, requestId: String(i).padStart(8, '0') + '-1111-4111-8111-111111111111',
      input: { action, id: list.id, revision: list.revision, version: packingVersion(read.context) } };
    const command = { requestId: request.requestId, memberId: 'M', input: request, prepare: async () => (await service.prepare(request)).plan };
    await protocol.commit(command); await protocol.commit(command);
  }
  const current = await service.read({ company: 'NCT', department: 'WAREHOUSE' });
  assert.equal(current.generation, 2); assert.equal(current.context.lists.length, 1); assert.equal(current.context.lists[0].status, 'PROCESSING');
  assert.equal([...f.db.values()].filter(r => r.action === 'SUPPORT_PACKING_LIST_CURRENT').length, 1);
  const product = [...f.db.entries()].find(([id]) => id.startsWith('StockProducts:'))[1];
  assert.equal(product.onHand, 50); assert.equal(product.reservedUsable, 50); assert.equal(product.available, 0);
});
