const test = require('node:test'), assert = require('node:assert/strict');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { createReceiptStockReader } = require('../prototypes/stock-current-state/receipt-stock-reader.cjs');
const clone = row => JSON.parse(JSON.stringify(row));
function fixture() {
  const task = { id: 'B', company: 'NCT', customerId: 'B', orderId: 'O', sourceLineId: 'L',
    barcode: '1', packing: '12x1', ea: 12, poId: 'PO' };
  const key = stockKey(task), positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'B'), productId = hash('NCT', key), claimId = hash('NCT', positionId, 'B');
  const base = { company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'CLOSED', _version: 'V0',
    onHand: 0, reservedUsable: 0, isolated: 0, available: 0 };
  const rows = new Map([
    ['StockPositions:' + positionId, { ...base, _id: positionId, sourceTaskId: 'B', poId: 'PO', receiptAccepted: 40, replacementReceived: 0, dispatched: 40, reviewCodes: [] }],
    ['StockProducts:' + productId, { ...base, _id: productId, reviewRequired: false }],
    ['StockClaims:' + claimId, { _id: claimId, company: 'NCT', stockKey: key, positionId, taskId: 'B', customerId: 'B', orderId: 'O', sourceLineId: 'L', reservedUsable: 0,
      isolatedAttributed: 0, reviewCodes: [], revision: 0, status: 'CLOSED', _version: 'V0' }]
  ]);
  const calls = [], queries = [];
  const event = { _id: 'E', title: 'E', description: 'PO', action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED',
    details: { company: 'NCT', lines: [{ taskId: 'B', orderId: 'O', sourceLineId: 'L', planned: 100, beforeAccepted: 40, accepted: 60,
      beforeRejected: 0, rejected: 0, kind: 'PARTIAL', reason: 'later receipt' }] } };
  const authority = { event, sources: [{ sourceTask: task, ownership: { kind: 'PURCHASE_CUSTOMER_SHARE', customerShare: 100, owner: task },
    holds: { complete: true, scope: 'SOURCE_CONFIRMED', sourceTaskId: 'B', heldByTask: {} } }] };
  const store = { read: async (collection, id) => { calls.push({ collection, id }); return clone(rows.get(collection + ':' + id) || null); },
    all: async () => { throw Error('Full history read forbidden'); } };
  const items = { query: collection => {
    assert.equal(collection, 'StockClaims'); const filters = {}, options = {};
    const q = { eq: (field, value) => { filters[field] = value; return q; }, ascending: field => { options.sort = field; return q; },
      limit: n => { options.limit = n; return q; }, find: async findOptions => {
        queries.push({ ...options, filters, findOptions });
        const selected = [...rows].filter(([key, row]) => key.startsWith('StockClaims:') && Object.entries(filters).every(([field, value]) => row[field] === value)).map(([, row]) => clone(row));
        return { items: selected.slice(0, options.limit), totalCount: selected.length };
      } }; return q;
  } };
  const protocol = { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) };
  const deps = { company: 'NCT', items, store, protocol, readReceiptAuthority: async () => authority };
  return { rows, authority, deps, calls, queries, positionId, claimId, productId };
}

test('writer reads CLOSED exact source/claim and plans update, never duplicate stable-ID insert', async () => {
  const f = fixture(), result = await createReceiptStockReader(f.deps)();
  const claim = result.plan.writes.find(write => write.collection === 'StockClaims');
  assert.equal(claim.before.status, 'CLOSED'); assert.equal(claim.after.reservedUsable, 20);
  assert.equal(claim.after._id, f.claimId); assert.equal(result.metrics.exactReads, 3); assert.equal(result.metrics.claimQueries, 1);
  assert.deepEqual(f.queries[0], { sort: '_id', limit: 31, filters: { company: 'NCT', positionId: f.positionId },
    findOptions: { consistentRead: true, returnTotalCount: true } });
});
test('shared product snapshot is read only once for two receipt sources', async () => {
  const f = fixture(), task = { ...f.authority.sources[0].sourceTask, id: 'C', customerId: 'C', orderId: 'O-C', sourceLineId: 'L-C' };
  f.authority.sources.push({ sourceTask: task, ownership: { kind: 'PURCHASE_CUSTOMER_SHARE', customerShare: 100, owner: task },
    holds: { complete: true, scope: 'SOURCE_CONFIRMED', sourceTaskId: 'C', heldByTask: {} } });
  f.authority.event.details.lines.push({ ...f.authority.event.details.lines[0], taskId: 'C', orderId: 'O-C', sourceLineId: 'L-C', beforeAccepted: 0, accepted: 30 });
  const result = await createReceiptStockReader(f.deps)();
  assert.equal(f.calls.filter(call => call.collection === 'StockProducts').length, 1);
  assert.equal(result.plan.writes.find(write => write.collection === 'StockProducts').after.onHand, 50);
});
test('claim overflow or incomplete count never returns truncated ownership as complete', async () => {
  for (const response of [{ items: [], totalCount: 1 }, { items: [], totalCount: 31 }, { items: [], totalCount: undefined }]) {
    const f = fixture(), q = {};
    for (const method of ['eq', 'ascending', 'limit']) q[method] = () => q;
    q.find = async () => response;
    await assert.rejects(createReceiptStockReader({ ...f.deps, items: { query: () => q } })(), /complete snapshot bound/);
  }
});
test('pending stops before authority/current reads; generation barrier error propagates', async () => {
  const f = fixture(); let called = false;
  const deps = { ...f.deps, readReceiptAuthority: async () => { called = true; return f.authority; },
    protocol: { readSnapshot: async () => { throw Error('Inventory pending'); } } };
  await assert.rejects(createReceiptStockReader(deps)(), /pending/); assert.equal(called, false); assert.equal(f.calls.length, 0);
  deps.protocol = { readSnapshot: async fn => { await fn(); throw Error('Inventory changed during read'); } };
  await assert.rejects(createReceiptStockReader(deps)(), /changed during read/);
});
test('global task holds cannot be relabeled as source-specific confirmation', async () => {
  const f = fixture(); f.authority.sources[0].holds.scope = 'TASK_TOTAL';
  await assert.rejects(createReceiptStockReader(f.deps)(), /Confirmed source holds/); assert.equal(f.calls.length, 0);
});
test('permission/read errors and vanished claims stop instead of becoming free inventory', async () => {
  const f = fixture();
  await assert.rejects(createReceiptStockReader({ ...f.deps, store: { read: async () => { throw Error('Permission unavailable'); } } })(), /Permission unavailable/);
  const original = f.deps.store.read;
  f.deps.store.read = async (c, id) => c === 'StockClaims' ? null : original(c, id);
  await assert.rejects(createReceiptStockReader(f.deps)(), /snapshot changed/);
});
