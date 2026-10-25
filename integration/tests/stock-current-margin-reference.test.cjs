const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createPurchaseMarginRefresh } = load('purchaseMarginRefresh.js');
const { prepareMarginReference, prepareMarginReferenceGroup } = require('../prototypes/stock-current-state/margin-reference-plan.cjs');
const { domainCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(company = 'NCT') {
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const order = { _id: 'O', company, _version: 'O0', title: 'ORDER', sourceLineId: 'L', transactionCurrency: 'SGD', sellingPricePc: 10,
    orderId: 10, salesInvoiceNumber: '', gp: 0.1, adminFxSource: 3, orderQtyInCtn: 100, customerId: 'C' };
  const task = { _id: 'T', company, _version: 'T0', title: 'T', description: 'ORDER', imageAltText: 'L', purchaseQtyInCtn: 90,
    receivedQtyInCtn: 80, supplierId: 'SUP', ourPoNumber: 'PO', lpCtn: 240, lpPc: 24, disc1: 0, disc2: 0, disc3: 0 };
  const tables = { [orders]: [order], [tasks]: [task], [journal]: [] }, workspace = { company, tasks: [{ id: 'T', orderId: 'ORDER',
    sourceLineId: 'L', customerId: 'C', ord: 90, supplierId: 'SUP', procurement: { totalCtn: 90, revision: 'PLAN' } }] };
  let rate = 3.2, rateReads = 0;
  const args = { company, tables, workspace, createPurchaseMarginRefresh, now: () => new Date('2026-10-22T04:00:00Z'),
    readRates: async () => { rateReads++; return [{ currency: 'SGD', rateToMyr: rate, updatedAt: '2026-10-22T03:59:00Z' }]; } };
  return { args, orders, tasks, journal, task, order, setRate: value => rate = value, reads: () => rateReads };
}
function invoices(f, quantity) {
  const line = { taskId: 'T', quantity, sources: [{ sourceTaskId: 'T', quantity }] };
  f.args.tables[f.journal] = ['REQUESTED', 'INVOICED'].map((status, i) => ({ _id: 'S' + i, title: 'S' + i, description: 'SHIP',
    action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: '2026-10-22T03:00:00Z', details: { beforeRevision: i ? 'S0' : '', shipment: {
      id: 'SHIP', company: f.args.company, customerId: 'C', currency: 'SGD', status,
      lines: [{ ...line, ...(i ? { sellingPriceCtn: 100, rateToMyr: 3, costSources: [{ sourceTaskId: 'T', quantity, netCostCtn: 240 }] } : {}) }],
      ...(i ? { invoice: { number: 'INV', date: '2026-10-22', amountCents: quantity * 10000, currency: 'SGD', rateToMyr: 3,
        at: '2026-10-22T03:00:00Z', by: 'Support', byStaffId: 'S' } } : {}) } } }));
}

test('original GP/FX cache becomes paired exact audit/order plan in both companies, no source/stock edits', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(company), before = JSON.stringify(f.args.tables), result = await prepareMarginReference(f.args);
    assert.equal(new Map(result.results).get('T'), 0.25); assert.equal(result.plan.writes.length, 2); assert.equal(result.mustCommit, true);
    assert.equal(result.plan.writes[0].after.action, 'GP_RECALCULATED');
    const change = result.plan.writes[1]; assert.equal(change.collection, f.orders); assert.equal(change.before._version, 'O0');
    assert.equal(change.after.adminFxSource, 3.2); assert.equal(change.after.orderQtyInCtn, 100); assert.equal(change.after.sellingPricePc, 10);
    assert.equal(result.plan.writes.every(w => w.after.company === company), true); assert.equal(JSON.stringify(f.args.tables), before);
  }
});

test('unchanged reads create no plan writes; missing rate/cost remains unknown, never old cached GP or zero', async () => {
  const f = fixture(); f.order.gp = 0.25; f.order.adminFxSource = 3.2;
  const same = await prepareMarginReference(f.args); assert.equal(same.mustCommit, false); assert.equal(same.plan.writes.length, 0);
  for (const kind of ['rate', 'cost']) {
    const g = fixture(); if (kind === 'rate') g.setRate(null); else g.task.disc3 = null;
    const result = await prepareMarginReference(g.args); assert.equal(new Map(result.results).get('T'), null); assert.equal(result.plan.writes.length, 0);
  }
});

test('bare invoice fails closed, locked invoice stays frozen, partial invoice only reprices the open portion', async () => {
  const f = fixture(); f.order.salesInvoiceNumber = 'INV';
  assert.equal(new Map((await prepareMarginReference(f.args)).results).get('T'), null);
  f.order.financialLockedBy = 'ACCOUNT'; f.order.gp = 0.375; f.setRate(5);
  const locked = await prepareMarginReference(f.args); assert.equal(new Map(locked.results).get('T'), 0.375); assert.equal(locked.mustCommit, false);
  const g = fixture(); invoices(g, 40); g.setRate(4);
  const partial = await prepareMarginReference(g.args), expected = (40 * 300 + 50 * 400 - 90 * 240) / (40 * 300 + 50 * 400);
  assert.equal(new Map(partial.results).get('T'), expected);
  assert.equal(partial.plan.writes.at(-1).after.salesInvoiceSummary[0].rateToMyr, 3);
  assert.equal(partial.plan.writes.at(-1).after.salesInvoiceNumber, '');
  const h = fixture(); invoices(h, 90); h.args.readRates = async () => { throw Error('Offline'); };
  assert.equal(new Map((await prepareMarginReference(h.args)).results).get('T'), 0.2);
});

test('original existing cost/GP locks stay intact and suppress GP instead of being stolen or deleted', async () => {
  for (const kind of ['COST_LOCK', 'GP_LOCK']) {
    const f = fixture(), lock = { _id: hash('NCT', 'T', kind), details: { requestId: 'OTHER' } };
    f.args.tables[f.journal].push(lock); const before = JSON.stringify(f.args.tables);
    const result = await prepareMarginReference(f.args); assert.equal(new Map(result.results).get('T'), null);
    assert.equal(result.mustCommit, false); assert.equal(JSON.stringify(f.args.tables), before);
  }
});

test('guard rejection cannot be swallowed by original best-effort cache catch', async () => {
  const f = fixture(); f.args.createPurchaseMarginRefresh = ({ store }) => async () => {
    try { await store.update(f.orders, { ...f.order, orderQtyInCtn: 999 }); } catch (_) {}
    return new Map([['T', 0.25]]);
  };
  await assert.rejects(prepareMarginReference(f.args), /cannot change/); assert.equal(f.order.orderQtyInCtn, 100);
});

test('existing independent demand boundary retains every supplier child, without a whole-workroom transaction', async () => {
  const f = fixture();
  f.args.workspace.tasks[0].procurement = { totalCtn: 60, revision: 'P1' };
  f.args.tables[f.tasks].push({ ...copy(f.task), _id: 'B', title: 'B', procurementSource: true, customerDemandTaskId: 'T', lpCtn: 300 });
  f.args.workspace.tasks.push({ id: 'B', orderId: 'ORDER', sourceLineId: 'L', procurementSource: true, customerDemandTaskId: 'T',
    ord: 0, procurement: { totalCtn: 30, revision: 'P2' } });
  for (let i = 1; i <= 16; i++) {
    f.args.tables[f.orders].push({ ...copy(f.order), _id: 'O' + i, title: 'ORDER' + i, sourceLineId: 'L' + i });
    f.args.tables[f.tasks].push({ ...copy(f.task), _id: 'T' + i, title: 'T' + i, description: 'ORDER' + i, imageAltText: 'L' + i });
    f.args.workspace.tasks.push({ ...copy(f.args.workspace.tasks[0]), id: 'T' + i, orderId: 'ORDER' + i, sourceLineId: 'L' + i,
      procurement: { totalCtn: 90, revision: 'P' + i } });
  }
  await assert.rejects(prepareMarginReference(f.args), /bounded margin plan/);
  const group = await prepareMarginReferenceGroup({ ...f.args, targetTaskId: 'T' });
  assert.equal(new Map(group.results).get('T'), (320 - 260) / 320);
  assert.equal(new Map(group.results).has('SOURCE:B'), true); assert.equal(new Map(group.results).has('T1'), false);
  assert.equal(group.plan.writes.length, 2); assert.equal(group.plan.writes.at(-1).after._id, 'O');
  await assert.rejects(prepareMarginReferenceGroup({ ...f.args, targetTaskId: 'B' }), /demand group/);
});

test('interrupted audit/cache common fence hides partial state and replays without recalculation', async () => {
  const f = fixture(), db = new Map(); let failOrder = true, prepares = 0;
  for (const [c, rows] of Object.entries(f.args.tables)) for (const row of rows) db.set(c + ':' + row._id, copy(row));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => {
      if (c === f.orders && failOrder) { failOrder = false; throw Error('Cache interrupted'); }
      if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row)); return copy(row);
    }, compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize();
  const command = { requestId: '11111111-1111-4111-8111-111111111111', memberId: 'SYSTEM_GP', input: { company: 'NCT', readGeneration: 0 },
    prepare: async () => { prepares++; return (await prepareMarginReference(f.args)).plan; } };
  await assert.rejects(protocol.commit(command), /Cache interrupted/); await assert.rejects(protocol.readSnapshot(async () => null), /pending/i);
  await protocol.commit(command); await protocol.commit(command);
  assert.equal(prepares, 1); assert.equal(f.reads(), 1); assert.equal(db.get(f.orders + ':O').gp, 0.25);
  assert.equal([...db.values()].filter(row => row.action === 'GP_RECALCULATED').length, 1);
  assert.equal(db.get(f.tasks + ':T').receivedQtyInCtn, 80);
});
