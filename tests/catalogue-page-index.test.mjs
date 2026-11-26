import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCataloguePageIndex } from '../backend/cataloguePageIndex.js';

function fixture(rows) {
  const calls = [];
  let time = 0;
  const data = { query(collection) {
    assert.equal(collection, 'FMCGMALAYSIA');
    let records = rows, fields = [], size;
    return {
      eq(key, value) { records = records.filter(row => row[key] === value); return this; },
      hasSome(key, values) {
        records = records.filter(row => [row[key]].flat().some(v => values.includes(v))); return this;
      },
      fields(...keys) { fields = keys; return this; },
      limit(n) { size = n; return this; },
      async find() {
        calls.push({ size, fields });
        function batch(offset) {
          return { items: records.slice(offset, offset + size).map(row => Object.fromEntries(fields.map(k => [k, row[k]]))),
            hasNext: () => offset + size < records.length, next: async () => batch(offset + size) };
        }
        return batch(0);
      }
    };
  } };
  const fetch = createCataloguePageIndex(data, () => time);
  return { calls, advance: () => { time += 60001; }, page: args => fetch({ size: 25, afterId: '', term: '', principle: '', subcategories: [], ...args }) };
}

test('search includes the last of 6,051 products; category, dates, active status and size remain scoped', async () => {
  const rows = Array.from({ length: 6051 }, (_, i) => ({
    _id: 'item-' + i, name: 'Product ' + i, barcode: 9500000000000 + i, brandName: 'Brand ' + (i % 10),
    principle: 'P', subCategories: [i % 2 ? 'odd' : 'even'], pointBaseStatus: 'ACTIVE', image: 'secret', countryOrigin: 'MY'
  }));
  const { page, calls } = fixture(rows);
  const [desktop, last] = await Promise.all([page({ size: 50 }), page({ term: String(rows.at(-1).barcode) })]);
  assert.equal(desktop.items.length, 50);
  assert.deepEqual(last.items.map(i => i.id), ['item-6050']);
  assert.equal(calls.filter(c => c.fields.includes('pointBaseSortId')).length, 1);
  assert.ok(calls.every(c => !c.fields.includes('image') && !c.fields.includes('countryOrigin')));
  assert.equal((await page({ term: '6050', subcategories: ['odd'] })).items.length, 0);
  rows.at(-1).pointBaseStatus = 'INACTIVE';
  assert.equal((await page({ term: String(rows.at(-1).barcode) })).items.length, 0);
});

test('legacy numeric brand and mixed sort fields, blanks last, stable ties and index refresh', async () => {
  const rows = [
    ['z', '', 1], ['a', 'Brand 10', 1], ['b', 'Brand 2', null], ['c', 'Brand 2', 20],
    ['d', 'BRAND 2', 5], ['e', 'Brand 2', 5], ['f', 'Brand 2', 'A1']
  ].map(([id, brand, order]) => ({ _id: id, name: id, brandName: brand, sortNO: order, pointBaseStatus: 'ACTIVE' }));
  const { page, advance } = fixture(rows);
  assert.deepEqual((await page({})).items.map(i => i.id), ['d', 'e', 'c', 'f', 'b', 'a', 'z']);
  rows[0].brandName = 'AAA';
  advance();
  assert.equal((await page({})).items[0].id, 'z');
  await assert.rejects(page({ afterId: 'no-longer-active' }), /Refresh/);
});
