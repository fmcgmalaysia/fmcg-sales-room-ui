'use strict';
// Review witnesses only. All stores/files are in-memory; no lock is removed or
// adopted while an external execution is suspended, and no native timeout is retried.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const filename = require.resolve('./stock-current-order-file-fence.test.cjs');
const fixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test=require('node:test')", 'const test=()=>{}') + ';fixture;',
  { require: createRequire(filename), __dirname, Buffer, Map });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const databaseRequest = { requestId: '99999999-1111-4111-8111-111111111111', memberId: 'OTHER', input: { action: 'DB' },
  prepare: async () => ({ writes: [{ collection: 'StockProducts', before: null, after: { _id: 'NEW_PRODUCT', company: 'NCT', onHand: 0 } }] }) };

test('a suspended original file callback retains its pending barrier against both same-file retry and a different CAS writer', async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  await f.save(f.request); f.late(async () => { entered.resolve(); await release.promise; });
  const old = f.save(f.request); await entered.promise;
  await assert.rejects(f.save(f.request), /Duplicate/);
  const db = createSegmentedFencedProof({ company: 'NCT', store: f.store, domainWrites: true, coordination: 'CONTROL_CAS_CANDIDATE' });
  await assert.rejects(db.commit(databaseRequest), /Prior inventory save pending/);
  await assert.rejects(db.readSnapshot(async () => []), /pending/);
  assert.equal(f.effects.length, 1); assert.equal(f.db.get('PurchaseOrders/' + f.request.input.id).details.audit.length, 0);
  // Only the original callback completion releases its own lock. No elapsed-time
  // inference, delete, takeover or fake receipt is used by the retry.
  release.resolve(); await old; f.late(null); await f.finish();
  assert.equal((await db.commit(databaseRequest)).ok, true);
  assert.equal(f.db.get('PurchaseOrders/' + f.request.input.id).details.audit.length, 1);
});

test('control CAS and exclusive file entry racing before pending cannot both select different manifests', async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const original = f.store.compareAndSet; let held = false;
  f.store.compareAndSet = async (c, id, version, row) => {
    if (!held && id === f.original.ids.controlId && row.pending?.phase === 'BEFORE') {
      held = true; entered.resolve(); await release.promise;
    }
    return original(c, id, version, row);
  };
  const old = f.save(f.request).then(value => ({ value }), error => ({ error })); await entered.promise;
  const db = createSegmentedFencedProof({ company: 'NCT', store: f.store, domainWrites: true, coordination: 'CONTROL_CAS_CANDIDATE' });
  assert.equal((await db.commit(databaseRequest)).ok, true);
  release.resolve(); assert.ok((await old).error);
  assert.equal(f.effects.length, 0); assert.equal((await db.readControl()).generation, 1);
  assert.equal(f.db.get('PurchaseOrders/' + f.request.input.id).details.audit.length, 0);
});
