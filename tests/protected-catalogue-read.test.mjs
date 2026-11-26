import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedCatalogueRead } from '../backend/protectedCatalogueRead.js';

function fixture(grant = true, reserveCoverage = async () => true) {
  const calls = [];
  const rows = Array.from({ length: 101 }, (_, i) => ({
    _id: String(i).padStart(4, '0'), title: 'QA', pointBaseStatus: 'ACTIVE',
    image: 'private-original', countryOrigin: 'MY', cbm: 0, price: 24, internalCost: 40
  }));
  const data = { query() {
    let matches = rows;
    let limit;
    return {
      eq(k, v) { matches = matches.filter(row => row[k] === v); return this; },
      hasSome(k, values) { matches = matches.filter(row => values.includes(row[k])); return this; },
      fields(...fields) { calls.push(fields); return this; },
      limit(n) { limit = n; return this; },
      async find() { return { items: matches.slice(0, limit), hasNext: () => false }; }
    };
  } };
  return { calls, read: createProtectedCatalogueRead({
    data, authorize: async customerId => ({ customerId, actorId: 'QA' }), reserveRead: async () => grant, reserveCoverage
  }) };
}

test('page size, non-overlapping continuation and last page', async () => {
  const { read, calls } = fixture();
  const first = await read.list('A', { size: 50 });
  const next = await read.list('A', { size: 50, afterId: first.afterId });
  const last = await read.list('A', { size: 50, afterId: next.afterId });
  assert.deepEqual([first.items.length, next.items.length, last.items.length, last.afterId], [50, 50, 1, null]);
  assert.equal(new Set([...first.items, ...next.items, ...last.items].map(item => item.id)).size, 101);
  assert.equal((await read.list('B')).items.length, 25);
  for (const key of ['image', 'cbm', 'countryOrigin', 'internalCost']) {
    assert.ok(!calls.flat().includes(key));
    assert.ok(!(key in first.items[0]));
  }
});

test('only returned IDs count and a rejected result never reaches the caller', async () => {
  const checks = [];
  const { read } = fixture(true, async (actor, action, ids) => {
    checks.push({ company: actor.customerId, action, ids });
    return false;
  });
  await assert.rejects(read.list('Beta'), /limited/);
  assert.equal(checks[0].ids.length, 25);
  assert.equal(checks[0].ids.at(-1), '0024');
  await assert.rejects(read.detail('Alpha', '0080'), /limited/);
  assert.deepEqual(checks[1], { company: 'Alpha', action: 'CATALOGUE_DETAIL', ids: ['0080'] });
});

test('access, rate control and page bounds enforced before reading data', async () => {
  const { read, calls } = fixture(false);
  await assert.rejects(read.list(''), /unavailable/);
  await assert.rejects(read.list('A', { size: 1000 }), /size/);
  await assert.rejects(read.list('A'), /limited/);
  await assert.rejects(read.detail('A', '0001'), /limited/);
  assert.equal(calls.length, 0);
});

test('one detail preserves zero CBM and legacy EA without returning a source image or private cost', async () => {
  const { read } = fixture();
  const item = await read.detail('A', '0001');
  assert.equal(item.cbmPerCtn, 0);
  assert.equal(item.ea, 24);
  assert.equal(item.unitPrice, null);
  assert.equal(item.countryOrigin, 'MY');
  assert.ok(!('image' in item || 'internalCost' in item));
  assert.equal(await read.detail('A', 'missing'), null);
});
