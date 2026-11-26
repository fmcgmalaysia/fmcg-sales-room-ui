import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueBudgetStore } from '../backend/catalogueBudgetStore.js';

const state = { usage: {}, denials: {} };
function fixture() {
  const rows = new Map();
  const data = {
    query() {
      let key;
      return {
        eq(_, id) { key = id; return this; },
        limit() { return this; },
        async find(options) {
          assert.equal(options.consistentRead, true);
          return { items: rows.has(key) ? [structuredClone(rows.get(key))] : [] };
        }
      };
    },
    async insert(_, row) {
      if (rows.has(row._id)) throw Error('duplicate');
      rows.set(row._id, structuredClone(row));
    }
  };
  async function patch(_, key, changes, { condition }) {
    const row = rows.get(key);
    if (row.version !== condition.version.$eq) return structuredClone(row);
    for (const change of changes) row[change.fieldPath] = change.value;
    return structuredClone(row);
  }
  return { rows, data, patch, store: createCatalogueBudgetStore({ data, patch, collection: 'QA' }) };
}

test('simultaneous creates and conditional updates each admit only one owner', async () => {
  const { store } = fixture();
  for (const version of [0, 1]) {
    const attempts = await Promise.all([store.replaceIfVersion('alpha', version, state), store.replaceIfVersion('alpha', version, state)]);
    assert.deepEqual(attempts.sort(), [false, true]);
  }
  assert.equal((await store.read('alpha')).version, 2);
});

test('a different reservation with the same next version is not a successful update', async () => {
  const { store } = fixture();
  await store.replaceIfVersion('alpha', 0, state);
  await store.replaceIfVersion('alpha', 1, state);
  assert.equal(await store.replaceIfVersion('alpha', 1, state), false);
});

test('an unavailable or damaged ledger never grants access', async () => {
  const { rows, data } = fixture();
  rows.set('broken', { version: 0 });
  const store = createCatalogueBudgetStore({ data, patch() { throw Error('offline'); }, collection: 'QA' });
  await assert.rejects(store.read('broken'), /unavailable/);
  await store.replaceIfVersion('alpha', 0, state);
  await assert.rejects(store.replaceIfVersion('alpha', 1, state), /offline/);
});
