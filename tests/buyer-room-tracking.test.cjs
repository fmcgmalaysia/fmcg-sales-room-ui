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
  assert.match(html, /data-view="track"[\s\S]*?<svg[\s\S]*?<path[\s\S]*?<circle cx="6" cy="17\.5" r="2\.5"\/>[\s\S]*?<circle cx="17" cy="17\.5" r="2\.5"\/>[\s\S]*?Track Orders/);
});

test('Track Orders keeps submitted customer quantities locked', () => {
  assert.match(html, /function canReduceOrder\(order\)\{return false\}/);
  assert.match(html, /Transaction History/);
});

test('Track rows and headers use readable 11px typography', () => {
  assert.match(html, /\.tracking-row\{grid-template-columns:8% 25% 10% 6% 10% 6% 6% 9% 5% 5% 8% 2%;min-height:38px;color:#173557;font-size:11px/);
  assert.match(html, /\.tracking-head\{min-height:42px;background:#dce7f1!important;color:#173557;font-size:11px/);
  assert.match(html, /\.tracking-pending,\.tracking-delta,\.progress-pill\{font-size:11px\}/);
  assert.match(html, /\.tracking-head>div\{color:#173557!important;font-size:11px;font-weight:850!important\}/);
});

test('Track header fits operational columns into a compact desktop width', () => {
  assert.match(html, /\.tracking-grid\{min-width:1180px/);
  assert.match(html, /\.tracking-row\{grid-template-columns:8% 25% 10%/);
  assert.match(html, /\.tracking-row>div:nth-child\(n\+4\):nth-child\(-n\+11\)\{text-align:right\}/);
  assert.match(html, /<div>Descriptions<\/div><div>Packing Size<\/div>/);
});

test('Overall Progress uses percentage-filled numbered rings', () => {
  assert.match(html, /background:conic-gradient\(#12883e calc\(var\(--progress\)\*1%\),#e7eef4 0\)/);
  assert.match(html, /class="tracking-ring" style="--progress:\$\{percent\}"/);
  assert.match(html, /<span>\$\{index\+1\}<\/span>/);
  assert.match(html, /aria-label="\$\{esc\(label\)\} \$\{percent\}% completed"/);
  assert.doesNotMatch(html, /<strong>\$\{percent\}%<\/strong>/);
});

test('Track operational columns shift left and Updated stays aligned', () => {
  assert.match(html, /\.tracking-row\{grid-template-columns:8% 23% 8% 6% 10% 6% 6% 9% 5% 5% 9% 5%\}/);
  assert.match(html, /\.tracking-row>div:nth-child\(11\)\{padding-right:10px;text-align:right\}/);
  assert.match(html, /\.tracking-row>\.tracking-edit\{justify-self:start;margin-left:6px\}/);
});

test('Track progress pills use one consistent green status color', () => {
  assert.match(html, /\.progress-pill\.s1,\.progress-pill\.s2,\.progress-pill\.s3,\.progress-pill\.s4,\.progress-pill\.s5,\.progress-pill\.s6\{background:#12883e;color:#fff\}/);
});

test('Track row hover preserves the current neutral theme and restrained motion', () => {
  assert.match(html, /\.tracking-row:hover\{background:#f5f8fa!important;transform:none;box-shadow:none\}/);
  assert.match(html, /#trackRows \.tracking-row:hover \.tracking-edit\{background:#12883e;color:#fff/);
});

test('Track quantities use the confirmed Desk remainder, with unknown historical receiving left unknown', () => {
  const get=name=>html.slice(html.indexOf('function '+name+'('),html.indexOf('\n',html.indexOf('function '+name+'(')));
  const f=new Function(get('completedLineQty')+';'+get('customerReceivedQty')+';'+get('trackingCommittedQty')+';return trackingCommittedQty;')();
  assert.equal(f({activeQty:20,line:{splitBatch:{},loadedInvoicedQtyCtn:170}}),20);
  assert.equal(f({activeQty:0,line:{splitBatch:{}}}),0);
  assert.equal(f({line:{}}),null);
  assert.equal(f({line:{receivedQtyCtn:200,loadedInvoicedQtyCtn:170}}),30);
  assert.equal(f({line:{receivedQtyCtn:200,loadedInvoicedQtyCtn:200}}),0);
  assert.match(html,/amount=!completed&&qty===null\?null:qty\*ctn/);
  assert.match(html,/committedValue=rows\.reduce\(\(sum,row\)=>sum\+activeCommittedQty\(row\)\*num\(row\.line\.lockedPriceCtn\|\|row\.line\.lockedUnitPrice\),0\)/);
});
