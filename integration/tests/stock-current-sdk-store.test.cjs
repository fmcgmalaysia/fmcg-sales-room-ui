const test = require('node:test'), assert = require('node:assert/strict');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
function fixture() {
  const rows = new Map(), delayed = [];
  let fault = null;
  const key = (c, id) => c + '/' + id;
  const matching = (row, condition) => Object.entries(condition).every(([field, value]) => row?.[field] === value.$eq);
  const items = {
    query: c => {
      let id, limit;
      const query = { eq: (field, value) => { assert.equal(field, '_id'); id = value; return query; },
        limit: value => { limit = value; return query; }, find: async options => {
          assert.equal(options.consistentRead, true); assert.equal(limit, 2);
          const row = rows.get(key(c, id)); return { items: row ? [copy(row)] : [] };
        } };
      return query;
    },
    insert: async (c, row) => {
      if (rows.has(key(c, row._id))) throw Error('Duplicate');
      rows.set(key(c, row._id), { ...copy(row), _updatedDate: 'SYSTEM' }); return copy(rows.get(key(c, row._id)));
    },
    patch: (c, id) => {
      const changes = [];
      const patch = { setField: (field, value) => { changes.push({ field, value: copy(value) }); return patch; },
        removeField: field => { changes.push({ field, remove: true }); return patch; },
        run: async options => {
          const apply = () => {
            const row = rows.get(key(c, id));
            if (!matching(row, options.condition)) throw Error('WDE0193: Update condition not met.');
            const next = copy(row);
            for (const change of changes) { if (change.remove) delete next[change.field]; else next[change.field] = change.value; }
            rows.set(key(c, id), next); return copy(next);
          };
          if (fault?.(c, id)) { fault = null; delayed.push(apply); throw Error('Unknown outcome'); }
          return apply();
        } };
      return patch;
    },
    remove: async (c, id, options) => {
      const row = rows.get(key(c, id));
      if (!matching(row, options.condition)) throw Error('WDE0193: Remove condition not met.');
      rows.delete(key(c, id)); return copy(row);
    }
  };
  const store = createSdkConditionalStore({ items, company: 'NCT',
    collections: ['NCTActivity', 'StockPositions', 'StockClaims', 'StockProducts'] });
  return { store, rows, delayed, items, delay: predicate => { fault = predicate; } };
}
test('SDK adapter maps internal version, strips only system metadata and preserves user payload', async () => {
  const f = fixture();
  await f.store.insert('StockPositions', { _id: 'A', company: 'NCT', _version: 'V0', quantity: 20, obsolete: true });
  assert.deepEqual(await f.store.read('StockPositions', 'A'), { _id: 'A', company: 'NCT', quantity: 20, obsolete: true, _version: 'V0' });
  await f.store.compareAndSet('StockPositions', 'A', 'V0', { _id: 'A', company: 'NCT', _version: 'V1', quantity: 19 });
  assert.equal((await f.store.read('StockPositions', 'A')).obsolete, undefined);
  assert.equal(f.rows.get('StockPositions/A').stockCommitVersion, 'V1');
  await assert.rejects(f.store.compareAndSet('StockPositions', 'A', 'V0', { _id: 'A', company: 'NCT', _version: 'OLD', quantity: 999 }), /version conflict/);
});
test('SDK adapter rejects cross-company records, unlisted collections and same-version writes', async () => {
  const f = fixture();
  await assert.rejects(f.store.insert('NCTOrders', { _id: 'A', company: 'NCT' }), /scope/);
  await assert.rejects(f.store.insert('StockPositions', { _id: 'A', company: 'GHR' }), /owned storage/);
  await assert.rejects(f.store.compareAndSet('StockPositions', 'A', 'V0', { _id: 'A', company: 'NCT', _version: 'V0' }), /Fresh conditional/);
  f.rows.set('StockPositions/A', { _id: 'A', company: 'GHR' });
  await assert.rejects(f.store.read('StockPositions', 'A'), /company conflict/);
});
test('protocol plus SDK adapter fences a late old physical write after generation2', async () => {
  const f = fixture(), p = createFencedProof({ store: f.store }); await p.initialize();
  await f.store.insert('StockPositions', { _id: 'S', company: 'NCT', _version: 'V0', quantity: 20 });
  const request = n => ({ requestId: uuid(n), memberId: 'STAFF', input: { amount: 10 }, prepare: async () => {
    const before = await f.store.read('StockPositions', 'S');
    return { writes: [{ collection: 'StockPositions', before, after: { ...before, quantity: before.quantity - 10 } }] };
  } });
  f.delay(c => c === 'StockPositions');
  await assert.rejects(p.commit(request(1)), /Unknown outcome/);
  await p.commit(request(1)); await p.commit(request(2));
  assert.throws(f.delayed[0], /WDE0193/);
  assert.equal((await f.store.read('StockPositions', 'S')).quantity, 0);
  assert.equal((await p.readControl()).generation, 2);
});
test('SDK lock removal checks execution identity and does not delete another attempt', async () => {
  const f = fixture(); await f.store.insert('NCTActivity', { _id: 'LOCK', company: 'NCT', attempt: 'NEW' });
  await assert.rejects(f.store.compareAndRemove('NCTActivity', 'LOCK', 'OLD'), /WDE0193/);
  assert.equal((await f.store.read('NCTActivity', 'LOCK')).attempt, 'NEW');
  await f.store.compareAndRemove('NCTActivity', 'LOCK', 'NEW');
  assert.equal(await f.store.read('NCTActivity', 'LOCK'), null);
});
test('server JSON field ordering does not cause false image conflicts', async () => {
  const f = fixture();
  const store = { ...f.store, read: async (c, id) => {
    const row = await f.store.read(c, id);
    return row && Object.fromEntries(Object.entries(row).reverse());
  } };
  const p = createFencedProof({ store }); await p.initialize();
  await store.insert('StockPositions', { _id: 'S', company: 'NCT', _version: 'V0', quantity: 20 });
  await p.commit({ requestId: uuid(1), memberId: 'STAFF', input: {}, prepare: async () => {
    const before = await store.read('StockPositions', 'S');
    return { writes: [{ collection: 'StockPositions', before,
      after: { ...before, quantity: 19, extra: { z: 1, a: 2 } } }] };
  } });
  assert.equal((await store.read('StockPositions', 'S')).quantity, 19);
});
