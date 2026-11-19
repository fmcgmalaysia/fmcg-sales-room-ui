const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process'), load = require('./load-master-module.cjs');
const { validateOriginalShipment } = require('../prototypes/stock-current-state/original-shipment-validation.cjs');
const folder = path.join(__dirname, '../prototypes/stock-current-state');
function candidate() {
  let source = fs.readFileSync(path.join(folder, 'customerFulfilment.candidate.js'), 'utf8'); const bindings = {};
  source = source.replace(/^import \{([^}]+)\} from 'backend\/([^']+)';$/gm, (_, names, file) => {
    const exports = load(file); for (const name of names.split(',').map(s => s.trim())) bindings[name] = exports[name]; return '';
  }).replace(/^export /gm, '');
  return vm.runInNewContext('(function(){' + source + '\nreturn {createCustomerFulfilmentOperations,shipmentVersion};})()', { ...bindings, Date, JSON, Map, Set, Error });
}
const api = candidate(), legacy = load('customerFulfilment.js');
const staff = { memberId: 'SOURCE_SALES/S', staffId: 'S', staffName: 'Sales', customerId: 'C', canSelectShipment: true };
function context(current = true) {
  return { company: 'NCT', tasks: [{ id: 'A', customerId: 'C', orderId: 'O', sourceLineId: 'L', ord: 100, inc: 30,
    barcode: '1', packing: '12', ea: 12, sellingPricePc: 2, netCostCtn: 10, transactionCurrency: 'USD' }],
    activity: [{ _id: 'OLD', title: 'OLD', action: 'PLANNER_ALLOCATION_SAVED', imageAltText: 'A', result: 'SAVED',
      activityTime: '2026-10-20T00:00:00.000Z', details: { beforeRevision: '', targets: [{ taskId: 'A', quantity: 90 }] } }],
    ...(current ? { stockAllocationView: 'CURRENT_V2', allocations: [{ sourceTaskId: 'B', targets: [{ taskId: 'A', quantity: 30 }] }] } : {}) };
}
const request = (ctx, action, extra = {}) => ({ company: 'NCT', staff, requestId: '11111111-1111-4111-8111-111111111111', context: ctx,
  createCustomerFulfilmentOperations: api.createCustomerFulfilmentOperations, currentAllocationVersion: 2, now: () => new Date('2026-10-22T12:00:00.000Z'),
  input: { action, version: api.shipmentVersion(ctx), reason: 'Prepare customer shipment', ...extra } });
test('exact guarded original fulfilment seam preserves legacy version while current source selection uses borrowed B not old A', async () => {
  assert.match(execFileSync(process.execPath, [path.join(folder, 'build-fulfilment-current-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const old = context(false); assert.equal(api.shipmentVersion(old), legacy.shipmentVersion(old));
  const ctx = context(), before = JSON.stringify(ctx);
  const prepared = await validateOriginalShipment(request(ctx, 'SELECT', { customerId: 'C', lines: [{ taskId: 'A', quantity: 30 }] }));
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.event.details.shipment.lines[0].sources)), [{ sourceTaskId: 'B', quantity: 30 }]);
  assert.equal(JSON.stringify(ctx), before);
  ctx.activity.push(prepared.event);
  const cancelled = await validateOriginalShipment({ ...request(ctx, 'CANCEL', { id: prepared.event.description }), requestId: '22222222-1111-4111-8111-111111111111' });
  assert.equal(cancelled.event.details.shipment.status, 'CANCELLED');
  assert.equal(cancelled.event.details.shipment.lines[0].sources[0].sourceTaskId, 'B');
});
test('no original grant, stale form, missing current view or invoice action can reach an apply/FX path', async () => {
  const ctx = context(), args = request(ctx, 'SELECT', { customerId: 'C', lines: [{ taskId: 'A', quantity: 30 }] });
  await assert.rejects(validateOriginalShipment({ ...args, staff: { ...staff, canSelectShipment: false } }), /not authorized/);
  await assert.rejects(validateOriginalShipment({ ...args, input: { ...args.input, version: 'OLD' } }), /changed/);
  await assert.rejects(validateOriginalShipment({ ...args, currentAllocationVersion: 1 }), /dependencies/);
  await assert.rejects(validateOriginalShipment({ ...args, input: { ...args.input, action: 'INVOICE' } }), /non-invoice/);
  delete ctx.allocations; assert.throws(() => api.shipmentVersion(ctx), /view missing/);
});
