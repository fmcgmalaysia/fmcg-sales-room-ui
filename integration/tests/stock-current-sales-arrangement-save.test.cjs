const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createCurrentSalesArrangementSave } = require('../prototypes/stock-current-state/current-sales-arrangement-save.cjs');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { createSalesShipmentDateOperations, createShipmentPlanOperations, shipmentPlanVersion, readShipmentPlans, readSalesShipmentDate } = load('customerShipmentPlan.js');
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(company = 'NCT', stepsPerInvocation = 100) {
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', db = new Map();
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { if (db.get(c + ':' + id)?._version !== version) throw Error('Conflict'); db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Attempt'); db.delete(c + ':' + id); } };
  const protocol = createSegmentedFencedProof({ company, store, stepsPerInvocation }); await protocol.initialize();
  Object.assign(db.get(journal + ':' + protocol.ids.controlId), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST', transferIndexVersion: 2 });
  db.set(journal + ':R', { _id: 'R', title: 'R', description: 'O', action: 'ORDER_RECEIVED', result: 'ACCEPTED', details: { submissionId: 'SUB', taskIds: ['T'] } });
  const tasks = [{ id: 'T', customerId: 'C', orderId: 'O', sourceLineId: 'L', ord: 100, requested: 100, inc: 90,
    po: 'PO', netCostCtn: 50, estimatedShipmentDate: '2026-10-20', salesFulfilment: { invoices: [] } }];
  let staff = { memberId: 'SOURCE_SALES/S', staffId: 'S', staffName: 'Sales', customerId: 'C', canEditShipmentDate: true, canSelectShipment: true }, reads = 0, auth = 0;
  const context = () => ({ company, tasks: copy(tasks), activity: [...db.entries()].filter(([key]) => key.startsWith(journal + ':')).map(([, row]) => copy(row)) });
  const deps = { company, store, protocol, coverage: Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }])),
    authenticateOriginalDelegation: async () => { auth++; return copy(staff); }, readContext: async () => { reads++; return context(); },
    createSalesShipmentDateOperations, createShipmentPlanOperations, now: () => new Date('2026-10-22T05:00:00Z') };
  const request = (action, generation = 0, serial = 1) => ({ requestId: String(serial).padStart(8, '0') + '-1111-4111-8111-111111111111',
    stockProtocol: 1, stockBuild: 'TEST', stockGeneration: generation,
    input: action === 'ORDER_DATE' ? { action, customerId: 'C', orderId: 'O', submissionId: 'SUB', version: '', date: '2026-11-12' }
      : { action, customerId: 'C', orderId: 'O', version: shipmentPlanVersion(context()), reason: 'Two container dates',
        batches: [{ label: 'First', lines: [{ taskId: 'T', quantity: 40 }] }, { label: 'Second', lines: [{ taskId: 'T', quantity: 60 }] }] } });
  return { deps, db, tasks, context, request, save: createCurrentSalesArrangementSave(deps), setStaff: value => { staff = { ...staff, ...value }; }, counts: () => ({ reads, auth }) };
}

test('concrete current Sales date/plan keep original receipts and demand, no inventory/PO/task/packing writes in either company', async () => {
  for (const company of ['NCT', 'GHR']) {
    const f = await fixture(company), before = JSON.stringify(f.tasks), date = f.request('ORDER_DATE');
    const dated = await f.save(date); assert.equal(dated.stockGeneration, 1); assert.equal(dated.date, '2026-11-12');
    assert.equal(dated.orderId, 'O'); assert.equal(dated.customerId, 'C'); assert.equal(dated.by, 'Sales'); assert.ok(dated.revision);
    assert.equal((await f.save(date)).revision, dated.revision);
    const plan = f.request('PLAN', 1, 2), planned = await f.save(plan); assert.equal(planned.stockGeneration, 2); assert.ok(planned.planId);
    assert.equal((await f.save(plan)).planId, planned.planId); assert.deepEqual(f.counts(), { reads: 2, auth: 4 });
    const rows = f.context().activity;
    assert.equal(readSalesShipmentDate('O', 'C', 'SUB', '', rows).date, '2026-11-12');
    assert.deepEqual(readShipmentPlans(rows)[0].batches.map(b => b.lines[0].quantity), [40, 60]);
    assert.equal(rows.filter(r => ['SALES_SHIPMENT_DATE_SAVED', 'CUSTOMER_SHIPMENT_PLAN_SAVED'].includes(r.action)).length, 2);
    assert.equal(JSON.stringify(f.tasks), before);
    assert.equal([...f.db.keys()].every(key => key.startsWith((company === 'NCT' ? 'NCTActivity' : 'NCTActivity1') + ':')), true);
  }
});

test('current arrangement retains original date/plan permissions, version/customer/demand and preparation locks', async () => {
  for (const change of [r => { r.input.customerId = 'OTHER'; }, r => { r.input.date = '2026-02-30'; },
    r => { r.input.submissionId = 'OTHER'; }, r => { r.stockGeneration = 3; }, r => { r.input.version = 'OLD'; }]) {
    const f = await fixture(), request = f.request('ORDER_DATE'); change(request); await assert.rejects(f.save(request));
    assert.equal(f.context().activity.some(r => r.action === 'SALES_SHIPMENT_DATE_SAVED'), false);
  }
  const f = await fixture(); f.setStaff({ canEditShipmentDate: false });
  await assert.rejects(f.save(f.request('ORDER_DATE')), /authorized/);
  f.setStaff({ canEditShipmentDate: true }); f.tasks[0].salesFulfilment.invoices.push({ dispatched: true, quantity: 100 });
  await assert.rejects(f.save(f.request('ORDER_DATE')), /finished shipping/);
  const g = await fixture(), invalid = g.request('PLAN'); invalid.input.batches[1].lines[0].quantity = 59;
  await assert.rejects(g.save(invalid), /preserve/);
  g.db.set('NCTActivity:PACK', { _id: 'PACK', title: 'PACK', action: 'WAREHOUSE_PREPARATION_SAVED', result: 'SAVED',
    details: { beforeRevision: '', state: { id: 'PREP', taskId: 'T', prepared: true, loaded: 0 } } });
  await assert.rejects(g.save(g.request('PLAN')), /reversed/);
});

test('bounded current arrangement resumes same durable intent, reauthorizes replay and refuses altered request identity', async () => {
  const f = await fixture('NCT', 1), request = f.request('ORDER_DATE'); let result = await f.save(request), attempts = 1;
  assert.equal(result.pending, true); assert.equal(result.date, undefined);
  while (result.pending && attempts++ < 10) result = await f.save(request);
  assert.equal(result.ok, true); assert.equal(result.stockGeneration, 1); assert.equal(f.counts().reads, 1);
  await assert.rejects(f.save({ ...request, input: { ...request.input, date: '2026-12-01' } }), /identity reused/);
  f.setStaff({ canSelectShipment: false }); await assert.rejects(f.save(request), /delegation/);
  assert.equal(f.context().activity.filter(r => r.action === 'SALES_SHIPMENT_DATE_SAVED').length, 1);
});
