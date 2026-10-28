// Isolated diagnostic of existing production-source contracts. No network or CMS.
// Observations are not a new stock ledger and do not enable candidate writers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('../../tests/load-master-module.cjs');
const { projectPreparation, createPreparationOperations } = load('warehousePreparation.js');
const { createCustomerFulfilmentOperations, shipmentVersion } = load('customerFulfilment.js');
const { readAllocations } = load('plannerAllocation.js');
const { stockPosition } = load('inventoryExceptions.js');
const { projectStockCard } = load('stockCardProjection.js');
const { projectPackingContext } = load('packingListContext.js');
const { createPackingListOperations, readPackingLists, packingVersion } = load('packingListOperations.js');
const { packingInvoiceLines } = load('packingListModel.js');
const { supportInvoiceState } = load('supportInvoice.js');
const clone = value => JSON.parse(JSON.stringify(value));
const at = '2026-10-28T08:00:00Z';
function fixture() {
  const records = new Map(); let sequence = 0, lostAction = '';
  const tasks = ['A', 'B'].map((id, index) => ({ id, orderId: 'ORDER-' + id,
    sourceLineId: 'LINE-' + id, customerId: 'CUSTOMER-' + id, barcode: 'SYNTHETIC-001',
    name: 'SYNTHETIC PRODUCT', packing: '12 x 1', ea: 12, ord: 100, requested: 100,
    inc: index ? 50 : 100, po: 'SYNTHETIC-PO-' + id, supplierId: 'SYNTHETIC-SUPPLIER',
    netCostCtn: 60, sellingPricePc: 2, transactionCurrency: 'USD',
    procurement: { totalCtn: 100, customerCtn: 100 },
    warehouse: { hasPhysicalReceipt: true, accepted: index ? 100 : 50 } }));
  // Represents already-saved cross-customer allocation, not a proven borrow debt writer.
  for (const [source, targets] of [['A', [{ taskId: 'A', quantity: 50 }]],
    ['B', [{ taskId: 'A', quantity: 50 }, { taskId: 'B', quantity: 50 }]]]) {
    const id = 'ALLOCATION-' + source;
    records.set('N/' + id, { _id: id, title: id, imageAltText: source,
      action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED', activityTime: at,
      details: { beforeRevision: '', targets } });
  }
  const store = {
    read: async (c, id) => clone(records.get(c + '/' + id) || null),
    all: async c => [...records].filter(([k]) => k.startsWith(c + '/')).map(([, v]) => clone(v)),
    insert: async (c, row) => {
      if (records.has(c + '/' + row._id)) throw Error('duplicate');
      records.set(c + '/' + row._id, clone(row));
      if (lostAction === row.action) { lostAction = ''; throw Error('synthetic lost acknowledgement'); }
      return clone(row);
    },
    update: async (c, row) => { records.set(c + '/' + row._id, clone(row)); return clone(row); },
    remove: async (c, id) => records.delete(c + '/' + id)
  };
  const context = async (company = 'NCT') => {
    const activity = await store.all(company === 'NCT' ? 'N' : 'G');
    const currentTasks = company === 'NCT' ? clone(tasks) : [];
    for (const task of currentTasks) task.warehouse.stock = stockPosition(task.id, task.warehouse.accepted, activity);
    return { company, tasks: currentTasks, activity, allocations: readAllocations(activity),
      customers: ['A', 'B'].map(id => ({ id: 'CUSTOMER-' + id, name: 'SYNTHETIC ' + id })) };
  };
  const names = { NCT: { activity: 'N' }, GHR: { activity: 'G' } };
  const staff = { memberId: 'SYNTHETIC-MEMBER', staffId: 'SYNTHETIC-STAFF', staffName: 'SYNTHETIC',
    canPrepareWarehouse: true, canSelectShipment: true, canInvoiceShipment: true, canDispatchShipment: true };
  const nextId = () => String(++sequence).padStart(8, '0') + '-1111-4111-8111-111111111111';
  const prepSave = createPreparationOperations({ store, names, readContext: context,
    documentService: async () => { throw Error('External file call forbidden in diagnostic'); }, now: () => new Date(at) });
  const prepRequest = async input => {
    const item = projectPreparation(await context()).find(row => row.taskId === 'A');
    return { company: 'NCT', staff, requestId: nextId(), input: { id: item.id, version: item.version, ...input } };
  };
  const fulfilSave = createCustomerFulfilmentOperations({ store, names, readContext: context,
    readRates: async () => [{ currency: 'USD', rateToMyr: 4 }], now: () => new Date(at) });
  const fulfil = async input => fulfilSave({ company: 'NCT', staff, requestId: nextId(),
    input: { version: shipmentVersion(await context()), reason: 'Synthetic contract diagnosis', ...input } });
  const packingContext = async (company, actor) => projectPackingContext(await context(company, actor));
  const packingSave = createPackingListOperations({ store, names, readContext: packingContext, now: () => new Date(at) });
  const packing = async (input, department = 'SUPPORT') => packingSave({ company: 'NCT',
    staff: { ...staff, packingDepartment: department }, requestId: nextId(),
    input: { version: packingVersion(await packingContext('NCT')), ...input } });
  const stock = async () => {
    const row = projectStockCard(await context()).items[0];
    return { onHand: row.onHand, reserved: row.reservedUsable, free: row.available };
  };
  return { records, context, stock, prepSave, prepRequest, fulfil, packing, packingContext,
    lose: action => { lostAction = action; } };
}
async function run() {
  const checks = [], protections = [];
  const observe = (id, expected, actual, detail) => checks.push({ id, expected, actual,
    matchesConfirmedRule: actual === expected, detail });
  const protect = (id, passed) => { assert.equal(passed, true, id); protections.push({ id, passed }); };
  for (const loaded of [80, 100]) {
    const f = fixture(); assert.equal((await f.stock()).onHand, 150);
    await f.prepSave(await f.prepRequest({ action: 'PACK' }));
    const request = await f.prepRequest({ action: 'LOAD', loaded, note: 'Synthetic container capacity' });
    f.lose('WAREHOUSE_PREPARATION_SAVED');
    await assert.rejects(f.prepSave(request), /synthetic lost acknowledgement/);
    await f.prepSave(request); await f.prepSave(request);
    const loadedEvents = (await f.context()).activity.filter(e => e.action === 'WAREHOUSE_PREPARATION_SAVED' && e.details.action === 'LOAD');
    protect('legacy-' + loaded + '-lost-reply-single-save', loadedEvents.length === 1);
    protect('legacy-' + loaded + '-loaded-readback', projectPreparation(await f.context()).find(r => r.taskId === 'A').loaded === loaded);
    const stale = { ...request, requestId: 'eeeeeeee-1111-4111-8111-111111111111' };
    await assert.rejects(f.prepSave(stale), /changed/);
    protect('legacy-' + loaded + '-stale-version-rejected', true);
    await assert.rejects(f.prepSave({ ...request, input: { ...request.input, loaded: loaded - 1 } }), /different changes/);
    protect('legacy-' + loaded + '-same-request-payload-immutable', true);
    observe('legacy-loaded-' + loaded, 150 - loaded, (await f.stock()).onHand,
      'Actual original LOAD writer followed by original Stock Card projection; no simulated deduction.');
    observe('legacy-loaded-' + loaded + '-remaining-claim', 150 - loaded, (await f.stock()).reserved,
      'Customer physical coverage should be consumed with successful Loaded, once.');
    const selected = await f.fulfil({ action: 'SELECT', customerId: 'CUSTOMER-A', lines: [{ taskId: 'A', quantity: loaded }] });
    await f.fulfil({ action: 'INVOICE', id: selected.shipmentId, number: 'SYNTHETIC-SI-' + loaded,
      date: '2026-10-28', amountCents: 2400 * loaded });
    observe('legacy-loaded-' + loaded + '-after-invoice', 150 - loaded, (await f.stock()).onHand,
      'Confirmed rule requires Loaded deduction already present before invoice.');
    await f.fulfil({ action: 'DISPATCH', id: selected.shipmentId, reference: 'SYNTHETIC-DO' });
    observe('legacy-loaded-' + loaded + '-after-dispatch', 150 - loaded, (await f.stock()).onHand,
      'Legacy cumulative dispatch eventually matches quantity; this does not validate Loaded timing.');
    const c = await f.context();
    protect('legacy-' + loaded + '-receipt-quantities-preserved', c.tasks[0].warehouse.accepted === 50 && c.tasks[1].warehouse.accepted === 100);
    protect('legacy-' + loaded + '-company-isolated', (await f.context('GHR')).activity.length === 0);
  }
  for (const loaded of [80, 100]) {
    const f = fixture();
    const created = await f.packing({ action: 'CREATE', customerId: 'CUSTOMER-A', currency: 'USD', lines: [{ taskId: 'A', quantity: 100 }] });
    for (const action of ['SEND', 'START', 'PROGRESS', 'COMPLETE']) {
      const list = (await f.packingContext('NCT')).lists.find(r => r.id === created.id);
      await f.packing({ action, id: list.id, revision: list.revision,
        ...(action === 'PROGRESS' ? { lines: [{ taskId: 'A', packed: 100, loaded, reason: 'Synthetic capacity' }] } : {}) },
      action === 'SEND' ? 'SUPPORT' : 'WAREHOUSE');
      if (action === 'PROGRESS') observe('packing-progress-' + loaded, 150 - loaded, (await f.stock()).onHand,
        'Actual Packing PROGRESS save records cumulative Loaded but Stock Card ignores it.');
    }
    const context = await f.context(), list = readPackingLists(context.activity, 'NCT')[0];
    protect('packing-' + loaded + '-single-current-row', context.activity.filter(e => e.action === 'SUPPORT_PACKING_LIST_CURRENT').length === 1);
    protect('packing-' + loaded + '-invoice-helper-uses-loaded', packingInvoiceLines(list)[0].quantity === loaded);
    observe('packing-completed-' + loaded, 150 - loaded, (await f.stock()).onHand,
      'Completing the list also does not post stock.');
    observe('packing-support-invoice-ready-' + loaded, loaded,
      supportInvoiceState(context).lines.find(r => r.taskId === 'A').maxInvoiceQty,
      'Main Support invoice reader uses legacy preparation, while active packing holds block it.');
    protect('packing-' + loaded + '-remainder-retained', (list.remainders[0]?.quantity || 0) === 100 - loaded);
  }
  return { schemaVersion: 1, at: new Date().toISOString(), sourceBaseline: '080d3578fbddc0995938a08d452828cc24e12f6d',
    environment: 'ISOLATED_MEMORY_STORE_ORIGINAL_BACKEND_MODULES', productionWrites: 0, networkCalls: 0,
    candidateRuntimeImplemented: false, readyForRelease: checks.every(c => c.matchesConfirmedRule),
    checks, protections, unresolvedRules: ['LOADED_CORRECTION_VS_PHYSICAL_RETURN', 'LEGACY_TO_PACKING_IDENTITY',
      'SOURCE_ATTRIBUTION_AT_LOADING', 'HISTORICAL_DISPATCH_RECONCILIATION'] };
}
run().then(result => {
  const out = process.argv.find(arg => arg.startsWith('--out='));
  if (out) fs.writeFileSync(path.resolve(out.slice(6)), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--require-ready') && !result.readyForRelease) process.exitCode = 2;
}).catch(error => { console.error(error.stack); process.exitCode = 1; });
