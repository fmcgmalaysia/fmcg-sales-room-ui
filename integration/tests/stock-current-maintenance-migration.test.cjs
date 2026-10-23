const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { copy, same } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const { stockBootstrapPreflight } = require('../prototypes/stock-current-state/bootstrap-preflight.cjs');
const { lifecycleBootstrapPreflight } = require('../prototypes/stock-current-state/lifecycle-bootstrap-preflight.cjs');
const { createMaintenanceMigration, prepareMaintenanceMigration } = require('../prototypes/stock-current-state/maintenance-migration.cjs');
const { projectStockCard } = load('../prototypes/stock-current-state/stockCardProjection.candidate.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');

function fixture(company = 'NCT', empty = false) {
  const tasks = empty ? [] : [{ id: 'T1', company, barcode: '001', name: 'Item', packing: '12 x 1', ea: 12,
    orderId: 'O1', sourceLineId: 'L1', customerId: 'C1', po: 'PO-1', supplierId: 'SUP', ord: 80, requested: 80,
    lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, history: [], procurement: { totalCtn: 100, customerCtn: 80 },
    warehouse: { hasPhysicalReceipt: true, accepted: 100 } }];
  const context = { company, tasks, activity: [], suppliers: [{ id: 'SUP', name: 'Supplier' }], customers: [{ id: 'C1', name: 'Customer' }] };
  const control = { _id: hash(company, 'STOCK_CONTROL'), company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null, _version: 'C0' };
  const taskRows = tasks.map(t => ({ _id: t.id, company, _version: 'T0', description: t.orderId,
    imageAltText: t.sourceLineId, ourPoNumber: t.po, manualCostField: ['KEEP'], nested: { untouched: true }, quantity: 80 }));
  const base = stockBootstrapPreflight({ company, context, purchaseRecords: [], includeProjection: true, control,
    existing: { complete: true, positions: [], claims: [], products: [], transfers: [] }, projectStockCard, projectPurchaseOrders });
  const expected = lifecycleBootstrapPreflight({ company, context, base, taskRows, generation: 0 });
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', taskTable = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
  const rows = new Map([[journal + '/' + control._id, copy(control)], ...taskRows.map(row => [taskTable + '/' + row._id, copy(row)])]);
  const calls = []; let fault = null, captureCount = 0, admin = { isAdmin: true, memberId: 'ADMIN' }, drain = true;
  const store = {
    read: async (table, id) => copy(rows.get(table + '/' + id) ?? null),
    insert: async (table, row) => { calls.push(['INSERT', table, row._id]); if (rows.has(table + '/' + row._id)) throw Error('Occupied'); rows.set(table + '/' + row._id, copy(row)); },
    compareAndSet: async (table, id, version, after) => {
      calls.push(['CAS', table, id]); const current = rows.get(table + '/' + id);
      if (current?._version !== version) throw Error('Stale CAS');
      rows.set(table + '/' + id, copy(after));
      if (fault === table) { fault = null; throw Error('Lost response after write'); }
    },
    compareAndRemove: async (table, id, attempt) => {
      calls.push(['REMOVE', table, id]); if (rows.get(table + '/' + id)?.attempt !== attempt) throw Error('Wrong lock owner'); rows.delete(table + '/' + id);
    }
  };
  const all = table => [...rows].filter(([key]) => key.startsWith(table + '/')).map(([, row]) => copy(row));
  const readInstalled = async () => ({ company, complete: true, taskRowsComplete: true, transfers: [],
    positions: all('StockPositions'), claims: all('StockClaims'), products: all('StockProducts'), taskRows: all(taskTable) });
  const service = createMaintenanceMigration({ company, store, authenticateAdmin: async () => admin,
    verifyLegacyDrain: async () => drain, capture: async () => {
      captureCount++;
      return { expected: copy(expected), taskRows: copy(taskRows), control: copy(control), emptyCurrentConfirmed: true, durableBackupConfirmed: true,
        backupIdentity: { requestId: '66666666-1111-4111-8111-111111111111', backupId: 'b'.repeat(32), checkpointId: 'c'.repeat(32), retainedBy: 'ADMIN' } };
    }, readInstalled, protocolOptions: { stepsPerInvocation: 2 } });
  const input = { requestId: '77777777-1111-4111-8111-111111111111', checkpointId: expected.checkpointId };
  const finish = async () => {
    for (let i = 0; i < 30; i++) { const result = await service.apply(input); if (result.ok) return result; assert.equal(result.pending, true); }
    throw Error('Migration did not complete');
  };
  return { ...service, finish, input, expected, taskRows, control, rows, calls, store, readInstalled, journal, taskTable,
    get captureCount() { return captureCount; }, setDrain: value => { drain = value; }, setAdmin: value => { admin = value; },
    loseReply: table => { fault = table; } };
}

for (const company of ['NCT', 'GHR']) test(company + ' migration resumes one exact plan, preserves business fields and verifies full lifecycle parity', async () => {
  const f = fixture(company), original = copy(f.taskRows[0]);
  const first = await f.apply(f.input); assert.equal(first.pending, true);
  f.loseReply(f.taskTable); await f.finish(); await f.apply(f.input);
  assert.equal(f.captureCount, 1);
  const current = await f.readInstalled(), task = current.taskRows[0];
  for (const key of Object.keys(original).filter(k => k !== '_version')) assert.deepEqual(task[key], original[key]);
  assert.equal(task.stockCounterGeneration, 1); assert.equal(task.stockDispatchedCumulative, 0);
  assert.equal(current.products[0].onHand, 100); assert.equal(current.products[0].available, 20);
  const parity = await f.inspect(f.input); assert.equal(parity.lifecycleVerified, true); assert.equal(parity.activationReady, false);
  const control = await f.store.read(f.journal, f.control._id); assert.equal(control.generation, 1); assert.equal(control.mode, 'MAINTENANCE');
  assert.equal([...f.rows.values()].filter(row => row.action === 'STOCK_INITIALIZATION_CHECKPOINT').length, 1);
});

test('unverified drain or missing admin refuses before any lock, metadata or inventory write', async () => {
  const f = fixture(); f.setDrain(false); await assert.rejects(f.apply(f.input), /drain/); assert.equal(f.calls.length, 0);
  f.setDrain(undefined); await assert.rejects(f.apply(f.input), /drain/); assert.equal(f.calls.length, 0);
  f.setDrain(true); f.setAdmin({ memberId: 'USER', isAdmin: false }); await assert.rejects(f.apply(f.input), /Administrator/); assert.equal(f.calls.length, 0);
});

test('empty company persists checkpoint without inventing catalogue inventory', async () => {
  const f = fixture('NCT', true); await f.finish(); const current = await f.readInstalled();
  assert.equal(current.products.length, 0); assert.equal(current.positions.length, 0); assert.equal(current.taskRows.length, 0);
  assert.equal((await f.inspect(f.input)).lifecycleVerified, true);
});

test('stale task before-image, missing version and unresolved attribution cannot initialize stock', async () => {
  const f = fixture(), before = copy(f.taskRows);
  before[0].quantity = 81;
  assert.throws(() => prepareMaintenanceMigration({ company: 'NCT', expected: f.expected, taskRows: before, control: f.control }), /Exact versioned/);
  delete before[0]._version;
  assert.throws(() => prepareMaintenanceMigration({ company: 'NCT', expected: f.expected, taskRows: before, control: f.control }), /Exact versioned/);
  const expected = copy(f.expected); expected.blockers.push('STOCK_ATTRIBUTION_REQUIRES_REVIEW');
  assert.throws(() => prepareMaintenanceMigration({ company: 'NCT', expected, taskRows: f.taskRows, control: f.control }), /Verified maintenance/);
  const row = f.rows.get(f.taskTable + '/T1'); row.quantity = 81; row._version = 'T1';
  await assert.rejects(f.finish(), /before-image stale/);
  assert.equal([...f.rows.keys()].some(key => key.startsWith('StockPositions/')), false);
  assert.equal(row.quantity, 81);
});

test('extra current row prevents completion and changed request cannot adopt pending migration', async () => {
  const f = fixture(); await f.apply(f.input);
  f.rows.set('StockProducts/EXTRA', { _id: 'EXTRA', company: 'NCT', _version: 'E0' });
  await assert.rejects(f.finish(), /cohort differs/);
  await assert.rejects(f.apply({ ...f.input, requestId: '88888888-1111-4111-8111-111111111111' }), /pending/);
  const control = await f.store.read(f.journal, f.control._id);
  assert.ok(control.pending); assert.equal(control.generation, 0); assert.equal(control.mode, 'MAINTENANCE');
});

test('browser-supplied authority or captured row images are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.apply({ ...f.input, drained: true }), /Original migration/);
  await assert.rejects(f.apply({ ...f.input, expected: f.expected }), /Original migration/);
  assert.equal(f.calls.length, 0); assert.equal(same(f.taskRows, (await f.readInstalled()).taskRows), true);
});

test('a complete in-memory capture cannot migrate without a separately retained private backup', async () => {
  const f = fixture();
  const service = createMaintenanceMigration({ company: 'NCT', store: f.store, authenticateAdmin: async () => ({ isAdmin: true, memberId: 'ADMIN' }),
    verifyLegacyDrain: async () => true, readInstalled: f.readInstalled,
    capture: async () => ({ expected: f.expected, taskRows: f.taskRows, control: f.control, emptyCurrentConfirmed: true, durableBackupConfirmed: false }) });
  await assert.rejects(service.apply(f.input), /Durable private/);
  assert.equal([...f.rows.keys()].some(key => key.startsWith('StockPositions/')), false);
  assert.equal((await f.store.read(f.journal, f.control._id)).generation, 0);
  assert.equal(f.calls.some(call => call[0] === 'CAS'), false);
});

test('a boolean backup flag without the original retained owner/identity cannot prepare migration writes', async () => {
  for (const backupIdentity of [null, { requestId: '66666666-1111-4111-8111-111111111111', backupId: 'b'.repeat(32), checkpointId: 'c'.repeat(32), retainedBy: 'OTHER' }]) {
    const f = fixture(), service = createMaintenanceMigration({ company: 'NCT', store: f.store,
      authenticateAdmin: async () => ({ isAdmin: true, memberId: 'ADMIN' }), verifyLegacyDrain: async () => true, readInstalled: f.readInstalled,
      capture: async () => ({ expected: f.expected, taskRows: f.taskRows, control: f.control, emptyCurrentConfirmed: true,
        durableBackupConfirmed: true, backupIdentity }) });
    await assert.rejects(service.apply(f.input), /retained backup identity/);
    assert.equal(f.calls.some(call => call[0] === 'CAS'), false);
    assert.equal([...f.rows.keys()].some(key => key.startsWith('StockPositions/')), false);
  }
});
