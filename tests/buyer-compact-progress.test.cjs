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
  assert.match(head,/Est\. Shipment Date<\/span><b>—<\/b>/);
  assert.match(html,/track-barcode/);assert.match(html,/trackEditHistory/);
});
