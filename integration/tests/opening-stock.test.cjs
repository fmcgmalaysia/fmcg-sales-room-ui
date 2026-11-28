const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createOpeningStockOperations } = load('openingStockOperations.js');
const { projectPurchaseWorkspace, PURCHASE_COLLECTIONS } = load('purchaseProjection.js');
const { projectStockControlPage } = load('stockControlService.js');
const { projectStockValuationPage } = load('stockValuationService.js');
const { createPlannerAllocationOperations } = load('plannerAllocation.js');
const { operationId } = load('purchaseOperationJournal.js');

const copy = value => JSON.parse(JSON.stringify(value));
const time = '2026-11-28T08:00:00.000Z';
let sequence = 0;
const nextId = () => String(++sequence).padStart(8, '0') + '-2222-4222-8222-222222222222';
const finance = { memberId: 'F', staffId: 'F1', staffName: 'QA Finance', canPostOpeningStock: true };
const buyer = { memberId: 'P', staffId: 'P1', staffName: 'QA Purchase' };
const barcode = '2991128073817';
const product = { barcode, name: 'QA OPENING STOCK', packing: '24 EA', ea: 24 };

function fixture() {
  const records = new Map(Object.values(PURCHASE_COLLECTIONS).map(names => [names.activity, new Map()]));
  let accepted = 80;
  let dropResult = false;
  const orders = ['A', 'B'].map(id => ({ title: 'ORDER-' + id, sourceLineId: 'LINE-' + id, submissionId: 'SUB-' + id,
    customerId: 'CUS-' + id, customerCompanyName: 'QA ' + id, description: barcode, image: product.name,
    imageAltText: product.packing, orderId: 24, orderQtyInCtn: id === 'A' ? 80 : 20, transactionCurrency: 'MYR' }));
  const tasks = orders.map((row, index) => ({ title: index === 0 ? 'A' : 'B', description: row.title, imageAltText: row.sourceLineId, purchaseQtyInCtn: row.orderQtyInCtn,
    ...(index === 0 ? { purchaseQtyInCtn: 80, ourPoNumber: 'QA-PO-OPENING-A', supplierId: 'QA-S',
      lpPc: 1, lpCtn: 24, disc1: 0, disc2: 0, disc3: 0 } : {}) }));
  const initial = () => orders.map((order, index) => ({ title: 'INTAKE-' + index, description: order.title, action: 'ORDER_RECEIVED',
    result: 'ACCEPTED', details: { submissionId: order.submissionId, taskIds: [tasks[index].title] } })).concat([
    { title: 'PLAN-A', description: 'ORDER-A', image: 'LINE-A', imageAltText: 'A',
      action: 'PURCHASE_PLAN_SAVED', result: 'SAVED', activityTime: time, details: { beforeRevision: '', totalCtn: 80, extraCtn: 0 } },
    { title: 'RECEIPT-A', description: operationId('NCT', 'PURCHASE_ORDER', ['A']),
      action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED', activityTime: time, details: { beforeRevision: '',
        lines: [{ taskId: 'A', orderId: 'ORDER-A', sourceLineId: 'LINE-A', beforeAccepted: 0, beforeRejected: 0, accepted, rejected: 0, issue: false }] } }
  ]);
  const store = {
    read: async (name, id) => copy(records.get(name).get(id) ?? null),
    insert: async (name, row) => {
      if (dropResult && row.action === 'PURCHASE_OPERATION_RESULT') {
        dropResult = false;
        throw Error('Simulated interrupted response');
      }
      assert.equal(records.get(name).has(row._id), false);
      records.get(name).set(row._id, copy(row));
      return copy(row);
    },
    remove: async (name, id) => records.get(name).delete(id),
    all: async name => copy([...(name === PURCHASE_COLLECTIONS.NCT.activity ? initial() : []), ...records.get(name).values()])
  };
  async function context(company, staff = finance) {
    const activity = await store.all(PURCHASE_COLLECTIONS[company].activity);
    const nct = company === 'NCT';
    const workspace = projectPurchaseWorkspace({ company, orders: nct ? orders : [], tasks: nct ? tasks : [],
      activity, suppliers: [{ _id: 'QA-S', title: 'QA-S', supplierName: 'QA Supplier' }], staff });
    return { ...workspace, activity };
  }
  const now = () => new Date(time);
  const opening = createOpeningStockOperations({ store, names: PURCHASE_COLLECTIONS, readContext: context,
    resolveProduct: async code => code === barcode ? product : null, now });
  return { context, opening,
    allocate: createPlannerAllocationOperations({ store, names: PURCHASE_COLLECTIONS, readWorkspace: context, now }),
    setAccepted: value => { accepted = value; }, dropResult: () => { dropResult = true; } };
}

const inputFor = (preview, counted, unitCostScaled = null) => ({
  mode: 'POST', barcode, version: preview.version, counted, countedAt: time, unitCostScaled,
  countConfirmed: true, reference: 'QA-OPENING-NOV-28'
});

test('80 recorded and 100 counted posts only 20 once. Both departments agree and Purchase allocates those same 20.', async () => {
  const f = fixture();
  const snapshot = async () => {
    const workspace = await f.context('NCT');
    const warehouse = projectStockControlPage(workspace).items[0];
    const accounts = projectStockValuationPage(workspace).items[0];
    const fields = row => [row.onHand, row.reservedUsable, row.available, row.isolated];
    assert.deepEqual(fields(warehouse), fields(accounts));
    assert.equal('valuation' in warehouse, false);
    assert.equal(warehouse.sources.some(row => 'valuation' in row), false);
    return { quantities: fields(warehouse), workspace, accounts };
  };
  assert.deepEqual((await snapshot()).quantities, [80, 80, 0, 0]);
  const preview = await f.opening.preview('NCT', finance, barcode);
  assert.deepEqual([preview.onHand, preview.reserved, preview.available], [80, 80, 0]);
  const request = { company: 'NCT', staff: finance, requestId: nextId(), input: inputFor(preview, 100, 336000) };
  assert.deepEqual((await snapshot()).quantities, [80, 80, 0, 0]);
  f.dropResult();
  await assert.rejects(f.opening.save(request), /interrupted response/);
  const result = await f.opening.save(request);
  assert.equal(result.added, 20);
  assert.equal((await f.opening.save(request)).sourceId, result.sourceId);
  assert.equal((await snapshot()).workspace.activity.filter(event => event.action === 'OPENING_STOCK_POSTED').length, 1);
  const after = await snapshot();
  assert.deepEqual(after.quantities, [100, 80, 20, 0]);
  assert.equal(after.accounts.sources.find(row => row.sourceTaskId === result.sourceId).valuation.valueCents, 67200);
  assert.equal(after.workspace.tasks.find(row => row.id === 'A').warehouse.accepted, 80);
  assert.equal(after.workspace.tasks.find(row => row.id === result.sourceId).specialPurchase, true);
  assert.ok(!after.workspace.tasks.find(row => row.id === result.sourceId).po);
  await f.allocate({ company: 'NCT', staff: buyer, requestId: nextId(), input: { action: 'ALLOCATE',
    planMode: 'CUSTOMER', version: after.workspace.allocationVersion, taskId: 'B', batchId: 'WHOLE', quantity: 20, useStock: true } });
  const allocated = await snapshot();
  assert.deepEqual(allocated.quantities, [100, 100, 0, 0]);
  assert.equal(allocated.workspace.tasks.find(row => row.id === 'B').inc, 20);
  assert.equal(allocated.workspace.allocations.find(row => row.sourceTaskId === result.sourceId).targets[0].taskId, 'B');
  assert.equal((await f.opening.preview('GHR', finance, barcode)).onHand, 0);
});

test('Permission, stale counts and duplicates are blocked. Missing cost can be confirmed without moving stock.', async () => {
  const f = fixture();
  await assert.rejects(f.opening.preview('NCT', buyer, barcode), /Finance stock editing/);
  const preview = await f.opening.preview('NCT', finance, barcode);
  const save = input => f.opening.save({ company: 'NCT', staff: finance, requestId: nextId(), input });
  await assert.rejects(save(inputFor(preview, 75)), /below recorded stock/);
  f.setAccepted(79);
  await assert.rejects(save(inputFor(preview, 100)), /Stock changed/);
  f.setAccepted(80);
  await save(inputFor(preview, 100));
  const pending = await f.opening.preview('NCT', finance, barcode);
  assert.equal(pending.opening.costPending, true);
  await assert.rejects(save(inputFor(pending, 120)), /already recorded/);
  const account = async () => projectStockValuationPage(await f.context('NCT')).items[0];
  assert.equal((await account()).valuation.valueCents, null);
  await save({ mode: 'CONFIRM_COST', barcode, version: pending.version, unitCostScaled: 336000, reference: 'QA COST SOURCE' });
  const confirmed = await account();
  assert.equal(confirmed.onHand, 100);
  assert.equal(confirmed.available, 20);
  assert.equal(confirmed.sources.find(row => row.sourceType === 'OPENING_STOCK').valuation.valueCents, 67200);
});

test('Finance Stock List button and nested message bridge post 20 cartons in Chrome', {
  skip: !process.env.OPENING_STOCK_QA_PAGES
}, async () => {
  const { chromium } = require('playwright');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(process.env.OPENING_STOCK_QA_PAGES);
  const f = fixture();
  const errors = [];
  const commands = [];
  const routes = [];
  const routePage = async route => {
    const request = route.request();
    const url = new URL(request.url());
    routes.push(request.method() + ' ' + url.pathname);
    if (url.pathname === '/test') {
      return route.fulfill({ contentType: 'text/html', body: `<iframe src="/account-room/relay" title="Finance QA" style="width:100%;height:720px;border:0"></iframe>
        <script>window.addEventListener('message', async event => {
          if (event.source !== document.querySelector('iframe').contentWindow || !event.data?.requestId) return;
          const reply = await fetch('/request', { method:'POST', body:JSON.stringify(event.data) }).then(r => r.json());
          event.source.postMessage(reply, location.origin);
        });</script>` });
    }
    if (url.pathname === '/account-room/relay') {
      return route.fulfill({ contentType: 'text/html', body: `<div id="app"></div><script src="/account-room/stock-list-link.js"></script>
        <script>window.accountStockList.render({company:'NCT',view:'stock'});</script>` });
    }
    if (url.pathname === '/request' && request.method() === 'POST') {
      const { company, requestId, input, type } = JSON.parse(request.postData());
      commands.push(type);
      let result;
      let error;
      try {
        if (type === 'FINANCE_OPENING_STOCK_ACCESS_REQUEST') result = { allowed: true, recoveryScope: 'a'.repeat(32) };
        else if (type === 'FINANCE_OPENING_STOCK_PREVIEW_REQUEST') result = await f.opening.preview(company, finance, input.barcode);
        else if (type === 'FINANCE_OPENING_STOCK_SAVE_REQUEST') result = await f.opening.save({ company, staff: finance, requestId, input });
        else if (type === 'FINANCE_STOCK_LIST_READ_REQUEST') result = projectStockValuationPage(await f.context(company), input);
        else throw Error('Unexpected message: ' + type);
      } catch (e) { error = e.message; errors.push(error); }
      return route.fulfill({ json: { type: type.replace('_REQUEST', '_RESULT'), company, requestId, ok: !error, result, error } });
    }
    const filename = path.resolve(root, '.' + url.pathname);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404 });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
    return route.fulfill({ path: filename, contentType: types[path.extname(filename)] || 'application/octet-stream' });
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1450, height: 875 } });
  try {
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'opening-stock.test' ? routePage(route) : route.abort());
    await page.goto('https://opening-stock.test/test');
    const stock = page.frameLocator('iframe[title="Finance QA"]').frameLocator('iframe[title="Finance Stock List"]');
    await stock.getByRole('button', { name: 'Opening Stock', exact: true }).click();
    const dialog = stock.getByRole('dialog', { name: 'Opening Stock' });
    await dialog.getByLabel('Unit barcode').fill(barcode);
    await dialog.getByRole('button', { name: 'Check stock' }).click();
    await dialog.getByLabel('Counted cartons').fill('100');
    await dialog.getByLabel('Counted at (MYT)').fill('2026-11-28T16:00');
    await dialog.getByLabel('I have excluded unposted deliveries', { exact: false }).check();
    await dialog.getByLabel('Reference').fill('QA-OPENING-NOV-28');
    await dialog.getByLabel('Cost per CTN (MYR)').fill('33.60');
    assert.match(await dialog.locator('[data-quantities]').textContent(), /On hand 80 CTN .*To add 20 CTN/);
    await dialog.getByRole('button', { name: 'Post opening stock' }).click();
    await dialog.getByText('20 CTN added. Opening count 100 CTN.').waitFor();
    await dialog.getByRole('button', { name: 'Close' }).click();
    const row = stock.getByRole('row').filter({ hasText: 'QA OPENING STOCK' });
    await row.getByRole('cell', { name: '100', exact: true }).waitFor();
    assert.deepEqual((await row.getByRole('cell').allTextContents()).slice(1, 5), ['100', '80', '20', '0']);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw Error(error.message + '\nBrowser errors: ' + errors.join(' | ') + '\nRelayed commands: ' + commands.join(', ') +
      '\nRequests: ' + routes.join(', ') + '\nFrames: ' + page.frames().map(frame => frame.url()).join(', '), { cause: error });
  } finally {
    await browser.close();
  }
});
