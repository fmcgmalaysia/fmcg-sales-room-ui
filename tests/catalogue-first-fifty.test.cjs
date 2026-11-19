const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../buyer-room/catalogue/wix/catalogue-page-v3.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; const wait = new Promise(resolve => release = resolve); return { wait, release }; }

function fixture(options = {}) {
  const full = gate(), preview = gate();
  const products = options.items || Array.from({ length: 3100 }, (_, i) => ({
    _id: 'fixture-' + i, name: 'Product ' + i, brandName: ['Z', 'B', 'A', 'a ', 'Á', '10', '2', '', 'C', 'D', ...Array.from({length: 20}, (_, n) => 'Other ' + n)][i % 30],
    pointBaseSortId: i % 17 ? 'FO-' + (i % 60) : '', principle: 'Fixture supplier'
  }));
  const messages = [], events = new Map(), elements = new Map(), calls = [];
  const chain = { contains() { return this; }, or() { return this; }, hasSome() { return this; } };
  const $w = id => {
    if (!elements.has(id)) elements.set(id, {
      postMessage(message) { messages.push(message); }, onMessage(handler) { events.set(id, handler); },
      expand() {}, show() {}, hide() {}, collapse() {}, onInput() {}, setPageSize() {}, async setFilter() {}
    });
    return elements.get(id);
  };
  $w.onReady = () => {};
  const context = vm.createContext({
    $w, URL, Intl, console: { warn() {}, error() {} }, products, setInterval() {}, setTimeout, clearTimeout,
    wixWindowFrontend: { formFactor: 'Mobile' }, wixLocationFrontend: { url: 'https://fixture.test/catalogue' },
    wixData: {
      filter: () => chain,
      query(collection) {
        let offset = 0, limit = 1000, brands;
        const page = (start, size, data) => ({
          items: data.slice(start, start + size), totalCount: data.length, pageSize: size,
          hasNext: () => start + size < data.length,
          next: async () => { await full.wait; return page(start + size, size, data); }
        });
        return {
          eq() { return this; }, fields() { return this; }, ascending() { return this; }, contains() { return this; },
          limit(n) { limit = n; return this; }, skip(n) { offset = n; return this; },
          hasSome(key, values) { if (key === 'brandName') brands = values; return this; },
          async distinct() {
            calls.push('distinct');
            if (options.fail) throw Error('Read unavailable');
            return { items: [...new Set(products.map(p => p.brandName))], hasNext: () => !!options.moreBrands };
          },
          async find() {
            if (collection !== 'FMCGMALAYSIA') return page(0, 1000, []);
            if (brands) {
              calls.push('prefix'); await preview.wait;
              return page(0, limit, products.filter(p => brands.includes(p.brandName)));
            }
            if (offset) await full.wait;
            return page(offset, limit, products);
          }
        };
      }
    }
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('catalogueWorkspaceReady = true;');
  return { run, full, preview, calls, messages, events };
}
const ids = expression => `JSON.stringify(${expression}.map(p => p.id))`;
const canonical = 'sortCatalogueProducts(products.slice(0, 10000).map(catalogueProductRecord).filter(p => p.id && p.name))';

test('first 50 are the exact canonical prefix including numeric, equivalent and blank brands; full read continues once', async () => {
  const f = fixture(); const loading = f.run('loadCatalogueWorkspaceProducts()');
  assert.equal(loading, f.run('loadCatalogueWorkspaceProducts()'));
  f.preview.release(); await tick();
  assert.equal(f.run('catalogueWorkspaceFullReadComplete'), false);
  assert.equal(f.run(ids('catalogueWorkspaceProducts')), f.run(ids(canonical + '.slice(0, 50)')));
  assert.equal(f.calls.filter(c => c === 'distinct').length, 1);
  f.full.release(); await loading;
  assert.equal(f.run(ids('catalogueWorkspaceProducts')), f.run(ids(canonical)));
  assert.equal(new Set(JSON.parse(f.run(ids('catalogueWorkspaceProducts')))).size, 3100);
});

for (const options of [{ fail: true }, { moreBrands: true }, { items: Array.from({ length: 1100 }, (_, i) => ({ _id: '' + i, name: 'Product', brandName: 'A' })) }]) {
  test('unconfirmed or oversized brand group safely leaves the full read authoritative ' + JSON.stringify(Object.keys(options)), async () => {
    const f = fixture(options); const loading = f.run('loadCatalogueWorkspaceProducts()');
    f.preview.release(); await tick();
    assert.equal(f.run('catalogueWorkspaceProducts.length'), 0);
    f.full.release(); await loading;
    assert.equal(f.run(ids('catalogueWorkspaceProducts')), f.run(ids(canonical)));
  });
}

test('late preview never truncates a completed full read', async () => {
  const f = fixture(); const loading = f.run('loadCatalogueWorkspaceProducts()');
  f.full.release(); await loading; f.preview.release(); await tick();
  assert.equal(f.run('catalogueWorkspaceProducts.length'), 3100);
});

test('newer category results survive both preview and full completion', async () => {
  const f = fixture(); const loading = f.run('loadCatalogueWorkspaceProducts()');
  f.run("catalogueWorkspaceQueryVersion += 1; catalogueWorkspaceProducts = [{id:'category-result'}]");
  f.preview.release(); await tick(); f.full.release(); await loading;
  assert.equal(f.run('catalogueWorkspaceProducts[0].id'), 'category-result');
  assert.equal(f.run('catalogueWorkspaceAllProducts.length'), 3100);
});

test('search entered while reading uses the complete list and latest search wins', async () => {
  const f = fixture(); f.run('setupNav()');
  const loading = f.run('loadCatalogueWorkspaceProducts()');
  const first = f.events.get('#html3')({ data: { type: 'catalogueSearch', query: 'old search' } });
  const last = f.events.get('#html3')({ data: { type: 'catalogueSearch', query: 'latest search' } });
  f.preview.release(); await tick(); f.full.release(); await Promise.all([loading, first, last]);
  assert.equal(f.run('catalogueWorkspaceProducts.length'), 3100);
  assert.equal(f.run('catalogueWorkspaceFilter.query'), 'latest search');
});

test('a newer category cancels an earlier pending search', async () => {
  const f = fixture(); f.run('setupNav()'); const loading = f.run('loadCatalogueWorkspaceProducts()');
  const search = f.events.get('#html3')({ data: { type: 'catalogueSearch', query: 'old search' } });
  f.run("catalogueWorkspaceQueryVersion += 1; catalogueWorkspaceProducts = [{id:'category-result'}]");
  f.full.release(); f.preview.release(); await Promise.all([loading, search]);
  assert.equal(f.run('catalogueWorkspaceProducts[0].id'), 'category-result');
});

test('All Products chosen during preview eventually restores the full list', async () => {
  const f = fixture(); const loading = f.run('loadCatalogueWorkspaceProducts()');
  f.preview.release(); await tick(); const all = f.run('showAllCatalogueWorkspaceProducts()');
  f.full.release(); await Promise.all([loading, all]);
  assert.equal(f.run('catalogueWorkspaceProducts.length'), 3100);
  assert.equal(f.run('catalogueWorkspaceFilter.query'), '');
});

test('small catalogues and absent named brands retain their complete original result', async () => {
  for (const items of [[], Array.from({ length: 25 }, (_, i) => ({ _id: '' + i, name: 'Product', brandName: i % 2 ? '' : 'A' }))]) {
    const f = fixture({ items }); f.preview.release(); f.full.release();
    await f.run('loadCatalogueWorkspaceProducts()'); await tick();
    assert.equal(f.run('catalogueWorkspaceProducts.length'), items.length);
  }
});
