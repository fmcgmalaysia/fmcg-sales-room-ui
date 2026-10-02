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
  assert.match(html, /grid-template-columns:96px minmax\(280px,2fr\)[^;}]+32px/);
  assert.match(html, /<div class="center">Updated<\/div><div aria-hidden="true"><\/div>/);
  assert.match(html, /class="tracking-edit"[^>]+data-reduce-order/);
  assert.doesNotMatch(html, />ACTION<\/div>/);
});

test('reduction is available only before NCT or GHR submission', () => {
  assert.match(html, /function canReduceOrder\(order\)\{return !String\(order\.status\|\|''\)\.toUpperCase\(\)\.startsWith\('SUBMITTED TO '\)\}/);
  assert.match(backend, /if \(upper\(order\.status\)\.startsWith\('SUBMITTED TO '\)\) throw new Error\('Requested quantity is locked after submission to NCT \/ GHR\.'\)/);
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

test('Overall Progress exposes readable committed value and CBM summaries', () => {
  assert.match(html, /Committed Value/);
  assert.match(html, /id="trackCommittedValue"/);
  assert.match(html, /row\.committed\*num\(row\.line\.lockedPriceCtn\|\|row\.line\.lockedUnitPrice\)/);
  assert.match(html, /\.tracking-stage-top b\{color:#173557;font-size:11px\}/);
  assert.match(html, /\.tracking-stage small\{margin-top:6px;color:#718399;font-size:9px\}/);
});

