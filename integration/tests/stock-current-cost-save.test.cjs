const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { createCurrentCostReferenceSave } = require('../prototypes/stock-current-state/current-cost-reference-save.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js');
const filename = require.resolve('./stock-current-cost-reference.test.cjs');
const baseFixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\nfixture;',
  { require: createRequire(filename), Map, Buffer });
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(company = 'NCT') {
  const f = baseFixture(company), db = new Map(); let interrupt = false, tableReads = 0;
  Object.assign(f.task, { stockCounterSchema: 2, stockDispatchedCumulative: 30, stockCounterGeneration: 0 });
  for (const [c, rows] of Object.entries(f.args.tables)) for (const row of rows) db.set(c + ':' + row._id, copy(row));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, row) => {
    if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); },
    compareAndSet: async (c, id, version, row) => { if (c === f.tasks && interrupt) { interrupt = false; throw Error('Interrupted reference task'); }
      if (db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); db.set(c + ':' + id, copy(row)); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ company, store, domainWrites: true, stepsPerInvocation: 1 }); await protocol.initialize();
  Object.assign(db.get(f.journal + ':' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  const member = { _id: 'M', loginEmail: 'purchase@example.test', status: 'APPROVED' }, employee = {
    title: 'P', description: 'M', staffEmail: member.loginEmail, staffName: 'Purchase', staffStatus: 'ACTIVE', departments: ['PURCHASE'] };
  const deps = { ...f.args, requirePurchaseStaff, readMember: async () => member, readStaffRecords: async () => [employee],
    readCostTables: async (selectedCompany, id, staff) => { tableReads++; assert.equal(selectedCompany, company); assert.equal(id, f.task._id); assert.equal(staff.memberId, 'M');
      return Object.fromEntries([f.orders, f.tasks, f.journal].map(c => [c, [...db].filter(([address]) => address.startsWith(c + ':')).map(([, row]) => copy(row))])); } };
  const save = createCurrentCostReferenceSave({ company, store, protocol, authorityDependencies: deps,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])) });
  const request = { requestId: f.args.request.requestId, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    staff: { memberId: 'FORGED' }, input: { taskId: f.task._id } };
  return { ...f, db, member, employee, deps, store, protocol, save, request, tableReads: () => tableReads, interrupt: () => { interrupt = true; } };
}
async function finish(f) { let result, attempts = 0; do { result = await f.save(f.request); assert.ok(attempts++ < 30); } while (result.pending); return result; }

test('actual Purchase reference retry preserves original receipt, all stock counters/manual price/PO fields and both companies', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture(company), task = f.db.get(f.tasks + ':' + f.task._id); task.lpPc = 9; task.manualCostField = ['lpCtn'];
    const result = await finish(f); assert.equal(result.ok, true); assert.equal(result.stockGeneration, 1);
    assert.equal(result.costStatus, 'CAPTURED'); assert.equal(result.taskId, f.task._id); assert.equal(result.capturedAt, '2026-10-22T02:00:00Z');
    assert.equal((await f.save(f.request)).stockGeneration, 1); assert.equal(f.captures(), 1); assert.equal(f.tableReads(), 1);
    const after = f.db.get(f.tasks + ':' + f.task._id);
    assert.equal(after.lpPc, 9); assert.equal(after.lpCtn, null);
    for (const key of ['purchaseQtyInCtn', 'receivedQtyInCtn', 'supplierId', 'ourPoNumber', 'rowPosition', 'stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration']) assert.equal(after[key], task[key]);
    assert.equal(f.db.get(f.orders + ':' + f.order._id).cbmCtn, 0.1);
    assert.equal([...f.db.keys()].some(key => key.startsWith('Stock')), false);
    assert.equal([...f.db.values()].filter(row => row.action === 'COST_RETRY_RESULT').length, 1);
    assert.equal([...f.db.values()].some(row => row.action === 'COST_RETRY_LOCK'), false);
  }
});

test('interrupted current reference resumes durable captured price once and blocks actionable reads until complete', async () => {
  const f = await fixture(); f.interrupt(); let interrupted = false;
  for (let i = 0; i < 20; i++) {
    try { const result = await f.save(f.request); assert.equal(result.pending, true); }
    catch (error) { assert.match(error.message, /Interrupted reference/); interrupted = true; break; }
  }
  assert.equal(interrupted, true); assert.equal(f.captures(), 1);
  await assert.rejects(f.protocol.readSnapshot(async () => null), /pending/i);
  assert.equal((await finish(f)).stockGeneration, 1); assert.equal(f.captures(), 1); assert.equal(f.tableReads(), 1);
});

test('original incomplete/invoice locks, Purchase authority and expired legacy lock remain protected', async () => {
  const f = await fixture(); f.db.get(f.orders + ':' + f.order._id).salesInvoiceNumber = 'INV';
  await assert.rejects(f.save(f.request), /locked/); assert.equal(f.captures(), 0);
  const g = await fixture(); g.employee.departments = ['WAREHOUSE']; await assert.rejects(g.save(g.request)); assert.equal(g.tableReads(), 0);
  const h = await fixture(); const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
  const id = hash('NCT', h.task._id, 'COST_LOCK'); h.db.set(h.journal + ':' + id, { _id: id, action: 'COST_RETRY_LOCK', activityTime: '2020-01-01' });
  await assert.rejects(h.save(h.request), /no TTL takeover/); assert.equal(h.captures(), 0);
  const j = await fixture(); await finish(j); j.member.status = 'PENDING'; await assert.rejects(j.save(j.request));
  assert.equal(j.captures(), 1);
});
