// Offline cutover review only. A PASS of the second test demonstrates UNSAFETY,
// not permission to migrate, delete a native lock, or activate current stock.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createOperationJournal, operationId } = load('purchaseOperationJournal.js');
const { createPurchaseCostRetry } = load('purchaseCostRetry.js');
const staff = { memberId: 'MEMBER', staffId: 'PURCHASE', staffName: 'Synthetic Purchase' };
const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function latch() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function memory(rows = []) {
  const db = new Map(rows.map(([collection, row]) => [collection + ':' + row._id, structuredClone(row)]));
  const changes = [];
  const store = {
    async read(collection, id) { return structuredClone(db.get(collection + ':' + id) || null); },
    async one(collection, criteria) {
      const matches = [...db].filter(([key, row]) => key.startsWith(collection + ':')
        && Object.entries(criteria).every(([field, value]) => row[field] === value));
      assert.ok(matches.length <= 1);
      return structuredClone(matches[0]?.[1] || null);
    },
    async insert(collection, row) {
      const key = collection + ':' + row._id;
      if (db.has(key)) throw Error('Duplicate fixed identity');
      db.set(key, structuredClone(row)); changes.push(['INSERT', collection, row._id]);
      return structuredClone(row);
    },
    async update(collection, row) {
      assert.ok(db.has(collection + ':' + row._id));
      db.set(collection + ':' + row._id, structuredClone(row)); changes.push(['UPDATE', collection, row._id]);
      return structuredClone(row);
    },
    async remove(collection, id) { db.delete(collection + ':' + id); changes.push(['REMOVE', collection, id]); }
  };
  return { db, changes, store };
}

test('original company journal: a held fixed-ID barrier rejects a writer paused before unique lock insertion', async () => {
  const f = memory(), reached = latch(), resume = latch();
  const lockId = operationId('NCT/PURCHASE', 'LOCK'), insert = f.store.insert;
  f.store.insert = async (collection, row) => {
    if (row._id === lockId) { reached.release(); await resume.promise; }
    return insert(collection, row);
  };
  let applied = false;
  const pending = createOperationJournal({ store: f.store })({ collection: 'NCTActivity',
    scope: 'NCT/PURCHASE', requestId, staff, input: {}, prepare: async () => ({}),
    apply: async () => { applied = true; return { ok: true }; } });
  await reached.promise;
  // Direct test-store insertion represents maintenance winning the unique insert;
  // it is NOT a production maintenance implementation or native mutation.
  await insert('NCTActivity', { _id: lockId, details: { owner: 'MAINTENANCE' } });
  resume.release();
  await assert.rejects(pending, /Duplicate fixed identity/);
  assert.equal(applied, false);
  assert.equal((await f.store.read('NCTActivity', lockId)).details.owner, 'MAINTENANCE');
});

test('UNSAFE: original cost retry can delete a newer barrier after reading an expired previous lock, then write', async () => {
  const taskId = 'b'.repeat(32), lockId = operationId('NCT', taskId, 'COST_LOCK');
  const task = { _id: taskId, title: taskId, description: 'ORDER', imageAltText: 'LINE', originalCostSnapshot: {} };
  const f = memory([
    ['NCTTasks', task],
    ['NCTOrders', { _id: 'ORDER-LINE', title: 'ORDER', sourceLineId: 'LINE', submissionId: 'SUBMISSION', description: 'BARCODE', cbmCtn: 1 }],
    ['NCTActivity', { _id: 'RECEIPT', description: 'ORDER', action: 'ORDER_RECEIVED', result: 'ACCEPTED',
      details: { submissionId: 'SUBMISSION', taskIds: [taskId] } }],
    ['NCTActivity', { _id: lockId, activityTime: '2026-10-23T00:00:00.000Z', details: { owner: 'OLD' } }]
  ]);
  const reached = latch(), resume = latch(), remove = f.store.remove;
  let intercept = true;
  f.store.remove = async (collection, id) => {
    if (id === lockId && intercept) { intercept = false; reached.release(); await resume.promise; }
    return remove(collection, id);
  };
  const pending = createPurchaseCostRetry({ store: f.store, now: () => new Date('2026-10-23T00:10:00.000Z'),
    captureCosts: async () => ({ BARCODE: { unitBarcode: 'BARCODE', costCurrency: 'MYR', costStatus: 'CAPTURED',
      costIssues: [], capturedAt: '2026-10-23T00:10:00.000Z', lpPc: 1, lpCtn: 24 } })
  })({ company: 'NCT', taskId, requestId, staff });
  await reached.promise;
  // The earlier lock owner finishes; maintenance then legitimately wins a fresh
  // insert. The paused retry has already decided to delete by ID, not owner.
  await remove('NCTActivity', lockId);
  await f.store.insert('NCTActivity', { _id: lockId, activityTime: '2026-10-23T00:10:00.000Z', details: { owner: 'MAINTENANCE' } });
  const capture = structuredClone(f.db.get('NCTTasks:' + taskId));
  const afterBarrier = f.changes.length;
  resume.release();
  assert.equal((await pending).ok, true);
  assert.deepEqual(f.changes[afterBarrier], ['REMOVE', 'NCTActivity', lockId]);
  assert.ok(f.changes.slice(afterBarrier).some(([kind, collection]) => kind === 'UPDATE' && collection === 'NCTTasks'));
  assert.notDeepEqual(f.db.get('NCTTasks:' + taskId), capture);
  assert.equal(await f.store.read('NCTActivity', lockId), null);
});
