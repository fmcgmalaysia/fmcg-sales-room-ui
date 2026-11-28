const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('./load-master-module.cjs');

const { createStockCountGainOperations, projectStockCounts } = load('stockCountGain.js');
const { stockPosition } = load('inventoryExceptions.js');
const { calculatePlanCosting } = load('purchasePlan.js');
const { projectStockControlPage } = load('stockControlService.js');
const { projectStockValuationPage } = load('stockValuationService.js');
const { allocationVersion, createPlannerAllocationOperations, readAllocations } = load('plannerAllocation.js');
const script = fs.readFileSync(path.join(__dirname, '../../master-shared/stock-exceptions-20261128-count-gain.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const at = '2026-11-28T08:00:00.000Z';
let sequence = 0;
const nextId = () => String(++sequence).padStart(8, '0') + '-1111-4111-8111-111111111111';
const staff = name => ({ memberId: name + '-MEMBER', staffId: name, staffName: name,
  canReportStockException: name === 'WAREHOUSE', canCloseStockException: name === 'ACCOUNT' });

function fixture() {
  const names = { NCT: { activity: 'NCTActivity' }, GHR: { activity: 'GHRActivity' } };
  const collections = new Map(Object.values(names).map(({ activity }) => [activity, new Map()]));
  const initial = [
    { title: 'LOAD-A', action: 'WAREHOUSE_PREPARATION_SAVED', result: 'SAVED', description: 'LOAD-A', details: { beforeRevision: '', state: {
      id: 'LOAD-A', taskId: 'A', customerId: 'A', company: 'NCT', loaded: 1, physicalSources: [{ sourceTaskId: 'SOURCE', quantity: 1 }]
    } } },
    { title: 'ALLOC-A', action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED', imageAltText: 'SOURCE', activityTime: at,
      details: { beforeRevision: '', targets: [{ taskId: 'A', quantity: 1 }] } }
  ];
  const store = {
    read: async (name, id) => copy(collections.get(name).get(id) ?? null),
    insert: async (name, row) => {
      const records = collections.get(name);
      assert.ok(!records.has(row._id), 'duplicate event');
      records.set(row._id, copy(row));
      return copy(row);
    },
    remove: async (name, id) => collections.get(name).delete(id),
    all: async name => copy([...(name === names.NCT.activity ? initial : []), ...collections.get(name).values()]),
  };
  const costing = calculatePlanCosting({ schema: 1, mode: 'NORMAL', moneySource: 'PRICES', paidCtn: 1, freeCtn: 0,
    prices: { lpPc: 1.4, lpCtn: 33.6, disc1: 0, disc2: 0, disc3: 0 } }, 1, 24);
  const product = { barcode: '2991128073800', name: 'Synthetic item', packing: '24 EA', ea: 24 };
  const demand = id => ({ ...product, id, customerId: id, orderId: 'ORD-' + id, sourceLineId: 'LINE-' + id,
    ord: 1, requested: 1, procurement: { totalCtn: 0, customerCtn: 0 } });
  let costKnown = true;
  async function context(company) {
    const activity = await store.all(names[company].activity);
    const tasks = company === 'GHR' ? [] : [
      { ...demand('A'), id: 'SOURCE', specialPurchase: true, po: 'QA-PO', supplierId: 'QA', costCurrency: 'MYR',
        procurement: { totalCtn: 1, customerCtn: 0, costing: costKnown ? costing : null },
        warehouse: { hasPhysicalReceipt: true, accepted: 1, stock: stockPosition('SOURCE', 1, activity) } },
      { ...demand('A'), archived: true }, demand('B')
    ];
    return { company, activity, tasks, customers: [] };
  }
  const now = () => new Date(at);
  return { context, run: createStockCountGainOperations({ store, names, readContext: context, now }),
    allocate: createPlannerAllocationOperations({ store, names, readWorkspace: context, now }),
    setCostKnown: value => { costKnown = value; } };
}

function screen(department) {
  const warehouse = department === 'WAREHOUSE';
  const nodes = new Map(), handlers = {}, sent = [], timers = [];
  const fields = {};
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      value: key === '#stockFilter' ? 'OPEN' : '', style: {}, innerHTML: '', textContent: '',
      appendChild() {}, replaceChildren() { this.innerHTML = ''; }, removeAttribute() {},
      addEventListener(kind, callback) { this[kind] = callback; },
      querySelector: selector => selector.includes('data-money-unset') ? null : node(selector),
      querySelectorAll: () => [], reportValidity: () => true,
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    return nodes.get(key);
  }
  const parent = { postMessage: message => sent.push(copy(message)) };
  const window = { addEventListener: (name, handler) => { handlers[name] = handler; } };
  const document = { createElement: node, body: node('body'), addEventListener() {}, getElementById: id =>
    id === 'warehouseStockIssues' && !warehouse ? null : node(id), querySelector: selector =>
    selector === 'nav[aria-label="Account navigation"]' ? (warehouse ? null : node('nav')) :
      selector === 'dialog[open]' ? (node('dialog').open ? node('dialog') : null) : node(selector) };
  vm.runInNewContext(script, { document, window, parent, navigator: { onLine: true }, crypto: { randomUUID: nextId },
    FormData: function FormData() { return Object.entries(fields); },
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cancelled = true; } });
  const notify = (request, result) => handlers.message({ source: parent, data: {
    type: request.type.replace('_REQUEST', '_RESULT'), company: 'NCT', requestId: request.requestId, ok: true, result
  } });
  return { node, fields, sent, notify, open: () => window.masterStockExceptions.open(),
    start: () => node('[data-count-report]').click(), save: () => node('[data-save]').onclick(),
    timeout: () => timers.findLast(timer => timer.delay === 30000 && !timer.cancelled).fn() };
}

test('Warehouse report stays pending, Finance posts one carton and Purchase allocates the same carton', async () => {
  const f = fixture();
  const qty = async () => {
    const context = await f.context('NCT');
    const warehouse = projectStockControlPage(context, { filter: 'ALL' }).items[0];
    const finance = projectStockValuationPage(context, { filter: 'ALL' }).items[0];
    assert.equal(warehouse.onHand, finance.onHand);
    return [warehouse.onHand, warehouse.available, finance.valuation.valueCents];
  };
  const payload = async department => ({ cases: [], permissions: {}, version: 'test', resolutionVersion: 'test',
    stockCounts: projectStockCounts(await f.context('NCT'), staff(department)) });
  assert.deepEqual(await qty(), [0, 0, 0]);
  const warehouse = screen('WAREHOUSE');
  warehouse.open();
  warehouse.notify(warehouse.sent.at(-1), await payload('WAREHOUSE'));
  warehouse.start();
  Object.assign(warehouse.fields, { sourceTaskId: 'SOURCE', counted: '1', reference: 'QA-COUNT-01', reason: 'One extra carton counted' });
  warehouse.save();
  const reportRequest = warehouse.sent.at(-1);
  assert.equal(reportRequest.input.onHand, 0);
  const report = await f.run({ ...reportRequest, staff: staff('WAREHOUSE') });
  assert.deepEqual(await qty(), [0, 0, 0]);
  warehouse.timeout();
  const status = warehouse.sent.at(-1);
  assert.equal(status.type, 'STOCK_SAVE_STATUS_REQUEST');
  assert.equal(status.caseId, '');
  assert.equal(status.saveRequestId, reportRequest.requestId);
  warehouse.notify(status, report);
  assert.equal(warehouse.sent.at(-1).type, 'STOCK_READ_REQUEST');
  assert.equal((await payload('WAREHOUSE')).stockCounts.reports[0].unitCost, undefined);

  const finance = screen('ACCOUNT');
  finance.open();
  const trigger = finance.node('[data-count-confirm]');
  trigger.dataset = { countConfirm: report.caseId };
  finance.node('#stockCountRows').querySelectorAll = () => [trigger];
  finance.notify(finance.sent.at(-1), await payload('ACCOUNT'));
  trigger.onclick();
  finance.fields.reason = 'Physical count and original cost verified';
  finance.save();
  const confirm = finance.sent.at(-1);
  assert.equal(confirm.input.reportId, report.caseId);
  const run = (name, input = confirm) => f.run({ ...input, staff: staff(name) });
  await assert.rejects(run('WAREHOUSE'), /not authorized/);
  await assert.rejects(run('ACCOUNT', { ...confirm, company: 'GHR' }), /unavailable/);
  f.setCostKnown(false);
  await assert.rejects(run('ACCOUNT'), /pending verification/);
  f.setCostKnown(true);
  const saved = await run('ACCOUNT');
  assert.equal(saved.added, 1);
  assert.equal((await run('ACCOUNT')).caseId, report.caseId);
  await assert.rejects(run('ACCOUNT', { ...confirm, requestId: nextId() }), /already confirmed/);
  assert.deepEqual(await qty(), [1, 1, 3360]);

  const before = await f.context('NCT');
  const allocation = { company: 'NCT', staff: staff('PURCHASE'), requestId: nextId(), input: {
    action: 'ALLOCATE', planMode: 'CUSTOMER', version: allocationVersion(before, before.activity),
    taskId: 'B', batchId: 'WHOLE', quantity: 1, useStock: true } };
  assert.equal((await f.allocate(allocation)).ok, true);
  assert.equal((await f.allocate(allocation)).ok, true);
  const after = await f.context('NCT');
  assert.equal(readAllocations(after.activity)[0].targets.find(row => row.taskId === 'B').quantity, 1);
  assert.equal(after.tasks[0].warehouse.accepted, 1);
  assert.equal(after.tasks[0].warehouse.stock.shipped, 1);
  assert.deepEqual(await qty(), [1, 0, 3360]);
  assert.equal(projectStockControlPage(await f.context('GHR')).total, 0);
});
