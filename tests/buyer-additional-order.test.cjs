const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));
const request = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function harness() {
  const db = new Map(), writes = [];
  let sequence = 0, failure = null, beforeWrite = null;
  const table = name => { if (!db.has(name)) db.set(name, new Map()); return db.get(name); };
  const page = (rows, start, size) => ({ items: clone(rows.slice(start, start + size)), hasNext: () => start + size < rows.length, next: async () => page(rows, start + size, size) });
  const data = row => JSON.parse(row.payload || '{}');
  const wixData = {
    query(name) {
      const filters = []; let size = 1000, sort = null;
      const q = { eq(k, v) { filters.push(r => r[k] === v); return q; }, lt(k, v) { filters.push(r => r[k] < v); return q; }, contains(k, v) { filters.push(r => String(r[k] || '').includes(v)); return q; }, limit(n) { size = n; return q; }, descending(k) { sort = k; return q; }, find: async () => {
        const rows = [...table(name).values()].filter(r => filters.every(f => f(r)));
        if (sort) rows.sort((a, b) => String(b[sort]).localeCompare(String(a[sort])));
        return page(rows, 0, size);
      } }; return q;
    },
    get: async (name, id) => { if (!table(name).has(id)) throw new Error('Not found'); return clone(table(name).get(id)); },
    async insert(name, row) { const id = row._id || `row-${++sequence}`; if (table(name).has(id)) throw new Error('Duplicate ID'); await writeHook(name, row); if (table(name).has(id)) throw new Error('Duplicate ID'); const saved = { ...clone(row), _id: id }; table(name).set(id, saved); writes.push({ name, row: clone(saved) }); return clone(saved); },
    async update(name, row) { await writeHook(name, row); table(name).set(row._id, clone(row)); writes.push({ name, row: clone(row) }); return clone(row); },
    async remove(name, id) { table(name).delete(id); }
  };
  async function writeHook(name, row) { if (beforeWrite) await beforeWrite(name, data(row)); if (failure && failure(name, data(row))) { failure = null; throw new Error('Injected save failure'); } }
  function seed(name, id, payload, extra = {}) { table(name).set(id, { _id: id, title: id, payload: JSON.stringify(payload), ...extra }); }
  const products = new Map();
  function product(id = 'SKU1', patch = {}) {
    const item = { id, barcode: '0012345678901', itemName: 'Product', packingSize: '24 x 1', catalogueEa: 24, vipPriceEa: 1, vipPriceCtn: 24, vipCurrency: 'SGD', cbmPerCtn: 0.02, quoteStatus: 'VIEW QUOTE', ...patch };
    products.set(id, item); seed('WixBuyerListItems', id, { ...item, customerId: 'C1', orderQtyCtn: 20 }, { customerId: 'C1' }); return item;
  }
  product();
  table('WixCustomers').set('C1', { _id: 'C1', customerId: 'C1', assignedStaffId: 'LAW', title: 'DEMO' });
  const base = { wixData, Permissions: { SiteMember: 'member' }, webMethod: (_, fn) => fn, console, Date, Map, Set, Buffer };
  const source = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');
  const buyer = vm.createContext({ ...base });
  vm.runInContext(source('backend/catalogueAuth.web.js') + "\nresolveBuyerContext=async()=>({customerId:'C1',companyName:'DEMO',currency:'SGD',selectionLimit:100,email:'demo@example.test',actorName:'LAW',actorType:'STAFF'}); workspaceItems=async()=>__products(); globalThis.api={submitBuyerOrder,getBuyerOrderDetail,buyerOrderHistory};", buyer);
  buyer.__products = () => clone([...products.values()]);
  const sales = vm.createContext({ ...base, wixRealtimeBackend: { publish: async () => {} } });
  vm.runInContext(source('sales-room/wix/onboarding.web.js') + "\nresolveCurrentStaffContext=async()=>({authorized:true,staffId:'LAW',staffName:'LAW',loginEmail:'demo@example.test',canViewAllCustomers:false});loadSalesRoomCustomers=async()=>({customers:[{customerId:'C1'}],summary:{}});loadQuoteRiskCounts=async()=>new Map([['C1',{available:true,quoteRiskCount:0,pendingQuoteCount:0,redSignalCount:0,lowGpCount:0}]]);globalThis.api={submitSalesRoomOrder,saveSalesRoomOrderQty,getSalesRoomConfirmedOrders,getSalesRoomOrderDetail,getSalesRoomOrderProgress,getSalesRoomCustomersOperational};", sales);
  const download = vm.createContext({ ...base, buildBuyerOrderExcel: input => Buffer.from(JSON.stringify(input)) });
  vm.runInContext(source('backend/buyerOrderDownload.js') + '\nglobalThis.download=buildBuyerOrderDownload;', download);
  return {
    ...buyer.api, ...sales.api, product, products, seed, table, writes,
    payloads: name => [...table(name).values()].map(data),
    line: orderId => [...table('WixBuyerOrderLines').values()].map(data).filter(x => x.orderId === orderId),
    order: orderId => [...table('WixBuyerOrders').values()].map(data).find(x => x.orderId === orderId),
    failOnce: predicate => { failure = predicate; }, hook: fn => { beforeWrite = fn; },
    receipt: async id => JSON.parse((await download.download('C1', id, 'https://example.test')).bytes.toString()),
    submit: (qty, n, id = 'SKU1') => buyer.api.submitBuyerOrder([{ itemId: id, quantityCtn: qty }], '', request(n))
  };
}

test('20 +100 +200 accumulates one task, preserves three Excel receipts and two history events', async () => {
  const h = harness(), first = await h.submit(20, 1), second = await h.submit(100, 2), third = await h.submit(200, 3);
  const line = h.line(first.orderId)[0];
  assert.equal(line.quantityCtn, 20); assert.equal(line.effectiveRequestedQtyCtn, 320); assert.equal(line.committedQtyCtn, undefined);
  assert.equal(h.order(first.orderId).effectiveTotalCartons, 320); assert.equal(h.order(first.orderId).effectiveEstimatedTotal, 7680);
  assert.equal(h.order(first.orderId).confirmedAt, line.priceLockedAt);
  for (const [id, qty] of [[first.orderId, 20], [second.orderId, 100], [third.orderId, 200]]) assert.equal((await h.receipt(id)).rows[0].quantityCtn, qty);
  const detail = await h.getBuyerOrderDetail(first.orderId);
  assert.equal(detail.order.editHistory.length, 2);
  assert.deepEqual(Array.from(detail.order.editHistory, x => [x.detail.previousQuantityCtn, x.detail.newQuantityCtn]), [[20, 120], [120, 320]]);
  assert.ok(detail.order.editHistory.every(x => x.detail.barcode === '0012345678901' && x.detail.packingSize === '24 x 1' && x.actorName === 'LAW'));
  const incoming = await h.getSalesRoomConfirmedOrders(), progress = await h.getSalesRoomOrderProgress('C1');
  assert.equal(incoming.orders.length, 1); assert.equal(incoming.orders[0].totalCartons, 320); assert.equal(incoming.orders[0].productCount, 1);
  assert.equal(progress.activeLineCount, 1); assert.equal((await h.buyerOrderHistory('C1')).orders.length, 1);
  const overview = await h.getSalesRoomCustomersOperational();
  assert.equal(overview.customers[0].confirmedOrderCount, 1); assert.equal(overview.customers[0].activeOrderLineCount, 1);
  assert.equal(overview.summary.confirmedOrderCount, 1);
});

test('replay never adds twice and conflicting reuse of a request ID is rejected', async () => {
  const h = harness(), first = await h.submit(20, 1); await h.submit(10, 2); await h.submit(10, 2);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 30); assert.equal(h.order(first.orderId).revision, 1);
  assert.equal(h.payloads('WixOrderAudit').filter(x => x.action === 'BUYER_ADDED_ORDER_LINE').length, 1);
  await assert.rejects(h.submit(11, 2), /conflict/);
});

test('after NCT or GHR transfer, additions are separate tasks and original quantities remain unchanged', async () => {
  for (const destination of ['NCT', 'GHR']) {
    const h = harness(), first = await h.submit(20, 1); await h.submitSalesRoomOrder(first.orderId, destination); const next = await h.submit(10, 2);
    assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, undefined); assert.equal(h.line(next.orderId)[0].addedToOrderId, undefined);
    assert.equal((await h.getSalesRoomOrderProgress('C1')).activeLineCount, 2);
  }
});

test('price/currency/packing and committed markers prevent merging', async () => {
  for (const patch of [{ vipPriceCtn: 25 }, { vipCurrency: 'USD' }, { packingSize: '12 x 2' }]) {
    const h = harness(), first = await h.submit(20, 1); h.product('SKU1', patch); const next = await h.submit(10, 2);
    assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, undefined); assert.equal(h.line(next.orderId)[0].addedToOrderId, undefined);
  }
  const h = harness(), first = await h.submit(20, 1), stored = [...h.table('WixBuyerOrderLines').values()][0];
  stored.payload = JSON.stringify({ ...JSON.parse(stored.payload), committedQtyCtn: 0 }); const next = await h.submit(10, 2);
  assert.equal(h.line(next.orderId)[0].addedToOrderId, undefined);
});

test('mixed submission receipt includes both additions and new products; active tasks/totals count once', async () => {
  const h = harness(), first = await h.submit(20, 1); h.product('SKU2', { barcode: '0098765432101' });
  const mixed = await h.submitBuyerOrder([{ itemId: 'SKU1', quantityCtn: 10 }, { itemId: 'SKU2', quantityCtn: 5 }], '', request(2));
  assert.deepEqual((await h.receipt(mixed.orderId)).rows.map(x => x.quantityCtn), [10, 5]);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 30);
  assert.equal(h.order(mixed.orderId).totalCartons, 15); assert.equal(h.order(mixed.orderId).effectiveTotalCartons, 5);
  assert.equal((await h.getBuyerOrderDetail(mixed.orderId)).order.lines.length, 1);
  const incoming = await h.getSalesRoomConfirmedOrders(); assert.equal(incoming.orders.reduce((sum, x) => sum + x.totalCartons, 0), 35);
  assert.equal((await h.getSalesRoomOrderProgress('C1')).activeLineCount, 2);
});

test('audit save failure keeps target locked; same-request recovery writes one addition', async () => {
  const h = harness(), first = await h.submit(20, 1);
  h.failOnce((name, row) => row.action === 'BUYER_ADDED_ORDER_LINE');
  await assert.rejects(h.submit(10, 2), /Injected/);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, undefined);
  assert.equal(h.order(first.orderId).effectiveTotalCartons, 20);
  await assert.rejects(h.submitSalesRoomOrder(first.orderId, 'NCT'), /being updated/);
  await assert.rejects(h.submit(5, 3), /previous order request/);
  await h.submit(10, 2);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 30); assert.equal(h.order(first.orderId).revision, 1);
  assert.equal(h.payloads('WixOrderAudit').filter(x => x.action === 'BUYER_ADDED_ORDER_LINE').length, 1);
  await h.submitSalesRoomOrder(first.orderId, 'NCT');
});

test('concurrent requests are serialized; retry preserves both additions', async () => {
  const h = harness(), first = await h.submit(20, 1);
  const results = await Promise.allSettled([h.submit(10, 2), h.submit(5, 3)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const failed = results.findIndex(x => x.status === 'rejected'); await h.submit(failed === 0 ? 10 : 5, failed === 0 ? 2 : 3);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 35);
});

test('addition holds the same lock as Sales transfer during canonical line writes', async () => {
  const h = harness(), first = await h.submit(20, 1); let entered, resume;
  const atWrite = new Promise(resolve => { entered = resolve; }), release = new Promise(resolve => { resume = resolve; });
  h.hook(async (name, row) => { if (name === 'WixBuyerOrderLines' && row.effectiveRequestedQtyCtn === 30) { entered(); await release; } });
  const adding = h.submit(10, 2); await atWrite; await assert.rejects(h.submitSalesRoomOrder(first.orderId, 'GHR'), /being updated/); resume(); await adding;
  await h.submitSalesRoomOrder(first.orderId, 'GHR'); assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 30);
});

test('many receipt-only submissions cannot hide the older active task behind pagination', async () => {
  const h = harness(), first = await h.submit(20, 1);
  for (let n = 2; n <= 25; n++) await h.submit(1, n);
  const visible = await h.buyerOrderHistory('C1'); assert.equal(visible.orders.length, 1); assert.equal(visible.orders[0].orderId, first.orderId);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 44);
});

test('additions use the latest Sales effective quantity while preserving the original receipt', async () => {
  const h = harness(), first = await h.submit(20, 1);
  await h.saveSalesRoomOrderQty(first.orderId, 'L001', 25, 0, request(90)); await h.submit(10, 2);
  assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 35); assert.equal(h.line(first.orderId)[0].quantityCtn, 20);
  const audit = h.payloads('WixOrderAudit').find(x => x.action === 'BUYER_ADDED_ORDER_LINE');
  assert.equal(audit.detail.previousQuantityCtn, 25); assert.equal(audit.detail.newQuantityCtn, 35);
  assert.equal((await h.receipt(first.orderId)).rows[0].quantityCtn, 20);
});

test('failure after one of two addition audits resumes without duplicate quantities or events', async () => {
  const h = harness(); h.product('SKU2', { barcode: '0098765432101' });
  const first = await h.submitBuyerOrder([{ itemId: 'SKU1', quantityCtn: 20 }, { itemId: 'SKU2', quantityCtn: 5 }], '', request(1));
  h.failOnce((name, row) => row.action === 'BUYER_ADDED_ORDER_LINE' && row.detail.barcode === '0098765432101');
  const adding = () => h.submitBuyerOrder([{ itemId: 'SKU1', quantityCtn: 10 }, { itemId: 'SKU2', quantityCtn: 7 }], '', request(2));
  await assert.rejects(adding(), /Injected/);
  assert.ok(h.line(first.orderId).every(x => x.effectiveRequestedQtyCtn === undefined));
  assert.equal(h.payloads('WixOrderAudit').filter(x => x.action === 'BUYER_ADDED_ORDER_LINE').length, 0);
  const result = await adding();
  assert.deepEqual(h.line(first.orderId).map(x => x.effectiveRequestedQtyCtn), [30, 12]);
  assert.equal(h.order(first.orderId).revision, 1); assert.equal(h.payloads('WixOrderAudit').filter(x => x.action === 'BUYER_ADDED_ORDER_LINE').length, 2);
  assert.deepEqual((await h.receipt(result.orderId)).rows.map(x => x.quantityCtn), [10, 7]);
});

test('an older task belonging to another customer is never selected for an addition', async () => {
  const h = harness(), first = await h.submit(20, 1), original = h.line(first.orderId)[0];
  h.seed('WixBuyerOrders', 'foreign-order', { ...h.order(first.orderId), orderId: 'FOREIGN', customerId: 'C2', confirmedAt: '2000-01-01T00:00:00Z' }, { customerId: 'C2', orderId: 'FOREIGN', isComplete: true });
  h.seed('WixBuyerOrderLines', 'foreign-line', { ...original, orderId: 'FOREIGN', customerId: 'C2' }, { customerId: 'C2', orderId: 'FOREIGN' });
  await h.submit(10, 2); assert.equal(h.line('FOREIGN')[0].effectiveRequestedQtyCtn, undefined); assert.equal(h.line(first.orderId)[0].effectiveRequestedQtyCtn, 30);
});
