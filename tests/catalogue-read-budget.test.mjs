import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueReadBudget } from '../backend/catalogueReadBudget.js';
import { createProtectedCatalogueRead } from '../backend/protectedCatalogueRead.js';

function fixture() {
  let time = 900;
  const rows = new Map();
  const store = {
    async read(key) { return structuredClone(rows.get(key)); },
    async replaceIfVersion(key, version, next) {
      if ((rows.get(key)?.version ?? 0) !== version) return false;
      rows.set(key, { ...next, version: version + 1 });
      return true;
    }
  };
  const rule = { bucketMs: 1000, buckets: 2, limit: 50 };
  const policy = { CATALOGUE_LIST: rule, CATALOGUE_DETAIL: { ...rule, limit: 2 }, BUYER_IMAGE: { ...rule, limit: 1 } };
  return { reserve: createCatalogueReadBudget({ store, policy, now: () => time }), rows, setTime: t => { time = t; } };
}
const alpha = { actorId: 'member', customerId: 'Alpha' };
const beta = { actorId: 'member', customerId: 'Beta' };

test('concurrent tabs in two companies share one budget and record the company of the denied read', async () => {
  const { reserve, rows } = fixture();
  const actors = [alpha, beta, beta, alpha, beta, alpha];
  const results = await Promise.all(actors.map(actor => reserve(actor, 'CATALOGUE_LIST', 25)));
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(rows.size, 1);
  const [row] = rows.values();
  assert.equal(row.usage.CATALOGUE_LIST[0].units, 50);
  assert.equal(row.denials.CATALOGUE_LIST.companyId, actors[results.indexOf(false)].customerId);
  assert.equal(row.version, 3);
});

test('a bucket transition does not immediately release quota, and restrictions expire', async () => {
  const { reserve, setTime } = fixture();
  assert.equal(await reserve(alpha, 'BUYER_IMAGE', 1), true);
  setTime(1001);
  assert.equal(await reserve(beta, 'BUYER_IMAGE', 1), false);
  assert.equal(await reserve(beta, 'CATALOGUE_DETAIL', 1), true);
  assert.equal(await reserve({ ...beta, actorId: 'other-member' }, 'BUYER_IMAGE', 1), true);
  setTime(3001);
  assert.equal(await reserve(beta, 'BUYER_IMAGE', 1), true);
});

test('malformed stored usage cannot reopen the download budget', async () => {
  for (const invalid of [ [{tick:0}], [{tick:0, units:-5}], [{tick:'0',units:1}], {} ]) {
    const {reserve, rows} = fixture();
    assert.equal(await reserve(alpha, 'BUYER_IMAGE', 1), true);
    const row = [...rows.values()][0];
    row.usage.BUYER_IMAGE = invalid;
    assert.equal(await reserve(alpha, 'BUYER_IMAGE', 1), false);
    assert.equal(row.version, 1);
  }
});

test('an unavailable ledger prevents delivery, including when the catalogue service calls it', async () => {
  const { reserve } = fixture();
  assert.equal(await reserve({}, 'CATALOGUE_LIST', 25), false);
  assert.equal(await reserve(alpha, 'unknown', 1), false);
  let queries = 0;
  const read = createProtectedCatalogueRead({
    authorize: async () => alpha, data: { query() { queries++; } },
    reserveRead: async () => { throw Error('Ledger unavailable'); }
  });
  await assert.rejects(read.list('Alpha'), /Ledger unavailable/);
  assert.equal(queries, 0);
});
