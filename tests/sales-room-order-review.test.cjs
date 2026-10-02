const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');

test('Sales Room uses the compact incoming-order review build', () => {
  assert.match(html, /Sales Room build: 2026-10-02-buyer-progress-parity-v59/);
  assert.match(html, /incoming-order-review/);
  assert.match(html, /#orderDetailArea:has\(\.incoming-order-review\)\{width:min\(820px,96vw\)/);
  assert.match(html, /incoming-order-table-wrap\{max-height:calc\(100vh - 252px\);overflow:auto\}/);
});

test('incoming-order table exposes barcode and compact operational columns', () => {
  assert.match(html, /<th>#<\/th><th>Barcode<\/th><th>Item &amp; Packing<\/th><th>Locked \/ CTN<\/th><th>Qty<\/th><th>Amount<\/th>/);
  assert.match(html, /esc\(line\.barcode\|\|'—'\)/);
  assert.match(html, /esc\(line\.packingSize\|\|'Packing not provided'\)/);
  assert.match(html, /incoming-order-summary/);
  assert.match(html, /ORDER VALUE/);
});

test('incoming-order quantity is read-only and downstream actions remain wired', () => {
  assert.match(html, /order-qty-locked/);
  assert.match(html, /Prices and quantities locked · Adjust in Buyer Room before transfer/);
  assert.doesNotMatch(html, /data-order-qty/);
  assert.doesNotMatch(html, /SALES_ROOM_ORDER_QTY_UPDATE/);
  assert.match(html, /SALES_ROOM_CREATE_PROFORMA/);
  assert.match(html, /SALES_ROOM_SUBMIT_ORDER/);
});

test('order detail backend preserves barcode on stored lines', () => {
  assert.match(backend, /barcode: normalize\(item\.barcode\)/);
  assert.match(backend, /order: \{ \.\.\.orderEntry\.data, totalCartons: orderEntry\.data\.effectiveTotalCartons \?\? orderEntry\.data\.totalCartons,[\s\S]*lines \}/);
});

test('Sales Room backend refuses every quantity mutation', () => {
  assert.match(backend, /Sales Room quantities are read-only\. Additions require a new Buyer Room request; reductions must be made in Track Orders before NCT \/ GHR submission\./);
  const mutationBlock = backend.match(/export const saveSalesRoomOrderQty[\s\S]*?export const submitSalesRoomOrder/)?.[0] || '';
  assert.doesNotMatch(mutationBlock, /putPayload\(BUYER_LINE_COLLECTION/);
  assert.doesNotMatch(mutationBlock, /SALES_QTY_UPDATED/);
});
