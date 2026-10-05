const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'buyer-room.html'), 'utf8');
const page = fs.readFileSync(path.join(root, 'buyer-room', 'wix', 'buyer-room-page.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'backend', 'catalogueAuth.web.js'), 'utf8');
const sales = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Track Orders uses the compact unlabeled pencil action column', () => {
  assert.match(html, /grid-template-columns:8% 23% 8% 6% 10% 6% 6% 9% 5% 5% 9% 5%/);
  assert.match(html, /<div class="num">Updated<\/div><div aria-hidden="true"><\/div>/);
  assert.match(html, /class="tracking-edit"[^>]+data-reduce-order/);
  assert.doesNotMatch(html, />ACTION<\/div>/);
});

test('customer quantities are locked immediately after submission, including the existing API route', () => {
  assert.match(html, /function canReduceOrder\(order\)\{return false\}/);
  assert.match(backend, /throw new Error\('Submitted orders are locked\. Please contact your salesperson to request changes\.'\)/);
  assert.match(page, /message\.type === 'BUYER_ROOM_REDUCE_ORDER'/);
  assert.match(page, /reduceBuyerOrderLine\(/);
});

test('reduction preserves the original quantity and records an immutable audit', () => {
  assert.match(backend, /originalQuantityCtn:/);
  assert.match(backend, /effectiveRequestedQtyCtn: nextQty/);
  assert.match(backend, /BUYER_REDUCED_ORDER_LINE/);
  assert.match(backend, /BUYER_CANCELLED_ORDER_LINE/);
  assert.match(sales, /line\.effectiveRequestedQtyCtn\?\?line\.quantityCtn/);
});

test('reduction dialog keeps product details readable and uses one clear action', () => {
  assert.match(html, /2026-10-05-sales-quantity-history-room5-v1/);
  assert.match(page, /buyer-room\.html\?v=20261004-selection-same-site-download-v98/);
  assert.match(html, /\.reduction-product span\{[^}]+font-size:11px/);
  assert.match(html, /\.reduction-value\{display:flex;align-items:center;font-size:16px/);
  assert.match(html, /\.reduction-actions #submitReduction\{[^}]+background:#e87524[^}]+color:#fff!important/);
  assert.doesNotMatch(html, /id="cancelReduction"/);
  assert.doesNotMatch(html, /\$\('cancelReduction'\)/);
});

test('Overall Progress exposes readable committed value and CBM summaries', () => {
  assert.match(html, /Committed Value/);
  assert.match(html, /id="trackCommittedValue"/);
  assert.match(html, /activeCommittedQty\(row\)\*num\(row\.line\.lockedPriceCtn\|\|row\.line\.lockedUnitPrice\)/);
  assert.match(html, /\.tracking-stage-label\{[^}]+font-size:11px/);
  assert.match(html, /\.tracking-stage small\{[^}]+font-size:11px/);
});
