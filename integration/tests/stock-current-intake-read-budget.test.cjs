'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createNctIntake, createNctReceiptReader } = load('nctIntake.js');
const { createCurrentOrderIntakeOperations } = require('../prototypes/stock-current-state/current-order-intake.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture({ batch = true, company = 'NCT', distinct = true, malformed, changeGeneration = false } = {}) {
  const counts = { exact: 0, batchQueries: 0, captures: 0 }, control = { company, _version: 'GENESIS', generation: 0,
    pending: null, mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST' };
  let preparing = false, plan;
  const body = { sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: company, orderId: 'ORDER',
    customerId: 'C', customerCompanyName: 'Customer', submissionId: 'SUB', submittedByStaffId: 'S', submittedByStaffName: 'Sales',
    submittedAt: '2026-10-22T03:00:00Z', transactionCurrency: 'USD', fxRate: 4.3, estimatedShipmentDate: '2026-11-12',
    lines: Array.from({ length: 300 }, (_, i) => ({ sourceLineId: 'L' + i, unitBarcode: distinct ? String(i).padStart(6, '0') : '00123',
      itemName: 'Item', packingSize: '12x1', eaPerCtn: 12, qtyCtn: 100, sellingPricePc: 2 })) };
  const read = async () => { if (preparing) counts.exact++; return null; };
  const store = { read, ...(batch ? { readMany: async (collection, ids) => {
    counts.batchQueries += Math.ceil(ids.length / 50);
    if (changeGeneration) control._version = 'CHANGED';
    return malformed ? malformed(collection, ids) : ids.map(() => null);
  } } : {}) };
  const protocol = { planFormat: 'SEGMENTED_V2', readControl: async () => copy(control),
    readSnapshot: async fn => { const before = copy(control), rows = await fn(before);
      if (before._version !== control._version) throw Error('Inventory changed during read');
      return { generation: control.generation, rows }; },
    commit: async options => { await options.authorize({ control: copy(control), replay: false }); preparing = true;
      plan = await options.prepare(); return { ok: false, pending: true, phase: 'BEFORE', completedCount: 0,
        totalRecords: plan.writes.length, requestId: options.requestId }; } };
  const api = createCurrentOrderIntakeOperations({ company, store, protocol,
    coverage: Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'TEST' }])),
    createNctIntake, createNctReceiptReader, readOppositePreparation: read, now: () => new Date('2026-10-22T03:00:01Z'),
    captureCosts: async barcodes => { counts.captures++; return Object.fromEntries(barcodes.map(unitBarcode => [unitBarcode,
      { unitBarcode, capturedAt: '2026-10-22T03:00:01Z', costCurrency: 'MYR', costStatus: 'CAPTURED', costIssues: [],
        lpPc: 1, lpCtn: 12, disc1: 0, disc2: 0, disc3: 0, netCostCtn: 12, cbmPerCtn: 0.1 }])); } });
  return { run: () => api.receive(body), counts, plan: () => copy(plan) };
}
test('300-line preparation preserves every planned image with 27 rather than 1203 exact/batch queries', async () => {
  for (const company of ['NCT', 'GHR']) {
    const serial = fixture({ batch: false, company }), batched = fixture({ company });
    await serial.run(); await batched.run();
    assert.deepEqual(batched.plan(), serial.plan());
    assert.equal(serial.counts.exact, 1203);
    assert.equal(batched.counts.exact + batched.counts.batchQueries, 27);
    assert.equal(batched.plan().writes.length, 1202);
    assert.equal(batched.counts.captures, 1);
  }
});
test('repeated product lines remain distinct orders/tasks with only one zero product checkpoint', async () => {
  const f = fixture({ distinct: false }); await f.run();
  assert.equal(f.plan().writes.filter(change => change.collection === 'StockProducts').length, 1);
  assert.equal(f.plan().writes.filter(change => change.collection === 'NCTTasks').length, 300);
  assert.equal(f.counts.exact + f.counts.batchQueries, 22);
});
test('incomplete, wrong-ID, foreign and failed batches refuse before cost capture or a plan', async () => {
  for (const malformed of [(_c, ids) => ids.slice(1).map(() => null),
    (_c, ids) => ids.map((_id, i) => i ? null : { _id: 'WRONG', company: 'NCT' }),
    (_c, ids) => ids.map((_id, i) => i ? null : { _id, company: 'GHR' }),
    () => { throw Error('QUERY_UNAVAILABLE'); }]) {
    const f = fixture({ malformed }); await assert.rejects(f.run(), /batch|QUERY_UNAVAILABLE/);
    assert.equal(f.counts.captures, 0);
  }
});
test('generation change during batched preparation still rejects the snapshot', async () => {
  const f = fixture({ changeGeneration: true }); await assert.rejects(f.run(), /changed during read/);
});
