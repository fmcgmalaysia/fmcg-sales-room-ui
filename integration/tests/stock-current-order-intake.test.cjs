const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createNctIntake, createNctReceiptReader } = load('nctIntake.js');
const { prepareOrderIntake, intakeProtocolIdentity } = require('../prototypes/stock-current-state/order-intake-plan.cjs');
const { domainCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(company = 'NCT') {
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', otherJournal = company === 'NCT' ? 'NCTActivity1' : 'NCTActivity';
  const body = { sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: company, orderId: 'ORDER',
    customerId: 'C', customerCompanyName: 'Customer', submissionId: 'SUB', submittedByStaffId: 'S', submittedByStaffName: 'Sales',
    submittedAt: '2026-10-22T03:00:00Z', transactionCurrency: 'USD', fxRate: 4.3, estimatedShipmentDate: '2026-11-12',
    lines: [{ sourceLineId: 'L', unitBarcode: '00123', itemName: 'Item', packingSize: '12x1', eaPerCtn: 12, qtyCtn: 100, sellingPricePc: 2 }] };
  const tables = { [orders]: [], [tasks]: [], [journal]: [], [otherJournal]: [] }; let captures = 0;
  const args = { company, body, tables, createNctIntake, createNctReceiptReader, now: () => new Date('2026-10-22T03:00:01Z'), captureCosts: async barcodes => {
    captures++; return Object.fromEntries(barcodes.map(unitBarcode => [unitBarcode, { unitBarcode, capturedAt: '2026-10-22T03:00:01Z', costCurrency: 'MYR',
      costStatus: 'CAPTURED', costIssues: [], lpPc: 1, lpCtn: 12, disc1: 0, disc2: 0, disc3: 0, netCostCtn: 12, cbmPerCtn: 0.1 }]));
  } };
  function apply(result) { for (const w of result.plan.writes) tables[w.collection].push(copy(w.after)); }
  return { args, orders, tasks, journal, otherJournal, apply, captures: () => captures };
}

test('original intake/receipt creates exact company insert-only plan, no inventory or procurement invented', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = fixture(company), before = JSON.stringify(f.args.tables), result = await prepareOrderIntake(f.args);
    assert.equal(result.outcome.ok, true); assert.equal(result.plan.writes.length, 5); assert.equal(result.activationReady, false);
    assert.equal(result.plan.writes.at(-1).after.action, 'ORDER_RECEIVED');
    const order = result.plan.writes.find(w => w.collection === f.orders).after, task = result.plan.writes.find(w => w.collection === f.tasks).after;
    assert.equal(order.orderId, 12); assert.equal(order.orderQtyInCtn, 100); assert.equal(order.adminFxSource, 4.3); assert.equal(order.description, '00123');
    assert.equal(task.receivedQtyInCtn, null); assert.equal(task.ourPoNumber, ''); assert.equal(task.supplierId, '');
    assert.equal(result.plan.writes.every(w => w.before === null && w.after.company === company && w.collection !== f.otherJournal), true);
    assert.equal(result.plan.writes.some(w => w.collection.startsWith('Stock')), false); assert.equal(JSON.stringify(f.args.tables), before);
  }
});

test('duplicate accepted delivery retains manual procurement fields and never recaptures or changes quantity', async () => {
  const f = fixture(), first = await prepareOrderIntake(f.args); f.apply(first);
  const task = f.args.tables[f.tasks][0]; task.lpCtn = 88; task.supplierId = 'KEEP'; task.ourPoNumber = 'KEEP-PO'; task.rowPosition = 90;
  const replay = await prepareOrderIntake(f.args); assert.equal(replay.replay, true); assert.equal(replay.plan.writes.length, 0);
  assert.deepEqual(replay.outcome, first.outcome); assert.equal(task.lpCtn, 88); assert.equal(task.supplierId, 'KEEP'); assert.equal(f.captures(), 1);
  const changed = copy(f.args.body); changed.lines[0].qtyCtn = 101;
  await assert.rejects(prepareOrderIntake({ ...f.args, body: changed }), /different submission/);
});

test('original incomplete persistence resumes immutable captured costs, accepted marker still last', async () => {
  const f = fixture(), first = await prepareOrderIntake(f.args);
  f.args.tables[f.journal].push(copy(first.plan.writes[0].after));
  f.args.tables[f.orders].push(copy(first.plan.writes[1].after));
  const resume = await prepareOrderIntake(f.args);
  assert.equal(f.captures(), 1); assert.equal(resume.plan.writes.length, 3); assert.equal(resume.plan.writes.at(-1).after.action, 'ORDER_RECEIVED');
});

test('original source/date/line validation and opposite-company accepted preparation remain authoritative', async () => {
  for (const patch of [{ sourceSiteId: 'OTHER' }, { estimatedShipmentDate: '2026-02-30' }, { fxRate: 0 }]) {
    const f = fixture(); await assert.rejects(prepareOrderIntake({ ...f.args, body: { ...f.args.body, ...patch } })); assert.equal(f.captures(), 0);
  }
  const f = fixture(), accepted = await prepareOrderIntake(f.args), g = fixture('GHR');
  g.args.tables[g.otherJournal] = accepted.plan.writes.filter(w => w.collection === f.journal).map(w => copy(w.after));
  await assert.rejects(prepareOrderIntake(g.args), /receiving company/); assert.equal(g.captures(), 0);
});

test('POINTBASE outage preserves original explicit missing-cost state instead of fabricating zero', async () => {
  const f = fixture(); f.args.captureCosts = async () => { throw Error('offline'); };
  const result = await prepareOrderIntake(f.args), task = result.plan.writes.find(w => w.collection === f.tasks).after;
  assert.equal(result.outcome.costErrorTaskCount, 1); assert.equal(task.lpCtn, null); assert.equal(task.costStatus, 'ERROR');
  assert.equal(task.costErrorReason, 'POINTBASE_SERVICE_UNAVAILABLE');
});

test('prototype budget refuses a large original order atomically; never silently chunks or drops lines', async () => {
  const f = fixture(); f.args.body.lines = Array.from({ length: 10 }, (_, i) => ({ ...f.args.body.lines[0], sourceLineId: 'L' + i }));
  await assert.rejects(prepareOrderIntake(f.args), /bounded original intake/);
  assert.equal(Object.values(f.args.tables).every(rows => rows.length === 0), true);
});

test('company-local plan does not pretend concurrent opposite routing is serialized', async () => {
  const f = fixture(), g = fixture('GHR');
  const [a, b] = await Promise.all([prepareOrderIntake(f.args), prepareOrderIntake(g.args)]);
  assert.equal(a.outcome.ok, true); assert.equal(b.outcome.ok, true);
  for (const candidate of [a, b]) assert.equal(candidate.blockers.includes('CROSS_COMPANY_ROUTING_PROOF_REQUIRED'), true);
  // These are private plans, not acceptance receipts or permission to publish.
  assert.equal(a.activationReady || b.activationReady, false);
});

test('same server intake identity resumes an interrupted task write, with one capture and receipt', async () => {
  const f = fixture(), db = new Map(); let failTask = true, prepares = 0;
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, row) => {
    if (c === f.tasks && failTask) { failTask = false; throw Error('Task interrupted'); }
    if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row);
  }, compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row)); return copy(row); },
  compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize();
  const identity = intakeProtocolIdentity(f.args.body), command = { ...identity, input: f.args.body, prepare: async () => { prepares++; return (await prepareOrderIntake(f.args)).plan; } };
  await assert.rejects(protocol.commit(command), /Task interrupted/);
  await assert.rejects(protocol.readSnapshot(async () => null), /pending/i);
  assert.equal([...db.values()].some(row => row.action === 'ORDER_RECEIVED'), false);
  await protocol.commit(command); await protocol.commit(command);
  assert.equal(prepares, 1); assert.equal(f.captures(), 1); assert.equal([...db.values()].filter(row => row.action === 'ORDER_RECEIVED').length, 1);
  assert.equal((await protocol.readSnapshot(async () => null)).generation, 1);
});
