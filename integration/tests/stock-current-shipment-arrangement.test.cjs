const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { prepareShipmentArrangement } = require('../prototypes/stock-current-state/shipment-arrangement-plan.cjs');
const { createSalesShipmentDateOperations, createShipmentPlanOperations, shipmentPlanVersion, readShipmentPlans, readSalesShipmentDate } = load('customerShipmentPlan.js');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(company = 'NCT') {
  const context = { company, tasks: [{ id: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', ord: 100, requested: 100, inc: 90,
    po: 'PO', netCostCtn: 50, estimatedShipmentDate: '2026-10-20', salesFulfilment: { invoices: [] } }],
    activity: [{ _id: 'R', title: 'R', description: 'O', action: 'ORDER_RECEIVED', result: 'ACCEPTED', details: { submissionId: 'SUB', taskIds: ['T'] } }] };
  const staff = { memberId: 'SOURCE_SALES/S', staffId: 'S', staffName: 'Sales', customerId: 'C', canEditShipmentDate: true, canSelectShipment: true };
  const args = { company, context, staff, requestId: '11111111-1111-4111-8111-111111111111', createSalesShipmentDateOperations,
    createShipmentPlanOperations, now: () => new Date('2026-10-22T05:00:00Z') };
  const date = () => ({ action: 'ORDER_DATE', orderId: 'O', customerId: 'C', submissionId: 'SUB', version: '', date: '2026-11-12' });
  const plan = () => ({ action: 'PLAN', orderId: 'O', customerId: 'C', version: shipmentPlanVersion(context), reason: 'Two container dates',
    batches: [{ label: 'First', lines: [{ taskId: 'T', quantity: 40 }] }, { label: 'Second', lines: [{ taskId: 'T', quantity: 60 }] }] });
  return { args, context, date, plan };
}

test('original date and batch arrangement produce only original company event, never stock/demand/PO changes', async () => {
  for (const company of ['NCT', 'GHR']) for (const kind of ['date', 'plan']) {
    const f = fixture(company), before = JSON.stringify(f.context), result = await prepareShipmentArrangement({ ...f.args, input: f[kind]() });
    assert.equal(result.plan.writes.length, 1); assert.equal(result.plan.writes[0].collection, company === 'NCT' ? 'NCTActivity' : 'NCTActivity1');
    assert.equal(result.plan.writes[0].after.company, company); assert.equal(result.event.initiatedByStaffId, 'S');
    if (kind === 'plan') assert.equal(result.event.details.plan.batches.reduce((n, b) => n + b.lines[0].quantity, 0), 100);
    assert.equal(JSON.stringify(f.context), before);
  }
});

test('original date permission/customer/submission/stale/date and completed shipping locks remain', async () => {
  const f = fixture();
  for (const input of [{ ...f.date(), customerId: 'OTHER' }, { ...f.date(), submissionId: 'OTHER' }, { ...f.date(), version: 'OLD' }, { ...f.date(), date: '2026-02-30' }])
    await assert.rejects(prepareShipmentArrangement({ ...f.args, input }));
  await assert.rejects(prepareShipmentArrangement({ ...f.args, staff: { ...f.args.staff, canEditShipmentDate: false }, input: f.date() }), /authorized/);
  f.context.tasks[0].salesFulfilment.invoices = [{ dispatched: true, quantity: 40 }];
  assert.equal((await prepareShipmentArrangement({ ...f.args, input: f.date() })).event.details.date, '2026-11-12');
  f.context.tasks[0].salesFulfilment.invoices[0].quantity = 100;
  await assert.rejects(prepareShipmentArrangement({ ...f.args, input: f.date() }), /finished shipping/);
});

test('original plan preserves total demand and rejects foreign customer, stale version and prepared goods', async () => {
  const f = fixture(), changed = f.plan(); changed.batches[1].lines[0].quantity = 59;
  await assert.rejects(prepareShipmentArrangement({ ...f.args, input: changed }), /preserve/);
  await assert.rejects(prepareShipmentArrangement({ ...f.args, input: { ...f.plan(), version: 'OLD' } }), /changed/);
  await assert.rejects(prepareShipmentArrangement({ ...f.args, input: { ...f.plan(), customerId: 'OTHER' } }), /authorized/);
  f.context.activity.push({ title: 'PACK', action: 'WAREHOUSE_PREPARATION_SAVED', result: 'SAVED', details: {
    beforeRevision: '', state: { id: 'PREP', taskId: 'T', prepared: true, loaded: 0 } } });
  await assert.rejects(prepareShipmentArrangement({ ...f.args, input: f.plan() }), /reversed/);
});

test('source/batch entitlements cannot be erased or renumbered by original legacy PLAN', async () => {
  const f = fixture(), original = await prepareShipmentArrangement({ ...f.args, input: f.plan() });
  original.event.details.plan.batches[0].lines[0].coverage = { T: 40 };
  original.event.details.plan.batches[0].lines[0].sourceCoverage = { T: 40 };
  f.context.activity.push(original.event);
  const changed = f.plan(); changed.batches[0].label = 'Renamed';
  await assert.rejects(prepareShipmentArrangement({ ...f.args, input: changed }), /Order Adjustment/);
});

test('date and plan common fence replay preserves one original event per request and shared generation', async () => {
  const f = fixture(), db = new Map(f.context.activity.map(row => ['NCTActivity:' + row._id, copy(row)]));
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('Conditional conflict'); db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong execution'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store }); await protocol.initialize();
  for (const [i, kind] of ['date', 'plan'].entries()) {
    f.context.activity = [...db.values()]; const input = f[kind](), requestId = String(i + 1).padStart(8, '0') + '-1111-4111-8111-111111111111';
    const command = { requestId, memberId: f.args.staff.memberId, input, prepare: async () => (await prepareShipmentArrangement({ ...f.args, requestId, input })).plan };
    await protocol.commit(command); await protocol.commit(command);
  }
  const activity = [...db.values()]; assert.equal(readShipmentPlans(activity).length, 1);
  assert.equal(readSalesShipmentDate('O', 'C', 'SUB', '2026-10-20', activity).date, '2026-11-12');
  assert.equal((await protocol.readSnapshot(async () => null)).generation, 2);
  assert.equal(activity.filter(row => ['SALES_SHIPMENT_DATE_SAVED', 'CUSTOMER_SHIPMENT_PLAN_SAVED'].includes(row.action)).length, 2);
});
