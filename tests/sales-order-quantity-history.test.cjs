const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const requestId = '11111111-1111-4111-8111-111111111111';
const copy = value => JSON.parse(JSON.stringify(value));

function harness({ buyer = false, staffId = 'LAW', failAudit = false } = {}) {
  const records = new Map();
  const writes = [], signals = [];
  const collection = name => { if (!records.has(name)) records.set(name, new Map()); return records.get(name); };
  function seed(name, id, data, fields = {}) { collection(name).set(id, { _id: id, title: id, payload: JSON.stringify(data), ...fields }); }
  collection('WixCustomers').set('customer', { _id: 'customer', customerId: 'C1', assignedStaffId: 'LAW', title: 'CUSTOMER', customerStatus: 'ACTIVE' });
  seed('WixBuyerOrders', 'order', { orderId: 'O1', customerId: 'C1', status: 'CONFIRMED', revision: 0, totalCartons: 10, estimatedTotal: 20, totalCbm: 5, isComplete: true }, { orderId: 'O1', customerId: 'C1', isComplete: true });
  seed('WixBuyerOrderLines', 'line', { orderId: 'O1', customerId: 'C1', lineId: 'L1', barcode: 'PRODUCT', itemName: 'Product', quantityCtn: 10, lockedUnitPrice: 2, lineAmount: 20, lineCbm: 5, cbmPerCtn: 0.5 }, { orderId: 'O1', customerId: 'C1' });
  function page(items, offset, size) { return { items: copy(items.slice(offset, offset + size)), hasNext: () => offset + size < items.length, next: async () => page(items, offset + size, size) }; }
  const wixData = {
    query(name) {
      const filters = []; let size = 1000;
      const query = { eq(field, value) { filters.push(row => row[field] === value); return query; }, contains(field, value) { filters.push(row => String(row[field] || '').includes(value)); return query; }, limit(value) { size = value; return query; }, find: async () => page([...collection(name).values()].filter(row => filters.every(filter => filter(row))), 0, size) };
      return query;
    },
    get: async (name, id) => { const row = collection(name).get(id); if (!row) throw new Error('Not found'); return copy(row); },
    insert: async (name, row) => {
      const id = row._id || row.title;
      if (collection(name).has(id)) throw new Error('Duplicate ID');
      if (failAudit && JSON.parse(row.payload || '{}').action === 'SALES_QTY_UPDATED') throw new Error('Audit unavailable');
      const next = { ...copy(row), _id: id }; collection(name).set(id, next); writes.push({ operation: 'insert', collection: name, row: copy(next) }); return copy(next);
    },
    update: async (name, row) => { collection(name).set(row._id, copy(row)); writes.push({ operation: 'update', collection: name, row: copy(row) }); return copy(row); },
    remove: async (name, id) => { collection(name).delete(id); writes.push({ operation: 'remove', collection: name, id }); }
  };
  const file = buyer ? 'backend/catalogueAuth.web.js' : 'sales-room/wix/onboarding.web.js';
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export const /gm, 'const ');
  const context = vm.createContext({ wixData, Permissions: { SiteMember: 'member' }, webMethod: (_, method) => method, wixRealtimeBackend: { publish: async (channel, message) => signals.push(copy({ channel, message })) }, console, Date, Map, Set });
  vm.runInContext(source + (buyer
    ? "\nresolveBuyerContext=async()=>({customerId:'C1'});globalThis.api={reduceBuyerOrderLine,getBuyerOrderDetail};"
    : `\nresolveCurrentStaffContext=async()=>({authorized:true,staffId:${JSON.stringify(staffId)},staffName:'LAW',loginEmail:'law@example.test',canViewAllCustomers:false});globalThis.api={saveSalesRoomOrderQty,submitSalesRoomOrder,createSalesRoomProforma};`), context);
  return { ...context.api, collection, seed, writes, signals, data: (name, id) => JSON.parse(collection(name).get(id).payload) };
}

test('Buyer customer mutation is rejected before any operational write or duplicate replay', async () => {
  const h = harness({ buyer: true });
  h.seed('WixOrderAudit', 'old', { auditId: 'BUYER-REDUCTION-' + requestId, customerId: 'C1', orderId: 'O1', lineId: 'L1', newQuantityCtn: 5 });
  await assert.rejects(h.reduceBuyerOrderLine('O1', 'L1', 5, requestId), /Submitted orders are locked/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.data('WixBuyerOrderLines', 'line').quantityCtn, 10);
});

test('Sales changes effective quantity and totals, preserving original quantity and quotation', async () => {
  const h = harness();
  await h.saveSalesRoomOrderQty('O1', 'L1', 25, 0, requestId);
  const line = h.data('WixBuyerOrderLines', 'line'), order = h.data('WixBuyerOrders', 'order');
  assert.equal(line.quantityCtn, 10); assert.equal(line.originalQuantityCtn, 10);
  assert.equal(line.lockedUnitPrice, 2); assert.equal(line.lineAmount, 20);
  assert.equal(line.effectiveRequestedQtyCtn, 25); assert.equal(line.effectiveLineAmount, 50);
  assert.equal(order.totalCartons, 10); assert.equal(order.effectiveTotalCartons, 25);
  assert.equal(order.effectiveEstimatedTotal, 50); assert.equal(order.effectiveTotalCbm, 12.5);
  assert.equal(order.revision, 1);
  const audit = h.data('WixOrderAudit', 'SALES-QTY-' + requestId);
  assert.equal(audit.actorName, 'LAW'); assert.equal(audit.detail.previousQuantityCtn, 10);
  assert.equal(audit.detail.newQuantityCtn, 25); assert.equal(audit.at, line.lastQuantityEditAt);
  assert.deepEqual(h.signals[0].channel, { name: 'sales-room-signals' });
  assert.deepEqual(Object.keys(h.signals[0].message).sort(), ['at', 'type']);
});

test('zero quantity is saved with the same audit and original snapshot', async () => {
  const h = harness(); await h.saveSalesRoomOrderQty('O1', 'L1', 0, 0, requestId);
  assert.equal(h.data('WixBuyerOrderLines', 'line').effectiveRequestedQtyCtn, 0);
  assert.equal(h.data('WixBuyerOrders', 'order').effectiveEstimatedTotal, 0);
});

test('unassigned salesperson cannot obtain a lock or change an order', async () => {
  const h = harness({ staffId: 'OTHER' });
  await assert.rejects(h.saveSalesRoomOrderQty('O1', 'L1', 5, 0, requestId), /Customer was not found/);
  assert.equal(h.writes.length, 0);
});

test('stale versions, decimals and negative quantities never change operational rows', async () => {
  const h = harness();
  for (const [qty, revision] of [[3, 9], [1.5, 0], [-1, 0]]) await assert.rejects(h.saveSalesRoomOrderQty('O1', 'L1', qty, revision, requestId));
  assert.equal(h.data('WixBuyerOrderLines', 'line').quantityCtn, 10);
  assert.equal(h.data('WixBuyerOrderLines', 'line').effectiveRequestedQtyCtn, undefined);
  assert.equal(h.writes.filter(write => write.operation === 'update').length, 0);
});

test('same request replay creates one immutable audit and one revision', async () => {
  const h = harness();
  await h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId);
  await h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId);
  assert.equal(h.data('WixBuyerOrders', 'order').revision, 1);
  assert.equal([...h.collection('WixOrderAudit').values()].length, 1);
  assert.equal(h.signals.length, 1);
});

test('replay protection and owned lines still work beyond the first CMS page', async () => {
  const h = harness();
  for (let i = 0; i < 1001; i++) h.seed('WixOrderAudit', 'old-' + i, { action: 'OLD' });
  await h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId);
  await h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId);
  await assert.rejects(h.saveSalesRoomOrderQty('O1', 'L1', 6, 1, requestId), /request conflict/);
  assert.equal(h.data('WixBuyerOrders', 'order').revision, 1);
  assert.equal(h.data('WixBuyerOrderLines', 'line').effectiveRequestedQtyCtn, 4);
});

test('committed and completed line markers reject edits even before an order transfer flag', async () => {
  for (const patch of [{ committedQtyCtn: 0 }, { completedQtyCtn: 1 }, { masterSubmittedAt: '2026-10-05T00:00:00Z' }]) {
    const h = harness(); h.seed('WixBuyerOrderLines', 'line', { ...h.data('WixBuyerOrderLines', 'line'), ...patch });
    await assert.rejects(h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId), /already committed/);
    assert.equal(h.writes.filter(w => w.operation === 'update').length, 0);
  }
});

test('transfer and quantity changes cannot write concurrently; both NCT and GHR lock later edits', async () => {
  for (const destination of ['NCT', 'GHR']) {
    const h = harness();
    const results = await Promise.allSettled([h.submitSalesRoomOrder('O1', destination), h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId)]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
    await assert.rejects(h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId), /locked after transfer/);
    assert.equal(h.data('WixBuyerOrderLines', 'line').effectiveRequestedQtyCtn, undefined);
    assert.equal(h.data('WixBuyerOrders', 'order').destination, destination);
  }
});

test('audit failure restores the prior line and order instead of accepting unrecorded edits', async () => {
  const h = harness({ failAudit: true });
  const beforeOrder = h.data('WixBuyerOrders', 'order'), beforeLine = h.data('WixBuyerOrderLines', 'line');
  await assert.rejects(h.saveSalesRoomOrderQty('O1', 'L1', 4, 0, requestId), /Audit unavailable/);
  assert.deepEqual(h.data('WixBuyerOrders', 'order'), beforeOrder);
  assert.deepEqual(h.data('WixBuyerOrderLines', 'line'), beforeLine);
  assert.equal(h.signals.length, 0); assert.equal(h.collection('WixOrderAudit').size, 0);
});

test('a concurrent proforma cannot overwrite saved quantities with an older order payload', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.saveSalesRoomOrderQty('O1', 'L1', 25, 0, requestId), h.createSalesRoomProforma('O1')]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  await h.createSalesRoomProforma('O1');
  const order = h.data('WixBuyerOrders', 'order');
  assert.equal(order.effectiveTotalCartons, 25); assert.equal(order.revision, 1);
  assert.equal(order.status, 'PROFORMA REQUESTED');
});

test('Buyer edit history paginates past 1000, filters customer identity, and excludes locks', async () => {
  const h = harness({ buyer: true });
  for (let i = 0; i < 1001; i++) h.seed('WixOrderAudit', 'A' + i, { orderId: 'O1', customerId: 'C1', action: 'SALES_QTY_UPDATED', detail: { lineId: 'L1' } });
  h.seed('WixOrderAudit', 'foreign', { orderId: 'O1', customerId: 'OTHER', action: 'SALES_QTY_UPDATED' });
  h.seed('WixOrderAudit', 'lock', { orderId: 'O1', customerId: 'C1', action: 'ORDER_MUTATION_LOCK' });
  const result = await h.getBuyerOrderDetail('O1');
  assert.equal(result.order.editHistory.length, 1001);
  assert.ok(result.order.editHistory.every(audit => audit.customerId === 'C1'));
  await assert.rejects(h.getBuyerOrderDetail('OTHER'), /Order was not found/);
});

function buyerUi(state) {
  const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
  const names = ['orderInvoiceNo', 'completedLineQty', 'committedLineQty', 'effectiveRequestedQty', 'canReduceOrder', 'stageForLine', 'requestTimestamp', 'progressUpdated', 'orderLines', 'allTrackingRows', 'allCompletedRows', 'requestOrderDetails', 'trackingLineHtml', 'orderEditEntries', 'editHistoryHtml'];
  const definitions = names.map(name => html.split(/\r?\n/).find(line => line.startsWith('function ' + name + '('))).join('\n');
  const requests = [];
  const context = vm.createContext({ state, post: (...args) => requests.push(args), num: value => Number(value) || 0, money: value => Number(value || 0).toFixed(2), compactTime: value => value, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'), Date, Set });
  vm.runInContext(definitions + '\nglobalThis.api={allTrackingRows,allCompletedRows,editHistoryHtml,trackingLineHtml,requestOrderDetails};', context);
  return { ...context.api, requests };
}

test('active edit history disappears on existing completion criteria and remains with completed items', () => {
  const state = { orders: [{ orderId: 'O1', status: 'CONFIRMED' }], orderDetails: { O1: { lines: [{ lineId: 'L1', itemName: 'ACTIVE PRODUCT', quantityCtn: 10, effectiveRequestedQtyCtn: 9 }, { lineId: 'L2', itemName: 'COMPLETED PRODUCT', quantityCtn: 6, committedQtyCtn: 5, completedQtyCtn: 5, invoiceNo: 'INV1' }], editHistory: [{ action: 'SALES_QTY_UPDATED', orderId: 'O1', actorName: 'LAW', at: '2026-10-05T01:00:00Z', detail: { lineId: 'L1', previousQuantityCtn: 10, newQuantityCtn: 9 } }, { action: 'SALES_QTY_UPDATED', orderId: 'O1', actorName: '<unsafe>', at: '2026-10-05T02:00:00Z', detail: { lineId: 'L2', previousQuantityCtn: 6, newQuantityCtn: 5 } }] } }, orderDetailRequests: new Set() };
  const ui = buyerUi(state);
  const active = ui.editHistoryHtml(ui.allTrackingRows()), completed = ui.editHistoryHtml(ui.allCompletedRows());
  assert.match(active, /ACTIVE PRODUCT/); assert.doesNotMatch(active, /COMPLETED PRODUCT/);
  assert.match(completed, /COMPLETED PRODUCT/); assert.doesNotMatch(completed, /ACTIVE PRODUCT/);
  assert.match(completed, /&lt;unsafe&gt;/); assert.doesNotMatch(completed, /<unsafe>/);
  assert.equal(state.orderDetails.O1.editHistory.length, 2);
});

test('Current Status hides customer edits and staff identity while showing latest quantity time', () => {
  const order = { orderId: 'O1', status: 'CONFIRMED' }, line = { lineId: 'L1', itemName: 'PRODUCT', quantityCtn: 10, effectiveRequestedQtyCtn: 9, lastQuantityEditBy: 'SECRET STAFF NAME', lastQuantityEditAt: '2026-10-05T02:00:00Z', progressUpdatedAt: '2026-10-05T01:00:00Z' };
  const ui = buyerUi({ orders: [order], orderDetails: { O1: { lines: [line] } }, orderDetailRequests: new Set() });
  const row = ui.trackingLineHtml({ order, line });
  assert.doesNotMatch(row, /data-reduce-order/); assert.doesNotMatch(row, /SECRET STAFF NAME/);
  assert.match(row, /2026-10-05T02:00:00Z/);
});

test('changed order versions and realtime signals refresh cached detail without a manual click', () => {
  const state = { orders: [{ orderId: 'O1', revision: 1, updatedAt: 'NEW' }], orderDetails: { O1: { revision: 0, updatedAt: 'OLD' } }, orderDetailRequests: new Set() };
  const ui = buyerUi(state); ui.requestOrderDetails(); ui.requestOrderDetails();
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0][0], 'BUYER_ROOM_ORDER_DETAIL');
  state.orderDetailRequests.clear(); state.orderDetails.O1 = { revision: 1, updatedAt: 'NEW' };
  ui.requestOrderDetails(); assert.equal(ui.requests.length, 1);
  ui.requestOrderDetails(true); assert.equal(ui.requests.length, 2);
  state.orderDetailRequests.clear(); state.orders[0].revision = 0;
  ui.requestOrderDetails(); assert.equal(ui.requests.length, 2, 'an older workspace snapshot must not trigger a repeated detail fetch');
});

test('all edited inline scripts parse as JavaScript', () => {
  for (const filename of ['buyer-room.html', 'index.html']) {
    const html = fs.readFileSync(path.join(root, filename), 'utf8');
    for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(source, { filename });
  }
});
