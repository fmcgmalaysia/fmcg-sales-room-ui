const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../buyer-room/catalogue/wix/catalogue-page-v3.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');

function catalogue(size, { fault, pause } = {}) {
  const items = Array.from({ length: size }, (_, index) => ({
    _id: 'product-' + index,
    name: 'Product ' + index,
    brandName: index % 7 ? 'Brand ' + (index % 11) : '',
    pointBaseSortId: index % 9 ? String(index % 15) : '',
    pointBaseStatus: 'ACTIVE'
  }));
  const reads = { parallel: [], next: [], peak: 0 };
  let inFlight = 0;
  const $w = () => ({ postMessage() {} });
  $w.onReady = () => {};
  const context = vm.createContext({
    $w, console, URL, productsFromCms: items,
    wixData: {
      query(collection) {
        assert.equal(collection, 'FMCGMALAYSIA');
        let offset = 0, limit = 1000;
        function page(start, count) {
          return {
            items: items.slice(start, start + count),
            pageSize: count,
            totalCount: items.length,
            hasNext: () => start + count < items.length,
            next: async () => {
              reads.next.push(start + count);
              return page(start + count, count);
            }
          };
        }
        return {
          eq(key, value) { assert.equal(key, 'pointBaseStatus'); assert.equal(value, 'ACTIVE'); return this; },
          fields() { return this; },
          limit(value) { limit = value; return this; },
          skip(value) { offset = value; return this; },
          async find() {
            const result = page(offset, limit);
            if (!offset) return result;
            reads.parallel.push(offset);
            inFlight += 1;
            reads.peak = Math.max(inFlight, reads.peak);
            try {
              if (pause) await pause;
              await Promise.resolve();
              if (offset === 999) fault?.(result);
              return result;
            } finally {
              inFlight -= 1;
            }
          }
        };
      }
    }
  });
  vm.runInContext(source, context);
  return { reads, run: code => vm.runInContext(code, context) };
}

const actual = 'JSON.stringify(catalogueWorkspaceAllProducts)';
const expected = 'JSON.stringify(sortCatalogueProducts(productsFromCms.slice(0, 10000).map(catalogueProductRecord)))';

for (const size of [0, 1750, 2001, 10002]) {
  test(`preserves full catalogue order and the cap with ${size} products`, async () => {
    const { run, reads } = catalogue(size);
    await run('readCatalogueWorkspaceProducts(0)');
    assert.equal(run(actual), run(expected));
    assert.equal(run('catalogueWorkspaceFullReadComplete'), true);
    assert.equal(reads.peak, size <= 2000 ? 0 : size <= 3997 ? 2 : 3);
    assert.equal(reads.next.length, size === 1750 ? 1 : 0);
  });
}

for (const [name, fault] of [
  ['rejected', () => { throw Error('Wix rate limited a page'); }],
  ['shifted', result => { result.items[0] = result.items[1]; }],
  ['duplicated', result => { result.items[10] = result.items[11]; }],
  ['truncated', result => { result.items.pop(); }],
  ['changed total', result => { result.totalCount -= 1; }]
]) {
  test(`rereads through the original cursor when a parallel page is ${name}`, async () => {
    const { run, reads } = catalogue(4102, { fault });
    await run('readCatalogueWorkspaceProducts(0)');
    assert.equal(run(actual), run(expected));
    assert.deepEqual(reads.next, [1000, 2000, 3000, 4000]);
  });
}

test('a pending startup read never pushes a partial list or replaces a newer filter', async () => {
  let finish;
  const pause = new Promise(resolve => { finish = resolve; });
  const { run, reads } = catalogue(3100, { pause });
  const starting = run('loadCatalogueWorkspaceProducts()');
  assert.equal(starting, run('loadCatalogueWorkspaceProducts()'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.peak, 3);
  assert.equal(run('catalogueWorkspaceProducts.length'), 0);
  run("catalogueWorkspaceQueryVersion += 1; catalogueWorkspaceProducts = [{ id: 'filter-result' }];");
  finish();
  await starting;
  assert.equal(run('catalogueWorkspaceProducts[0].id'), 'filter-result');
  assert.equal(run(actual), run(expected));
});
