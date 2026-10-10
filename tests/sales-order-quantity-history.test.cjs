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
  seed('WixBuyerOrders', 'order', { orderId: 'O1', customerId: 'C1', companyName: 'CUSTOMER', currency: 'SGD', status: 'CONFIRMED', revision: 0, totalCartons: 10, estimatedTotal: 20, totalCbm: 5, isComplete: true }, { orderId: 'O1', customerId: 'C1', isComplete: true });
  seed('WixBuyerOrderLines', 'line', { orderId: 'O1', customerId: 'C1', lineId: 'L1', barcode: 'PRODUCT', itemName: 'Product', packingSize: '2 x1', eaPerCtn: 2, lockedUnitPriceEa: 1, currency: 'SGD', quantityCtn: 10, lockedUnitPrice: 2, lineAmount: 20, lineCbm: 5, cbmPerCtn: 0.5 }, { orderId: 'O1', customerId: 'C1' });
  function page(items, offset, size) { return { items: copy(items.slice(offset, offset + size)), hasNext: () => offset + size < items.length, next: async () => page(items, offset + size, size) }; }
  const wixData = {
    query(name) {
      const filters = []; let size = 1000;
      const query = { eq(field, value) { filters.push(row => row[field] === value); return query; }, hasSome(field, values) { filters.push(row => (Array.isArray(row[field]) ? row[field] : [row[field]]).some(value => values.includes(value))); return query; }, startsWith(field, value) { filters.push(row => String(row[field] || '').startsWith(value)); return query; }, contains(field, value) { filters.push(row => String(row[field] || '').includes(value)); return query; }, limit(value) { size = value; return query; }, find: async () => page([...collection(name).values()].filter(row => filters.every(filter => filter(row))), 0, size) };
      return query;
    },
    get: async (name, id) => { const row = collection(name).get(id); if (!row) throw new Error('Not found'); return copy(row); },
    insert: async (name, row) => {
      const id = row._id || row.title;
      if (collection(name).has(id)) throw new Error('Duplicate ID');
      if (failAudit && ['SALES_QTY_UPDATED', 'CUSTOMER_PO_UPDATED', 'ORDER_PLANNING_UPDATED'].includes(JSON.parse(row.payload || '{}').action)) throw new Error('Audit unavailable');
      const next = { ...copy(row), _id: id }; collection(name).set(id, next); writes.push({ operation: 'insert', collection: name, row: copy(next) }); return copy(next);
    },
    update: async (name, row) => { collection(name).set(row._id, copy(row)); writes.push({ operation: 'update', collection: name, row: copy(row) }); return copy(row); },
    remove: async (name, id) => { collection(name).delete(id); writes.push({ operation: 'remove', collection: name, id }); }
  };
  const file = buyer ? 'backend/catalogueAuth.web.js' : 'sales-room/wix/onboarding.web.js';
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export const /gm, 'const ');
  const context = vm.createContext({ wixData, Permissions: { SiteMember: 'member' }, webMethod: (_, method) => method, wixRealtimeBackend: { publish: async (channel, message) => signals.push(copy({ channel, message })) }, console, Date, Map, Set });
  if (!buyer) {
    collection('WixFxRates').set('SGD', { _id: 'SGD', currency: 'SGD', active: true, rateToMyr: 3.25 });
    context.createHash = require('node:crypto').createHash;
    context.getSecret = async () => 'LOCAL-TEST-ONLY';
    context.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ ok: true, destination: 'NCT', orderId: body.orderId,
        submissionId: body.submissionId, receiptId: 'RECEIPT-' + body.orderId,
        masterReceivedAt: new Date().toISOString(), taskIds: body.lines.map(line => 'TASK-' + line.sourceLineId), costErrorTaskCount: 0 }) };
    };
    for (const [file, name] of [['backend/nctSubmissionPayload.js', 'buildNctSubmission'],
        ['backend/nctSubmissionDelivery.js', 'createNctSubmissionDelivery'], ['backend/nctSalesIntake.js', 'submitNctSalesOrder']]) {
      const moduleSource = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export (async function|function) /gm, '$1 ');
      context[name] = vm.runInContext('(function(){' + moduleSource + '\nreturn ' + name + ';})()', context);
    }
  }
  require('./load-master-quantity.cjs')(context,()=>[...collection('WixBuyerOrderLines').values()].map(row=>JSON.parse(row.payload)));
  vm.runInContext(source + (buyer
    ? "\nresolveBuyerContext=async()=>({customerId:'C1'});globalThis.api={reduceBuyerOrderLine,getBuyerOrderDetail};"
    : `\nresolveCurrentStaffContext=async()=>({authorized:true,staffId:${JSON.stringify(staffId)},staffName:'LAW',loginEmail:'law@example.test',canViewAllCustomers:false});globalThis.api={saveSalesRoomOrderQty,saveSalesRoomOrderPo,saveSalesRoomOrderPlanning,getSalesRoomOrderDetail,getSalesRoomOrderProgress,submitSalesRoomOrder,createSalesRoomProforma};`), context);
  return { ...context.api, collection, seed, writes, signals, data: (name, id) => JSON.parse(collection(name).get(id).payload) };
}

test('order planning preserves quantities, quotes and another order while persisting a date-only value', async () => {
  const h=harness(),beforeLine=h.data('WixBuyerOrderLines','line'),before=h.data('WixBuyerOrders','order');
  h.seed('WixBuyerOrders','other',{...before,orderId:'O2',customerPoNumber:'OTHER-PO',estimatedShipmentDate:'2026-11-01'});
  await h.saveSalesRoomOrderPlanning('O1',' PO-CUSTOMER ','2026-10-21',0,requestId);
  const order=h.data('WixBuyerOrders','order');assert.equal(order.customerPoNumber,'PO-CUSTOMER');assert.equal(order.estimatedShipmentDate,'2026-10-21');assert.equal(order.shipmentDateUpdatedBy,'LAW');assert.ok(order.shipmentDateUpdatedAt.endsWith('Z'));assert.equal(order.revision,1);
  for(const key of Object.keys(before).filter(key=>key!=='revision'))assert.deepEqual(order[key],before[key]);
  assert.deepEqual(h.data('WixBuyerOrderLines','line'),beforeLine);assert.equal(h.data('WixBuyerOrders','other').customerPoNumber,'OTHER-PO');
  assert.equal(h.data('WixOrderAudit','SALES-PLAN-'+requestId).action,'ORDER_PLANNING_UPDATED');
  const detail=await h.getSalesRoomOrderDetail('O1');assert.equal(detail.order.estimatedShipmentDate,'2026-10-21');
});

test('planning replay is idempotent, rejects changed replay and stale quantities, and retains the date actor on P.O.-only edits',async()=>{
  const h=harness();await h.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',0,requestId);const at=h.data('WixBuyerOrders','order').shipmentDateUpdatedAt;
  await h.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',0,requestId);assert.equal(h.data('WixBuyerOrders','order').revision,1);
  await assert.rejects(h.saveSalesRoomOrderPlanning('O1','PO','2026-10-22',1,requestId),/request conflict/);
  await assert.rejects(h.saveSalesRoomOrderQty('O1','L1',5,0,'22222222-2222-4222-8222-222222222222'),/has changed/);
  await h.saveSalesRoomOrderPlanning('O1','PO-NEW','2026-10-21',1,'33333333-3333-4333-8333-333333333333');assert.equal(h.data('WixBuyerOrders','order').shipmentDateUpdatedAt,at);
  assert.equal(h.data('WixBuyerOrderLines','line').quantityCtn,10);
});

test('invalid calendar dates and stale revisions cannot write order planning',async()=>{
  const h=harness();for(const date of ['2026-02-30','2026-13-01','21-10-2026','2026-10-21T00:00:00Z','0026-01-01'])await assert.rejects(h.saveSalesRoomOrderPlanning('O1','PO',date,0,requestId),/valid shipment date/);
  await assert.rejects(h.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',9,requestId),/has changed/);assert.equal(h.writes.filter(w=>w.operation==='update').length,0);
  await h.saveSalesRoomOrderPlanning('O1','','2028-02-29',0,requestId);assert.equal(h.data('WixBuyerOrders','order').estimatedShipmentDate,'2028-02-29');
});

test('planning respects assigned staff, transfer locks and audit rollback',async()=>{
  const denied=harness({staffId:'OTHER'});await assert.rejects(denied.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',0,requestId),/Customer was not found/);assert.equal(denied.writes.length,0);
  const transferred=harness();await transferred.submitSalesRoomOrder('O1','NCT');await assert.rejects(transferred.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',0,requestId),/locked after transfer/);
  const failed=harness({failAudit:true}),before=failed.data('WixBuyerOrders','order');await assert.rejects(failed.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',0,requestId),/Audit unavailable/);assert.deepEqual(failed.data('WixBuyerOrders','order'),before);assert.equal(failed.collection('WixOrderAudit').size,0);
});

test('planning and quantity edits share the existing mutation lock',async()=>{
  const h=harness(),results=await Promise.allSettled([h.saveSalesRoomOrderPlanning('O1','PO','2026-10-21',0,requestId),h.saveSalesRoomOrderQty('O1','L1',5,0,'44444444-4444-4444-8444-444444444444')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.data('WixBuyerOrders','order').revision,1);assert.equal(h.collection('WixOrderAudit').size,1);
});

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
  const names = ['isFoodItem', 'bySelectionOrder', 'orderInvoiceNo', 'completedLineQty', 'committedLineQty', 'effectiveRequestedQty', 'canReduceOrder', 'stageForLine', 'requestTimestamp', 'progressUpdated', 'orderLines', 'allTrackingRows', 'allCompletedRows', 'requestOrderDetails', 'trackTime24', 'trackingLineHtml', 'orderEditEntries', 'quantityChangeDetails', 'orderEditGroups', 'historyPathHtml', 'editHistoryHtml'];
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

test('Current Status keeps customer edits locked and committed update time blank until Master provides it', () => {
  const order = { orderId: 'O1', status: 'CONFIRMED' }, line = { lineId: 'L1', itemName: 'PRODUCT', quantityCtn: 10, effectiveRequestedQtyCtn: 9, lastQuantityEditBy: 'SECRET STAFF NAME', lastQuantityEditAt: '2026-10-05T02:00:00Z', progressUpdatedAt: '2026-10-05T01:00:00Z' };
  const ui = buyerUi({ orders: [order], orderDetails: { O1: { lines: [line] } }, orderDetailRequests: new Set() });
  const row = ui.trackingLineHtml({ order, line });
  assert.doesNotMatch(row, /data-reduce-order/); assert.doesNotMatch(row, /SECRET STAFF NAME/);
  assert.doesNotMatch(row, /2026-10-05T02:00:00Z/);
});

test('Track reuses selection product ranking and groups repeated requests without changing amounts', () => {
  const products = [{ id: 'N1', barcode: '3', category: 'NONFOOD', brandName: 'A', sortNo: '1' }, { id: 'F2', barcode: '2', category: 'FOOD', brandName: 'B', sortNo: '2' }, { id: 'F1', barcode: '1', category: 'FOOD', brandName: 'B', sortNo: '1' }];
  const lines = [{ lineId: 'L1', itemId: 'F2', barcode: '2', quantityCtn: 20 }, { lineId: 'L2', itemId: 'N1', barcode: '3', quantityCtn: 5 }, { lineId: 'L3', itemId: 'F1', barcode: '1', quantityCtn: 10 }, { lineId: 'L4', itemId: 'F2', barcode: '2', quantityCtn: 7 }];
  const state = { my: products, removed: [], orders: [{ orderId: 'O1' }], orderDetails: { O1: { lines } } };
  const before = JSON.stringify(state);
  const rows = buyerUi(state).allTrackingRows();
  assert.equal(rows.map(row => row.line.lineId).join(','), 'L3,L1,L4,L2');
  assert.equal(rows.reduce((sum,row) => sum + row.requested,0),42);
  assert.equal(JSON.stringify(state),before);
});

test('History path preserves saved additions, reductions and cancellations without generating audits', () => {
  const lines = [{ lineId: 'L1', itemName: 'Product', quantityCtn: 20 }];
  const editHistory = [
    { detail: { lineId: 'L1', previousQuantityCtn: 20, newQuantityCtn: 30 } },
    { detail: { lineId: 'L1', previousQuantityCtn: 30, newQuantityCtn: 25 } },
    { detail: { lineId: 'L1', previousQuantityCtn: 25, newQuantityCtn: 0 } }
  ];
  const state = { orders: [{ orderId: 'O1' }], orderDetails: { O1: { lines, editHistory } } };
  const ui=buyerUi(state), html=ui.editHistoryHtml(ui.allTrackingRows());
  assert.match(html,/<th>Path<\/th>/);
  assert.match(html,/20 → 30 → 25 → 0 CTN/);
  assert.match(html,/<th>Reason<\/th>/);
  assert.equal(editHistory.length,3);
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

test('customer PO survives reopening without changing quantities, totals, prices or processing PO', async () => {
  const h=harness(); const line=h.data('WixBuyerOrderLines','line'); line.poNumber='PROCUREMENT-PO'; h.seed('WixBuyerOrderLines','line',line,{orderId:'O1',customerId:'C1'});
  const before=h.data('WixBuyerOrders','order'); await h.saveSalesRoomOrderPo('O1',' CUSTOMER-PO-7 ',0,requestId);
  const reopened=(await h.getSalesRoomOrderDetail('O1')).order;
  assert.equal(reopened.customerPoNumber,'CUSTOMER-PO-7'); assert.equal(reopened.revision,1);
  assert.deepEqual(h.data('WixBuyerOrderLines','line'),line);
  assert.deepEqual(h.data('WixBuyerOrders','order'),{...before,customerPoNumber:'CUSTOMER-PO-7',revision:1});
});
test('PO replay is idempotent, and conflicts, stale changes and unassigned staff are rejected',async()=>{
  const h=harness(); await h.saveSalesRoomOrderPo('O1','PO1',0,requestId); await h.saveSalesRoomOrderPo('O1','PO1',0,requestId);
  assert.equal(h.data('WixBuyerOrders','order').revision,1); assert.equal([...h.collection('WixOrderAudit').values()].length,1);
  await assert.rejects(h.saveSalesRoomOrderPo('O1','OTHER',1,requestId),/conflict/);
  await assert.rejects(h.saveSalesRoomOrderPo('O1','PO2',0,'22222222-2222-4222-8222-222222222222'),/changed/);
  const other=harness({staffId:'OTHER'}); await assert.rejects(other.saveSalesRoomOrderPo('O1','PO',0,requestId),/Customer was not found/); assert.equal(other.writes.length,0);
});
test('PO audit failure restores the exact order and leaves quantities untouched',async()=>{
  const h=harness({failAudit:true}),before=h.data('WixBuyerOrders','order'),line=h.data('WixBuyerOrderLines','line');
  await assert.rejects(h.saveSalesRoomOrderPo('O1','PO',0,requestId),/Audit unavailable/); assert.deepEqual(h.data('WixBuyerOrders','order'),before); assert.deepEqual(h.data('WixBuyerOrderLines','line'),line);
  assert.equal([...h.collection('WixOrderAudit').values()].length,0);
});
test('PO cannot change after transfer and a saved PO does not bypass the quantity revision guard',async()=>{
  const h=harness(); await h.saveSalesRoomOrderPo('O1','PO1',0,requestId); await assert.rejects(h.saveSalesRoomOrderQty('O1','L1',12,0,requestId),/changed/);
  await h.saveSalesRoomOrderQty('O1','L1',12,1,requestId); assert.equal(h.data('WixBuyerOrders','order').customerPoNumber,'PO1');
  await h.submitSalesRoomOrder('O1','NCT'); await assert.rejects(h.saveSalesRoomOrderPo('O1','PO2',2,'22222222-2222-4222-8222-222222222222'),/locked after transfer/);
});
test('progress product metadata includes only authorized customer display fields',async()=>{
  const h=harness(); h.seed('WixBuyerListItems','product',{customerId:'C1',id:'P1',barcode:'ONE',category:'FOOD',brandName:'A',sortNo:3,cost:123}); h.seed('WixBuyerListItems','other',{customerId:'C2',id:'SECRET',barcode:'OTHER'});
  const result=await h.getSalesRoomOrderProgress('C1'); assert.equal(result.selectionOrder.length,1); assert.equal(result.selectionOrder[0].id,'product'); assert.equal(result.selectionOrder[0].cost,undefined); assert.equal(result.orders.length,1);
});

test('legacy selection sorting uses current Catalogue brand, point-base sort and Food references like Buyer',async()=>{
  const h=harness(); h.seed('WixBuyerListItems','selected',{customerId:'C1',id:'OLD-ID',productId:'CAT',barcode:'123'});
  h.collection('FMCGMALAYSIA').set('CAT',{_id:'CAT',barcode:'123',brandName:'Kelloggs',pointBaseSortId:7,subCategories:['FOOD-SUB'],cost:999});
  h.collection('subCategories').set('FOOD-SUB',{_id:'FOOD-SUB',mainCategory:'FOOD & BEVERAGES'});
  const result=await h.getSalesRoomOrderProgress('C1'),item=result.selectionOrder[0];
  assert.equal(item.id,'selected'); assert.equal(item.category,'FOOD'); assert.equal(item.brandName,'Kelloggs'); assert.equal(item.sortNo,'7'); assert.equal(item.cost,undefined);
});
