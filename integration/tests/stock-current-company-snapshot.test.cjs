const test = require('node:test'), assert = require('node:assert/strict');
const { readCompanyCurrentSnapshot } = require('../prototypes/stock-current-state/company-current-snapshot.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const db = new Map(), calls = [];
  for (const [collection, count] of [['StockPositions', 5], ['StockClaims', 5], ['StockProducts', 1]]) for (let i = 0; i < count; i++) db.set(collection + ':' + i, { _id: String(i), company: 'NCT', _version: 'V' });
  db.set('NCTActivity:OTHER', { _id: 'OTHER', company: 'NCT', action: 'UNRELATED_BUSINESS_EVENT' });
  db.set('StockPositions:FOREIGN', { _id: 'FOREIGN', company: 'GHR' });
  const items = { query: collection => {
    const filters = []; let offset = 0, size;
    const q = { eq: (k, v) => { filters.push([k, v]); return q; }, ascending: key => { assert.equal(key, '_id'); return q; },
      skip: n => { offset = n; return q; }, limit: n => { size = n; return q; }, find: async options => {
        assert.deepEqual(options, { consistentRead: true, returnTotalCount: true }); calls.push({ collection, filters, offset, size });
        const all = [...db.entries()].filter(([id, row]) => id.startsWith(collection + ':') && filters.every(([k, v]) => row[k] === v)).map(([, row]) => row).sort((a, b) => a._id.localeCompare(b._id));
        return { items: copy(all.slice(offset, offset + size)), totalCount: all.length };
      } }; return q;
  } };
  return { db, calls, args: { company: 'NCT', items, store: { read: async (c, id) => copy(db.get(c + ':' + id) || null) },
    protocol: { readSnapshot: async fn => ({ generation: 7, rows: await fn() }) }, limits: { positions: 10, claims: 10, products: 10, transfers: 10 }, pageSize: 3 } };
}
test('explicit snapshot includes all pages and CLOSED/unknown rows, excludes foreign/unrelated Activity', async () => {
  const f = fixture(); f.db.get('StockPositions:0').status = 'CLOSED'; f.db.get('StockPositions:1').onHand = null;
  const r = await readCompanyCurrentSnapshot(f.args);
  assert.equal(r.complete, true); assert.equal(r.generation, 7); assert.equal(r.positions.length, 5); assert.equal(r.claims.length, 5);
  assert.equal(r.transfers.length, 0); assert.equal(r.positions[0].status, 'CLOSED'); assert.equal(r.positions[1].onHand, null);
  assert.deepEqual(r.metrics, { queries: 6, exactReads: 11 });
  assert.deepEqual(f.calls.find(c => c.collection === 'NCTActivity').filters, [['company', 'NCT'], ['action', 'STOCK_TRANSFER_CURRENT']]);
});
test('pending barrier and explicit budget stop before partial data can be reported complete', async () => {
  const f = fixture(); f.args.protocol.readSnapshot = async () => { throw Error('Pending'); };
  await assert.rejects(readCompanyCurrentSnapshot(f.args), /Pending/); assert.equal(f.calls.length, 0);
  const g = fixture(); g.args.limits.positions = 4; let exact = 0; g.args.store.read = async () => { exact++; return null; };
  await assert.rejects(readCompanyCurrentSnapshot(g.args), /over-budget/); assert.equal(exact, 0);
});
test('missing exact row and changed count between pages refuse, never a truncated successful snapshot', async () => {
  const f = fixture(); f.args.store.read = async () => null; await assert.rejects(readCompanyCurrentSnapshot(f.args), /changed/);
  const g = fixture(), originalRead = g.args.store.read;
  g.args.store.read = async (c, id) => { const row = await originalRead(c, id); if (c === 'StockPositions' && id === '2') g.db.delete('StockPositions:4'); return row; };
  await assert.rejects(readCompanyCurrentSnapshot(g.args), /Incomplete/);
  const h = fixture(); h.args.limits = null; await assert.rejects(readCompanyCurrentSnapshot(h.args), /budgets/); assert.equal(h.calls.length, 0);
});
