const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { createSdkFieldCodec } = require('../prototypes/stock-current-state/sdk-field-codec.cjs');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const stamp = '2026-10-22T01:23:45.678Z';
const config = { collections: ['NCTActivity', 'StockProducts'], dateTimeFields: { NCTActivity: ['activityTime'] } };
test('only schema-listed top-level DateTime fields become SDK Date values', () => {
  const schema = { NCTActivity: ['activityTime'] }, codec = createSdkFieldCodec({ ...config, dateTimeFields: schema });
  schema.NCTActivity.push('message'); // schema is captured, not later widened by its caller
  assert.ok(codec.encode('NCTActivity', 'activityTime', stamp) instanceof Date);
  assert.equal(codec.encode('NCTActivity', 'message', stamp), stamp);
  assert.equal(codec.encode('StockProducts', 'activityTime', stamp), stamp);
  assert.deepEqual(codec.encode('NCTActivity', 'details', { activityTime: stamp }), { activityTime: stamp });
  assert.equal(codec.encode('NCTActivity', 'activityTime', null), null);
});
test('typed SDK reads canonicalize Date including cross-realm Dates, not ordinary strings', () => {
  const codec = createSdkFieldCodec(config);
  assert.equal(codec.decode('NCTActivity', 'activityTime', new Date(stamp)), stamp);
  assert.equal(codec.decode('NCTActivity', 'activityTime', vm.runInNewContext(`new Date('${stamp}')`)), stamp);
  for (const bad of [stamp, { $date: stamp }, new Date('invalid'), 0]) {
    assert.throws(() => codec.decode('NCTActivity', 'activityTime', bad), /type mismatch/);
  }
});
test('invalid/ambiguous dates reject before transport rather than rollover or timezone guessing', () => {
  const codec = createSdkFieldCodec(config);
  for (const bad of ['2026-02-30T01:23:45.678Z', '2026-10-22', '2026-10-22T01:23:45Z',
    '2026-10-22T09:23:45.678+08:00', new Date('invalid'), {}, 123]) {
    assert.throws(() => codec.encode('NCTActivity', 'activityTime', bad), /DateTime/);
  }
  assert.throws(() => codec.encode('Foreign', 'activityTime', stamp), /scope/);
  for (const fields of [{ Foreign: ['activityTime'] }, { NCTActivity: ['company'] },
    { NCTActivity: ['details.time'] }, { NCTActivity: ['activityTime', 'activityTime'] }]) {
    assert.throws(() => createSdkFieldCodec({ ...config, dateTimeFields: fields }), /scope/);
  }
});
function fixture({ corruptRead = false } = {}) {
  let record = null, writes = 0;
  const items = {
    query: () => { const q = { eq: () => q, limit: () => q, find: async () => ({ items: record ? [structuredClone(record)] : [] }) }; return q; },
    insert: async (_collection, row) => {
      assert.ok(row.activityTime instanceof Date, 'actual SDK argument must remain a Date, not JSON-cloned');
      writes++; record = structuredClone(row);
      return corruptRead ? { ...record, activityTime: stamp } : structuredClone(record);
    },
    patch: () => { const changes = new Map(), removed = [];
      const p = { setField: (key, value) => { changes.set(key, value); return p; },
        removeField: key => { removed.push(key); return p; }, run: async ({ condition }) => {
          assert.equal(condition.stockCommitVersion.$eq, record.stockCommitVersion);
          assert.equal(condition.company.$eq, 'NCT');
          assert.ok(changes.get('activityTime') instanceof Date);
          writes++; for (const key of removed) delete record[key];
          for (const [key, value] of changes) record[key] = structuredClone(value);
          return structuredClone(record);
        } }; return p;
    },
    remove: async () => { throw Error('No delete authorized in this fixture'); }
  };
  return { store: createSdkConditionalStore({ ...config, items, company: 'NCT' }), writes: () => writes,
    stored: () => structuredClone(record), corrupt: () => { record.activityTime = stamp; } };
}
test('conditional adapter preserves canonical journal images across typed SDK insert/read/CAS', async () => {
  const f = fixture(), first = { _id: 'DATE-TEST', company: 'NCT', _version: 'V0', activityTime: stamp,
    message: stamp, details: { activityTime: stamp }, obsolete: true };
  assert.deepEqual(await f.store.insert('NCTActivity', first), first);
  assert.ok(f.stored().activityTime instanceof Date);
  const after = { ...first, _version: 'V1', activityTime: '2026-10-23T00:00:00.000Z' }; delete after.obsolete;
  assert.deepEqual(await f.store.compareAndSet('NCTActivity', first._id, 'V0', after), after);
  assert.deepEqual(await f.store.read('NCTActivity', first._id), after);
  assert.equal(f.stored().message, stamp); assert.equal(f.stored().obsolete, undefined);
  assert.equal(f.writes(), 2);
  await assert.rejects(f.store.compareAndSet('NCTActivity', first._id, 'V0', after), /version conflict/);
});
test('read type corruption fails closed and does not produce a verified save or further write', async () => {
  const f = fixture({ corruptRead: true });
  await assert.rejects(f.store.insert('NCTActivity', { _id: 'DATE-TEST', company: 'NCT', activityTime: stamp }), /type mismatch/);
  assert.equal(f.writes(), 1, 'unknown outcome is retained, not automatically undone');
  f.corrupt(); await assert.rejects(f.store.read('NCTActivity', 'DATE-TEST'), /type mismatch/);
  assert.equal(f.writes(), 1);
});
