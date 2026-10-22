const test = require('node:test'), assert = require('node:assert/strict');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const stamp = '2026-10-22T01:23:45.678Z';
function fixture() {
  const rows = new Map(), calls = []; let change;
  const items = { query: collection => {
    let company, ids, limit;
    const q = { eq: (f, v) => { assert.equal(f, 'company'); company = v; return q; },
      hasSome: (f, v) => { assert.equal(f, '_id'); ids = [...v]; return q; },
      limit: n => { limit = n; return q; }, find: async options => {
        assert.deepEqual(options, { consistentRead: true, returnTotalCount: true });
        calls.push({ collection, ids, limit });
        const result = [...rows.values()].filter(r => ids.includes(r._id) && (company === undefined || r.company === company)).reverse();
        const page = { items: structuredClone(result.slice(0, limit)), totalCount: result.length };
        if (change) await change(page, calls.length); return page;
      } }; return q;
  }, insert: () => assert.fail('read only'), patch: () => assert.fail('read only'), remove: () => assert.fail('read only') };
  const store = createSdkConditionalStore({ company: 'NCT', items, collections: ['NCTTasks'], dateTimeFields: { NCTTasks: ['lastCostCaptureTime'] } });
  return { rows, calls, store, items, change: fn => { change = fn; } };
}
test('batched exact read preserves order, missing vs CLOSED zero, version and native dates without mutation', async () => {
  const f = fixture();
  for (let i = 0; i < 121; i++) f.rows.set('T' + i, { _id: 'T' + i, company: 'NCT', stockCommitVersion: 'V' + i,
    _updatedDate: new Date(), lastCostCaptureTime: new Date(stamp), status: 'CLOSED', quantity: 0 });
  const ids = Array.from({ length: 122 }, (_, i) => 'T' + i), result = await f.store.readMany('NCTTasks', ids);
  assert.equal(f.calls.length, 3); assert.ok(f.calls.every(c => c.ids.length <= 50 && c.limit === c.ids.length + 1));
  assert.equal(result.length, 122); assert.equal(result[121], null);
  result.slice(0, 121).forEach((row, i) => assert.deepEqual(row, { _id: 'T' + i, company: 'NCT', _version: 'V' + i,
    lastCostCaptureTime: stamp, status: 'CLOSED', quantity: 0 }));
  assert.deepEqual(await f.store.readMany('NCTTasks', []), []); assert.equal(f.calls.length, 3);
});
test('partial, duplicate, unexpected, foreign and corrupt typed results fail closed, never become missing', async () => {
  for (const kind of ['partial', 'duplicate', 'unexpected', 'foreign', 'date', 'count', 'missingCount', 'transport']) {
    const f = fixture(); f.rows.set('A', { _id: 'A', company: 'NCT', stockCommitVersion: 'V0', lastCostCaptureTime: new Date(stamp) });
    f.change(page => {
      if (kind === 'partial') page.items = [];
      if (kind === 'duplicate') { page.items.push({ ...page.items[0] }); page.totalCount = 2; }
      if (kind === 'unexpected') page.items[0]._id = 'OTHER';
      if (kind === 'foreign') page.items[0].company = 'GHR';
      if (kind === 'date') page.items[0].lastCostCaptureTime = stamp;
      if (kind === 'count') page.totalCount = -1;
      if (kind === 'missingCount') delete page.totalCount;
      if (kind === 'transport') throw Error('Permission or transport denied');
    });
    await assert.rejects(f.store.readMany('NCTTasks', ['A', 'B']), undefined, kind);
  }
});
test('invalid scope and duplicate IDs reject before I/O; a later batch failure returns no partial result', async () => {
  const f = fixture();
  for (const [collection, ids] of [['Foreign', ['A']], ['NCTTasks', ['A', 'A']], ['NCTTasks', ['']],
    ['NCTTasks', [null]], ['NCTTasks', Array.from({ length: 2001 }, (_, i) => String(i))]]) {
    await assert.rejects(f.store.readMany(collection, ids));
  }
  assert.equal(f.calls.length, 0);
  f.change((_page, count) => { if (count === 2) throw Error('Later batch denied'); });
  await assert.rejects(f.store.readMany('NCTTasks', Array.from({ length: 51 }, (_, i) => String(i))), /Later batch denied/);
});
test('readMany has no per-ID or old-reader fallback when hasSome is unavailable', async () => {
  const f = fixture(); f.items.query = () => ({ eq() { return this; } });
  await assert.rejects(f.store.readMany('NCTTasks', ['A']), /hasSome/);
});
test('an occupied foreign exact ID rejects instead of being hidden as missing by a company filter', async () => {
  const f = fixture(); f.rows.set('A', { _id: 'A', company: 'GHR', stockCommitVersion: 'V0' });
  await assert.rejects(f.store.readMany('NCTTasks', ['A']), /company conflict/);
});
