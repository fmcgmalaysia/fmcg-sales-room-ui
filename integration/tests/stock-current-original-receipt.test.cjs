const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createWarehouseOperations, projectWarehouseOrders, requireWarehouseStaff } = load('warehouseReceiving.js');
const { validateOriginalReceipt } = require('../prototypes/stock-current-state/original-receipt-validation.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const activity = [], tasks = [{ id: 'T', orderId: 'O', sourceLineId: 'L', ord: 100, barcode: '001', packing: '12', procurement: { totalCtn: 100 } }];
  const po = { id: 'PO-ID', version: 'V', company: 'NCT', number: 'PO-DISPLAY', taskIds: ['T'], customerId: 'C', documents: [] };
  const staff = { memberId: 'M', staffId: 'S', staffName: 'LAW' }, now = () => new Date('2026-10-21T18:41:14Z');
  const orders = () => projectWarehouseOrders({ company: 'NCT', purchaseOrders: [po], tasks, activity });
  const base = { company: 'NCT', staff, requestId: '11111111-1111-4111-8111-111111111111' };
  const input = () => ({ id: 'PO-ID', version: orders()[0].version, action: 'RECEIVE',
    lines: [{ taskId: 'T', accepted: 80, rejected: 0, kind: 'PARTIAL', reason: 'Second delivery pending' }] });
  const validate = (entry = input()) => validateOriginalReceipt({ createWarehouseOperations, ...base, input: entry, orders: orders(), activity, now });
  return { activity, tasks, po, staff, now, orders, base, input, validate };
}
test('unchanged original prepare event matches original save; validation mutates no business input', async () => {
  const f = fixture(), before = clone({ activity: f.activity, tasks: f.tasks, po: f.po });
  const plan = await f.validate();
  assert.deepEqual({ activity: f.activity, tasks: f.tasks, po: f.po }, before);
  const records = new Map();
  const store = { read: async (c, id) => records.get(id) || null, all: async () => f.activity,
    insert: async (c, row) => { records.set(row._id, row); return row; }, remove: async (c, id) => records.delete(id) };
  await createWarehouseOperations({ store, names: { NCT: { activity: 'NCTActivity' } }, readOrders: async () => f.orders(), now: f.now })
    .save({ ...f.base, input: f.input() });
  const saved = [...records.values()].find(r => r.action === 'WAREHOUSE_RECEIPT_SAVED');
  assert.deepEqual(plan.event, { ...clone(saved), activityTime: saved.activityTime.toISOString() });
  assert.equal(plan.event.description, 'PO-ID');
  assert.equal(plan.event.details.lines[0].accepted, 80);
});
test('original stale-version, duplicate, foreign PO and approved ceiling checks remain enforced', async () => {
  const f = fixture();
  for (const mutate of [x => x.version = 'OLD', x => x.id = 'FOREIGN', x => x.lines.push(clone(x.lines[0])), x => x.lines[0].accepted = 101]) {
    const input = f.input(); mutate(input); await assert.rejects(f.validate(input));
  }
  assert.equal(f.activity.length, 0);
});
test('partial reason, rejection and previous-issue resolution remain original validations', async () => {
  const f = fixture(), missing = f.input(); missing.lines[0].reason = '';
  await assert.rejects(f.validate(missing), /reason/);
  const bad = f.input(); bad.lines[0].accepted = -1; await assert.rejects(f.validate(bad), /whole/);
  const delivery = f.input(); delivery.lines[0].kind = 'DELIVERY'; await assert.rejects(f.validate(delivery), /partial/);
  const first = f.input(); first.lines[0].kind = 'DAMAGED'; first.lines[0].rejected = 20;
  f.activity.push((await f.validate(first)).event);
  const second = f.input(); second.lines[0] = { taskId: 'T', accepted: 20, rejected: 0, kind: 'DELIVERY', reason: 'Replacement arrived' };
  await assert.rejects(f.validate(second), /Confirm/);
  second.lines[0].resolveIssue = true;
  assert.equal((await f.validate(second)).event.details.lines[0].accepted, 100);
});
test('original financial lock and legacy allocated-stock correction floors remain enforced', async () => {
  const f = fixture(), first = f.input(); first.lines[0].accepted = 100; first.lines[0].kind = 'DELIVERY';
  f.activity.push((await f.validate(first)).event);
  const correction = () => ({ ...f.input(), action: 'CORRECT', lines: [{ taskId: 'T', accepted: 90, rejected: 0, reason: 'Recount' }] });
  assert.equal((await f.validate(correction())).event.details.lines[0].kind, 'CORRECTION');
  f.activity.push({ title: 'ALLOC', imageAltText: 'T', action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED',
    activityTime: '2026-10-21T18:42:00Z', details: { beforeRevision: '', targets: [{ taskId: 'CUSTOMER', quantity: 95 }] } });
  await assert.rejects(f.validate(correction()), /below allocated/);
  f.po.invoiceChecked = true;
  await assert.rejects(f.validate(correction()), /financially locked/);
});
test('validation does not grant Warehouse permission to Purchase staff', () => {
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'law@example.com' };
  const records = [{ title: 'S', description: 'M', staffName: 'LAW', staffEmail: member.loginEmail, staffStatus: 'ACTIVE', departments: ['PURCHASE'] }];
  assert.throws(() => requireWarehouseStaff(member, records), /not authorized/);
  records[0].departments = ['WAREHOUSE']; assert.equal(requireWarehouseStaff(member, records).staffId, 'S');
});
test('unexpected original factory behavior fails closed; no real store capability is supplied', async () => {
  const f = fixture();
  await assert.rejects(validateOriginalReceipt({ createWarehouseOperations: () => ({ save: async () => ({ ok: true }) }),
    ...f.base, input: f.input(), orders: f.orders(), activity: f.activity, now: f.now }), /boundary/);
  await assert.rejects(validateOriginalReceipt({ createWarehouseOperations: ({ store }) => ({ save: async () => store.insert('StockPositions', { _id: 'NO' }) }),
    ...f.base, input: f.input(), orders: f.orders(), activity: f.activity, now: f.now }), /Unexpected receipt journal/);
});
