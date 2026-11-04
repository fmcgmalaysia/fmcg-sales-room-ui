const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { same, copy, utf8Bytes } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const { encodeMaintenanceNativeImage: encode, decodeMaintenanceNativeImage: decode } = require('../prototypes/stock-current-state/maintenance-native-images.cjs');
const { createMaintenanceBackupStore, isMaintenanceBackupRecord, createRetainedMaintenanceCapture } = require('../prototypes/stock-current-state/maintenance-backup-store.cjs');
const { prepareMaintenanceMigration, createMaintenanceMigration } = require('../prototypes/stock-current-state/maintenance-migration.cjs');
const { createMaintenanceInstalledReader } = require('../prototypes/stock-current-state/maintenance-installed-reader.cjs');
const { createMaintenanceSnapshotReader } = require('../prototypes/stock-current-state/maintenance-snapshot-reader.cjs');
const { createMaintenanceMetadataInitializer } = require('../prototypes/stock-current-state/maintenance-metadata-initializer.cjs');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const { projectPurchaseWorkspace } = load('purchaseProjection.js'), { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { projectStockCard } = load('../prototypes/stock-current-state/stockCardProjection.candidate.js');
const clone = value => decode(encode(value)), request = { requestId: '88888888-1111-4111-8111-111111111111' };
const HEADER = 'STOCK_MAINTENANCE_BACKUP_HEADER', PART = 'STOCK_MAINTENANCE_BACKUP_PART', CONFIRMED = 'STOCK_MAINTENANCE_BACKUP_CONFIRMED';

function fixture(company = 'NCT') {
  const orders = company === 'NCT' ? 'NCTOrders' : 'NCTOrders1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', date = new Date('2026-10-23T06:00:00.000Z');
  const db = {
    [orders]: [{ _id: 'O', title: 'ORDER', sourceLineId: 'LINE', submissionId: 'SUB', customerId: 'C', customerCompanyName: 'Customer',
      description: '001', image: 'Item', imageAltText: '12 x 1', orderId: 12, orderQtyInCtn: 80, transactionCurrency: 'MYR', _updatedDate: new Date(date) }],
    [tasks]: [{ _id: 'T', title: 'T', description: 'ORDER', imageAltText: 'LINE', purchaseQtyInCtn: 80, receivedQtyInCtn: null,
      lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, _updatedDate: new Date(date),
      originalCostSnapshot: { zOriginalFirst: 1, aOriginalSecond: 0 }, notes: '货😀\\\"'.repeat(1800), native: { date: new Date(date), text: date.toISOString() } }],
    [journal]: [{ _id: 'A', title: 'A', description: 'ORDER', action: 'ORDER_RECEIVED', result: 'ACCEPTED',
      activityTime: new Date(date), details: { submissionId: 'SUB', taskIds: ['T'] } }],
    PurchaseOrders: [], SharedSuppliers: [], StockPositions: [], StockClaims: [], StockProducts: []
  };
  const control = { _id: hash(company, 'STOCK_CONTROL'), company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null, _version: 'C0' };
  let admin = { isAdmin: true, memberId: 'ADMIN' }, privateRetention = true, drain = true, lose = null, captureCount = 0, afterInsert = null;
  const writes = [], reads = [], items = { query: collection => {
    const filters = []; let skip = 0, size = 100;
    const q = { eq: (key, value) => { filters.push([key, value]); return q; }, hasSome: (key, values) => { filters.push([key, values]); return q; },
      ascending: () => q, skip: value => { skip = value; return q; },
      limit: value => { size = value; return q; }, find: async () => {
        const all = db[collection].filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).sort((a, b) => a._id < b._id ? -1 : 1);
        return { totalCount: all.length, items: all.slice(skip, skip + size).map(clone) }; } }; return q;
  }, insert: async (collection, row) => {
    if (db[collection].some(value => value._id === row._id)) throw Error('Occupied native ID');
    db[collection].push(clone(row)); return clone(row);
  }, remove: async (collection, id, { condition }) => {
    const row = db[collection].find(value => value._id === id);
    assert.equal(row.company, condition.company.$eq); assert.equal(row.attempt, condition.attempt.$eq);
    db[collection].splice(db[collection].indexOf(row), 1); return clone(row);
  }, patch: (collection, id) => {
    const fields = {}, removed = []; const p = { setField: (key, value) => { fields[key] = value; return p; },
      removeField: key => { removed.push(key); return p; }, run: async ({ condition }) => {
      const row = db[collection].find(row => row._id === id);
      if (condition.stockCommitVersion.$exists === false) {
        assert.equal(condition._updatedDate.$eq.$date, row._updatedDate.toISOString());
        assert.equal(Object.hasOwn(row, 'stockCommitVersion'), false);
      } else assert.equal(row.stockCommitVersion, condition.stockCommitVersion.$eq);
      if (condition.company.$exists === false) assert.equal(Object.hasOwn(row, 'company'), false);
      else assert.equal(row.company, condition.company.$eq);
      for (const key of removed) delete row[key];
      Object.assign(row, fields); row._updatedDate = new Date('2026-10-23T07:00:00.000Z'); return clone(row);
    } }; return p;
  } };
  const store = { read: async (collection, id) => {
    assert.equal(collection, journal); reads.push(id); return copy(db[collection].find(row => row._id === id) || null);
  }, insert: async (collection, row) => {
    assert.equal(collection, journal); assert.equal(db[collection].some(existing => existing._id === row._id), false);
    writes.push(copy(row)); db[collection].push(copy(row));
    if (afterInsert) afterInsert(row);
    if (lose === row.action) { lose = null; throw Error('Lost native write reply'); }
    return copy(row);
  } };
  const authenticateAdmin = async () => clone(admin), verifyLegacyDrain = async () => drain, readControl = async () => copy(control);
  const sdkStore = createSdkConditionalStore({ company, items, collections: Object.keys(db), dateTimeFields: { [journal]: ['activityTime'], [tasks]: ['lastCostCaptureTime'] } });
  const reader = createMaintenanceSnapshotReader({ company, items, store: sdkStore,
    protocol: { readControl, readSnapshot: async fn => ({ rows: await fn(copy(control)), generation: control.generation }) },
    authenticateAdmin, verifyLegacyDrain, projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders,
    limits: Object.fromEntries(Object.keys(db).map(name => [name, 1000])), maxBackupBytes: 200000, pageSize: 10 });
  const args = { company, store, authenticateAdmin, verifyLegacyDrain, readControl, verifyPrivateRetention: async () => privateRetention,
    readSnapshot: async () => { captureCount++; return reader.read(); },
    policy: { recordBudgetBytes: 4096, maxBackupBytes: 200000, maxFragments: 64, partsPerInvocation: 1 } };
  const service = () => createMaintenanceBackupStore(args);
  const finish = async (target = service()) => {
    for (let i = 0; i < 64; i++) { const result = await target.retain(request); if (result.durableBackupConfirmed) return result; assert.equal(result.pending, true); }
    throw Error('Backup did not finish');
  };
  return { args, service, finish, db, company, orders, tasks, journal, control, writes, reads, items, reader, sdkStore,
    authenticateAdmin, verifyLegacyDrain, readControl, get captureCount() { return captureCount; },
    setAdmin: value => { admin = value; }, setPrivacy: value => { privateRetention = value; }, setDrain: value => { drain = value; },
    lose: action => { lose = action; }, afterInsert: fn => { afterInsert = fn; } };
}

for (const company of ['NCT', 'GHR']) test(company + ' retains one original complete typed backup across bounded invocations and feeds existing metadata initializer', async () => {
  const f = fixture(company), first = await f.reader.read(), original = clone(f.db[f.tasks][0]), service = f.service();
  const pending = await service.retain(request); assert.equal(pending.pending, true); assert.equal(pending.durableBackupConfirmed, false);
  await assert.rejects(service.inspect(request), /confirmation/);
  const saved = await f.finish(service);
  assert.equal(saved.checkpointId, first.expected.checkpointId); assert.equal(saved.backupId, first.backup.backupId);
  assert.equal(saved.durableBackupConfirmed, true); assert.equal(saved.activationReady, false);
  assert.ok(f.writes.filter(row => row.action === PART).length > 1);
  assert.equal(f.writes.filter(row => row.action === HEADER).length, 1); assert.equal(f.writes.filter(row => row.action === CONFIRMED).length, 1);
  assert.equal(f.writes.at(-1).action, CONFIRMED);
  assert.ok(f.writes.every(row => utf8Bytes(JSON.stringify(row)) <= f.args.policy.recordBudgetBytes));
  assert.deepEqual(saved.raw.tables[f.tasks][0], original); assert.equal(hash(saved.raw.tables[f.tasks][0].originalCostSnapshot), hash(original.originalCostSnapshot));
  assert.ok(saved.raw.tables[f.tasks][0].native.date instanceof Date);
  assert.equal(saved.raw.tables[f.tasks][0].native.text, original.native.text);
  assert.equal(f.control.generation, 0); assert.equal(f.control.mode, 'MAINTENANCE');
  const recapture = await f.reader.read(); assert.equal(recapture.backup.backupId, first.backup.backupId);
  assert.equal(recapture.expected.checkpointId, first.expected.checkpointId, 'owned backup records cannot change business checkpoint or recursively back up themselves');
  const count = f.writes.length, captures = f.captureCount;
  await service.retain(request); assert.equal(f.writes.length, count); assert.equal(f.captureCount, captures, 'completed replay inspects original backup, never recaptures');
  const initialize = createMaintenanceMetadataInitializer({ company, items: f.items, authenticateAdmin: f.authenticateAdmin,
    verifyLegacyDrain: f.verifyLegacyDrain, readControl: f.readControl, readCapturedRow: service.metadataReader(request) });
  const result = await initialize.step({ checkpointId: saved.checkpointId, ordinal: 1 }); assert.equal(result.initialized, true);
  assert.equal(f.db[f.tasks][0].company, company); assert.equal(hash(f.db[f.tasks][0].originalCostSnapshot), hash(original.originalCostSnapshot));
  assert.deepEqual(f.db[f.tasks][0].native, original.native);
  await initialize.step({ checkpointId: saved.checkpointId, ordinal: 0 });
  const fresh = await f.reader.read(), capture = createRetainedMaintenanceCapture({ company, backupStore: service,
    readSnapshot: () => f.reader.read(), backupRequest: request });
  const verified = await capture({ company, checkpointId: fresh.expected.checkpointId });
  assert.equal(verified.durableBackupConfirmed, true); assert.equal(verified.backupIdentity.backupId, saved.backupId);
  assert.deepEqual(prepareMaintenanceMigration({ company, ...verified }).migration.backupIdentity, verified.backupIdentity);
});

for (const action of [HEADER, PART, CONFIRMED]) test(action + ' lost reply stops immediately; only a later explicit call reads and resumes original immutable records', async () => {
  const f = fixture(); f.args.policy.partsPerInvocation = 64; f.lose(action);
  await assert.rejects(f.service().retain(request), /Lost native write reply/);
  assert.equal(f.writes.at(-1).action, action); const before = f.writes.map(row => copy(row));
  const saved = await f.finish(); assert.equal(saved.durableBackupConfirmed, true);
  assert.equal(new Set(f.writes.map(row => row._id)).size, f.writes.length);
  assert.ok(before.every(row => same(row, f.db[f.journal].find(current => current._id === row._id))));
});

test('unknown privacy, wrong Admin, unverified drain and wrong maintenance mode refuse without writing', async () => {
  const f = fixture(); f.setPrivacy(undefined);
  await assert.rejects(f.service().retain(request), /retention is not verified/); assert.equal(f.reads.length, 0);
  f.setPrivacy(true); f.setAdmin({ isAdmin: false, memberId: 'USER' });
  await assert.rejects(f.service().retain(request), /Administrator/); assert.equal(f.reads.length, 0);
  f.setAdmin({ isAdmin: true, memberId: 'ADMIN' }); f.setDrain(false);
  await assert.rejects(f.service().retain(request), /drain/); assert.equal(f.captureCount, 0);
  f.setDrain(true); f.control.mode = 'ACTIVE'; await assert.rejects(f.service().retain(request), /maintenance/);
  assert.equal(f.writes.length, 0);
});

test('changed capture cannot adopt the original request or overwrite an occupied header', async () => {
  const f = fixture(), service = f.service(); await service.retain(request); const before = copy(f.writes);
  f.db[f.tasks][0].purchaseQtyInCtn = 79;
  await assert.rejects(service.retain(request), /occupied identity/); assert.deepEqual(f.writes, before);
});

test('partial, missing, corrupted or foreign retained records never provide durable confirmation or metadata images', async () => {
  for (const fault of ['MISSING', 'CORRUPT', 'FOREIGN']) {
    const f = fixture(); await f.finish(); const parts = f.db[f.journal].filter(row => row.action === PART), part = parts[0];
    if (fault === 'MISSING') f.db[f.journal].splice(f.db[f.journal].indexOf(part), 1);
    if (fault === 'CORRUPT') part.details.payload += 'changed';
    if (fault === 'FOREIGN') part.company = 'GHR';
    await assert.rejects(f.service().inspect(request), /incomplete|Malformed/);
    await assert.rejects(f.service().metadataReader(request)({ company: 'NCT', checkpointId: 'a'.repeat(32), ordinal: 0 }), /incomplete|Malformed/);
  }
});

test('late authority, privacy or control change stops before confirmation and never modifies existing rows', async () => {
  for (const fault of ['ADMIN', 'PRIVACY', 'CONTROL']) {
    const f = fixture(); f.afterInsert(row => { if (row.action !== HEADER) return;
      if (fault === 'ADMIN') f.setAdmin({ isAdmin: true, memberId: 'OTHER' });
      if (fault === 'PRIVACY') f.setPrivacy(false);
      if (fault === 'CONTROL') f.control._version = 'CHANGED';
    });
    await assert.rejects(f.service().retain(request), /Administrator|retention|maintenance/);
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].action, HEADER);
  }
});

test('byte, fragment and exact browser-input policies refuse before any backup write', async () => {
  for (const policy of [{ maxBackupBytes: 100 }, { maxFragments: 1 }, { recordBudgetBytes: 2048, maxFragments: 64 }]) {
    const f = fixture(); Object.assign(f.args.policy, policy);
    await assert.rejects(f.service().retain(request), /policy/); assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.service().retain({ ...request, backup: {} }), /Original backup/);
  await assert.rejects(f.service().retain({ ...request, company: 'GHR' }), /Original backup/);
  assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
});

test('only exact reserved backup records are excluded; ordinary activity remains business evidence', async () => {
  const f = fixture(); await f.service().retain(request); const header = f.writes[0];
  assert.equal(isMaintenanceBackupRecord({ ...header, _updatedDate: new Date() }, 'NCT'), true);
  assert.equal(isMaintenanceBackupRecord({ _id: 'BUSINESS', action: 'PURCHASE_PLAN_SAVED', details: {} }, 'NCT'), false);
  assert.throws(() => isMaintenanceBackupRecord({ ...header, quantity: 80 }, 'NCT'), /Malformed/);
  f.db[f.journal].push({ ...copy(header), _id: 'BAD' });
  await assert.rejects(f.reader.read(), /Malformed/);
});

test('native backup roundtrip preserves nested legacy JSON property order as well as values', () => {
  const before = { z: { b: 0, a: 1 }, a: [new Date('2026-10-23T00:00:00.000Z'), 'literal'] };
  const restored = decode(JSON.parse(JSON.stringify(encode(before))));
  assert.equal(JSON.stringify(restored), JSON.stringify(before)); assert.equal(hash(restored.z), hash(before.z));
});

test('retained capture rejects missing/wrong initialization tokens, demand edits, extra rows and wrong ownership', async () => {
  for (const mode of ['MISSING_VERSION', 'WRONG_VERSION', 'DEMAND_EDIT', 'EXTRA_ROW', 'OWNER']) {
    const f = fixture(), service = f.service(), saved = await f.finish(service);
    const initialize = createMaintenanceMetadataInitializer({ company: f.company, items: f.items, authenticateAdmin: f.authenticateAdmin,
      verifyLegacyDrain: f.verifyLegacyDrain, readControl: f.readControl, readCapturedRow: service.metadataReader(request) });
    if (mode !== 'MISSING_VERSION') for (const ordinal of [0, 1]) await initialize.step({ checkpointId: saved.checkpointId, ordinal });
    if (mode === 'WRONG_VERSION') f.db[f.tasks][0].stockCommitVersion = 'UNRELATED';
    if (mode === 'DEMAND_EDIT') f.db[f.tasks][0].purchaseQtyInCtn = 79;
    if (mode === 'EXTRA_ROW') f.db.SharedSuppliers.push({ _id: 'NEW', title: 'NEW', companyName: 'Unexpected' });
    if (mode === 'OWNER') f.setAdmin({ isAdmin: true, memberId: 'OTHER' });
    const fresh = await f.reader.read(), capture = createRetainedMaintenanceCapture({ company: f.company, backupStore: service,
      readSnapshot: () => f.reader.read(), backupRequest: request });
    await assert.rejects(capture({ company: f.company, checkpointId: fresh.expected.checkpointId }), /metadata initialization|cohort changed|Original bounded/);
  }
});

for (const company of ['NCT', 'GHR']) test(company + ' complete candidate pipeline retains native input, initializes, migrates under its own lock and verifies installed lifecycle', async () => {
  const f = fixture(company), control = clone(f.control); control.stockCommitVersion = control._version; delete control._version;
  f.db[f.journal].push(control);
  // Use only actual declared native DateTime fields in the conditional domain
  // images; nested JSON text stays JSON, not an invented schema conversion.
  delete f.db[f.tasks][0].native.date; f.db[f.tasks][0].lastCostCaptureTime = new Date('2026-10-23T06:00:00.000Z');
  const original = clone(f.db[f.tasks][0]), readControl = () => f.sdkStore.read(f.journal, f.control._id);
  const reader = createMaintenanceSnapshotReader({ company, items: f.items, store: f.sdkStore,
    protocol: { readControl, readSnapshot: async fn => {
      const before = await readControl(); assert.equal(before.pending, null); const rows = await fn(before);
      assert.ok(same(before, await readControl())); return { rows, generation: before.generation };
    } }, authenticateAdmin: f.authenticateAdmin, verifyLegacyDrain: f.verifyLegacyDrain,
    projectPurchaseWorkspace, projectStockCard, projectPurchaseOrders,
    limits: Object.fromEntries(Object.keys(f.db).map(name => [name, 1000])), maxBackupBytes: 200000, pageSize: 10 });
  Object.assign(f.args, { store: f.sdkStore, readControl, readSnapshot: () => reader.read() });
  const backups = f.service(), saved = await f.finish(backups);
  const initialize = createMaintenanceMetadataInitializer({ company, items: f.items, authenticateAdmin: f.authenticateAdmin,
    verifyLegacyDrain: f.verifyLegacyDrain, readControl, readCapturedRow: backups.metadataReader(request) });
  for (const ordinal of [0, 1]) await initialize.step({ checkpointId: saved.checkpointId, ordinal });
  const beforeMigration = await reader.read(), migrationInput = { requestId: '77777777-1111-4111-8111-111111111111', checkpointId: beforeMigration.expected.checkpointId };
  const installed = createMaintenanceInstalledReader({ company, items: f.items, store: f.sdkStore, readControl,
    authenticateAdmin: f.authenticateAdmin, verifyLegacyDrain: f.verifyLegacyDrain,
    limits: { positions: 100, claims: 100, products: 100, transfers: 100, taskRows: 100 }, maxSnapshotBytes: 200000, pageSize: 10 });
  const migration = createMaintenanceMigration({ company, store: f.sdkStore, authenticateAdmin: f.authenticateAdmin,
    verifyLegacyDrain: f.verifyLegacyDrain, readInstalled: installed, protocolOptions: { stepsPerInvocation: 2 },
    capture: createRetainedMaintenanceCapture({ company, backupStore: backups, backupRequest: request,
      readSnapshot: owned => owned ? reader.readOwnedMigration(owned) : reader.read() }) });
  let outcome;
  for (let i = 0; i < 30; i++) { outcome = await migration.apply(migrationInput); if (outcome.ok) break; assert.equal(outcome.pending, true); }
  assert.equal(outcome.ok, true); assert.equal((await migration.inspect(migrationInput)).lifecycleVerified, true);
  const after = f.db[f.tasks][0];
  assert.equal(after.quantity, original.quantity); assert.equal(after.purchaseQtyInCtn, original.purchaseQtyInCtn);
  assert.equal(hash(after.originalCostSnapshot), hash(original.originalCostSnapshot));
  assert.deepEqual(after.lastCostCaptureTime, original.lastCostCaptureTime);
  assert.equal(after.stockCounterSchema, 2); assert.equal(after.stockCounterGeneration, 1); assert.equal(after.stockDispatchedCumulative, 0);
  assert.equal(f.db.StockProducts[0].onHand, 0); assert.equal(f.db.StockProducts[0].status, 'CLOSED');
  assert.equal((await readControl()).mode, 'MAINTENANCE'); assert.equal((await readControl()).generation, 1);
});
