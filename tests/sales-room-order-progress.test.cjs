const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('Sales Room includes a dedicated customer Order Progress page', () => {
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
  assert.match(html, /\.sales-progress-row\{display:grid;grid-template-columns:7% 20% 8% 7% 10% 7% 7% 9% 6% 7% 12%/);
  assert.match(html, /\.sales-progress-head\{min-height:48px[\s\S]*font-size:11px/);
  const section = html.match(/<section id="order-progress"[\s\S]*?<section id="activity"/)?.[0] || '';
  assert.doesNotMatch(section, /tracking-edit|data-reduce-order|pencil/);
});
