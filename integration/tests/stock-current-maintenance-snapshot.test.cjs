const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { createMaintenanceSnapshotReader } = require('../prototypes/stock-current-state/maintenance-snapshot-reader.cjs');
const { encodeMaintenanceNativeImage: encode, decodeMaintenanceNativeImage: decode } = require('../prototypes/stock-current-state/maintenance-native-images.cjs');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const { prepareMaintenanceMigration } = require('../prototypes/stock-current-state/maintenance-migration.cjs');
const { projectPurchaseWorkspace } = load('purchaseProjection.js');
const { projectStockCard } = load('../prototypes/stock-current-state/stockCardProjection.candidate.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const clone = row => decode(encode(row));

function fixture(company = 'NCT') {
  const orders = company === 'NCT' ? 'NCTOrders' : 'NCTOrders1', tasks = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1';
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const stamp = new Date('2026-10-23T05:00:00.000Z');
  const row = (_id, fields) => ({ _id, _updatedDate: new Date(stamp), ...fields });
  const db = {
    [orders]: [row('O', { company, stockCommitVersion: 'O0', title: 'ORDER', sourceLineId: 'LINE', submissionId: 'SUB', customerId: 'C',
      customerCompanyName: 'Customer', description: '001', image: 'Item', imageAltText: '12 x 1', orderId: 12, orderQtyInCtn: 80,
      transactionCurrency: 'MYR', masterReceivedTime: new Date(stamp) })],
    [tasks]: [row('T', { company, stockCommitVersion: 'T0', title: 'T', description: 'ORDER', imageAltText: 'LINE', purchaseQtyInCtn: 80,
      receivedQtyInCtn: null, lpCtn: 12, lpPc: 1, disc1: 0, disc2: 0, disc3: 0, manualCostField: [], lastCostCaptureTime: new Date(stamp),
      untouched: { zero: 0, text: stamp.toISOString(), dates: [new Date(stamp)] } })],
    [journal]: [row('A', { title: 'A', action: 'ORDER_RECEIVED', result: 'ACCEPTED', description: 'ORDER', activityTime: new Date(stamp),
      details: { submissionId: 'SUB', taskIds: ['T'] } })],
    SharedSuppliers: [row('S1', { title: 'SUP', companyName: 'Supplier' }), row('S2', { title: 'SUP2', companyName: 'Other supplier' })],
    PurchaseOrders: [row('PO1', { company: company === 'NCT' ? 'GHR' : 'NCT', stockCommitVersion: 'P0' })],
    StockPositions: [], StockClaims: [], StockProducts: []
  };
  const calls = [], control = { _id: hash(company, 'STOCK_CONTROL'), company, mode: 'MAINTENANCE', schemaVersion: 1,
    transferIndexVersion: 2, generation: 0, pending: null, _version: 'C0' };
  let admin = { memberId: 'ADMIN', isAdmin: true }, drain = true, onPage = null, projectorCalls = 0;
  const items = { query: collection => {
    const filters = []; let skip = 0, size;
    const query = { eq: (key, value) => { filters.push([key, value]); return query; }, ascending: key => { assert.equal(key, '_id'); return query; },
      skip: value => { skip = value; return query; }, limit: value => { size = value; return query; },
      find: async options => {
        assert.deepEqual(options, { consistentRead: true, returnTotalCount: true }); calls.push({ collection, skip, size, filters });
        const all = db[collection].filter(row => filters.every(([key, value]) => row[key] === value)).sort((a, b) => a._id < b._id ? -1 : 1);
        const result = { items: all.slice(skip, skip + size).map(clone), totalCount: all.length };
        if (onPage) await onPage(collection, skip, result);
        return result;
      } }; return query;
  } };
  const sdkStore = createSdkConditionalStore({ company, collections: Object.keys(db), items: { ...items, insert() {}, patch() {}, remove() {} },
    dateTimeFields: { [orders]: ['masterReceivedTime'], [tasks]: ['lastCostCaptureTime'] } });
  const args = { company, items, store: sdkStore, protocol: { readControl: async () => clone(control),
    readSnapshot: async fn => {
      const before = clone(control); if (before.pending) throw Error('Pending');
      const rows = await fn(before); if (control._version !== before._version) throw Error('Changed');
      return { rows, generation: control.generation };
    } },
    authenticateAdmin: async () => clone(admin), verifyLegacyDrain: async () => drain,
    projectPurchaseWorkspace: input => { projectorCalls++; return projectPurchaseWorkspace(input); }, projectStockCard, projectPurchaseOrders,
    limits: Object.fromEntries(Object.keys(db).map(key => [key, 20])), maxBackupBytes: 1000000, pageSize: 1 };
  return { args, db, calls, control, orders, tasks, journal, reader: () => createMaintenanceSnapshotReader(args),
    setAdmin: value => { admin = value; }, setDrain: value => { drain = value; }, onPage: fn => { onPage = fn; },
    get projectorCalls() { return projectorCalls; } };
}

for (const company of ['NCT', 'GHR']) test(company + ' complete native capture composes original projectors and existing migration planner, without writes', async () => {
  const f = fixture(company), r = await f.reader().read();
  assert.equal(r.complete, true); assert.equal(r.emptyCurrentConfirmed, true); assert.equal(r.durableBackupConfirmed, false);
  assert.equal(r.context.tasks[0].requested, 80); assert.equal(r.taskRows[0]._version, 'T0');
  assert.equal(r.taskRows[0].lastCostCaptureTime, '2026-10-23T05:00:00.000Z');
  assert.equal(r.metadataRows.length, 0); assert.deepEqual(r.existing.transfers, []);
  assert.deepEqual(r.expected.counts, { positions: 0, claims: 0, products: 1, tasks: 1 });
  const prepared = prepareMaintenanceMigration({ company, ...r });
  assert.equal(prepared.writes.find(w => w.collection === 'StockProducts').after.onHand, 0);
  assert.equal(prepared.writes.find(w => w.collection === f.tasks).after.stockCounterGeneration, 1);
  const persisted = JSON.parse(JSON.stringify(r.backup)), original = decode(persisted.payload);
  assert.equal(persisted.backupId, hash('MAINTENANCE_NATIVE_BACKUP_V1', persisted.payload));
  assert.ok(original.tables[f.tasks][0]._updatedDate instanceof Date);
  assert.ok(original.tables[f.tasks][0].untouched.dates[0] instanceof Date);
  assert.equal(original.tables[f.tasks][0].untouched.text, '2026-10-23T05:00:00.000Z');
  assert.equal(original.tables[f.tasks][0].untouched.zero, 0); assert.equal(original.tables.PurchaseOrders.length, 0);
  assert.equal(original.tables.SharedSuppliers.length, 2); assert.equal(r.metrics.queries, 18);
  assert.equal(f.calls.some(call => call.collection === (company === 'NCT' ? 'NCTOrders1' : 'NCTOrders')), false);
  const second = await f.reader().capture({ company, checkpointId: r.expected.checkpointId });
  assert.equal(second.expected.checkpointId, r.expected.checkpointId, 'fetchedAt/session fields must not change business checkpoint');
});

test('unversioned native task/date and shared PO remain in backup and block apply; no zero or ownership inference', async () => {
  const f = fixture(); delete f.db[f.tasks][0].company; delete f.db[f.tasks][0].stockCommitVersion;
  f.db.PurchaseOrders.push({ _id: 'PO2', company: 'NCT', _updatedDate: new Date('2026-10-23T00:00:00.000Z'), quantity: 0 });
  const r = await f.reader().read();
  assert.equal(r.metadataRows.length, 2); assert.ok(r.metadataRows.every(entry => entry.row._updatedDate instanceof Date));
  assert.ok(r.expected.blockers.includes('TASK_VERSION_INITIALIZATION_NOT_VERIFIED'));
  assert.ok(r.expected.blockers.includes('LEGACY_VERSION_INITIALIZATION_NOT_VERIFIED'));
  assert.equal(Object.hasOwn(r.metadataRows[0].row, 'company'), false);
  assert.throws(() => prepareMaintenanceMigration({ company: 'NCT', ...r }), /Verified maintenance/);
  delete f.db.PurchaseOrders[0].company;
  await assert.rejects(f.reader().read(), /company conflict/);
});

test('no Admin/drain/control or missing limits refuses before business queries/projectors', async () => {
  const f = fixture(); f.setAdmin({ memberId: 'MEMBER', isAdmin: false });
  await assert.rejects(f.reader().read(), /Administrator/); assert.equal(f.calls.length, 0);
  f.setAdmin({ memberId: 'ADMIN', isAdmin: true }); f.setDrain(undefined);
  await assert.rejects(f.reader().read(), /drain/); assert.equal(f.calls.length, 0);
  f.setDrain(true); f.control.mode = 'ACTIVE'; await assert.rejects(f.reader().read(), /control/); assert.equal(f.calls.length, 0);
  delete f.args.limits[f.tasks]; assert.throws(f.reader, /budgets/); assert.equal(f.projectorCalls, 0);
});

test('truncated, over-budget, duplicate, foreign and changed pages refuse without a successful partial capture', async () => {
  for (const mode of ['TRUNCATED', 'BUDGET', 'DUPLICATE', 'FOREIGN', 'TOTAL_CHANGED']) {
    const f = fixture();
    if (mode === 'BUDGET') f.args.limits.SharedSuppliers = 1;
    f.onPage((collection, skip, page) => {
      if (collection !== 'SharedSuppliers') return;
      if (mode === 'TRUNCATED') page.items = [];
      if (mode === 'DUPLICATE' && skip === 1) page.items[0]._id = 'S1';
      if (mode === 'TOTAL_CHANGED' && skip === 1) page.totalCount = 3;
    });
    if (mode === 'FOREIGN') f.db[f.tasks][0].company = 'GHR';
    await assert.rejects(f.reader().read(), /Incomplete|Distinct|company conflict/);
    assert.equal(f.projectorCalls, 0);
  }
});

test('late Admin/drain/control change invalidates the entire capture and changed checkpoint cannot be adopted', async () => {
  for (const mode of ['ADMIN', 'DRAIN', 'CONTROL']) {
    const f = fixture(); f.onPage(collection => {
      if (collection === 'StockProducts') {
        if (mode === 'ADMIN') f.setAdmin({ memberId: 'OTHER', isAdmin: true });
        if (mode === 'DRAIN') f.setDrain(false);
        if (mode === 'CONTROL') f.control.writerBuild = 'UNEXPECTED';
      }
    });
    await assert.rejects(f.reader().read(), /administrator changed|drain|control changed/);
  }
  const f = fixture(), r = await f.reader().read(); f.db[f.tasks][0].purchaseQtyInCtn = 79;
  await assert.rejects(f.reader().capture({ company: 'NCT', checkpointId: r.expected.checkpointId }), /checkpoint changed/);
  await assert.rejects(f.reader().read({ drained: true }), /no browser/);
  await assert.rejects(f.reader().capture({ company: 'GHR', checkpointId: r.expected.checkpointId }), /identity/);
});

test('complete raw orphan task cannot disappear behind the original projected task filter', async () => {
  const f = fixture(); f.db[f.tasks].push({ ...clone(f.db[f.tasks][0]), _id: 'U', title: 'U', description: 'UNACCEPTED' });
  await assert.rejects(f.reader().read(), /Complete exact legacy task snapshot/);
});

test('tagged durable images distinguish actual Dates, strings, arrays, null and prototype-named keys', () => {
  const original = JSON.parse('{"__proto__":{"safe":true},"n":null,"zero":0,"text":"2026-10-23T00:00:00.000Z"}');
  original.date = new Date(original.text); original.negativeZero = -0; original.array = [0, '', false, null, new Date(original.text)];
  const restored = decode(JSON.parse(JSON.stringify(encode(original))));
  assert.deepEqual(restored, original); assert.equal(Object.getPrototypeOf(restored), Object.prototype);
  assert.throws(() => encode({ value: undefined }), /Supported/);
  assert.throws(() => encode(new Date('bad')), /Valid native/);
  assert.throws(() => encode(new Array(2)), /Dense/);
  assert.throws(() => decode(['OBJECT', [['same', ['TEXT', '1']], ['same', ['TEXT', '2']]]]), /Valid exact/);
  assert.throws(() => decode(['DATE', original.text.replace('.000', '')]), /Valid exact/);
});

test('private byte budget and pre-existing stock block migration without discarding complete evidence', async () => {
  const f = fixture(); f.args.maxBackupBytes = 200;
  await assert.rejects(f.reader().read(), /byte budget/); assert.equal(f.projectorCalls, 0);
  const g = fixture(); g.db.StockProducts.push({ _id: 'P', company: 'NCT', stockCommitVersion: 'P0', onHand: null, status: 'CLOSED' });
  const report = await g.reader().read();
  assert.equal(report.emptyCurrentConfirmed, false); assert.equal(report.expected.canBootstrap, false);
  assert.ok(report.expected.blockers.includes('CURRENT_ROWS_ALREADY_EXIST_NO_OVERWRITE'));
  assert.equal(report.existing.products[0].onHand, null); assert.equal(report.existing.products[0].status, 'CLOSED');
});

test('same-count native edits and replacements during capture are refused, not declared stable from counts alone', async () => {
  for (const mode of ['EDIT', 'REPLACE']) {
    const f = fixture(); let changed = false;
    f.onPage(collection => {
      if (!changed && collection === 'StockProducts') {
        changed = true;
        if (mode === 'EDIT') f.db[f.tasks][0].untouched.zero = 1;
        else f.db[f.tasks][0]._id = 'U';
      }
    });
    await assert.rejects(f.reader().read(), /native cohort changed/);
  }
});
