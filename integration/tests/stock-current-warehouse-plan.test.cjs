const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createWarehouseOperations, projectWarehouseOrders } = load('warehouseReceiving.js');
const { validateOriginalReceipt } = require('../prototypes/stock-current-state/original-receipt-validation.cjs');
const { prepareWarehouseReceipt } = require('../prototypes/stock-current-state/warehouse-receipt-plan.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const tasks = ['A', 'B'].map(id => ({ id, orderId: 'O', sourceLineId: id, barcode: id, packing: '12', ord: 100, procurement: { totalCtn: 100 } }));
  const orders = projectWarehouseOrders({ company: 'NCT', purchaseOrders: [{ id: 'PO-ID', version: 'V', company: 'NCT', number: 'PO-01', taskIds: ['A', 'B'], customerId: 'C', documents: [] }], tasks, activity: [] });
  const validated = await validateOriginalReceipt({ createWarehouseOperations, company: 'NCT', staff: { staffId: 'W', memberId: 'M', staffName: 'LAW' },
    requestId: '11111111-1111-4111-8111-111111111111', orders, activity: [], now: () => new Date('2026-10-21T18:41:14Z'),
    input: { id: 'PO-ID', version: orders[0].version, action: 'RECEIVE', lines: tasks.map(t => ({ taskId: t.id, accepted: 100, rejected: 0, kind: 'DELIVERY', reason: '' })) } });
  const products = tasks.map(t => {
    const identity = { company: 'NCT', barcode: t.barcode, packing: '12', ea: 12 };
    return { state: { ...identity, complete: true, revision: 0,
      packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { [t.id]: 0 } },
      tasks: [{ ...identity, id: t.id, customerId: 'C', requested: 100, dispatched: 0, orderId: 'O', sourceLineId: t.id }],
      sources: [{ ...identity, id: t.id, ownerTaskId: t.id, poId: 'PO-ID', orderId: 'O', sourceLineId: t.id, poValid: true,
        reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', ownerShare: 100, planned: 100, accepted: 0, onHand: 0, isolated: 0, available: 0, claims: {} }], relations: [] },
      rows: { complete: true, positions: [], claims: [], transfers: [], product: null } };
  });
  return { validated, products, generation: 0 };
}
test('multi-product original receipt stays whole with one product revision each', async () => {
  const f = await fixture(), before = JSON.stringify(f), result = prepareWarehouseReceipt(f);
  assert.equal(JSON.stringify(f), before);
  const receipts = result.plan.writes.filter(w => w.after.action === 'WAREHOUSE_RECEIPT_SAVED');
  assert.equal(receipts.length, 1); assert.deepEqual(receipts[0].after.details, f.validated.event.details);
  assert.equal(result.states.length, 2); assert.deepEqual(result.states.map(s => s.revision), [1, 1]);
  assert.equal(result.plan.writes.filter(w => w.collection === 'StockProducts').length, 2);
  assert.equal(result.plan.writes.filter(w => w.collection === 'StockPositions').reduce((n, w) => n + w.after.onHand, 0), 200);
});
test('missing, duplicate, foreign, unrelated or ambiguous product coverage refuses entire PO save', async () => {
  const f = await fixture();
  assert.throws(() => prepareWarehouseReceipt({ ...f, products: f.products.slice(0, 1) }), /coverage/);
  assert.throws(() => prepareWarehouseReceipt({ ...f, products: [f.products[0], f.products[0]] }), /Duplicate/);
  const foreign = copy(f); foreign.products[1].state.company = 'GHR'; assert.throws(() => prepareWarehouseReceipt(foreign), /company/);
  const unrelated = copy(f); unrelated.products[1].state.sources[0].id = 'OTHER'; assert.throws(() => prepareWarehouseReceipt(unrelated), /Unrelated/);
  const ambiguous = copy(f); ambiguous.products[1].state.sources[0].id = 'A'; assert.throws(() => prepareWarehouseReceipt(ambiguous), /Ambiguous/);
});
test('interruption between products blocks all reads and resumes same single receipt once', async () => {
  const f = await fixture(), result = prepareWarehouseReceipt(f), db = new Map(); let fail = true, prepares = 0;
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => {
      if (c === 'StockProducts' && row.barcode === 'B' && fail) { fail = false; throw Error('Interrupted product B'); }
      if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row);
    }, compareAndSet: async (c, id, version, row) => {
      if (db.get(c + ':' + id)?._version !== version) throw Error('CAS conflict'); db.set(c + ':' + id, copy(row)); return copy(row);
    }, compareAndRemove: async (c, id, attempt) => {
      if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id);
    } };
  const protocol = createFencedProof({ store }); await protocol.initialize();
  const request = { requestId: '22222222-2222-4222-8222-222222222222', memberId: 'M', input: f.validated.event.details,
    prepare: async () => { prepares++; return result.plan; } };
  await assert.rejects(protocol.commit(request), /Interrupted/);
  await assert.rejects(protocol.readSnapshot(async () => [...db.values()]), /pending|progress/i);
  await protocol.commit(request); await protocol.commit(request);
  assert.equal(prepares, 1);
  const snapshot = await protocol.readSnapshot(async () => [...db.values()]);
  assert.equal(snapshot.rows.filter(r => r.action === 'WAREHOUSE_RECEIPT_SAVED').length, 1);
  assert.equal(snapshot.rows.filter(r => r.sourceKind === 'PURCHASE_SOURCE').reduce((n, r) => n + r.onHand, 0), 200);
});
