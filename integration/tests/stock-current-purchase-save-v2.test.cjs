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
});
test('current missing checkpoint/task counter and unconnected operations cannot fall back to old writer', async () => {
  const f = await fixture(); delete f.f.task().stockCounterSchema;
  await assert.rejects(createPurchaseStockPreparation(f.deps)(f.request), /checkpoint/);
  const g = await fixture(); g.db.delete('StockProducts/' + hash('NCT', g.key));
  await assert.rejects(createPurchaseStockPreparation(g.deps)(g.request), /product checkpoint/);
  for (const operation of ['REORDER', 'SPECIAL', 'QTY', 'ARCHIVE', 'ASSIGN']) assert.throws(() => g.save({ ...g.request, operation }), /Supported/);
});
