const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createCurrentStockControlService } = require('../prototypes/stock-current-state/stock-control-current-service.cjs');
const { requireWarehouseStaff } = load('warehouseReceiving.js');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const product = (barcode, extra = {}) => { const key = stockKey({ company: 'NCT', barcode, packing: '12', ea: 12 }); return {
  collection: 'StockProducts', _id: hash('NCT', key), company: 'NCT', stockKey: key, barcode, packing: '12', ea: 12, name: 'Item ' + barcode,
  status: 'ACTIVE', revision: 0, checkpointGeneration: 0, onHand: 100, isolated: 5, reservedUsable: 65, available: 30, reviewRequired: false,
  secretCost: 99, stockCommitVersion: 'PRIVATE', ...extra }; };
function fixture(rows) {
  const calls = [], collections = []; let generation = 0, mode = 'ACTIVE', privateReads = 0;
  const items = { query: collection => {
    collections.push(collection); let filters = [], sort = [], offset = 0, size = 50;
    const q = { eq: (k, v) => { filters.push(row => row[k] === v); return q; }, gt: (k, v) => { filters.push(row => typeof row[k] === 'number' && row[k] > v); return q; },
      isEmpty: k => { filters.push(row => row[k] == null); return q; }, contains: (k, v) => { filters.push(row => String(row[k] || '').toLowerCase().includes(v.toLowerCase())); return q; },
      and: other => { filters.push(other.matches); return q; }, or: other => { const previous = filters; filters = [row => previous.every(f => f(row)) || other.matches(row)]; return q; },
      matches: row => filters.every(f => f(row)), ascending: (...fields) => { sort = fields; return q; }, skip: n => { offset = n; return q; }, limit: n => { size = n; return q; },
      find: async options => { calls.push({ collection, offset, size, options });
        const selected = rows.filter(row => row.collection === collection && q.matches(row)).sort((a, b) => { for (const field of sort) { const n = String(a[field]).localeCompare(String(b[field])); if (n) return n; } return 0; });
        return { items: copy(selected.slice(offset, offset + size)), totalCount: selected.length }; } }; return q;
  } };
  const deps = { company: 'NCT', items, protocol: { readControl: async () => ({ company: 'NCT', _version: 'C0', schemaVersion: 1, generation, mode, pending: null }),
    readSnapshot: async fn => { privateReads++; return { generation, rows: await fn() }; } }, requireWarehouseStaff,
    readMember: async () => ({ _id: 'M', loginEmail: 'warehouse@example.test', status: 'APPROVED' }),
    readStaffRecords: async () => [{ title: 'W', description: 'M', staffName: 'Warehouse', staffEmail: 'warehouse@example.test', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] }],
    now: () => new Date('2026-10-22T09:00:00Z') };
  return { deps, calls, collections, setGeneration: n => generation = n, setMode: v => mode = v, reads: () => privateReads };
}

test('products and counts filter in current CMS before paging; no history/private costs or fake source arrays', async () => {
  const rows = [product('1'), product('2', { onHand: 0, isolated: 0, reservedUsable: 0, available: 0, status: 'CLOSED' }),
    product('3', { onHand: null, isolated: null, reservedUsable: null, available: null, reviewRequired: true })];
  const f = fixture(rows), service = createCurrentStockControlService(f.deps), page = await service.read('NCT', { pageSize: 1 });
  assert.equal(page.total, 2); assert.equal(page.items.length, 1); assert.deepEqual(page.counts, { onHandProducts: 2, availableProducts: 1, isolatedProducts: 2, reviewProducts: 1 });
  assert.equal(page.schema, 'CURRENT_STOCK_V1'); assert.equal(page.items[0].sourceDetails, 'PAGED'); assert.equal(page.items[0].sources, undefined);
  assert.equal(/secretCost|stockCommitVersion|finance/.test(JSON.stringify(page)), false); assert.equal(f.calls.length, 5);
  assert.ok(f.calls.every(c => c.collection === 'StockProducts' && c.size === 1 && c.options.consistentRead));
  const next = await service.read('NCT', { pageSize: 1, cursor: page.nextCursor }); assert.equal(next.items[0].onHand, null);
  assert.equal((await service.read('NCT', { filter: 'ALL' })).total, 3);
  assert.equal((await service.read('NCT', { filter: 'AVAILABLE', search: 'Item 1' })).total, 1);
});

test('unknown without review flag is still Review; real zero preserved and malformed balance refuses', async () => {
  const f = fixture([product('1', { available: null, reviewRequired: false })]), page = await createCurrentStockControlService(f.deps).read('NCT', { filter: 'REVIEW' });
  assert.equal(page.total, 1); assert.equal(page.items[0].reviewRequired, true); assert.equal(page.items[0].available, null);
  const g = fixture([product('2', { onHand: 0, isolated: 0, reservedUsable: 0, available: 0 })]);
  assert.equal((await createCurrentStockControlService(g.deps).read('NCT', { filter: 'ALL' })).items[0].available, 0);
  const h = fixture([product('3', { onHand: 999 })]); await assert.rejects(createCurrentStockControlService(h.deps).read('NCT'), /balance/);
});

test('page cursor binds search/filter/page size and generation; inactive mode never falls back', async () => {
  const f = fixture([product('1'), product('2')]), service = createCurrentStockControlService(f.deps), page = await service.read('NCT', { pageSize: 1 });
  f.setGeneration(1); await assert.rejects(service.read('NCT', { pageSize: 1, cursor: page.nextCursor }), /changed/);
  for (const mode of ['LEGACY', 'SHADOW', 'MAINTENANCE']) { f.setMode(mode); await assert.rejects(service.read('NCT'), /not active/); }
});

test('source/claim detail pages preserve full product summary, do not expose costs or sum a partial page', async () => {
  const p = product('1', { onHand: 2000, isolated: 0, available: 2000, reservedUsable: 0 });
  const rows = [p, ...Array.from({ length: 2000 }, (_, i) => ({ collection: 'StockPositions', _id: String(i).padStart(4, '0'), company: 'NCT', status: 'ACTIVE', stockKey: p.stockKey,
    sourceTaskId: 'T' + i, poId: 'PO' + i, onHand: 1, isolated: 0, available: 1, reservedUsable: 0, revision: 0, checkpointGeneration: 0, secretCost: 999 })),
    { collection: 'StockClaims', _id: 'CLAIM', company: 'NCT', status: 'ACTIVE', stockKey: p.stockKey, positionId: '0000', taskId: 'T', customerId: 'C', reservedUsable: null, isolatedAttributed: null, revision: 0, checkpointGeneration: 0 }];
  const f = fixture(rows), service = createCurrentStockControlService(f.deps);
  const sources = await service.detail('NCT', { kind: 'positions', stockKey: p.stockKey, pageSize: 20 });
  assert.equal(sources.total, 2000); assert.equal(sources.items.length, 20); assert.equal(sources.product.onHand, 2000);
  assert.equal(sources.items[0].secretCost, undefined); assert.equal(sources.nextCursor.offset, 20);
  const claims = await service.detail('NCT', { kind: 'claims', stockKey: p.stockKey, positionId: '0000' }); assert.equal(claims.items[0].reservedUsable, null);
  await assert.rejects(service.detail('NCT', { kind: 'claims', stockKey: p.stockKey, positionId: 'FOREIGN' }), /source required/);
  assert.ok(f.calls.every(call => call.size <= 50)); assert.ok(!f.collections.some(c => c.includes('Activity')));
});

test('authorization, company, invalid input and pending state block before quantity queries', async () => {
  const f = fixture([]); f.deps.readStaffRecords = async () => []; const service = createCurrentStockControlService(f.deps);
  await assert.rejects(service.read('NCT')); await assert.rejects(service.read('GHR')); await assert.rejects(service.read('NCT', { pageSize: 1000 }));
  assert.equal(f.calls.length, 0); assert.equal(f.reads(), 0);
  const g = fixture([]); g.deps.protocol.readSnapshot = async () => { throw Error('Inventory pending'); };
  await assert.rejects(createCurrentStockControlService(g.deps).read('NCT'), /pending/); assert.equal(g.calls.length, 0);
});

test('unrelated Activity growth adds no quantity reads or queries', async () => {
  for (const n of [0, 1000, 10000, 100000]) {
    const history = Array.from({ length: n }, (_, i) => ({ collection: 'NCTActivity', _id: 'H' + i, action: 'SYNTHETIC_OLD_EVENT' }));
    const f = fixture([product('1'), ...history]);
    const page = await createCurrentStockControlService(f.deps).read('NCT'); assert.equal(page.items[0].onHand, 100, 'history=' + n);
    assert.equal(f.calls.length, 5); assert.ok(f.collections.every(c => c === 'StockProducts'));
  }
});
