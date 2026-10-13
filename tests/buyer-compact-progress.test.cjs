const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','buyer-room.html'),'utf8');
const context=vm.createContext({trackingStages:['Request Sent','Order Confirmed','Processing','Goods Received','Repacking','Shipped'],committedLineQty:line=>line.committedQtyCtn??null,effectiveRequestedQty:line=>line.quantityCtn,num:v=>Number(v)||0,esc:v=>String(v).replaceAll('<','&lt;').replaceAll('"','&quot;')});
vm.runInContext(html.slice(html.indexOf('function trackingDots('),html.indexOf('function trackingLineHtml(')),context);
test('partial receipt is never displayed as fully received; completed and pending dots stay independent',()=>{
  const partial=context.trackingDots({}, {quantityCtn:200,committedQtyCtn:200,receivedQtyCtn:90},3);
  assert.equal((partial.match(/<button /g)||[]).length,6);
  assert.equal((partial.match(/class="tracking-dot complete"/g)||[]).length,3);
  assert.equal((partial.match(/class="tracking-dot partial"/g)||[]).length,1);
  assert.match(partial,/Goods Received · Partially received/);
  const complete=context.trackingDots({}, {quantityCtn:200,committedQtyCtn:190,receivedQtyCtn:190},4);
  assert.equal((complete.match(/class="tracking-dot complete"/g)||[]).length,4);
  assert.doesNotMatch(complete,/class="tracking-dot partial"/);
  const empty=context.trackingDots({}, {quantityCtn:200,receivedQtyCtn:0},1);
  assert.equal((empty.match(/class="tracking-dot complete"/g)||[]).length,1);
});
test('only current task layout removes Barcode and Updated; existing history and receipt behaviour remains available',()=>{
  const head=html.slice(html.indexOf('<section id="trackView"'),html.indexOf('<div id="trackRows"'));
  assert.match(head,/<div>Order On<\/div><div class="center">Progress<\/div><div class="center">Image<\/div><div>Descriptions<\/div>/);
  assert.doesNotMatch(head,/>Barcode<|Qty Updated|Latest progress from Master|\$\{done\} \/ \$\{total\}/);
  assert.match(head,/Est\. Shipment Date<\/span><b id="trackShipmentDate">—<\/b>/);
  assert.match(html,/track-barcode/);assert.match(html,/trackEditHistory/);
});
test('customer quantity comes only from assigned warehouse receipts and excludes completed history',()=>{
  const ctx=vm.createContext({Number,Math,completedLineQty:line=>line.completedQtyCtn||0});
  vm.runInContext(html.slice(html.indexOf('function customerReceivedQty('),html.indexOf('function trackingDots(')),ctx);
  assert.equal(ctx.customerReceivedQty({committedQtyCtn:200,receivedQtyCtn:90}),90);
  assert.equal(ctx.customerReceivedQty({committedQtyCtn:200}),null);
  assert.equal(ctx.customerReceivedQty({committedQtyCtn:200,receivedQtyCtn:0}),0);
  assert.equal(ctx.customerReceivedQty({receivedQtyCtn:350,completedQtyCtn:300}),50);
  const active=html.slice(html.indexOf('if(!completed)return `<div class="tracking-row'),html.indexOf(';return `<div class="tracking-row',html.indexOf('function trackingLineHtml(')));
  assert.doesNotMatch(active,/tracking-delta|tracking-qty-change|Received \/ 已收|\| \$\{line\.receivedQtyCtn/);
  assert.match(active,/qty===null\?'—':qty\.toLocaleString/);
  assert.match(html,/activeCommittedQty=row=>customerReceivedQty\(row.line\)\?\?0/);
});
test('numbered larger progress dots and Track images reuse the original My Selection hover handler',()=>{
  assert.match(html,/<span aria-hidden="true">\$\{index\+1\}<\/span>/);
  assert.match(html,/flex-basis:18px;width:18px;height:18px/);
  const active=html.slice(html.indexOf('if(!completed)return `<div class="tracking-row'),html.indexOf(';return `<div class="tracking-row',html.indexOf('function trackingLineHtml(')));
  assert.match(active,/\|\|line,true\)/);
  assert.match(html,/bindImagePreview\(\);document.querySelectorAll\('\[data-reduce-order\]'/);
});
