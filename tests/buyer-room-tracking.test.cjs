const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'buyer-room.html'), 'utf8');

test('Track Orders uses the six operational stages only', () => {
  assert.match(html, /const trackingStages=\['Request Sent','Order Confirmed','Processing','Goods Received','Repacking','Shipped On'\]/);
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
  assert.match(html, /2026-10-02-buyer-reduction-v84/);
  assert.match(html, /Reduce \/ Cancel Requested Qty/);
});
