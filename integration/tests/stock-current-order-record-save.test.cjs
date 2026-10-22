const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { createCurrentPurchaseOrderRecordSave, createCurrentAccountOrderRecordSave } = require('../prototypes/stock-current-state/current-order-record-save.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js'), { requireAccountStaff } = load('accountPurchaseReview.js');
const { createAccountSettlementOperations } = load('accountSettlement.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const filename = require.resolve('./stock-current-purchase-order-record.test.cjs');
const baseFixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\nfixture;',
  { require: createRequire(filename), Map, Buffer });
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(company = 'NCT', department = 'PURCHASE', saved = true) {
  const f = baseFixture(company, saved), db = new Map(f.records.map(row => ['PurchaseOrders:' + row._id, copy(row)]));
  let interrupt = false, reads = 0;
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, row) => {
    if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); },
    compareAndSet: async (c, id, version, row) => {
      if (c === 'PurchaseOrders' && interrupt) { interrupt = false; throw Error('Interrupted shared PO'); }
      if (db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); db.set(c + ':' + id, copy(row)); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ company, store, domainWrites: true, stepsPerInvocation: 1 }); await protocol.initialize();
  Object.assign(db.get(protocol.ids.journal + ':' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  const member = { _id: 'M', loginEmail: 'staff@example.test', status: 'APPROVED' }, employee = {
    title: department === 'PURCHASE' ? 'P' : 'A', description: 'M', staffEmail: member.loginEmail,
    staffName: department, staffStatus: 'ACTIVE', departments: [department] };
  const records = () => [...db].filter(([key]) => key.startsWith('PurchaseOrders:')).map(([, row]) => copy(row));
  const rows = () => projectPurchaseOrders({ company, workspace: f.context, records: records() });
  const deps = { ...f.args, requirePurchaseStaff, requireAccountStaff, createAccountSettlementOperations,
    readMember: async () => member, readStaffRecords: async () => [employee],
    readContext: async (c, staff) => { reads++; assert.equal(c, company); assert.equal(staff.memberId, 'M'); return copy(f.context); },
    readPurchaseRecords: async c => { assert.equal(c, company); return records(); },
    readOrders: async (c, staff) => { reads++; assert.equal(c, company); assert.equal(staff.memberId, 'M'); return rows(); } };
  const save = (department === 'PURCHASE' ? createCurrentPurchaseOrderRecordSave : createCurrentAccountOrderRecordSave)({ company, store, protocol,
    authorityDependencies: deps, coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])) });
  const input = extra => ({ ...(department === 'PURCHASE' ? { ...f.input(), version: rows()[0].version } : { action: 'AMOUNTS', id: rows()[0].id, version: rows()[0].version,
    amounts: [{ fileId: 'INV', cents: 100000 }], reason: 'Invoice reconciled' }), ...extra });
  const request = { requestId: f.args.requestId, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0,
    staff: { staffId: 'FORGED', memberId: 'FORGED' }, input: input() };
  return { ...f, db, store, protocol, member, employee, deps, save, request, input, reads: () => reads, interrupt: () => { interrupt = true; } };
}
async function finish(f, request = f.request) {
  let result, attempts = 0;
  do { result = await f.save(request); assert.ok(attempts++ < 20); } while (result.pending);
  return result;
}

for (const department of ['PURCHASE', 'ACCOUNT']) {
  test(`${department} original PO metadata save/replay preserves documents, stock fields and both company boundaries`, async () => {
    for (const company of ['NCT', 'GHR']) {
      const f = await fixture(company, department), id = f.request.input.id, record = f.db.get('PurchaseOrders:' + id);
      record.details.stockSentinel = { retained: 7 }; const beforeDocs = copy(record.details.documents), originalTask = copy(f.context.tasks);
      f.request.input.version = projectPurchaseOrders({ company, workspace: f.context, records: [copy(record)] })[0].version;
      const result = await finish(f);
      assert.deepEqual({ ok: result.ok, company: result.company, poId: result.poId, savedAt: result.savedAt, generation: result.stockGeneration },
        { ok: true, company, poId: id, savedAt: '2026-10-22T07:00:00.000Z', generation: 1 });
      const saved = f.db.get('PurchaseOrders:' + id);
      assert.equal(saved.details.audit.length, 1); assert.equal(saved.details.audit[0].actorStaffId, department === 'PURCHASE' ? 'P' : 'A');
      assert.deepEqual(saved.details.stockSentinel, { retained: 7 }); assert.deepEqual(saved.details.documents, beforeDocs);
      assert.deepEqual(copy(f.context.tasks), originalTask); assert.equal([...f.db.keys()].some(key => key.startsWith('Stock')), false);
      assert.equal((await f.save(f.request)).stockGeneration, 1); assert.equal(f.reads(), 1);
    }
  });

  test(`${department} interrupted shared PO write retains one plan and reauthenticates same request`, async () => {
    const f = await fixture('NCT', department); f.interrupt(); let interrupted = false;
    for (let i = 0; i < 15; i++) {
      try { assert.equal((await f.save(f.request)).pending, true); }
      catch (error) { assert.match(error.message, /Interrupted shared PO/); interrupted = true; break; }
    }
    assert.equal(interrupted, true); await assert.rejects(f.protocol.readSnapshot(async () => null), /pending/i);
    f.member.status = 'PENDING'; await assert.rejects(f.save(f.request)); f.member.status = 'APPROVED';
    assert.equal((await finish(f)).stockGeneration, 1); assert.equal(f.reads(), 1);
    assert.equal(f.db.get('PurchaseOrders:' + f.request.input.id).details.audit.length, 1);
    f.employee.departments = ['WAREHOUSE']; await assert.rejects(f.save(f.request)); assert.equal(f.reads(), 1);
  });

  test(`${department} old replay uses retained audit after later update; missing/duplicate audit never yields success`, async () => {
    const f = await fixture('NCT', department); await finish(f);
    const next = { ...f.request, requestId: '22222222-2222-4222-8222-222222222222', stockGeneration: 1,
      input: f.input(department === 'PURCHASE' ? { termDays: 60 } : { amounts: [{ fileId: 'INV', cents: 99000 }] }) };
    assert.equal((await finish(f, next)).stockGeneration, 2); assert.equal((await f.save(f.request)).stockGeneration, 1);
    const row = f.db.get('PurchaseOrders:' + f.request.input.id), first = copy(row.details.audit[0]);
    row.details.audit.push(first); await assert.rejects(f.save(f.request), /receipt requires review/);
    row.details.audit = row.details.audit.filter(a => a.id !== first.id); await assert.rejects(f.save(f.request), /receipt requires review/);
  });

  test(`${department} no original policy bypass, file operation, foreign company record or forged actor`, async () => {
    const f = await fixture('NCT', department); f.request.input.version = 'OLD'; await assert.rejects(f.save(f.request), /changed/);
    const g = await fixture('NCT', department); g.request.input.action = department === 'PURCHASE' ? 'DOCUMENT' : 'DOCUMENT_UPLOAD';
    await assert.rejects(g.save(g.request), /non-file/); assert.equal(g.db.get('PurchaseOrders:' + g.request.input.id).details.audit.length, 0);
    const h = await fixture('NCT', department); h.db.get('PurchaseOrders:' + h.request.input.id).company = 'GHR'; await assert.rejects(h.save(h.request));
    const j = await fixture('NCT', department); j.employee.description = 'NOT_M'; await assert.rejects(j.save(j.request)); assert.equal(j.reads(), 0);
  });
}

test('Purchase request uses original procurement audit action and does not create a payment or stock allocation', async () => {
  const f = await fixture(); f.request.input = f.input({ action: 'REQUEST_PAYMENT', termDays: 0, purpose: 'FULL', requestedCents: 100000, basisFileId: 'INV', creditNotes: [] });
  assert.equal((await finish(f)).ok, true);
  const details = f.db.get('PurchaseOrders:' + f.request.input.id).details;
  assert.equal(details.audit[0].action, 'PROCUREMENT_REQUEST_PAYMENT'); assert.equal(details.finance?.payments?.length || 0, 0);
  assert.equal(details.procurementHandoff.submission.paymentRequest.requestedCents, 100000);
});

test('new original PO metadata record is inserted once, not an invented task or PO identity', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture(company, 'PURCHASE', false), result = await finish(f);
    assert.equal(result.poId, f.request.input.id); assert.equal((await f.save(f.request)).stockGeneration, 1);
    const records = [...f.db].filter(([key]) => key.startsWith('PurchaseOrders:'));
    assert.equal(records.length, 1); assert.equal(records[0][1].details.audit.length, 1);
    assert.deepEqual(records[0][1].details.taskIds, ['T']);
  }
});

test('Purchase and Account use ONE company barrier, preserve both audits and replay either original result', async () => {
  const f = await fixture(); await finish(f);
  const purchaseEmployee = copy(f.employee), accountEmployee = { ...copy(f.employee), title: 'A', staffName: 'Account', departments: ['ACCOUNT'] };
  f.deps.readStaffRecords = async () => [accountEmployee];
  const account = createCurrentAccountOrderRecordSave({ company: 'NCT', store: f.store, protocol: f.protocol, authorityDependencies: f.deps,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])) });
  const request = { ...f.request, requestId: '33333333-3333-4333-8333-333333333333', stockGeneration: 1,
    input: f.input({ action: 'AMOUNTS', amounts: [{ fileId: 'INV', cents: 100000 }] }) };
  const a = { save: account, request }; let started;
  do { started = await account(request); } while (started.pending && started.phase === 'BEFORE');
  assert.equal(started.pending, true); const beforeAudit = copy(f.db.get('PurchaseOrders:' + request.input.id).details.audit);
  f.deps.readStaffRecords = async () => [purchaseEmployee];
  await assert.rejects(f.save({ ...f.request, requestId: '44444444-4444-4444-8444-444444444444', stockGeneration: 1,
    input: f.input({ termDays: 60 }) }), /pending|owned|busy/i);
  assert.deepEqual(f.db.get('PurchaseOrders:' + request.input.id).details.audit, beforeAudit);
  f.deps.readStaffRecords = async () => [accountEmployee]; assert.equal((await finish(a)).stockGeneration, 2);
  const record = f.db.get('PurchaseOrders:' + request.input.id);
  assert.equal(record.details.termDays, 30); assert.equal(record.details.finance.amounts[0].cents, 100000);
  assert.deepEqual(record.details.audit.map(event => event.actorStaffId), ['P', 'A']);
  assert.equal((await account(request)).stockGeneration, 2);
  f.deps.readStaffRecords = async () => [purchaseEmployee]; assert.equal((await f.save(f.request)).stockGeneration, 1);
});
