const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), load = require('./load-master-module.cjs');
const { createPurchaseOperations } = load('purchaseOperations.js');
const { taskEditVersion } = load('purchaseTaskIdentity.js');
const { projectPurchaseWorkspace } = load('purchaseProjection.js');
const { operationId } = load('purchaseOperationJournal.js');
const { validateOriginalPurchase } = require('../prototypes/stock-current-state/original-purchase-validation.cjs');
const { preparePurchaseDomain } = require('../prototypes/stock-current-state/purchase-domain-plan.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(require.resolve('./purchase-operations.test.cjs'), 'utf8');
const fixture = vm.runInNewContext('(' + source.slice(source.indexOf('function fixture(){'), source.indexOf("\ntest('submitted PO blocks")) + ')', { Map, copy, createPurchaseOperations, taskEditVersion, projectPurchaseWorkspace });
async function snapshots(f) {
  return Object.fromEntries(await Promise.all(['NCTOrders', 'NCTTasks', 'NCTActivity', 'SharedSuppliers', 'PurchaseOrders'].map(async c => [c, await f.store.all(c)])));
}
test('original Purchase PLAN prepares read-only with original supplier/transport/version checks', async () => {
  const f = fixture(), tables = await snapshots(f), before = JSON.stringify([...f.rows]);
  const request = { ...f.base, operation: 'PLAN', input: { taskId: f.id, version: taskEditVersion(f.task()), planRevision: '', totalCtn: 240,
    transportMode: 'SUPPLIER_DELIVER', reason: 'Supplier confirmed' } };
  const validated = await validateOriginalPurchase({ createPurchaseOperations, request, tables, now: () => new Date('2026-10-22T09:00:00Z') });
  assert.equal(validated.events.find(e => e.action === 'PURCHASE_PLAN_SAVED').totalCtn, 240);
  assert.equal(JSON.stringify([...f.rows]), before);
  for (const input of [{ ...request.input, version: 'OLD' }, { ...request.input, transportMode: '' }]) await assert.rejects(validateOriginalPurchase({ createPurchaseOperations, request: { ...request, input }, tables, now: () => new Date() }));
});
test('domain plan keeps original task patch and deterministic business event, refuses untagged legacy rows', async () => {
  const f = fixture(); f.task().company = 'NCT'; f.task()._version = 'T0';
  const tables = await snapshots(f), request = { ...f.base, operation: 'EDIT', input: { edits: [{ taskId: f.id, version: taskEditVersion(f.task()), changes: { lpCtn: 20 } }] } };
  const validated = await validateOriginalPurchase({ createPurchaseOperations, request, tables, now: () => new Date('2026-10-22T09:00:00Z') });
  const plan = preparePurchaseDomain({ validated, request, tables, taskEditVersion, operationId });
  assert.equal(plan.writes.find(w => w.collection === 'NCTTasks').after.lpCtn, 20);
  const record = plan.writes.find(w => w.collection === 'NCTActivity').after;
  assert.equal(record._id, operationId('NCT', request.requestId, request.staff.memberId, f.id, 'PURCHASE_PRICE_SAVED'));
  assert.deepEqual(record.details, { requestId: request.requestId, ...copy(validated.events[0]) });
  delete tables.NCTTasks[0]._version;
  assert.throws(() => preparePurchaseDomain({ validated, request, tables, taskEditVersion, operationId }), /Migration-tagged/);
});
test('original submitted handoff and invoice still block before captured Purchase plan', async () => {
  for (const variant of ['handoff', 'invoice']) {
    const f = fixture();
    if (variant === 'invoice') f.rows.get('NCTOrders/O0').salesInvoiceNumber = 'INV';
    else { f.task().ourPoNumber = 'PO-1'; f.rows.set('PurchaseOrders/P', { _id: 'P', company: 'NCT', details: { taskIds: [f.id], procurementHandoff: { schema: 1, stage: 'SUBMITTED' } } }); }
    const request = { ...f.base, operation: 'EDIT', input: { edits: [{ taskId: f.id, version: taskEditVersion(f.task()), changes: { lpCtn: 20 } }] } };
    await assert.rejects(validateOriginalPurchase({ createPurchaseOperations, request, tables: await snapshots(f), now: () => new Date() }), /locked/);
  }
});
test('domain mapping refuses existing cost lock, protocol patch injection and unsupported display order', async () => {
  const f = fixture(); f.task().company = 'NCT'; f.task()._version = 'T0';
  const tables = await snapshots(f), request = { ...f.base, operation: 'EDIT', input: { edits: [{ taskId: f.id, version: taskEditVersion(f.task()), changes: { lpCtn: 20 } }] } };
  const validated = await validateOriginalPurchase({ createPurchaseOperations, request, tables, now: () => new Date() });
  const args = { validated, request, tables, taskEditVersion, operationId };
  tables.NCTActivity.push({ _id: operationId('NCT', f.id, 'COST_LOCK') }); assert.throws(() => preparePurchaseDomain(args), /cost lock/); tables.NCTActivity.pop();
  validated.updates[0].patch._version = 'FORGED'; assert.throws(() => preparePurchaseDomain(args), /protocol ownership/); delete validated.updates[0].patch._version;
  assert.throws(() => preparePurchaseDomain({ ...args, validated: { ...validated, displayOrder: {} } }), /display order/);
});
