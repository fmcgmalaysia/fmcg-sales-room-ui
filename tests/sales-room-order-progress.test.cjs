const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('Sales Room includes a dedicated customer Order Progress page', () => {
  assert.match(html, /Sales Room build: 2026-10-02-order-progress-retry-v47/);
  assert.match(html, /data-view="order-progress"/);
  assert.match(html, /id="order-progress" class="view"/);
  assert.match(html, /id="progressCustomerSelect"/);
  assert.match(html, /READ ONLY/);
  assert.match(html, /Sales visibility · no quantity editing/);
});

test('Order Progress requests one selected customer and handles live responses', () => {
  assert.match(html, /type:'SALES_ROOM_ORDER_PROGRESS_REQUEST',customerId:salesProgressCustomerId,requestId/);
  assert.match(html, /m\.type==='SALES_ROOM_ORDER_PROGRESS'/);
  assert.match(html, /function renderSalesOrderProgress\(payload\)/);
  assert.match(html, /populateOrderProgressCustomers\(\)/);
});

test('Order Progress retries one lost or slow first response and then exposes a manual retry', () => {
  assert.match(html, /salesProgressRetryCountV47<1/);
  assert.match(html, /requestSalesOrderProgress\(\{retry:true\}\)/);
  assert.match(html, /isRetry\?15000:10000/);
  assert.match(html, /button\.textContent='Retry Progress'/);
  assert.match(html, /No order data was changed/);
});

test('Order Progress mirrors the six Buyer Room fulfilment stages', () => {
  assert.match(html, /const salesProgressStages=\['Request Sent','Order Confirmed','Processing','Goods Received','Repacking','Shipped'\]/);
  assert.match(html, /background:conic-gradient\(#23a573 calc\(var\(--progress\)\*1%\),#dce6ee 0\)/);
  assert.match(html, /sales-progress-pill s'\+row\.stage[\s\S]{0,40}row\.stage\+'\/6/);
  assert.doesNotMatch(html, /salesProgressStages=.*Full Payment/);
});

test('Order Progress totals and rows use committed quantity only', () => {
  assert.match(html, /committedRows=rows\.filter\(row=>row\.committed!==null\)/);
  assert.match(html, /committedValue=committedRows\.reduce\(\(sum,row\)=>sum\+row\.qty\*salesProgressNum/);
  assert.match(html, /committedCbm=committedRows\.reduce\(\(sum,row\)=>sum\+row\.qty\*salesProgressNum/);
  assert.match(html, /Committed Value/);
  assert.match(html, /Committed CBM/);
});

test('Sales projection is compact and has no quantity edit control', () => {
  assert.match(html, /\.sales-progress-row\{grid-template-columns:7% 25% 8% 7% 10% 6% 6% 7% 5% 7% 12%\}/);
  assert.match(html, /\.sales-progress-head\{min-height:48px[\s\S]*font-size:11px/);
  assert.match(html, /content:"Requested\\A Qty"/);
  assert.match(html, /content:"Committed\\A Qty"/);
  assert.match(html, /content:"Line Amount\\A \/ USD"/);
  const section = html.match(/<section id="order-progress"[\s\S]*?<section id="activity"/)?.[0] || '';
  assert.doesNotMatch(section, /tracking-edit|data-reduce-order|pencil/);
});

test('Sales Room matches the compact Buyer Room header and uses deeper progress pills', () => {
  assert.match(html, /\.top\{height:48px;padding:0 19px/);
  assert.match(html, /\.room-title\{height:32px[\s\S]*background:#203047/);
  assert.match(html, /class="sales-account"/);
  assert.match(html, /\.sales-progress-pill\{[\s\S]*background:#31577e;color:#fff/);
  assert.match(html, /\.sales-progress-pill\.s6\{background:#0e6749;color:#fff\}/);
});
