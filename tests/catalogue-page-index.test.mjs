import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCataloguePageIndex } from '../backend/cataloguePageIndex.js';
import { createCatalogueIndexSnapshot } from '../backend/catalogueIndexSnapshot.js';

function fixture(rows, useOpening = false) {
  const calls = [];
  const saved = new Map();
  let time = 0;
  const data = {
    async get(collection, id) {
      assert.equal(collection, 'CatalogueProtection');
      calls.push({ collection, get: id, fields: [] });
      return saved.get(id);
    },
    async save(collection, row) {
      assert.equal(collection, 'CatalogueProtection');
      saved.set(row._id, row);
    },
    async bulkSave(collection, entries) {
      for (const entry of entries) await this.save(collection, entry);
      return { errors: [] };
    },
    query(collection) {
      let records = collection === 'FMCGMALAYSIA' ? rows : [...saved.values()];
      let fields = [], size;
      return {
        eq(key, value) { records = records.filter(row => row[key] === value); return this; },
        hasSome(key, values) {
          records = records.filter(row => [row[key]].flat().some(v => values.includes(v))); return this;
        },
        fields(...keys) { fields = keys; return this; },
        descending(key) { records = [...records].sort((a, b) => b[key] - a[key]); return this; },
        limit(n) { size = n; return this; },
        async count() { return records.length; },
        async find() {
          calls.push({ collection, size, fields });
          function batch(offset) {
            return { items: records.slice(offset, offset + size).map(row => fields.length ? Object.fromEntries(fields.map(k => [k, row[k]])) : row),
              hasNext: () => offset + size < records.length, next: async () => batch(offset + size) };
          }
          return batch(0);
        }
      };
    }
  };
  const snapshot = createCatalogueIndexSnapshot(data, 'CatalogueProtection');
  const fetch = createCataloguePageIndex(data, () => time, snapshot.read, useOpening ? snapshot.readOpening : undefined);
  return { calls, saved, snapshot, advance: () => { time += 60001; }, page: args => fetch({ size: 25, afterId: '', term: '', principle: '', subcategories: [], ...args }) };
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

test('a prebuilt index saves only the ordered lookup fields and skips the full scan on a cold page', async () => {
  const rows = Array.from({ length: 6051 }, (_, i) => ({
    _id: 'item-' + i, _updatedDate: new Date(10000 + i), name: 'Product ' + i,
    description: 'A sample pack of 24 cartons for the test product', barcode: 9500000000000 + i,
    brandName: 'Brand ' + (i % 10), principle: 'Supplier', subCategories: [i % 2 ? 'odd' : 'even'],
    pointBaseStatus: 'ACTIVE', image: 'PRIVATE_IMAGE', countryOrigin: 'PRIVATE_ORIGIN'
  }));
  const { calls, saved, snapshot, page, advance } = fixture(rows);
  const fullScans = () => calls.filter(call => call.fields.includes('pointBaseSortId')).length;

  assert.deepEqual(await snapshot.refresh(), { status: 'BUILT', count: 6051 });
  assert.deepEqual(await snapshot.refresh(), { status: 'CURRENT', count: 6051 });
  assert.ok(saved.size > 2);
  for (const row of saved.values()) {
    if (!row.indexPayload) continue;
    assert.ok(Buffer.byteLength(row.indexPayload) <= 128 * 1024);
    assert.doesNotMatch(row.indexPayload, /PRIVATE_IMAGE|PRIVATE_ORIGIN/);
  }
  assert.equal((await page({ term: '6050', subcategories: ['even'] })).items[0].id, 'item-6050');
  assert.equal(fullScans(), 1);

  const part = saved.get('catalogue-index-v1-1');
  saved.set(part._id, { ...part, indexPayload: '[]' });
  assert.equal(await snapshot.read(), null);
  saved.set(part._id, part);
  saved.delete('catalogue-index-v1-2');
  assert.equal(await snapshot.read(), null);
  assert.deepEqual(await snapshot.refresh(), { status: 'BUILT', count: 6051 });

  rows.at(-1).name = 'Changed name';
  rows.at(-1)._updatedDate = new Date(90000);
  assert.equal(await snapshot.read(), null);
  advance();
  assert.equal((await page({ term: 'Changed name' })).items[0].id, 'item-6050');
  assert.equal(fullScans(), 3);
  rows.at(-1).pointBaseStatus = 'INACTIVE';
  assert.equal((await page({ term: 'Changed name' })).items.length, 0);
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

test('prepared HOME and Ready-to-Drink avoid loading full index shards and use live categories', async () => {
  const rows = Array.from({ length: 6051 }, (_, index) => ({
    _id: 'p-' + index, name: 'Product ' + index, _updatedDate: new Date(index + 1000),
    brandName: 'Brand', pointBaseSortId: index + 1, pointBaseStatus: 'ACTIVE',
    subCategories: index % 2 ? ['drink'] : [], image: 'PRIVATE_SOURCE'
  }));
  const { calls, saved, snapshot, page } = fixture(rows, true);
  const reference = fixture(rows);
  assert.equal(await snapshot.readOpening(), null);
  assert.deepEqual(await snapshot.refresh(), { status: 'BUILT', count: rows.length });
  calls.length = 0;
  const home = await page({ size: 50 });
  assert.deepEqual(home, await reference.page({ size: 50 }));
  assert.equal(home.items.length, 50);
  assert.equal(home.afterId, 'p-49');
  assert.deepEqual(calls.map(call => call.get || call.size).sort(), [1, 51, 'catalogue-opening-index-v1']);
  assert.doesNotMatch(saved.get('catalogue-opening-index-v1').indexPayload, /PRIVATE_SOURCE/);
  rows[0].subCategories.push('drink');
  rows[1].subCategories = [];
  calls.length = 0;
  const drink = await page({ subcategories: ['drink'] });
  assert.deepEqual(drink, await reference.page({ subcategories: ['drink'] }));
  assert.equal(drink.items[0].id, 'p-0');
  assert.ok(calls.every(call => call.get || !call.fields.includes('pointBaseSortId') && call.collection !== 'CatalogueProtection'));
  assert.deepEqual(await page({ subcategories: ['drink'], afterId: drink.afterId }),
    await reference.page({ subcategories: ['drink'], afterId: drink.afterId }));
  assert.deepEqual(await page({ term: 'Product 6050' }), await reference.page({ term: 'Product 6050' }));
});

test('prepared pages fall back for sparse categories, changed sources and invalid or legacy opening data', async () => {
  const rows = Array.from({ length: 400 }, (_, index) => ({
    _id: 'p-' + index, name: 'Product ' + index, _updatedDate: new Date(index + 1000),
    pointBaseSortId: index + 1, pointBaseStatus: 'ACTIVE', subCategories: index > 355 ? ['late'] : []
  }));
  const { saved, snapshot, page, advance } = fixture(rows, true);
  await snapshot.refresh();
  const id = 'catalogue-opening-index-v1';
  const head = saved.get(id);
  saved.set(id, { ...head, indexPayload: '["wrong",["p-0"]]' });
  assert.equal(await snapshot.readOpening(), null);
  assert.deepEqual(await snapshot.refreshOpening(), { status: 'BUILT', count: 320 });
  assert.equal((await snapshot.readOpening()).ids.length, 320);
  assert.equal((await page({ subcategories: ['late'] })).items[0].id, 'p-356');
  rows[0].pointBaseStatus = 'INACTIVE';
  rows[0]._updatedDate = new Date(50000);
  assert.equal(await snapshot.readOpening(), null);
  advance();
  const updated = await page({});
  assert.equal(updated.items[0].id, 'p-1');
});
