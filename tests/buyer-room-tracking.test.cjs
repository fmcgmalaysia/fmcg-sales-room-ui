const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'buyer-room.html'), 'utf8');

test('Track Orders uses the six operational stages only', () => {
  assert.match(html, /const trackingStages=\['Request Sent','Order Confirmed','Processing','Goods Received','Repacking','Shipped'\]/);
  assert.doesNotMatch(html, /Full Payment/);
  assert.doesNotMatch(html, /fullPaymentAt/);
  assert.doesNotMatch(html, /paymentStatus/);
  assert.match(html, /\$\{stage\}\/6/);
});

test('Track Orders lays six stages out responsively', () => {
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(html, /max-width:1100px\)\{\.tracking-rail\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(html, /max-width:700px\)\{\.tracking-rail\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('Track Orders uses the lorry navigation icon', () => {
  assert.match(html, /data-view="track"[\s\S]*?<path d="M3 6h11v11H3zM14 10h4l3 3v4h-7zM17 10v4h4"\/>[\s\S]*?<circle cx="7" cy="18" r="2"\/>[\s\S]*?<circle cx="18" cy="18" r="2"\/>[\s\S]*?Track Orders/);
});

test('Track Orders build includes buyer-owned reductions', () => {
  assert.match(html, /2026-10-02-track-percent-flow-v88/);
  assert.match(html, /Reduce \/ Cancel Requested Qty/);
});

test('Track rows and headers use readable 11px typography', () => {
  assert.match(html, /\.tracking-row\{grid-template-columns:8% 25% 10% 6% 10% 6% 6% 9% 5% 5% 8% 2%;min-height:38px;color:#173557;font-size:11px/);
  assert.match(html, /\.tracking-head\{min-height:42px;background:#dce7f1!important;color:#173557;font-size:11px/);
  assert.match(html, /\.tracking-pending,\.tracking-delta,\.progress-pill\{font-size:11px\}/);
});

test('Track header fits operational columns into a compact desktop width', () => {
  assert.match(html, /\.tracking-grid\{min-width:1180px/);
  assert.match(html, /\.tracking-row\{grid-template-columns:8% 25% 10%/);
  assert.match(html, /\.tracking-row>div:nth-child\(n\+4\):nth-child\(-n\+11\)\{text-align:right\}/);
  assert.match(html, /<div>Descriptions<\/div><div>Packing Size<\/div>/);
});

test('Overall Progress uses percentage-filled numbered rings', () => {
  assert.match(html, /background:conic-gradient\(#14835f calc\(var\(--progress\)\*1%\),#e7eef4 0\)/);
  assert.match(html, /class="tracking-ring" style="--progress:\$\{percent\}"/);
  assert.match(html, /<span>\$\{index\+1\}<\/span>/);
});

test('Track values only count committed quantity in rows and dashboard totals', () => {
  assert.match(html, /amount=committed===null&&!completed\?null:qty\*ctn/);
  assert.match(html, /activeCommittedQty=row=>row\.committed===null\?0:Math\.max\(0,row\.committed-completedLineQty\(row\.line\)\)/);
  assert.match(html, /committedValue=rows\.reduce\(\(sum,row\)=>sum\+activeCommittedQty\(row\)\*num\(row\.line\.lockedPriceCtn\|\|row\.line\.lockedUnitPrice\),0\)/);
});
