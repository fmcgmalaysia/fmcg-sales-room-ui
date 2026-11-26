import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueCoverage, readDeliveredCatalogueIds } from '../backend/catalogueCoverage.js';

const alpha = { actorId: 'buyer', customerId: 'A', companyName: 'QA Alpha' };
const beta = { ...alpha, customerId: 'B', companyName: 'QA Beta' };
const action = 'CATALOGUE_DETAIL';
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
  await reserve(alpha, action, ['detail-only']);
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
  assert.equal(await reserve(alpha, 'BUYER_IMAGE', ['e']), true);
});
