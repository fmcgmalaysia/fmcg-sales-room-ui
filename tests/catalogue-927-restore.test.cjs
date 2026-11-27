const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const runtime = read('backend/catalogueProtectionRuntime.js');
const start = runtime.indexOf('const catalogue927Fields');
const end = runtime.indexOf('export async function refreshCatalogueIndexSnapshot', start);
const service = runtime.slice(start, end).replace(/^export /gm, '');

function fixture(rows, allow = true) {
  const calls = [];
  const wixData = {
    query(collection) {
      calls.push(collection);
      let found = rows;
      let offset = 0, size;
      return {
        eq(field, value) { found = found.filter(item => item[field] === value); return this; },
        hasSome(field, values) { found = found.filter(item => values.includes(item[field])); return this; },
        ascending() { found = [...found].sort((a, b) => a._id.localeCompare(b._id)); return this; },
        include(field) { assert.equal(field, 'subCategories'); return this; },
        limit(value) { size = value; return this; },
        skip(value) { offset = value; return this; },
        async find(options) {
          assert.deepEqual(options, { suppressAuth: true, consistentRead: true });
          return { items: found.slice(offset, offset + size), totalCount: found.length };
        }
      };
    }
  };
  const authorize = async scope => {
    if (!allow || scope.buyerCompanyId !== 'CUS-OWN') throw Error('Company access unavailable.');
  };
  const indexSnapshot = { readOpening: async () => ({ ids: ['active-1', 'inactive', 'active-0'] }) };
  const load = new Function('wixData', 'authorize', 'indexSnapshot', service + '\nreturn readCatalogue927Products;');
  return { calls, readCatalogue: load(wixData, authorize, indexSnapshot) };
}

test('927 products cannot be retrieved without the existing company authorization', async () => {
  const { readCatalogue, calls } = fixture([], false);
  await assert.rejects(readCatalogue({ buyerCompanyId: 'CUS-OWN' }, 'FIRST'), /access unavailable/);
  await assert.rejects(readCatalogue({ buyerCompanyId: 'CUS-OWN' }, 'FULL'), /access unavailable/);
  assert.deepEqual(calls, []);
});

test('927 seed keeps historical order, active products, safe images and display fields', async () => {
  const { readCatalogue } = fixture([
    { _id: 'active-0', pointBaseStatus: 'ACTIVE', name: 'MAGICLEAN', subCategories: [{ _id: 'ORAL', unrelated: 'private' }],
      image: 'wix:image://v1/abc.jpg/Sample.jpg', quoteDetail: 'private', supplierCost: 99 },
    { _id: 'active-1', pointBaseStatus: 'ACTIVE', name: 'First', image: 'https://example.invalid/photo.jpg' },
    { _id: 'inactive', pointBaseStatus: 'INACTIVE', name: 'Inactive' }
  ]);
  const rows = await readCatalogue({ buyerCompanyId: 'CUS-OWN' }, 'FIRST');
  assert.deepEqual(rows.map(row => row._id), ['active-1', 'active-0']);
  assert.equal(rows[0].image, undefined);
  assert.deepEqual(rows[1].subCategories, ['ORAL']);
  assert.equal(rows[1].image, 'https://static.wixstatic.com/media/abc.jpg');
  assert.equal(rows[1].supplierCost, undefined);
  assert.equal(rows[1].quoteDetail, undefined);
});

test('927 full view retrieves later products for local searches without pagination controls', async () => {
  const rows = Array.from({ length: 6051 }, (_, i) => ({
    _id: 'p-' + String(i).padStart(4, '0'), pointBaseStatus: 'ACTIVE', name: i === 6050 ? 'MAGICLEAN' : 'Product ' + i
  }));
  const { readCatalogue } = fixture(rows);
  const result = await readCatalogue({ buyerCompanyId: 'CUS-OWN' }, 'FULL');
  assert.equal(result.length, 6051);
  assert.equal(result.at(-1).name, 'MAGICLEAN');
  const page = read('buyer-room/catalogue/wix/catalogue-access-20261123.page.js');
  const workspace = read('buyer-room/catalogue/wix/catalogue-20261126-account-workspace.inline.html');
  assert.doesNotMatch(page, /query\('FMCGMALAYSIA'\)|dataset\.setFilter/);
  assert.match(page, /const applySearch = raw => showCatalogueCachedView/);
  assert.match(workspace, /function filtered\(\).*state\.products/);
  assert.doesNotMatch(workspace, /id="page(?:Next|Previous)"/);
});
