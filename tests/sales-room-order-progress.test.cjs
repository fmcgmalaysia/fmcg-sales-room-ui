const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const backend = fs.readFileSync(path.resolve(__dirname, '..', 'sales-room', 'wix', 'onboarding.web.js'), 'utf8');

test('Sales Room includes a dedicated customer Order Progress page', () => {
  assert.match(html, /Sales Room build: 2026-10-02-customer-workspace-v56/);
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
  assert.match(html, /setProgressRefreshStateV54\(state\)/);
  assert.match(html, /state==='retry'\?'Retry Progress'/);
  assert.match(html, /No order data was changed/);
});

test('Order Progress mirrors the six Buyer Room fulfilment stages', () => {
  assert.match(html, /const salesProgressStages=\['Request Sent','Order Confirmed','Processing','Goods Received','Repacking','Shipped'\]/);
  assert.match(html, /background:conic-gradient\(#2b6cb0 calc\(var\(--progress\)\*1%\),#dce6ee 0\)/);
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

test('Sales direct progress view is compact and has no quantity edit control', () => {
  assert.match(html, /\.sales-progress-row\{grid-template-columns:7% 25% 8% 7% 10% 6% 6% 7% 5% 7% 12%\}/);
  assert.match(html, /\.sales-progress-head\{min-height:48px[\s\S]*font-size:11px/);
  assert.match(html, /content:"Requested\\A Qty"/);
  assert.match(html, /content:"Committed\\A Qty"/);
  assert.match(html, /content:"Line Amount\\A \/ USD"/);
  const section = html.match(/<section id="order-progress"[\s\S]*?<section id="activity"/)?.[0] || '';
  assert.doesNotMatch(section, /tracking-edit|data-reduce-order|pencil/);
});

test('Order Progress customer picker uses short names and active-line badges only', () => {
  assert.match(html, /id="progressCustomerMenu"/);
  assert.match(html, /Number\(customer\.activeOrderLineCount\)>0/);
  assert.match(html, /data-progress-customer/);
  assert.match(html, /customerDisplayName\(customer\)/);
  assert.match(html, /progress-customer-menu button b/);
  assert.match(html, /Direct Wix order data/);
});

test('Sales Room matches the compact Buyer Room header and uses deeper progress pills', () => {
  assert.match(html, /\.top\{height:48px;padding:0 19px/);
  assert.match(html, /\.room-title\{height:32px[\s\S]*background:#203047/);
  assert.match(html, /class="sales-account"/);
  assert.match(html, /\.sales-progress-pill\{[\s\S]*background:#31577e;color:#fff/);
  assert.match(html, /\.sales-progress-pill\.s6\{background:#174a84;color:#fff\}/);
});

test('New Customer requires a short name and the customer workspace is a one-page blue modal', () => {
  assert.match(html, /name="customerShortName" required minlength="2" maxlength="24"/);
  assert.match(html, /class="detail-card customer-drawer customer-profile-modal"/);
  assert.match(html, /class="customer-profile-grid"/);
  assert.match(html, /<h3>Company<\/h3>/);
  assert.match(html, /<h3>Operations<\/h3>/);
  assert.match(html, /<h3>Contact &amp; Delivery<\/h3>/);
  assert.match(html, /backdrop-filter:blur\(7px\)/);
  assert.match(html, /\.customer-profile-modal \.tag\.green\{background:#e5eef9;color:#185abd\}/);
});

test('Sales Room progress is loaded directly from Wix orders instead of a Buyer Room projection', () => {
  assert.match(backend, /export const getSalesRoomOrderProgress = webMethod/);
  assert.match(backend, /readAllPayloadRows\(BUYER_ORDER_COLLECTION\)/);
  assert.match(backend, /readAllPayloadRows\(BUYER_LINE_COLLECTION\)/);
  assert.match(backend, /activeLineCount: orders\.reduce/);
  assert.match(backend, /customerShortName: upper\(customer\.customerShortName\)/);
});

test('Customer short names are validated, stored and returned by the backend', () => {
  assert.match(backend, /customerShortName: validateCustomerShortName\(raw\.customerShortName\)/);
  assert.match(backend, /CUSTOMER SHORT NAME must contain 2 to 24 characters/);
  assert.match(backend, /\.eq\('customerShortName', customer\.customerShortName\)/);
  assert.match(backend, /customerShortName: customer\.customerShortName/);
});
