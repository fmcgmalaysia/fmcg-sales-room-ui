const test = require('node:test'), assert = require('node:assert/strict');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { prepareBorrowApproval, prepareBorrowingReceipt, transferId } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { createBorrowingStockReader } = require('../prototypes/stock-current-state/borrowing-stock-reader.cjs');
const copy = row => JSON.parse(JSON.stringify(row));
const identity = { company: 'NCT', barcode: '1', packing: '24x1', ea: 24 };
const uuid = n => String(n).padStart(8, '0') + '-2222-4222-8222-222222222222';
function fixture() {
  const key = stockKey(identity), positionId = id => hash('NCT', key, 'PURCHASE_SOURCE', id);
  const state = { ...identity, complete: true, revision: 0,
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { A: 0, B: 0 } },
    tasks: ['A', 'B'].map(id => ({ ...identity, id, customerId: 'CUSTOMER-' + id, requested: 100, dispatched: 0,
      orderId: 'O-' + id, sourceLineId: 'L-' + id })),
    sources: ['A', 'B'].map(id => ({ ...identity, id: 'S-' + id, ownerTaskId: id, poId: 'PO-' + id, orderId: 'O-' + id,
      sourceLineId: 'SL-' + id, poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND', planned: 100, accepted: id === 'B' ? 100 : 0,
      onHand: id === 'B' ? 100 : 0, isolated: 0, available: 0, claims: { [id]: id === 'B' ? 100 : 0 } })), relations: [] };
  const base = { company: 'NCT', stockKey: key, revision: 0, checkpointGeneration: 0, status: 'ACTIVE', _version: 'V0', reviewCodes: [] };
  const rows = { complete: true,
    positions: [{ ...base, _id: positionId('S-B'), sourceKind: 'PURCHASE_SOURCE', sourceTaskId: 'S-B', sourceId: 'S-B', poId: 'PO-B',
      receiptAccepted: 100, replacementReceived: 0, dispatched: 0, onHand: 100, isolated: 0, available: 0, reservedUsable: 100 }],
    claims: [{ ...base, _id: hash('NCT', positionId('S-B'), 'B'), positionId: positionId('S-B'), taskId: 'B', customerId: 'CUSTOMER-B',
      orderId: 'O-B', sourceLineId: 'L-B', reservedUsable: 100, isolatedAttributed: 0 },
    // Existing zero/CLOSED claim must be updated, not reinserted under its stable ID.
    { ...base, _id: hash('NCT', positionId('S-B'), 'A'), positionId: positionId('S-B'), taskId: 'A', customerId: 'CUSTOMER-A',
      orderId: 'O-A', sourceLineId: 'L-A', reservedUsable: 0, isolatedAttributed: 0, status: 'CLOSED' }],
    product: { ...base, _id: hash('NCT', key), onHand: 100, isolated: 0, available: 0, reservedUsable: 100, reviewRequired: false }, transfers: [] };
  const input = { expectedRevision: 0, id: 'REL-1', quantity: 30, lenderSourceId: 'S-B', replacementSourceId: 'S-A',
    borrowerTaskId: 'A', approvedBy: 'P1', reason: 'Fill container' };
  const event = { _id: 'APPROVAL-1', title: 'APPROVAL-1', description: 'REL-1', action: 'STOCK_TRANSFER_APPROVED', result: 'SAVED',
    activityTime: '2026-10-22T00:00:00.000Z', initiatedByStaffId: 'P1', details: { company: 'NCT', approval: copy(input) } };
  return { state, rows, input, event, generation: 0, key, positionId };
}
async function memory(f) {
  const db = new Map(); let failure = null;
  const read = async (c, id) => copy(db.get(c + ':' + id) || null);
  const put = (c, row) => db.set(c + ':' + row._id, copy(row));
  for (const [c, values] of [['StockPositions', f.rows.positions], ['StockClaims', f.rows.claims], ['StockProducts', [f.rows.product]]]) for (const row of values) put(c, row);
  const write = async (kind, c, row, version) => {
    if (failure?.({ kind, collection: c, row })) { failure = null; throw Error('Injected interruption'); }
    const old = await read(c, row._id);
    if (kind === 'insert' && old || kind === 'cas' && old?._version !== version) throw Error('Conditional conflict');
    put(c, row); return copy(row);
  };
  const store = { read, insert: (c, row) => write('insert', c, row), compareAndSet: (c, id, v, row) => {
    assert.equal(id, row._id); return write('cas', c, row, v);
  }, compareAndRemove: async (c, id, attempt) => {
    const old = await read(c, id); if (old?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id);
  } };
  const protocol = createFencedProof({ store }); await protocol.initialize();
  const rows = () => ({ complete: true,
    positions: [...db].filter(([k]) => k.startsWith('StockPositions:')).map(([, r]) => copy(r)),
    claims: [...db].filter(([k]) => k.startsWith('StockClaims:')).map(([, r]) => copy(r)),
    product: copy(db.get('StockProducts:' + f.rows.product._id)),
    transfers: [...db.values()].filter(r => r.action === 'STOCK_TRANSFER_CURRENT').map(copy) });
  return { store, protocol, rows, inject: fn => { failure = fn; } };
}
function receipt(state, amount, n = 1) {
  const source = state.sources.find(s => s.id === 'S-A');
  return { _id: 'RECEIPT-' + n, title: 'RECEIPT-' + n, description: source.poId, action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED',
    activityTime: '2026-10-22T00:01:00.000Z', initiatedByStaffId: 'WH1', details: { company: 'NCT', lines: [{ taskId: source.id,
      orderId: source.orderId, sourceLineId: source.sourceLineId, planned: source.planned, beforeAccepted: source.accepted,
      accepted: amount, beforeRejected: 0, rejected: 0, kind: 'PARTIAL', reason: 'Delivered' }] } };
}
test('approval uses individual current rows, updates CLOSED claim and keeps physical totals unchanged', () => {
  const f = fixture(), saved = JSON.stringify(f), result = prepareBorrowApproval(f);
  assert.equal(JSON.stringify(f), saved);
  const claim = result.plan.writes.find(w => w.collection === 'StockClaims' && w.after.taskId === 'A');
  assert.equal(claim.before.status, 'CLOSED'); assert.equal(claim.after.reservedUsable, 30);
  assert.equal(result.plan.writes.find(w => w.collection === 'StockProducts').after.onHand, 100);
  const transfer = result.plan.writes.find(w => w.after.action === 'STOCK_TRANSFER_CURRENT');
  assert.equal(transfer.after.details.relation.quantity, 30);
  assert.equal(result.plan.writes.some(w => Object.hasOwn(w.after, 'sources') || Object.hasOwn(w.after, 'tasks')), false);
});
test('approval, receipt20, receipt100 share existing conditional protocol and retain one transfer record', async () => {
  const f = fixture(), m = await memory(f), approved = prepareBorrowApproval(f);
  await m.protocol.commit({ requestId: uuid(1), memberId: 'P1', input: f.input, prepare: async () => approved.plan });
  let state = approved.state;
  for (const [n, amount] of [[2, 20], [3, 100]]) {
    const original = receipt(state, amount, n), result = prepareBorrowingReceipt({ state, rows: m.rows(), event: original, generation: n - 1 });
    assert.deepEqual(result.plan.writes[0].after.details, original.details);
    await m.protocol.commit({ requestId: uuid(n), memberId: 'WH1', input: original.details, prepare: async () => result.plan });
    state = result.state;
    const row = m.rows().transfers[0]; assert.equal(row.details.relation.repaid, Math.min(amount, 30));
  }
  assert.equal(m.rows().transfers.length, 1); assert.equal(m.rows().transfers[0].status, 'CLOSED');
  assert.equal(m.rows().product.onHand, 200); assert.equal(state.sources[0].claims.B, 30); assert.equal(state.sources[0].claims.A, 70);
});
test('interrupted automatic replacement blocks reads and resumes original plan; same request replays once', async () => {
  const f = fixture(), m = await memory(f), approved = prepareBorrowApproval(f);
  await m.protocol.commit({ requestId: uuid(1), memberId: 'P1', input: f.input, prepare: async () => approved.plan });
  const event = receipt(approved.state, 20), candidate = prepareBorrowingReceipt({ state: approved.state, rows: m.rows(), event, generation: 1 });
  let prepares = 0;
  const args = { requestId: uuid(2), memberId: 'WH1', input: event.details, prepare: async () => { prepares++; return candidate.plan; } };
  m.inject(e => e.collection === 'NCTActivity' && e.row.action === 'STOCK_TRANSFER_CURRENT');
  await assert.rejects(m.protocol.commit(args), /interruption/);
  await assert.rejects(m.protocol.readSnapshot(async () => m.rows()), /pending/);
  await assert.rejects(m.protocol.commit({ ...args, requestId: uuid(3) }), /pending/);
  const done = await m.protocol.commit(args), replay = await m.protocol.commit({ ...args, prepare: async () => { throw Error('Must not reprepare'); } });
  assert.deepEqual(replay, done); assert.equal(prepares, 1);
  assert.equal(m.rows().transfers[0].details.relation.repaid, 20);
  assert.equal(m.rows().product.onHand, 120); assert.equal((await m.protocol.readControl()).generation, 2);
});
test('stale or incomplete physical rows, inconsistent claims and business event mismatch stop before writes', () => {
  for (const mutate of [f => { f.rows.product.onHand = 101; }, f => { f.rows.positions = []; },
    f => { f.rows.claims[0].reservedUsable = 99; }, f => { f.rows.complete = false; },
    f => { f.rows.positions[0].replacementReceived = 1; }, f => { f.event.initiatedByStaffId = 'OTHER'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => prepareBorrowApproval(f));
  }
});
test('receipt binds original PO, source identity and accepted basis; corrections use their separate protected path', () => {
  const f = fixture(), approved = prepareBorrowApproval(f);
  // Materialize exact rows from approval without a database for this pure rejection test.
  const rows = copy(f.rows);
  for (const w of approved.plan.writes) {
    if (w.collection === 'StockProducts') rows.product = { ...w.after, _version: 'P1' };
    else if (w.after.action === 'STOCK_TRANSFER_CURRENT') rows.transfers.push({ ...w.after, _version: 'T1' });
    else if (w.collection === 'StockPositions' || w.collection === 'StockClaims') {
      const list = w.collection === 'StockPositions' ? rows.positions : rows.claims, index = list.findIndex(r => r._id === w.after._id);
      if (index >= 0) list[index] = { ...w.after, _version: 'V1' }; else list.push({ ...w.after, _version: 'V1' });
    }
  }
  for (const mutate of [e => { e.description = 'OTHER'; }, e => { e.details.lines[0].sourceLineId = 'OTHER'; },
    e => { e.details.lines[0].beforeAccepted = 1; }, e => { e.details.lines[0].kind = 'CORRECTION'; }]) {
    const event = receipt(approved.state, 20); mutate(event);
    assert.throws(() => prepareBorrowingReceipt({ state: approved.state, rows, event, generation: 1 }), /context mismatch/);
  }
});
test('transfer record identity stays stable and unbounded state is not silently chunked', () => {
  const f = fixture(); assert.equal(transferId('NCT', 'REL-1'), transferId('NCT', 'REL-1'));
  for (let n = 0; n < 13; n++) f.state.sources.push({ ...copy(f.state.sources[0]), id: 'EMPTY-' + n });
  assert.throws(() => prepareBorrowApproval(f), /bounded/);
});
test('already fulfilled borrower is not resurrected by receipt or by current transfer row completion', async () => {
  const f = fixture(); f.input.quantity = 100; f.event.details.approval = copy(f.input);
  const m = await memory(f), approved = prepareBorrowApproval(f);
  await m.protocol.commit({ requestId: uuid(1), memberId: 'P1', input: f.input, prepare: async () => approved.plan });
  // Trusted existing dispatch writer has posted its original domain event and physical changes.
  // This fixture only supplies the resulting exact current rows; it does not implement dispatch wiring.
  const { dispatch } = require('../prototypes/stock-current-state/borrowing-model.cjs');
  const shipped = dispatch(approved.state, { expectedRevision: 1, sourceId: 'S-B', taskId: 'A', quantity: 100 }).after;
  const rows = m.rows();
  const donor = rows.positions.find(r => r.sourceTaskId === 'S-B');
  donor.onHand = 0; donor.reservedUsable = 0; donor.dispatched = 100; donor.status = 'CLOSED';
  for (const row of rows.claims) { row.reservedUsable = 0; row.status = 'CLOSED'; }
  rows.product.onHand = 0; rows.product.reservedUsable = 0; rows.product.revision = 2; rows.product.status = 'CLOSED';
  const result = prepareBorrowingReceipt({ state: shipped, rows, event: receipt(shipped, 100), generation: 2 });
  assert.equal(result.state.tasks.find(t => t.id === 'A').dispatched, 100);
  assert.equal(result.plan.writes.find(w => w.collection === 'StockClaims' && w.after.taskId === 'B').after.reservedUsable, 100);
  assert.equal(result.plan.writes.some(w => w.collection === 'StockClaims' && w.after.taskId === 'A'), false);
  assert.equal(result.plan.writes.find(w => w.after.action === 'STOCK_TRANSFER_CURRENT').after.status, 'CLOSED');
});
function queryItems(m, calls, response) {
  return { query: collection => {
    const filters = {}, options = {};
    const q = { eq: (k, v) => { filters[k] = v; return q; }, ascending: field => { options.sort = field; return q; },
      limit: n => { options.limit = n; return q; }, find: async findOptions => {
        calls.push({ collection, filters, ...options, findOptions });
        if (response) return response;
        const values = m.rows(), all = collection === 'StockPositions' ? values.positions : collection === 'StockClaims' ? values.claims : values.transfers;
        const selected = all.filter(row => Object.entries(filters).every(([k, v]) => row[k] === v));
        return { items: selected.slice(0, options.limit), totalCount: selected.length };
      } };
    return q;
  } };
}
test('bounded reader includes CLOSED records and queries only current scoped rows', async () => {
  const f = fixture(), m = await memory(f), calls = [];
  const result = await createBorrowingStockReader({ company: 'NCT', items: queryItems(m, calls), store: m.store, protocol: m.protocol,
    readAuthority: async () => ({ kind: 'APPROVE', ...f }) })();
  assert.equal(result.metrics.queries, 3); assert.equal(result.metrics.exactReads, 4);
  assert.equal(result.plan.writes.find(w => w.collection === 'StockClaims' && w.after.taskId === 'A').before.status, 'CLOSED');
  assert.ok(calls.every(q => q.filters.company === 'NCT' && q.filters.stockKey === f.key && !Object.hasOwn(q.filters, 'status')
    && q.findOptions.consistentRead && q.findOptions.returnTotalCount));
  assert.equal(calls.find(q => q.collection === 'NCTActivity').filters.action, 'STOCK_TRANSFER_CURRENT');
});
test('bounded reader rejects overflow/missing count, preserves errors and never prepares behind pending barrier', async () => {
  const f = fixture(), m = await memory(f);
  for (const response of [{ items: [], totalCount: undefined }, { items: [], totalCount: 15 }, { items: [], totalCount: 1 }]) {
    await assert.rejects(createBorrowingStockReader({ company: 'NCT', items: queryItems(m, [], response), store: m.store,
      protocol: m.protocol, readAuthority: async () => ({ kind: 'APPROVE', ...f }) })(), /Incomplete/);
  }
  let authorityCalled = false;
  const blocked = createBorrowingStockReader({ company: 'NCT', items: queryItems(m, []), store: m.store,
    protocol: { readSnapshot: async () => { throw Error('Inventory pending'); } }, readAuthority: async () => { authorityCalled = true; return f; } });
  await assert.rejects(blocked(), /pending/); assert.equal(authorityCalled, false);
  await assert.rejects(createBorrowingStockReader({ company: 'NCT', items: queryItems(m, []), store: { read: async () => { throw Error('Read denied'); } },
    protocol: m.protocol, readAuthority: async () => ({ kind: 'APPROVE', ...f }) })(), /Read denied/);
});
