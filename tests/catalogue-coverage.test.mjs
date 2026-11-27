import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueCoverageKey, createCatalogueCoverage, readDeliveredCatalogueIds } from '../backend/catalogueCoverage.js';

const alpha = { actorId: 'buyer', customerId: 'A', companyName: 'QA Alpha' };
const beta = { ...alpha, customerId: 'B', companyName: 'QA Beta' };
const action = 'BUYER_IMAGE';
function fixture() {
  const rows = new Map();
  let time = 60000;
  const store = {
    async read(id) { return structuredClone(rows.get(id)); },
    async replaceIfVersion(id, version, fields) {
      if ((rows.get(id)?.version ?? 0) !== version) return false;
      rows.set(id, { ...fields, version: version + 1 });
      return true;
    }
  };
  const rule = { windowMs: 86400000, warnAt: 2, limit: 3 };
  const reserve = createCatalogueCoverage({
    store, now: () => time, policy: { CATALOGUE_DETAIL: rule, CATALOGUE_LIST: rule, BUYER_IMAGE: rule }
  });
  return { reserve, rows, store, now: () => time, advance: ms => { time += ms; } };
}

test('slow unique reads trigger warning and restriction across companies; repeated products stay available', async () => {
  const { reserve, advance, rows } = fixture();
  assert.equal(await reserve(alpha, action, ['a', 'a']), true);
  advance(60000);
  assert.equal(await reserve(beta, action, ['a', 'b']), true);
  advance(60000);
  assert.equal(await reserve(alpha, action, ['c']), true);
  advance(60000);
  assert.equal(await reserve(beta, action, ['d']), false);
  assert.equal(await reserve(alpha, action, ['b']), true);
  const [row] = rows.values();
  assert.equal(Object.keys(row.usage).length, 3);
  assert.equal(row.denials.warning.companyName, 'QA Beta');
  assert.equal(row.denials.restricted.deliveredUnique, 3);
  assert.equal(row.denials.restricted.attemptedNew, 1);
  assert.equal(row.denials.restricted.status, 'PENDING');
  advance(86400000);
  assert.equal(await reserve(beta, action, ['d']), true);
  assert.equal(Object.keys([...rows.values()][0].usage).length, 1);
});

test('thumbnail authorization reads the existing member list ledger without extending it', async () => {
  const { reserve, store, now, rows, advance } = fixture();
  await reserve(alpha, 'CATALOGUE_LIST', ['shown']);
  await reserve(alpha, 'CATALOGUE_DETAIL', ['detail-only']);
  const before = structuredClone(rows);
  const delivered = member => readDeliveredCatalogueIds(store, member, ['shown', 'detail-only'], 86400000, now);
  assert.deepEqual(await delivered(alpha), ['shown']);
  assert.deepEqual(await delivered({ ...alpha, actorId: 'another-member' }), []);
  assert.deepEqual(rows, before);
  advance(86400000);
  assert.deepEqual(await delivered(alpha), []);
});

test('concurrent reads do not exceed the unique limit or merge different accounts or actions', async () => {
  const { reserve } = fixture();
  const results = await Promise.all(['a', 'b', 'c', 'd'].map(id => reserve(alpha, action, [id])));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await reserve({ ...alpha, actorId: 'another-member' }, action, ['e']), true);
  assert.equal(await reserve(alpha, 'CATALOGUE_DETAIL', ['e']), true);
});

test('list and detail continue beyond the old daily limit while keeping warnings and image grants', async () => {
  const { reserve, store, now, rows } = fixture();
  for (const type of ['CATALOGUE_LIST', 'CATALOGUE_DETAIL']) {
    for (const [actor, ids] of [[alpha, ['a']], [beta, ['b', 'c']], [alpha, ['d', 'e']]]) {
      assert.equal(await reserve(actor, type, ids), true);
    }
    const row = rows.get(catalogueCoverageKey(alpha.actorId, type));
    assert.equal(Object.keys(row.usage).length, 5);
    assert.equal(row.denials.warning.companyName, 'QA Beta');
    assert.equal(row.denials.restricted, undefined);
  }
  assert.deepEqual(await readDeliveredCatalogueIds(store, alpha, ['d', 'e', 'unknown'], 86400000, now), ['d', 'e']);
});

test('large browsing histories remain bounded without turning into a daily block', async () => {
  const { reserve, store, now, rows, advance } = fixture();
  for (let i = 0; i < 161; i++) {
    advance(1000);
    const ids = Array.from({ length: 50 }, (_, j) => 'item-' + (i * 50 + j));
    assert.equal(await reserve(alpha, 'CATALOGUE_LIST', ids), true);
  }
  const row = rows.get(catalogueCoverageKey(alpha.actorId, 'CATALOGUE_LIST'));
  assert.equal(Object.keys(row.usage).length, 8000);
  assert.deepEqual(await readDeliveredCatalogueIds(store, alpha, ['item-0', 'item-50', 'item-8049'], 86400000, now), ['item-50', 'item-8049']);
});
