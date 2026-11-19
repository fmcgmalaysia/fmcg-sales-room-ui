const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { copy, same } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const { stockBootstrapPreflight } = require('../prototypes/stock-current-state/bootstrap-preflight.cjs');
const { lifecycleBootstrapPreflight } = require('../prototypes/stock-current-state/lifecycle-bootstrap-preflight.cjs');
const { createMaintenanceInstalledReader } = require('../prototypes/stock-current-state/maintenance-installed-reader.cjs');
const { createMaintenanceMigration } = require('../prototypes/stock-current-state/maintenance-migration.cjs');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { projectStockCard } = load('../prototypes/stock-current-state/stockCardProjection.candidate.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');

function fixture(company = 'NCT', factories = {}) {
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
  const control = { _id: hash(company, 'STOCK_CONTROL'), company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null, _version: 'C0' };
  const taskRows = [{ _id: 'T1', company, _version: 'T0', description: 'O', imageAltText: 'L', quantity: 80,
    lastCostCaptureTime: '2026-10-23T08:00:00.000Z', originalCostSnapshot: { z: 0, a: 1 } }];
  const context = { company, tasks: [{ id: 'T1', company, orderId: 'O', sourceLineId: 'L', customerId: 'C',
    barcode: '001', name: 'Item', packing: '12 x 1', ea: 12, ord: 80, requested: 80, procurement: { totalCtn: 80, customerCtn: 80 }, warehouse: null }],
    activity: [], suppliers: [], customers: [{ id: 'C', name: 'Customer' }] };
  if (company === 'NCT') {
    Object.assign(context.tasks[0], { po: 'PO-1', supplierId: 'SUP', lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [],
      procurement: { totalCtn: 100, customerCtn: 80 }, warehouse: { hasPhysicalReceipt: true, accepted: 100 } });
    context.suppliers.push({ id: 'SUP', name: 'Supplier' });
  }
  const base = stockBootstrapPreflight({ company, context, purchaseRecords: [], control, projectStockCard, projectPurchaseOrders,
    includeProjection: true, existing: { complete: true, positions: [], claims: [], products: [], transfers: [] } });
  const expected = lifecycleBootstrapPreflight({ company, context, base, taskRows, generation: 0 });
  const rows = new Map([[journal + '/' + control._id, copy(control)], ...taskRows.map(row => [tasks + '/' + row._id, copy(row)])]);
  const writes = [], queries = [], stages = []; let admin = { memberId: 'ADMIN', isAdmin: true }, drain = true, onPage = null, beforeInstalled = null;
  const store = { read: async (collection, id) => copy(rows.get(collection + '/' + id) || null),
    insert: async (collection, row) => {
      if (rows.has(collection + '/' + row._id)) throw Error('Occupied'); writes.push(['INSERT', collection, row._id]); rows.set(collection + '/' + row._id, copy(row));
    }, compareAndSet: async (collection, id, version, after) => {
      if (rows.get(collection + '/' + id)?._version !== version) throw Error('Stale CAS');
      writes.push(['CAS', collection, id]); rows.set(collection + '/' + id, copy(after));
    }, compareAndRemove: async (collection, id, attempt) => {
      if (rows.get(collection + '/' + id)?.attempt !== attempt) throw Error('Foreign lock');
      writes.push(['REMOVE', collection, id]); rows.delete(collection + '/' + id);
    } };
  const items = { query: collection => {
    const filters = []; let offset = 0, size = 100;
    const q = { eq: (key, value) => { filters.push([key, value]); return q; }, ascending: key => { assert.equal(key, '_id'); return q; },
      skip: value => { offset = value; return q; }, limit: value => { size = value; return q; }, find: async options => {
        assert.deepEqual(copy(options), { consistentRead: true, returnTotalCount: true }); queries.push({ collection, filters, offset, size });
        const all = [...rows].filter(([key, row]) => key.startsWith(collection + '/') && filters.every(([field, value]) => row[field] === value))
          .map(([, row]) => row).sort((a, b) => a._id < b._id ? -1 : 1);
        const page = { totalCount: all.length, items: all.slice(offset, offset + size).map(row => {
          const native = copy(row); native.stockCommitVersion = native._version; delete native._version;
          if (native.lastCostCaptureTime) native.lastCostCaptureTime = new Date(native.lastCostCaptureTime);
          return native;
        }) };
        if (onPage) await onPage(collection, page, offset);
        return page;
      } }; return q;
  }, insert() {}, patch() {}, remove() {} };
  store.normalizeListedRow = (factories.createSdkConditionalStore || createSdkConditionalStore)({ company, items,
    collections: [journal, tasks, 'StockPositions', 'StockClaims', 'StockProducts'], dateTimeFields: { [tasks]: ['lastCostCaptureTime'] } }).normalizeListedRow;
  const args = { company, items, store, authenticateAdmin: async () => copy(admin), verifyLegacyDrain: async () => drain,
    readControl: () => store.read(journal, control._id), limits: { positions: 20, claims: 20, products: 20, transfers: 20, taskRows: 20 },
    maxSnapshotBytes: 100000, pageSize: 1 };
  const reader = () => (factories.createMaintenanceInstalledReader || createMaintenanceInstalledReader)(args);
  const input = { requestId: '77777777-1111-4111-8111-111111111111', checkpointId: expected.checkpointId };
  const readInstalled = async request => {
    if (beforeInstalled) await beforeInstalled();
    const result = await reader()(request); stages.push(result.inspectionStage); return result;
  };
  const migration = (factories.createMaintenanceMigration || createMaintenanceMigration)({ company, store, authenticateAdmin: args.authenticateAdmin, verifyLegacyDrain: args.verifyLegacyDrain,
    capture: async () => ({ company, expected: copy(expected), taskRows: copy(taskRows), control: copy(control), emptyCurrentConfirmed: true,
      durableBackupConfirmed: true, backupIdentity: { requestId: '66666666-1111-4111-8111-111111111111', backupId: 'b'.repeat(32), checkpointId: 'c'.repeat(32), retainedBy: 'ADMIN' } }),
    readInstalled, protocolOptions: { stepsPerInvocation: 2 } });
  const finish = async () => {
    for (let i = 0; i < 30; i++) { const r = await migration.apply(input); if (r.ok) return r; assert.equal(r.pending, true); }
    throw Error('Migration did not finish');
  };
  return { ...migration, args, reader, finish, input, rows, store, writes, queries, stages, company, journal, tasks, control, expected,
    request: () => ({ company, ...input }), onPage: fn => { onPage = fn; }, beforeInstalled: fn => { beforeInstalled = fn; },
    setAdmin: value => { admin = value; }, setDrain: value => { drain = value; } };
}

for (const company of ['NCT', 'GHR']) test(company + ' candidate migration validates owned FINALIZE and inspects the complete confirmed cohort using original SDK normalization', async () => {
  const f = fixture(company), originalHash = hash(f.rows.get(f.tasks + '/T1').originalCostSnapshot);
  f.beforeInstalled(async () => {
    const control = await f.args.readControl();
    if (control.pending) await assert.rejects(createSegmentedFencedProof({ company, store: f.store }).readSnapshot(() => []), /Inventory pending/);
  });
  await f.finish(); assert.deepEqual(f.stages, ['OWNED_FINALIZE']);
  const before = f.writes.length, result = await f.reader()(f.request());
  assert.equal(result.complete, true); assert.equal(result.taskRowsComplete, true); assert.equal(result.inspectionStage, 'CONFIRMED');
  assert.equal(result.generation, 1); assert.equal(result.activationReady, false);
  assert.equal(result.products[0].status, company === 'NCT' ? 'ACTIVE' : 'CLOSED'); assert.equal(result.products[0].onHand, company === 'NCT' ? 100 : 0);
  assert.equal(result.products[0].available, company === 'NCT' ? 20 : 0);
  assert.equal(result.taskRows[0].stockCounterGeneration, 1); assert.equal(result.taskRows[0].lastCostCaptureTime, '2026-10-23T08:00:00.000Z');
  assert.equal(hash(result.taskRows[0].originalCostSnapshot), originalHash);
  assert.deepEqual(result.metrics, { queries: 10, exactReads: company === 'NCT' ? 8 : 4 }); assert.equal(f.writes.length, before, 'reader has no write capability');
  assert.equal((await f.inspect(f.input)).lifecycleVerified, true); assert.equal(f.stages.at(-1), 'CONFIRMED');
  assert.equal(f.queries.some(query => query.collection === (company === 'NCT' ? 'NCTTasks1' : 'NCTTasks')), false);
});

test('generated private runtime executes the same complete migration/readback/lifecycle path and exposes no public method', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
  const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockCurrentCommands.js'), 'utf8');
  const api = vm.runInNewContext('(function(){' + source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '')
    + '\nreturn {createMaintenanceInstalledReader,createMaintenanceMigration,createMaintenanceMetadataInitializer,createSdkConditionalStore};})()',
    { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
  const f = fixture('GHR', api); await f.finish();
  assert.equal((await f.inspect(f.input)).lifecycleVerified, true); assert.deepEqual(f.stages, ['OWNED_FINALIZE', 'CONFIRMED']);
  assert.throws(() => api.createMaintenanceMetadataInitializer({}), /dependencies/);
  assert.doesNotMatch(source, /webMethod\(|Permissions\./);
});

test('idle maintenance, another pending request, APPLY phase and foreign lock cannot bypass the normal pending barrier', async () => {
  const idle = fixture(); await assert.rejects(idle.reader()(idle.request()), /manifest/); assert.equal(idle.queries.length, 0);
  for (const mode of ['REQUEST', 'PHASE', 'LOCK']) {
    const f = fixture(); await f.apply(f.input);
    const control = f.rows.get(f.journal + '/' + f.control._id), key = control.pending.key;
    control.pending.phase = 'FINALIZE'; control.pending.cursor = control.pending.count;
    f.rows.set(f.journal + '/' + hash(f.company + '/PURCHASE', 'LOCK'), { _id: hash(f.company + '/PURCHASE', 'LOCK'), company: f.company, owner: key, attempt: 'OWNED' });
    if (mode === 'REQUEST') control.pending.key = 'OTHER';
    if (mode === 'PHASE') control.pending.phase = 'APPLY';
    if (mode === 'LOCK') f.rows.get(f.journal + '/' + hash(f.company + '/PURCHASE', 'LOCK')).owner = 'OTHER';
    await assert.rejects(f.reader()(f.request()), /Owned FINALIZE/); assert.equal(f.queries.length, 0);
  }
});

test('unverified drain, lost Admin and wrong company/browser authority refuse before data pages', async () => {
  const f = fixture(); await f.finish(); f.queries.length = 0;
  f.setDrain(undefined); await assert.rejects(f.reader()(f.request()), /drain/);
  f.setDrain(true); f.setAdmin({ memberId: 'USER', isAdmin: false }); await assert.rejects(f.reader()(f.request()), /Administrator/);
  await assert.rejects(f.reader()({ ...f.request(), company: 'GHR' }), /identity/);
  await assert.rejects(f.reader()({ ...f.request(), allowPending: true }), /identity/);
  assert.equal(f.queries.length, 0);
});

test('complete task table includes extra rows and refuses missing company/version instead of hiding them', async () => {
  const f = fixture(); await f.finish();
  f.rows.set(f.tasks + '/T2', { _id: 'T2', company: f.company, _version: 'T2', quantity: 0 });
  assert.equal((await f.reader()(f.request())).taskRows.length, 2);
  delete f.rows.get(f.tasks + '/T2').company;
  await assert.rejects(f.reader()(f.request()), /task scope conflict/);
  f.rows.get(f.tasks + '/T2').company = f.company; delete f.rows.get(f.tasks + '/T2')._version;
  await assert.rejects(f.reader()(f.request()), /migrated version/);
});

test('truncated, duplicate and over-budget task pages and same-count edits cannot produce a successful installed read', async () => {
  for (const fault of ['TRUNCATED', 'DUPLICATE', 'BUDGET', 'CHANGED']) {
    const f = fixture(); await f.finish(); f.rows.set(f.tasks + '/T2', { _id: 'T2', company: f.company, _version: 'T2', quantity: 0 });
    if (fault === 'BUDGET') f.args.limits.taskRows = 1;
    let taskQueries = 0;
    f.onPage((collection, page, offset) => {
      if (collection !== f.tasks) return; taskQueries++;
      if (fault === 'TRUNCATED') page.items = [];
      if (fault === 'DUPLICATE' && offset === 1) page.items[0] = { _id: 'T1', company: f.company, stockCommitVersion: 'T2' };
      if (fault === 'CHANGED' && taskQueries === 2) f.rows.get(f.tasks + '/T1').quantity = 79;
    });
    await assert.rejects(f.reader()(f.request()), /Incomplete|scope conflict|cohort changed/);
  }
});

test('late boundary changes and byte overflow refuse; extra task during FINALIZE prevents generation/result publication', async () => {
  for (const fault of ['CONTROL', 'ADMIN', 'DRAIN', 'RESULT', 'BYTES']) {
    const f = fixture(); await f.finish();
    if (fault === 'BYTES') f.args.maxSnapshotBytes = 100;
    f.onPage(collection => {
      if (collection !== f.tasks) return;
      if (fault === 'CONTROL') f.rows.get(f.journal + '/' + f.control._id)._version = 'CHANGED';
      if (fault === 'ADMIN') f.setAdmin({ memberId: 'OTHER', isAdmin: true });
      if (fault === 'DRAIN') f.setDrain(false);
      if (fault === 'RESULT') f.rows.get(f.journal + '/' + hash(hash(f.company + '/PURCHASE', f.input.requestId, 'ADMIN'), 'RESULT')).outcome.ok = false;
    });
    await assert.rejects(f.reader()(f.request()), /boundary changed|administrator changed|drain|Confirmed original|byte policy/);
  }
  const f = fixture(); f.beforeInstalled(() => { f.rows.set(f.tasks + '/EXTRA', { _id: 'EXTRA', company: f.company, _version: 'X', quantity: 0 }); });
  await assert.rejects(f.finish(), /cohort differs/);
  const control = await f.args.readControl(); assert.equal(control.generation, 0); assert.equal(control.pending.phase, 'FINALIZE');
  assert.equal(await f.store.read(f.journal, hash(hash(f.company + '/PURCHASE', f.input.requestId, 'ADMIN'), 'RESULT')), null);
});
