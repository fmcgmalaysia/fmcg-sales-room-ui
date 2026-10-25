const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createWarehouseAuthority } = require('../prototypes/stock-current-state/warehouse-authority.cjs');
const { prepareWarehouseReceipt } = require('../prototypes/stock-current-state/warehouse-receipt-plan.cjs');
const { prepareBorrowingReceipt } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { readCurrentProduct } = require('../prototypes/stock-current-state/current-product-reader.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } = load('warehouseReceiving.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { readAllocations } = load('plannerAllocation.js'), { readCustomerShipments } = load('customerShipmentLedger.js');
const { readPackingLists } = load('packingListOperations.js'), { packingHeld } = load('packingListModel.js');
const company = 'NCT', requestId = '11111111-1111-4111-8111-111111111111', emptyRows = () => ({ complete: true, positions: [], claims: [], transfers: [], product: null });
async function receipt(lines, nameRepeat = 1) {
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'w@example.test' };
  const employee = { title: 'W', description: 'M', staffEmail: member.loginEmail, staffName: 'Warehouse', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] };
  const context = { company, activity: [], suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: [{ id: 'C', name: 'Customer' }],
    tasks: Array.from({ length: lines }, (_, i) => ({ id: 'T' + i, company, customerId: 'C', orderId: 'O', sourceLineId: 'L' + i,
      barcode: String(i), name: '巧克力饼干 CHOCOLATE BISCUITS '.repeat(nameRepeat) + i, packing: '12x1', ea: 12, requested: 100, ord: 100, po: 'PO-300', supplierId: 'SUP',
      lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: 100, customerCtn: 100 }, warehouse: null })) };
  const purchaseOrders = projectPurchaseOrders({ company, workspace: context, records: [] });
  const orders = projectWarehouseOrders({ company, purchaseOrders, tasks: context.tasks, activity: [] });
  const authority = await createWarehouseAuthority({ readMember: async () => member, readStaffRecords: async () => [employee], requireWarehouseStaff,
    readContext: async () => context, readPurchaseRecords: async () => [], projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, now: () => new Date('2026-10-22T00:00:00Z') })({ company, requestId,
    input: { id: orders[0].id, version: orders[0].version, action: 'RECEIVE', lines: context.tasks.map(task => ({ taskId: task.id, accepted: 100, rejected: 0, kind: 'DELIVERY', reason: '' })) } });
  return { validated: authority.validated, generation: 0, products: authority.products.map(p => { const rows = emptyRows(); return { rows, state: p.buildState(rows) }; }) };
}
// These PASS by proving a release blocker, NOT that production capacity is accepted.
test('original ten-line PO receipt is valid but requires31current writes and proof envelope rejects it', async () => {
  const input = await receipt(10); assert.equal(input.validated.event.details.lines.length, 10);
  await assert.rejects(async () => prepareWarehouseReceipt(input), /atomic proof bound/);
});
test('original300line receipt remains valid; measure exact current images rather than raising30arbitrarily', async t => {
  for (const nameRepeat of [1, 3]) {
  const input = await receipt(300, nameRepeat), event = input.validated.event;
  assert.equal(event.details.lines.length, 300);
  const writes = [{ collection: 'NCTActivity', before: null, after: { ...event, company } }];
  for (const product of input.products) {
    const scoped = { ...event, details: { ...event.details, lines: event.details.lines.filter(line => product.state.sources.some(source => source.id === line.taskId)) } };
    const result = prepareBorrowingReceipt({ ...product, event: scoped, generation: 0 });
    writes.push(...result.plan.writes.filter(write => write.after.action !== 'WAREHOUSE_RECEIPT_SAVED'));
  }
  const operationId = hash(company + '/PURCHASE', requestId, 'M');
  for (const write of writes) write.after._version = hash(operationId, write.collection, write.after._id);
  const bytes = Buffer.byteLength(JSON.stringify({ writes }), 'utf8');
  assert.equal(writes.length, 901); assert.ok(bytes > 180000);
  t.diagnostic(JSON.stringify({ originalReceiptLines: 300, productNameRepeat: nameRepeat, currentWriteImages: writes.length, planUtf8Bytes: bytes, proofLimitBytes: 180000, singleItemRequestDocumentedBytes: 512 * 1024 }));
  if (nameRepeat === 3) assert.ok(bytes > 512 * 1024, 'valid original product descriptions can exceed the single-record request bound');
  assert.throws(() => prepareWarehouseReceipt(input), /atomic proof bound/);
  }
});
test('fifteen settled old sources already block unrelated new product mutation under current proof reader', async () => {
  const identity = { company, barcode: '1', packing: '12', ea: 12 }, key = JSON.stringify([company, '1', '12', 12]);
  const rows = Array.from({ length: 15 }, (_, i) => ({ _id: 'OLD' + i, company, stockKey: key, status: 'CLOSED', onHand: 0, reservedUsable: 0, available: 0, isolated: 0 }));
  const items = { query: collection => { assert.equal(collection, 'StockPositions'); const q = { eq: () => q, ascending: () => q, limit: () => q,
    find: async () => ({ items: rows, totalCount: rows.length }) }; return q; } };
  await assert.rejects(readCurrentProduct({ company, identity, items, store: { read: async () => { throw Error('Must reject before exact reads'); } }, metrics: { queries: 0, exactReads: 0 } }), /Incomplete bounded/);
});

test('segmented candidate commits actual original300line receipt once, without splitting PO/business event', async () => {
  const original = await receipt(300, 3), candidate = prepareWarehouseReceipt({ ...original, planFormat: 'SEGMENTED_V2' });
  assert.equal(candidate.plan.writes.length, 901);
  assert.equal(candidate.plan.writes.filter(w => w.after.action === 'WAREHOUSE_RECEIPT_SAVED').length, 1);
  const rows = new Map(), copy = x => JSON.parse(JSON.stringify(x));
  const store = { read: async (c, id) => copy(rows.get(c + '/' + id) || null),
    insert: async (c, row) => { const key = c + '/' + row._id; if (rows.has(key)) throw Error('Duplicate'); rows.set(key, copy(row)); },
    compareAndSet: async (c, id, version, row) => { if (rows.get(c + '/' + id)?._version !== version) throw Error('Conflict'); rows.set(c + '/' + id, copy(row)); },
    compareAndRemove: async (c, id, attempt) => { if (rows.get(c + '/' + id)?.attempt !== attempt) throw Error('Wrong attempt'); rows.delete(c + '/' + id); } };
  const protocol = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs').createSegmentedFencedProof({ store, stepsPerInvocation: 100 });
  await protocol.initialize(); let prepares = 0, result;
  const command = { requestId, memberId: 'M', input: original.validated.event.details, prepare: async () => { prepares++; return candidate.plan; } };
  for (let i = 0; i < 40; i++) { result = await protocol.commit(command); if (result.ok) break; assert.equal(result.pending, true); }
  assert.equal(result.ok, true); assert.equal(prepares, 1); assert.equal((await protocol.readControl()).generation, 1);
  await protocol.commit(command); assert.equal(prepares, 1);
  assert.equal([...rows.values()].filter(r => r.action === 'WAREHOUSE_RECEIPT_SAVED').length, 1);
  assert.equal([...rows.keys()].filter(k => k.startsWith('StockPositions/')).length, 300);
  assert.equal([...rows.entries()].filter(([k]) => k.startsWith('StockProducts/')).reduce((n, [, row]) => n + row.onHand, 0), 30000);
});
