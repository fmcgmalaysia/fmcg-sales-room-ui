const test = require('node:test'), assert = require('node:assert/strict');
const { readScopedCurrentProduct } = require('../prototypes/stock-current-state/scoped-current-reader.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const identity = { company: 'NCT', barcode: '1', packing: '12x1', ea: 12 }, key = stockKey(identity);
function fixture() {
  const rows = new Map(), reads = [], queries = [], copy = x => JSON.parse(JSON.stringify(x)); let corruptPage;
  const put = (collection, row) => rows.set(collection + '/' + row._id, row);
  const base = { company: 'NCT', stockKey: key, _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [] };
  const positionId = id => hash('NCT', key, 'PURCHASE_SOURCE', id);
  const p = { ...base, _id: positionId('S'), sourceTaskId: 'S', receiptAccepted: 100, borrowRepaidCumulative: 0,
    dispatched: 20, onHand: 80, reservedUsable: 80, isolated: 0, available: 0 };
  put('StockPositions', p);
  put('StockProducts', { ...base, _id: hash('NCT', key), lifecycleVersion: 2, nextBorrowSequence: 501, reviewRequired: false,
    onHand: 80, reservedUsable: 80, isolated: 0, available: 0 });
  for (const [taskId, qty, shipped] of [['A', 80, 0], ['B', 0, 20], ['C', 0, 0]]) put('StockClaims', { ...base,
    _id: hash('NCT', p._id, taskId), positionId: p._id, taskId, reservedUsable: qty, isolatedAttributed: 0,
    dispatchedCumulative: shipped, status: qty ? 'ACTIVE' : 'CLOSED' });
  const relation = { id: 'OLD-REPAID', sequence: 500, lenderSourceId: 'S', replacementSourceId: 'FUTURE',
    borrowerTaskId: 'B', lenderTaskId: 'A', quantity: 20, repaid: 20, returned: 0 };
  put('NCTActivity', { ...base, _id: hash('NCT', 'STOCK_TRANSFER_CURRENT', relation.id), status: 'CLOSED',
    action: 'STOCK_TRANSFER_CURRENT', lenderSourceId: 'S', replacementSourceId: 'FUTURE', repaidQuantity: 20,
    participantTaskIds: ['B', 'A'], details: { relation } });
  const store = { read: async (c, id) => { reads.push(c + '/' + id); return copy(rows.get(c + '/' + id) || null); } };
  const items = { query: c => {
    const filters = []; let limit;
    const q = { eq: (f, v) => { filters.push(['eq', f, v]); return q; }, gt: (f, v) => { filters.push(['gt', f, v]); return q; },
      ascending: f => { assert.equal(f, '_id'); return q; }, limit: n => { limit = n; return q; }, find: async options => {
        assert.deepEqual(options, { consistentRead: true, returnTotalCount: true }); queries.push({ c, filters: copy(filters) });
        const matching = [...rows.entries()].filter(([address, row]) => address.startsWith(c + '/')
          && filters.every(([m, f, v]) => m === 'eq' ? row[f] === v : row[f] > v)).map(([, r]) => r).sort((a, b) => a._id.localeCompare(b._id));
        const page = { items: copy(matching.slice(0, limit)), totalCount: matching.length };
        if (corruptPage) corruptPage(page); return page;
      } }; return q;
  } };
  const args = { company: 'NCT', identity, store, items, transferIndexVersion: 2, pageSize: 1,
    sourceTaskIds: ['S', 'NEW'], claimPairs: [{ sourceTaskId: 'S', taskId: 'C' }] };
  return { args, rows, reads, queries, put, p, positionId, corrupt: fn => { corruptPage = fn; } };
}
test('ten thousand unrelated CLOSED sources do not enter ordinary operational working set', async () => {
  const f = fixture();
  for (let i = 0; i < 10000; i++) f.put('StockPositions', { _id: 'OLD-' + i, company: 'NCT', stockKey: key, status: 'CLOSED' });
  const result = await readScopedCurrentProduct(f.args);
  assert.equal(result.positions.length, 1); assert.equal(result.transfers.length, 0); assert.equal(result.claims.length, 3);
  assert.ok(result.claims.some(c => c.taskId === 'B' && c.dispatchedCumulative === 20));
  assert.ok(result.claims.some(c => c.taskId === 'C' && c.status === 'CLOSED'));
  assert.equal(f.reads.some(id => id.includes('OLD-')), false); assert.ok(f.reads.length < 10);
  assert.ok(f.queries.every(q => q.c !== 'NCTActivity' || q.filters.some(([m, k, v]) => m === 'eq' && k === 'status' && v === 'ACTIVE')));
});
test('receipt correction reloads only affected source CLOSED repaid relations, not whole product history', async () => {
  const f = fixture(), result = await readScopedCurrentProduct({ ...f.args, correctionSourceIds: ['FUTURE'] });
  assert.equal(result.transfers.length, 1); assert.equal(result.transfers[0].status, 'CLOSED');
  assert.ok(f.queries.some(q => q.filters.some(([, k, v]) => k === 'replacementSourceId' && v === 'FUTURE')));
  assert.ok(result.sourceTaskIds.includes('FUTURE'));
});
test('complete pagination, exact stable CLOSED reads and missing new-source IDs remain distinct', async () => {
  const f = fixture(); f.put('StockPositions', { ...f.p, _id: f.positionId('ZERO'), sourceTaskId: 'ZERO', status: 'CLOSED',
    onHand: 0, reservedUsable: 0, receiptAccepted: 0, dispatched: 0 });
  const result = await readScopedCurrentProduct({ ...f.args, sourceTaskIds: ['S', 'ZERO', 'NEW'] });
  assert.equal(result.positions.length, 2); assert.ok(result.sourceTaskIds.includes('NEW'));
  assert.equal(result.positions.some(p => p.sourceTaskId === 'NEW'), false);
  assert.ok(result.positions.some(p => p.sourceTaskId === 'ZERO' && p.status === 'CLOSED'));
});
test('missing index approval, unknown checkpoint, partial page and operational fanout reject without fallback', async () => {
  const a = fixture(); await assert.rejects(readScopedCurrentProduct({ ...a.args, transferIndexVersion: 1 }), /index required/); assert.equal(a.reads.length, 0);
  const b = fixture(); b.rows.get('StockPositions/' + b.p._id).borrowRepaidCumulative = null;
  await assert.rejects(readScopedCurrentProduct(b.args), /requires review/);
  const c = fixture(); c.corrupt(page => { if (page.totalCount) page.items = []; });
  await assert.rejects(readScopedCurrentProduct(c.args), /Incomplete/);
  const d = fixture(); await assert.rejects(readScopedCurrentProduct({ ...d.args, maxRowsPerSet: 1 }), /bounded current scope/);
});
test('inconsistent replacement index never masquerades as a valid correction relationship', async () => {
  const f = fixture(), row = [...f.rows.values()].find(r => r.action === 'STOCK_TRANSFER_CURRENT'); row.repaidQuantity = 19;
  await assert.rejects(readScopedCurrentProduct({ ...f.args, correctionSourceIds: ['FUTURE'] }), /index conflict/);
});
