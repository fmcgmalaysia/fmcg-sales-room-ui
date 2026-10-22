const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createReceiptReadSnapshot } = require('../prototypes/stock-current-state/receipt-read-snapshot.cjs');
const { readScopedCurrentProduct } = require('../prototypes/stock-current-state/scoped-current-reader.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const file = require.resolve('./stock-current-scoped-reader.test.cjs');
const factory = vm.runInNewContext(fs.readFileSync(file, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + ';fixture;', { require: createRequire(file) });
const copy = row => JSON.parse(JSON.stringify(row));
async function batched(f, extra = {}) {
  const { sourceTaskIds, claimPairs, correctionSourceIds = [] } = f.args;
  const snapshot = await createReceiptReadSnapshot({ ...f.args, products: [{ identity: f.args.identity,
    stockScope: { sourceTaskIds, claimPairs, correctionSourceIds } }], ...extra });
  return readScopedCurrentProduct({ ...f.args, store: snapshot.store, snapshotSets: snapshot });
}
test('same-snapshot batches exactly match original scoped source/claim/transfer semantics including CLOSED correction and zero', async () => {
  for (const correction of [false, true]) {
    const f = factory(); f.put('StockPositions', { ...copy(f.p), _id: f.positionId('ZERO'), sourceTaskId: 'ZERO',
      status: 'CLOSED', onHand: 0, reservedUsable: 0, dispatched: 0, receiptAccepted: 0 });
    f.args.sourceTaskIds.push('ZERO'); if (correction) f.args.correctionSourceIds = ['FUTURE'];
    for (let i = 0; i < 10000; i++) f.put('StockPositions', { _id: 'OLD-' + i, company: 'NCT', stockKey: f.p.stockKey, status: 'CLOSED' });
    const original = await readScopedCurrentProduct(f.args), result = await batched(f);
    // Set order is irrelevant to models; exact images/required identities are not.
    const canonical = rows => ({ ...copy(rows), positions: copy(rows.positions).sort((a,b) => a._id.localeCompare(b._id)),
      claims: copy(rows.claims).sort((a,b) => a._id.localeCompare(b._id)), sourceTaskIds: [...rows.sourceTaskIds].sort() });
    assert.deepEqual(canonical(result), canonical(original));
    assert.equal(result.positions.some(row => row._id.startsWith('OLD-')), false);
    assert.equal(result.positions.some(row => row.sourceTaskId === 'NEW'), false);
    assert.ok(result.positions.some(row => row.sourceTaskId === 'ZERO' && row.onHand === 0));
    assert.ok(result.claims.some(row => row.taskId === 'C' && row.status === 'CLOSED'));
  }
});
test('partial paging, duplicate identities, transport failure and listed/exact race abort preparation', async () => {
  for (const kind of ['partial', 'duplicate', 'count', 'transport', 'race']) {
    const f = factory(); let calls = 0;
    f.corrupt(page => {
      calls++;
      if (kind === 'partial' && page.totalCount) page.items = [];
      if (kind === 'duplicate' && page.totalCount) { page.items.push(copy(page.items[0])); page.totalCount++; }
      if (kind === 'count') delete page.totalCount;
      if (kind === 'transport' && calls === 2) throw Error('Native query denied');
    });
    if (kind === 'race') { const read = f.args.store.readMany;
      f.args.store.readMany = async (c, ids) => { const rows = await read(c, ids); if (c === 'StockPositions') rows.filter(Boolean).forEach(row => { row._version = 'CHANGED'; }); return rows; };
    }
    await assert.rejects(batched(f), undefined, kind);
  }
});
test('batch discovery retains corrupt source/claim/relation review refusals from original validator', async () => {
  for (const kind of ['position', 'claim', 'relation', 'foreign', 'wrongProduct']) {
    const f = factory(); f.args.correctionSourceIds = ['FUTURE'];
    if (kind === 'position') f.rows.get('StockPositions/' + f.p._id).borrowRepaidCumulative = null;
    if (kind === 'claim') [...f.rows.values()].find(row => row.taskId === 'A')._id = 'WRONG';
    if (kind === 'relation') [...f.rows.values()].find(row => row.action === 'STOCK_TRANSFER_CURRENT').repaidQuantity = 19;
    if (kind === 'foreign' || kind === 'wrongProduct') {
      const read = f.args.store.readMany; f.args.store.readMany = async (c, ids) => {
        const rows = await read(c, ids); if (c === 'StockProducts') rows.filter(Boolean).forEach(row => { row[kind === 'foreign' ? 'company' : 'stockKey'] = 'FOREIGN'; }); return rows;
      };
    }
    await assert.rejects(batched(f), undefined, kind);
  }
});
test('cached absence is confirmed, scope is closed and a fresh snapshot never reuses an earlier image', async () => {
  const f = factory(), args = { ...f.args, products: [{ identity: f.args.identity, stockScope: { sourceTaskIds: ['S', 'NEW'], claimPairs: [], correctionSourceIds: [] } }] };
  const first = await createReceiptReadSnapshot(args), id = f.positionId('NEW');
  assert.equal(await first.store.read('StockPositions', id), null);
  await assert.rejects(first.store.read('StockPositions', 'UNREAD'), /not prepared/);
  await assert.rejects(first.readSet('StockClaims', f.p.stockKey, [['eq', 'taskId', 'UNREAD']]), /not prepared/);
  f.put('StockPositions', { ...copy(f.p), _id: id, sourceTaskId: 'NEW' });
  const second = await createReceiptReadSnapshot(args);
  assert.equal(await first.store.read('StockPositions', id), null);
  assert.equal((await second.store.read('StockPositions', id)).sourceTaskId, 'NEW');
  assert.equal(first.store.compareAndSet, undefined);
});
test('scope/index/capability/fanout bounds reject rather than silently use legacy or partial sets', async () => {
  for (const extra of [{ transferIndexVersion: 1 }, { maxRowsPerSet: 0 }, { maxSnapshotRows: 1 }, { products: [] },
    { store: { read: async () => null } }]) await assert.rejects(batched(factory(), extra));
  const f = factory(); await assert.rejects(batched(f, { maxRowsPerSet: 1 }));
});
test('more than one page of the same product is complete and retains exact zero/closed pairs', async () => {
  const f = factory();
  for (let i = 0; i < 110; i++) f.put('StockClaims', { company: 'NCT', stockKey: f.p.stockKey, _id: hash('NCT', f.p._id, 'EXTRA-' + i),
    _version: 'V0', revision: 0, status: 'ACTIVE', reviewCodes: [], positionId: f.p._id, taskId: 'EXTRA-' + i,
    reservedUsable: 0, isolatedAttributed: 0, dispatchedCumulative: 0 });
  const result = await batched(f); assert.equal(result.claims.length, 113);
  assert.ok(f.queries.some(q => q.filters.some(([method, field]) => method === 'gt' && field === '_id')));
});
test('actual 300-product receipt preparation stays within the new offline query budget without changing pending progress', async () => {
  const { measureWarehouseInvocationBudget } = require('../prototypes/stock-current-state/measure-warehouse-invocation-budget.cjs');
  const report = await measureWarehouseInvocationBudget(300, 20), [first, second] = report.snapshots;
  assert.equal(report.productionCapacityAccepted, false);
  assert.equal(first.result.pending, true); assert.equal(first.result.completedCount, 20); assert.equal(first.result.totalRecords, 901);
  assert.ok(first.operations.find <= 45); assert.ok(first.operations.read <= 55); assert.ok(first.countedDataRoundTripLowerBound <= 120);
  assert.equal(second.result.completedCount, 40); assert.equal(second.operations.find, 0);
});
test('snapshot byte and aggregate input budgets stop before memory grows with huge images or scopes', async () => {
  await assert.rejects(batched(factory(), { maxSnapshotBytes: 100 }), /byte policy/);
  await assert.rejects(batched(factory(), { maxSnapshotBytes: 0 }), /dependencies required/);
  const f = factory(); f.args.sourceTaskIds = Array.from({ length: 30 }, (_, i) => 'S' + i);
  await assert.rejects(batched(f, { maxSnapshotRows: 25 }), /input policy/);
  assert.equal(f.queries.length, 0);
});
