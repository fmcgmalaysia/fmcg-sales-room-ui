const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { preparePurchaseOrderRecord } = require('../prototypes/stock-current-state/purchase-order-record-plan.cjs');
const { createPurchaseOrderOperations, projectPurchaseOrders } = load('purchaseOrderWorkflow.js');
const { transitionProcurementHandoff } = load('paymentHandoff.js');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(company = 'NCT', saved = false) {
  const context = { company, activity: [], customers: [{ id: 'C', name: 'Customer', shortName: 'C' }], suppliers: [{ id: 'S', name: 'Supplier', shortName: 'SUP' }],
    tasks: [{ id: 'T', editVersion: 'T0', orderId: 'O', sourceLineId: 'L', customerId: 'C', supplierId: 'S', po: 'PO1', barcode: '1', packing: '12',
      ord: 100, procurement: { totalCtn: 100 }, lpCtn: 10, disc1: 0, disc2: 0, disc3: 0, history: [] }] };
  const records = [], initial = projectPurchaseOrders({ company, workspace: context, records })[0];
  if (saved) records.push({ _id: initial.id, title: initial.id, company, _version: 'P0', details: { taskIds: ['T'], documents: ['PO', 'INV'].map(type => ({
    fileId: type, type, linked: true, sha256: type.toLowerCase(), number: type + '1', date: '2026-10-22', ...(type === 'INV' ? { declaredCents: 100000 } : {}) })), audit: [] } });
  const staff = { memberId: 'M', staffId: 'P', staffName: 'Purchase' }, args = { company, staff, context, records, createPurchaseOrderOperations,
    requestId: '11111111-1111-4111-8111-111111111111', now: () => new Date('2026-10-22T07:00:00Z') };
  const row = () => projectPurchaseOrders({ company, workspace: context, records })[0];
  const input = (extra = {}) => ({ action: 'TERM', id: row().id, version: row().version, termDays: 30, reason: 'Supplier confirmed terms', ...extra });
  return { args, context, records, input, row };
}

test('new or migrated PO metadata yields one original record write; money/documents/stock untouched', async () => {
  for (const company of ['NCT', 'GHR']) for (const saved of [false, true]) {
    const f = fixture(company, saved), before = JSON.stringify({ context: f.context, records: f.records });
    const result = await preparePurchaseOrderRecord({ ...f.args, input: f.input() }), change = result.plan.writes[0];
    assert.equal(result.plan.writes.length, 1); assert.equal(change.collection, 'PurchaseOrders'); assert.equal(change.after.company, company);
    assert.equal(change.after.details.termDays, 30); assert.equal(change.before?._version || null, saved ? 'P0' : null);
    assert.equal(change.after.details.audit.at(-1).actorStaffId, 'P'); assert.deepEqual(change.after.details.documents, f.records[0]?.details.documents);
    assert.equal(JSON.stringify({ context: f.context, records: f.records }), before);
  }
});

test('original payment request is preserved, Reviewing lock cannot be bypassed by metadata adapter', async () => {
  const f = fixture('NCT', true), result = await preparePurchaseOrderRecord({ ...f.args, input: f.input({ action: 'REQUEST_PAYMENT', termDays: 0,
    purpose: 'FULL', requestedCents: 100000, basisFileId: 'INV', creditNotes: [] }) });
  const record = result.plan.writes[0].after;
  assert.equal(record.details.procurementHandoff.submission.paymentRequest.requestedCents, 100000);
  assert.equal(record.details.procurementHandoff.submission.byStaffId, 'P');
  f.records[0] = { ...record, _version: 'P1' };
  const row = f.row(); f.records[0].details.procurementHandoff = transitionProcurementHandoff(row, f.records[0].details,
    { action: 'TAKE_OWNERSHIP', reason: 'Finance review' }, { at: '2026-10-22T07:01:00Z', by: 'Account', byStaffId: 'A' }, 'ACCOUNT');
  await assert.rejects(preparePurchaseOrderRecord({ ...f.args, input: f.input({ action: 'REQUEST_PAYMENT', termDays: 0, purpose: 'FULL',
    requestedCents: 100000, basisFileId: 'INV', creditNotes: [] }) }), /locked/);
});

test('file upload/delete and retired CHASE are excluded; original stale/term/pending-deletion checks remain', async () => {
  const f = fixture('NCT', true);
  for (const action of ['DOCUMENT', 'DELETE_DOCUMENT', 'CHASE']) await assert.rejects(preparePurchaseOrderRecord({ ...f.args, input: f.input({ action }) }), /non-file/);
  for (const extra of [{ version: 'OLD' }, { termDays: 4000 }, { reason: '' }]) await assert.rejects(preparePurchaseOrderRecord({ ...f.args, input: f.input(extra) }));
  f.records[0].details.documentDeletion = { requestId: 'OTHER' };
  await assert.rejects(preparePurchaseOrderRecord({ ...f.args, input: f.input() }), /deletion is pending/);
});

test('unmigrated/foreign records and unrelated finance mutations refuse; no domain write occurs during prepare', async () => {
  const f = fixture('NCT', true); delete f.records[0]._version; await assert.rejects(preparePurchaseOrderRecord({ ...f.args, input: f.input() }), /exact PO record/);
  const g = fixture('NCT', true); g.records[0].company = 'GHR'; await assert.rejects(preparePurchaseOrderRecord({ ...g.args, input: g.input() }), /company PO/);
  const h = fixture('NCT', true);
  h.args.createPurchaseOrderOperations = deps => createPurchaseOrderOperations({ ...deps, store: { ...deps.store, insert: async (c, row) => {
    const altered = copy(row); if (altered.details?.kind === 'PREPARED') altered.details.plan.record.details.finance = { paidCents: 999 };
    return deps.store.insert(c, altered);
  } } });
  await assert.rejects(preparePurchaseOrderRecord({ ...h.args, input: h.input() }), /unrelated finance/); assert.equal(h.records[0].details.finance, undefined);
});

test('conditional PO record save/replay advances once without inserting duplicate audit or task/stock changes', async () => {
  const f = fixture('NCT', true), db = new Map(f.records.map(row => ['PurchaseOrders:' + row._id, copy(row)]));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize();
  const input = f.input(), command = { requestId: f.args.requestId, memberId: 'M', input, prepare: async () => (await preparePurchaseOrderRecord({ ...f.args, input })).plan };
  await protocol.commit(command); await protocol.commit(command);
  const saved = db.get('PurchaseOrders:' + input.id); assert.equal(saved.details.audit.length, 1); assert.equal(saved.details.termDays, 30);
  assert.equal((await protocol.readSnapshot(async () => null)).generation, 1); assert.equal(f.context.tasks[0].ord, 100);
});
