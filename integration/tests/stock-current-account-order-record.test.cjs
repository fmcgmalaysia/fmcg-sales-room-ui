const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createAccountRecordPreparation } = require('../prototypes/stock-current-state/account-order-record-plan.cjs');
const { requireAccountStaff } = load('accountPurchaseReview.js'), { createAccountSettlementOperations } = load('accountSettlement.js');
const { projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const context = { company: 'NCT', activity: [], customers: [{ id: 'C', name: 'Customer' }], suppliers: [{ id: 'S', name: 'Supplier' }],
    tasks: [{ id: 'T', customerId: 'C', supplierId: 'S', po: 'PO1', barcode: '1', packing: '12', editVersion: 'T0', ord: 100,
      procurement: { totalCtn: 100 }, lpCtn: 10, disc1: 0, disc2: 0, disc3: 0, history: [] }] };
  const id = projectPurchaseOrders({ company: 'NCT', workspace: context, records: [] })[0].id, db = new Map();
  db.set('PurchaseOrders:' + id, { _id: id, title: id, company: 'NCT', _version: 'P0', details: { taskIds: ['T'], audit: [], finance: { payments: [] },
    documents: [{ fileId: 'INV', type: 'INV', linked: true, sha256: 'inv', number: 'I1', date: '2026-10-22', declaredCents: 100000 }] } });
  const member = { _id: 'M', loginEmail: 'account@example.test', status: 'APPROVED' }, staff = { title: 'A', description: 'M', staffEmail: member.loginEmail,
    staffName: 'Account', staffStatus: 'ACTIVE', departments: ['ACCOUNT'] }; let privateReads = 0;
  const rows = () => projectPurchaseOrders({ company: 'NCT', workspace: context, records: [copy(db.get('PurchaseOrders:' + id))] });
  const deps = { company: 'NCT', readMember: async () => member, readStaffRecords: async () => [staff], requireAccountStaff,
    readOrders: async (company, employee) => { privateReads++; assert.equal(employee.memberId, 'M'); return rows(); },
    store: { read: async (c, key) => copy(db.get(c + ':' + key) || null) }, protocol: { readSnapshot: async fn => ({ generation: 0, rows: await fn() }) },
    createAccountSettlementOperations, now: () => new Date('2026-10-22T08:00:00Z') };
  const request = extra => ({ company: 'NCT', requestId: '11111111-1111-4111-8111-111111111111', staff: { staffId: 'FORGED' }, input: {
    action: 'AMOUNTS', id, version: rows()[0].version, amounts: [{ fileId: 'INV', cents: 100000 }], reason: 'Invoice reconciled', ...extra } });
  return { deps, db, id, request, context, reads: () => privateReads };
}

test('original Account auth and amounts prepare yield one exact PO image, no payment/file/quantity creation', async () => {
  const f = fixture(), before = JSON.stringify([...f.db]), result = await createAccountRecordPreparation(f.deps)(f.request());
  assert.equal(result.plan.writes.length, 1); const change = result.plan.writes[0];
  assert.equal(change.before._version, 'P0'); assert.equal(change.after.details.finance.amounts[0].cents, 100000);
  assert.equal(change.after.details.audit.at(-1).actorStaffId, 'A'); assert.deepEqual(change.after.details.finance.payments, []);
  assert.deepEqual(change.after.details.documents, change.before.details.documents); assert.equal(JSON.stringify([...f.db]), before);
});

test('original paper review is not financial clearance or bank payment; incomplete closure refuses', async () => {
  const f = fixture(), result = await createAccountRecordPreparation(f.deps)(f.request({ action: 'PAYMENT_REVIEW', stage: 'REVIEWING', paperReceived: true, requestedCents: 100000 }));
  const details = result.plan.writes[0].after.details;
  assert.equal(details.paymentHandoff.review.byStaffId, 'A'); assert.equal(details.paymentHandoff.review.stage, 'REVIEWING');
  assert.deepEqual(details.finance.payments, []); assert.equal(details.finance.check, undefined);
  await assert.rejects(createAccountRecordPreparation(f.deps)(f.request({ action: 'CLOSE_ACCOUNT' })), /resolve|Job Done/);
});

test('pending/wrong staff and file actions refuse before private data; stale and unversioned records refuse', async () => {
  const f = fixture(); f.deps.readMember = async () => ({ _id: 'M', status: 'PENDING' });
  await assert.rejects(createAccountRecordPreparation(f.deps)(f.request())); assert.equal(f.reads(), 0);
  const g = fixture(); g.deps.readStaffRecords = async () => []; await assert.rejects(createAccountRecordPreparation(g.deps)(g.request())); assert.equal(g.reads(), 0);
  for (const action of ['DOCUMENT_UPLOAD', 'PAYMENT_FILE_DELETE', 'APPLY_CREDIT']) {
    const h = fixture(); await assert.rejects(createAccountRecordPreparation(h.deps)(h.request({ action })), /non-file/); assert.equal(h.reads(), 0);
  }
  const h = fixture(); await assert.rejects(createAccountRecordPreparation(h.deps)(h.request({ version: 'OLD' })), /changed/);
  const j = fixture(); delete j.db.get('PurchaseOrders:' + j.id)._version; await assert.rejects(createAccountRecordPreparation(j.deps)(j.request()), /snapshot/);
});

test('common conditional Account save replays once and preserves original procurement/stock quantities', async () => {
  const f = fixture(), store = { ...f.deps.store };
  store.insert = async (c, row) => { if (f.db.has(c + ':' + row._id)) throw Error('Duplicate'); f.db.set(c + ':' + row._id, copy(row)); return copy(row); };
  store.compareAndSet = async (c, id, version, row) => { if (f.db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); f.db.set(c + ':' + id, copy(row)); return copy(row); };
  store.compareAndRemove = async (c, id, attempt) => { if (f.db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); f.db.delete(c + ':' + id); };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize(); f.deps.store = store; f.deps.protocol = protocol;
  const request = f.request(), command = { requestId: request.requestId, memberId: 'M', input: request,
    prepare: async () => (await createAccountRecordPreparation(f.deps)(request)).plan };
  await protocol.commit(command); await protocol.commit(command);
  assert.equal(f.db.get('PurchaseOrders:' + f.id).details.audit.length, 1); assert.equal(f.context.tasks[0].ord, 100);
  assert.equal((await protocol.readSnapshot(async () => null)).generation, 1);
});
