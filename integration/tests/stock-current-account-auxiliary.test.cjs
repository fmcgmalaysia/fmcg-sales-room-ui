const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), crypto = require('node:crypto');
const { createCurrentAccountAuxiliarySave } = require('../prototypes/stock-current-state/current-account-auxiliary-save.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { prepareAccountOriginalAuxiliary } = require('../prototypes/stock-current-state/account-original-auxiliary-plan.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { createAccountReviewOperations, requireAccountStaff } = load('accountPurchaseReview.js'), { createSupplierCreditOperations, readCreditTransfers } = load('supplierCredit.js');
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(company = 'NCT', action = 'APPLY_CREDIT', generated = false) {
  const db = new Map(), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1'; let interrupt = false, reads = 0;
  const record = { _id: 'TARGET', title: 'TARGET', company, _version: 'P0', details: { taskIds: ['T'], createdAt: '2026-10-01', createdBy: 'Original', audit: [],
    finance: { payments: [{ original: true }] }, documents: [{ fileId: 'INV', type: 'INV', linked: true, sha256: 'INV', number: 'I', date: '2026-10-21' }], stockSentinel: { retained: 80 } } };
  db.set('PurchaseOrders:TARGET', copy(record));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, row) => {
    if (interrupt && row.action === 'SUPPLIER_CREDIT_APPLIED') { interrupt = false; throw Error('Interrupted original credit insert'); }
    if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); }, compareAndSet: async (c, id, version, row) => {
    if (interrupt && c === 'PurchaseOrders') { interrupt = false; throw Error('Interrupted original invoice write'); }
    if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row));
  }, compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ company, store, domainWrites: true, stepsPerInvocation: 1 }); await protocol.initialize();
  const control = db.get(journal + ':' + protocol.ids.controlId); Object.assign(control, { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  const source = { id: 'SOURCE', company, supplierId: 'S', invoiceChecked: true }, target = { id: 'TARGET', company, supplierId: 'S', invoiceChecked: true,
    contentVersion: 'CV', amount: 1000, number: 'PO1', taskIds: ['T'], createdAt: '2026-10-01', createdBy: 'Original', documents: record.details.documents };
  const rows = () => { const transfers = readCreditTransfers([...db].filter(([key]) => key.startsWith(journal + ':')).map(([, row]) => row)), used = transfers.reduce((sum, row) => sum + row.cents, 0);
    return [{ ...copy(source), version: 'S' + used, finance: { supplierCreditCents: 10000 - used } }, { ...copy(target), version: 'T' + used, finance: { balanceCents: 50000 - used } }]; };
  const member = { _id: 'M', loginEmail: 'account@example.test', status: 'APPROVED' }, employee = { title: 'A', description: 'M', staffEmail: member.loginEmail, staffName: 'Account', staffStatus: 'ACTIVE', departments: ['ACCOUNT'] };
  const deps = { readMember: async () => member, readStaffRecords: async () => [employee], requireAccountStaff, readOrders: async (selected, staff) => { assert.equal(selected, company); assert.equal(staff.memberId, 'M'); reads++; return rows(); },
    createAccountReviewOperations, createSupplierCreditOperations, now: () => new Date('2026-10-22T14:50:00.000Z') };
  let create = createCurrentAccountAuxiliarySave;
  if (generated) create = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockCurrentCommands.js'), 'utf8').replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';createCurrentAccountAuxiliarySave;', { createHash: crypto.createHash, randomBytes: crypto.randomBytes, StockRuntimeBuffer: Buffer });
  const save = create({ company, store, protocol, coverage: Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }])), authorityDependencies: deps });
  const request = { requestId: '11111111-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'A', memberId: 'M' },
    input: action === 'APPLY_CREDIT' ? { action, id: 'TARGET', version: 'T0', sourceId: 'SOURCE', sourceVersion: 'S0', cents: 4000, reason: 'Original supplier credit' } : { action, id: 'TARGET', version: 'T0', enabled: false, reason: 'Original invoice check cancellation' } };
  async function finish(command = request) { for (let i = 0; i < 25; i++) { const result = await save(command); if (!result.pending) return copy(result); } throw Error('Still pending'); }
  return { db, store, protocol, get control() { return db.get(journal + ':' + protocol.ids.controlId); }, journal, source, target, rows, member, employee, deps, save, request, finish, record, reads: () => reads, interrupt: () => interrupt = true };
}

test('both companies original invoice cancellation or supplier credit use one conditional barrier, audit and replay; generated runtime matches', async () => {
  for (const company of ['NCT','GHR']) for (const action of ['INVOICE_CHECK','APPLY_CREDIT']) {
    const f = await fixture(company, action, true), before = JSON.stringify(f.db.get('PurchaseOrders:TARGET')), result = await f.finish();
    assert.deepEqual(result, { ok: true, requestId: f.request.requestId, stockGeneration: 1, company, poId: 'TARGET', savedAt: '2026-10-22T14:50:00.000Z' });
    assert.deepEqual(copy(await f.save(f.request)), result); assert.equal(f.reads(), 1); assert.equal([...f.db.keys()].some(key => /^(Stock|NCTTasks|NCTOrders)/.test(key)), false);
    if (action === 'APPLY_CREDIT') { assert.equal(JSON.stringify(f.db.get('PurchaseOrders:TARGET')), before); assert.equal(f.rows()[0].finance.supplierCreditCents, 6000); assert.equal(f.rows()[1].finance.balanceCents, 46000);
      assert.equal([...f.db.values()].filter(row => row.action === 'SUPPLIER_CREDIT_APPLIED').length, 1); }
    else { const row = f.db.get('PurchaseOrders:TARGET'); assert.equal(row.details.invoiceCheck.enabled, false); assert.equal(row.details.audit.length, 1); assert.equal(row.details.audit[0].actorStaffId, 'A');
      assert.deepEqual(row.details.finance, f.record.details.finance); assert.deepEqual(row.details.documents, f.record.details.documents); assert.deepEqual(row.details.stockSentinel, f.record.details.stockSentinel); }
  }
});

test('interruption resumes retained auxiliary plan; revoked auth and forged actor cannot adopt an original request', async () => {
  for (const action of ['INVOICE_CHECK','APPLY_CREDIT']) {
    const f = await fixture('NCT', action); f.interrupt(); let stopped = false;
    for (let i = 0; i < 20; i++) { try { await f.save(f.request); } catch (error) { assert.match(error.message, /Interrupted original/); stopped = true; break; } }
    assert.equal(stopped, true); assert.ok(f.control.pending); await assert.rejects(f.protocol.readSnapshot(async () => null), /pending/);
    f.member.status = 'PENDING'; await assert.rejects(f.save(f.request)); f.member.status = 'APPROVED';
    assert.equal((await f.finish()).stockGeneration, 1); assert.equal(f.reads(), 1); f.employee.departments = ['PURCHASE']; await assert.rejects(f.save(f.request));
    f.employee.departments = ['ACCOUNT']; await assert.rejects(f.save({ ...f.request, stockIdentity: { staffId: 'FORGED', memberId: 'M' } }), /identity/);
  }
});

test('original legacy review cannot approve an invoice or bypass stale/reason checks; no prepare writes escape', async () => {
  for (const patch of [{ enabled: true }, { version: 'OLD' }, { enabled: false, reason: '' }]) {
    const f = await fixture('NCT', 'INVOICE_CHECK'), before = JSON.stringify(f.db.get('PurchaseOrders:TARGET'));
    await assert.rejects(f.save({ ...f.request, input: { ...f.request.input, ...patch } })); assert.equal(JSON.stringify(f.db.get('PurchaseOrders:TARGET')), before); assert.equal(f.control.generation, 0);
  }
});

test('original supplier/company/finance/closed-target and positive available-credit rules cannot be bypassed', async () => {
  for (const change of [f => f.target.company = 'GHR', f => f.target.supplierId = 'OTHER', f => f.source.invoiceChecked = false,
    f => f.target.supplierAccount = { closed: true }, f => f.request.input.cents = 10001, f => f.request.input.cents = 0, f => f.request.input.sourceVersion = 'OLD']) {
    const f = await fixture(); change(f); await assert.rejects(f.save(f.request)); assert.equal(f.control.generation, 0); assert.equal([...f.db.values()].filter(row => row.action === 'SUPPLIER_CREDIT_APPLIED').length, 0);
  }
});

test('second current credit respects first consumption, original versions and remaining balance instead of double-spending', async () => {
  const f = await fixture(); await f.finish();
  const next = { ...f.request, requestId: '22222222-2222-4222-8222-222222222222', stockGeneration: 1, input: { ...f.request.input, sourceVersion: 'S4000', version: 'T4000', cents: 6001 } };
  await assert.rejects(f.save(next), /available/); next.input.cents = 6000; assert.equal((await f.finish(next)).stockGeneration, 2);
  assert.equal(f.rows()[0].finance.supplierCreditCents, 0); assert.equal(f.rows()[1].finance.balanceCents, 40000); assert.equal((await f.save(f.request)).stockGeneration, 1);
});

test('existing credit event or missing/duplicate retained review audit never fabricates a successful new receipt', async () => {
  const f = await fixture(); f.db.set(f.journal + ':' + hash('NCT', f.request.requestId, 'M', 'CREDIT'), { _id: 'OLD' }); await assert.rejects(f.save(f.request), /authority/); assert.equal(f.control.generation, 0);
  const g = await fixture('NCT', 'INVOICE_CHECK'); await g.finish(); const row = g.db.get('PurchaseOrders:TARGET'), event = copy(row.details.audit[0]);
  row.details.audit.push(event); await assert.rejects(g.save(g.request), /receipt requires review/); row.details.audit = []; await assert.rejects(g.save(g.request), /receipt requires review/);
});

test('original auxiliary preparation rejects unrelated/file actions and unmigrated images without touching live storage', async () => {
  const f = await fixture('NCT', 'INVOICE_CHECK'), args = { company: 'NCT', staff: { staffId: 'A', staffName: 'Account', memberId: 'M' }, requestId: f.request.requestId, input: f.request.input,
    rows: f.rows(), before: copy(f.record), creditBefore: null, createAccountReviewOperations, createSupplierCreditOperations, now: f.deps.now };
  const before = JSON.stringify([...f.db]); const plan = await prepareAccountOriginalAuxiliary(args); assert.equal(plan.writes.length, 1); assert.equal(JSON.stringify([...f.db]), before);
  for (const action of ['CHECK','DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE','AMOUNTS']) await assert.rejects(prepareAccountOriginalAuxiliary({ ...args, input: { ...args.input, action } }), /authority/);
  delete args.before._version; await assert.rejects(prepareAccountOriginalAuxiliary(args), /authority/);
});
