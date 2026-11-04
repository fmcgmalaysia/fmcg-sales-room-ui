const test = require('node:test'), assert = require('node:assert/strict');
const { createCurrentQuery, readCurrentDetailPage } = require('../prototypes/stock-current-state/current-query.cjs');
const { readProductPage } = require('../prototypes/stock-current-state/current-model.cjs');
function fixture(rows = []) {
  const calls = [], collections = [];
  const items = { query: collection => {
    collections.push(collection);
    let filters = [], order = [], offset = 0, size = 0;
    const q = {
      eq: (field, value) => { filters.push(row => row[field] === value); return q; },
      contains: (field, value) => { filters.push(row => String(row[field] || '').toLowerCase().includes(value.toLowerCase())); return q; },
      and: other => { filters.push(other.matches); return q; },
      or: other => { const previous = filters; filters = [row => previous.every(f => f(row)) || other.matches(row)]; return q; },
      matches: row => filters.every(f => f(row)),
      ascending: (...fields) => { order = fields; return q; },
      skip: n => { offset = n; return q; }, limit: n => { size = n; return q; },
      find: async options => {
        calls.push({ collection, order, offset, size, options });
        const selected = rows.filter(row => row.collection === collection && q.matches(row))
          .sort((a, b) => { for (const field of order) { const d = String(a[field]).localeCompare(String(b[field])); if (d) return d; } return 0; });
        return { items: selected.slice(offset, offset + size), totalCount: options.returnTotalCount ? selected.length : undefined };
      }
    }; return q;
  } };
  return { repository: createCurrentQuery({ items, company: 'NCT' }), calls, collections };
}
const args = { company: 'NCT', page: 0, pageSize: 25, status: 'ACTIVE', consistentRead: true };
const product = (id, extra = {}) => ({ collection: 'StockProducts', _id: id, company: 'NCT', status: 'ACTIVE', barcode: '0001', name: 'TEST', packing: '12x1', ...extra });
const protocol = { readSnapshot: async fn => ({ generation: 3, rows: await fn() }) };

test('product page filters company/status before pagination and returns stored full summary', async () => {
  const rows = Array.from({ length: 160 }, (_, i) => product(String(i).padStart(4, '0'), { onHand: 1000 + i }));
  rows.push(product('CLOSED', { status: 'CLOSED' }), product('GHR', { company: 'GHR' }));
  const f = fixture(rows);
  const page = await readProductPage({ protocol, repository: f.repository, company: 'NCT', page: 2, pageSize: 25 });
  assert.equal(page.rows.items.length, 25); assert.equal(page.rows.totalCount, 160);
  assert.equal(page.rows.items[0]._id, '0050'); assert.equal(page.rows.items[0].onHand, 1050);
  assert.deepEqual(f.calls, [{ collection: 'StockProducts', order: ['barcode', '_id'], offset: 50, size: 25, options: { consistentRead: true, returnTotalCount: true } }]);
});
test('search OR stays inside company and active filters; null/zero remain distinct', async () => {
  const f = fixture([product('A', { name: 'Chocolate', available: null, isolated: 0, secretCost: 99, stockCommitVersion: 'PRIVATE' }),
    product('B', { packing: 'Chocolate', company: 'GHR' }), product('C', { name: 'Chocolate', status: 'CLOSED' })]);
  const page = await readProductPage({ protocol, repository: f.repository, company: 'NCT', search: 'Chocolate' });
  assert.equal(page.rows.items.length, 1); assert.equal(page.rows.items[0].available, null);
  assert.equal(page.rows.items[0].isolated, 0); assert.equal(page.rows.items[0].secretCost, undefined);
  assert.equal(page.rows.items[0].stockCommitVersion, undefined);
});
test('product ordering is barcode first with stable ID tie-break in one SDK sort', async () => {
  const f = fixture([product('A', { barcode: '2' }), product('Z', { barcode: '1' }), product('B', { barcode: '1' })]);
  const page = await readProductPage({ protocol, repository: f.repository, company: 'NCT' });
  assert.deepEqual(page.rows.items.map(row => row._id), ['B', 'Z', 'A']);
  assert.deepEqual(f.calls[0].order, ['barcode', '_id']);
});
test('source and claim detail pages are bounded and never recompute product totals', async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ collection: 'StockPositions', _id: String(i).padStart(4, '0'), company: 'NCT', status: 'ACTIVE', stockKey: 'K', onHand: 1 }));
  rows.push({ collection: 'StockClaims', _id: 'C', company: 'NCT', status: 'ACTIVE', positionId: '0000', taskId: 'B', reservedUsable: 1 });
  const f = fixture(rows);
  const page = await readCurrentDetailPage({ protocol, repository: f.repository, company: 'NCT', kind: 'positions', stockKey: 'K', pageSize: 20, page: 3 });
  assert.equal(page.rows.totalCount, 2000); assert.equal(page.rows.items.length, 20);
  assert.equal(page.rows.onHand, undefined);
  for (const selector of [{ positionId: '0000' }, { taskId: 'B' }]) {
    const claims = await readCurrentDetailPage({ protocol, repository: f.repository, company: 'NCT', kind: 'claims', ...selector });
    assert.equal(claims.rows.items.length, 1);
  }
  assert.ok(f.calls.every(c => c.size <= 50)); assert.ok(!f.collections.some(c => c.includes('Activity')));
});
test('invalid scope, selectors and limits reject before any CMS query', async () => {
  const f = fixture();
  for (const invalid of [{ company: 'GHR' }, { pageSize: 101 }, { page: -1 }, { consistentRead: false }]) {
    await assert.rejects(f.repository.queryPositions({ ...args, stockKey: 'K', ...invalid }), /scope/);
  }
  await assert.rejects(f.repository.queryClaims({ ...args }), /selector/);
  await assert.rejects(f.repository.queryClaims({ ...args, positionId: 'P', taskId: 'T' }), /selector/);
  assert.equal(f.collections.length, 0);
});
test('pending barrier prevents all detail reads; changed generation error propagates', async () => {
  const f = fixture();
  for (const message of ['Inventory pending', 'Inventory changed during read']) {
    const guarded = { readSnapshot: async fn => { if (message.includes('changed')) await fn(); throw Error(message); } };
    await assert.rejects(readCurrentDetailPage({ protocol: guarded, repository: f.repository, company: 'NCT', kind: 'positions', stockKey: 'K' }), new RegExp(message));
    if (message.includes('pending')) assert.equal(f.calls.length, 0);
  }
});
test('query errors or malformed totals never become empty stock', async () => {
  for (const result of [null, { items: [], totalCount: -1 }, { items: [{ _id: 'X', company: 'GHR', status: 'ACTIVE' }], totalCount: 1 }]) {
    const q = {}; for (const method of ['eq', 'ascending', 'skip', 'limit']) q[method] = () => q;
    q.find = async () => result;
    const repository = createCurrentQuery({ items: { query: () => q }, company: 'NCT' });
    await assert.rejects(repository.queryPositions({ ...args, stockKey: 'K' }), /Invalid|conflict/);
  }
  const q = {}; for (const method of ['eq', 'ascending', 'skip', 'limit']) q[method] = () => q;
  q.find = async () => { throw Error('Permission/network failure'); };
  const repository = createCurrentQuery({ items: { query: () => q }, company: 'NCT' });
  await assert.rejects(repository.queryPositions({ ...args, stockKey: 'K' }), /Permission\/network/);
});
