const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { prepareCostReference } = require('../prototypes/stock-current-state/cost-reference-plan.cjs');
const { createPurchaseCostRetry } = load('purchaseCostRetry.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { domainCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(company = 'NCT') {
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', taskId = 'a'.repeat(32);
  const original = { unitBarcode: 'B', costCurrency: 'MYR', lpPc: null, lpCtn: null, disc1: null, disc2: null, disc3: null,
    costStatus: 'ERROR', costIssues: ['POINTBASE_SERVICE_UNAVAILABLE'] };
  const task = { _id: taskId, title: taskId, company, _version: 'T0', description: 'O', imageAltText: 'L', originalCostSnapshot: original,
    latestCostReference: original, lpPc: null, lpCtn: null, disc1: null, disc2: null, disc3: null, manualCostField: [],
    supplierId: 'SUP', ourPoNumber: 'PO', purchaseQtyInCtn: 100, receivedQtyInCtn: 80, rowPosition: 7 };
  const order = { _id: 'ORDER', company, _version: 'O0', title: 'O', description: 'B', sourceLineId: 'L', submissionId: 'SUB', cbmCtn: null, sellingPricePc: 14 };
  const tables = { [orders]: [order], [tasks]: [task], [journal]: [{ _id: 'RECEIPT', title: 'RECEIPT', description: 'O', action: 'ORDER_RECEIVED', result: 'ACCEPTED', details: { submissionId: 'SUB', taskIds: [taskId] } }] };
  const request = { company, taskId, requestId: '11111111-1111-4111-8111-111111111111', staff: { staffId: 'P', staffName: 'Purchase', memberId: 'M' } };
  let captures = 0;
  const args = { createPurchaseCostRetry, request, tables, now: () => new Date('2026-10-22T02:00:00Z'), captureCosts: async barcodes => {
    captures++; assert.deepEqual([...barcodes], ['B']); return { B: { unitBarcode: 'B', costCurrency: 'MYR', costStatus: 'CAPTURED', costIssues: [],
      capturedAt: '2026-10-22T02:00:00Z', lpPc: 1, lpCtn: 12, disc1: 0, disc2: 0, disc3: 0, cbmPerCtn: 0.1 } };
  } };
  return { args, task, order, orders, tasks, journal, captures: () => captures };
}

test('original reference-only result becomes exact versioned domain/event plan in either company, no stock writes', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(company), before = JSON.stringify(f.args.tables), result = await prepareCostReference(f.args);
    assert.equal(result.outcome.ok, true); assert.equal(result.plan.writes.length, 5); assert.equal(f.captures(), 1);
    const update = result.plan.writes.find(w => w.collection === f.tasks);
    assert.equal(update.before._version, 'T0'); assert.equal(update.after.lpPc, 1);
    for (const field of ['supplierId', 'ourPoNumber', 'purchaseQtyInCtn', 'receivedQtyInCtn', 'rowPosition', 'originalCostSnapshot']) assert.deepEqual(update.after[field], f.task[field]);
    assert.equal(result.plan.writes.find(w => w.collection === f.orders).after.cbmCtn, 0.1);
    assert.equal(result.plan.writes.some(w => w.after.action === 'COST_RETRY_LOCK' || w.collection.startsWith('Stock')), false);
    assert.equal(JSON.stringify(f.args.tables), before);
  }
});

test('original manual/existing prices, invoice lock and incomplete intake validation stay unchanged', async () => {
  const f = fixture(); f.task.lpPc = 9; f.task.disc3 = 0; f.task.manualCostField = ['lpCtn'];
  const after = (await prepareCostReference(f.args)).plan.writes.find(w => w.collection === f.tasks).after;
  assert.equal(after.lpPc, 9); assert.equal(after.lpCtn, null); assert.equal(after.disc3, 0); assert.equal(after.latestCostReference.lpCtn, 12);
  const g = fixture(); g.order.salesInvoiceNumber = 'INV'; await assert.rejects(prepareCostReference(g.args), /locked/); assert.equal(g.captures(), 0);
  const h = fixture(); h.args.tables[h.journal] = []; await assert.rejects(prepareCostReference(h.args), /receipt is not complete/); assert.equal(h.captures(), 0);
});

test('expired old cost lock is not stolen; missing migration metadata and duplicate identities refuse', async () => {
  const f = fixture(), lockId = hash('NCT', f.task._id, 'COST_LOCK');
  f.args.tables[f.journal].push({ _id: lockId, action: 'COST_RETRY_LOCK', activityTime: '2020-01-01T00:00:00Z' });
  await assert.rejects(prepareCostReference(f.args), /no TTL takeover/); assert.equal(f.captures(), 0);
  const g = fixture(); delete g.task._version; await assert.rejects(prepareCostReference(g.args), /migrated/);
  const h = fixture(); h.args.tables[h.tasks].push(copy(h.task)); await assert.rejects(prepareCostReference(h.args), /identity conflict/);
});

test('overlay rejects any stock/PO/identity field mutation and never changes server snapshot', async () => {
  const f = fixture(), before = JSON.stringify(f.args.tables);
  f.args.createPurchaseCostRetry = ({ store }) => async () => store.update(f.tasks, { ...f.task, purchaseQtyInCtn: 101 });
  await assert.rejects(prepareCostReference(f.args), /cannot change stock/); assert.equal(JSON.stringify(f.args.tables), before);
});

test('fenced reference refresh replays exact captured costs without a second lookup or whole-row overwrite', async () => {
  const f = fixture(), db = new Map();
  for (const [c, rows] of Object.entries(f.args.tables)) for (const row of rows) db.set(c + ':' + row._id, copy(row));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize();
  const command = { requestId: f.args.request.requestId, memberId: 'M', input: { taskId: f.task._id }, prepare: async () => (await prepareCostReference(f.args)).plan };
  await protocol.commit(command); await protocol.commit(command);
  assert.equal(f.captures(), 1); assert.equal((await protocol.readSnapshot(async () => null)).generation, 1);
  assert.equal(db.get(f.tasks + ':' + f.task._id).purchaseQtyInCtn, 100);
  assert.equal([...db.values()].filter(row => row.action === 'COST_RETRY_RESULT').length, 1);
});
