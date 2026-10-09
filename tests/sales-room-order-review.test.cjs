const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');

test('Sales Room uses the full workspace incoming-order review build', () => {
  assert.match(html, /Sales Room build: 2026-10-09-nct-submit-catch-cost-room6-v1/);
  assert.match(html, /incoming-order-review/);
  assert.match(html, /#orderDetailArea:has\(\.incoming-order-review\)\{position:static!important/);
  assert.match(html, /incoming-order-table-wrap\{max-height:none!important;overflow:visible!important\}/);
});

test('incoming-order table exposes barcode and compact operational columns', () => {
  assert.match(html, /<th>Barcode<\/th><th>Descriptions<\/th>/);
  assert.match(html, /<th>Qty \(CTN\)<\/th><th>Line Amount/);
  assert.match(html, /esc\(line\.barcode\|\|'—'\)/);
  assert.match(html, /esc\(line\.packingSize\|\|'Packing not provided'\)/);
  assert.match(html, /incoming-order-summary/);
  assert.match(html, /Order Value/);
});

test('authorized quantity edits preserve locked quotes and downstream actions', () => {
  assert.match(html, /order-qty-locked/);
  assert.match(html, /Quoted prices locked · Edit quantities before transfer/);
  assert.doesNotMatch(html, /data-order-qty/);
  assert.match(html, /SALES_ROOM_ORDER_QTY_UPDATE/);
  assert.match(html, /Save or cancel the current edit first/);
  assert.match(html, /data-company-preview="With North Cape"/);
  assert.match(html, /data-company-preview="To Global HR"/);
});

test('order detail backend preserves barcode on stored lines', () => {
  assert.match(backend, /barcode: normalize\(item\.barcode\)/);
  assert.match(backend, /order: \{ \.\.\.orderEntry\.data, totalCartons: orderEntry\.data\.effectiveTotalCartons \?\? orderEntry\.data\.totalCartons,[\s\S]*lines \}/);
});

test('Sales Room backend authorizes pretransfer changes with revision checks and immutable history', () => {
  const mutationBlock = backend.match(/export const saveSalesRoomOrderQty[\s\S]*?export const submitSalesRoomOrder/)?.[0] || '';
  assert.match(mutationBlock, /requireAuthorizedStaffContext/);
  assert.match(mutationBlock, /expectedRevision/);
  assert.match(mutationBlock, /locked after transfer/);
  assert.match(mutationBlock, /putPayload\(BUYER_LINE_COLLECTION/);
  assert.match(mutationBlock, /SALES_QTY_UPDATED/);
});
