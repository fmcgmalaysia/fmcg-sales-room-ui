const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const release=require('../prototypes/purchase-etd-requested-20261031/stage.cjs').plan(),source=release.assets.get('purchase-live/app.js').toString(),before=release.baseline.get('purchase-live/app.js').toString();
const time=source.split('\n').find(line=>line.includes('const shortTime ='));
const begin=source.indexOf('  function purchaseCreatedAge('),end=source.indexOf('  function requestQuote(',begin),current=source.slice(source.indexOf('  function purchaseCurrentDocuments('),begin);
const api=vm.runInNewContext('(()=>{'+time+current+source.slice(begin,end)+';return {age:purchaseCreatedAge,payment:purchasePaymentCell};})()',{esc:String});
test('Created On uses Kuala Lumpur calendar days across UTC midnight, month and year boundaries',()=>{
 const now=Date.parse('2026-10-31T00:30:00Z');
 assert.equal(api.age('2026-10-30T17:00:00Z',now),'Today');assert.equal(api.age('2026-10-30T15:59:00Z',now),'Yesterday');assert.equal(api.age('2026-10-29T00:30:00Z',now),'2 Days Ago');
 assert.equal(api.age('2026-12-31T15:59:00Z',Date.parse('2026-12-31T16:01:00Z')),'Yesterday');
 assert.equal(api.age('',now),'');assert.equal(api.age('invalid',now),'');assert.equal(api.age('2026-11-01T00:00:00Z',now),'');
});
test('Requested uses the real submission time, outside the original clickable request control',()=>{
 const row={id:'P',number:'PO',createdAt:'2026-01-01T00:00:00Z',procurementHandoff:{submitted:true,submission:{at:'2026-10-30T17:12:00Z'}}},saved=JSON.stringify(row),html=api.payment(row);
 assert.match(html,/>Requested<\/button><small class="po-requested-time">31-10-26T 01:12<\/small>/);
 assert.match(html,/data-po-request="P"/);assert.doesNotMatch(html,/<small[^>]*(?:data-|onclick|tabindex)|<a/);assert.equal(JSON.stringify(row),saved);
});
test('missing legacy submission time is not fabricated from PO creation; invalid time is omitted',()=>{
 for(const at of [undefined,'invalid']){const html=api.payment({id:'P',number:'PO',createdAt:'2026-10-31T00:00:00Z',procurementHandoff:{submitted:true,submission:{at}}});assert.match(html,/>Requested<\/button>/);assert.doesNotMatch(html,/po-requested-time/);}
});
test('eligibility remains unchanged: missing or superseded documents never become Requested',()=>{
 for(const documents of [[],[{type:'PO',linked:true,fileId:'p'}],[{type:'PO',linked:true,fileId:'p',superseded:true},{type:'PI',linked:true,fileId:'i'}]])assert.match(api.payment({id:'P',documents}),/Not eligible/);
 const html=api.payment({id:'P',number:'PO',documents:[{type:'PO',linked:true,fileId:'p'},{type:'PI',linked:true,fileId:'i'}]});assert.match(html,/data-po-request="P"/);assert.doesNotMatch(html,/Requested|po-requested-time/);
});
test('ETD relabels the existing customer shipment values without changing source fields or date rendering',()=>{
 const start=source.indexOf('  function purchaseFor('),stop=source.indexOf('  function purchaseDocumentIssues(',start);
 const f=vm.runInNewContext('('+source.slice(start,stop).trim()+')',{data:{customers:[{id:'C',shortName:'CUSTOMER'}]},window:{purchaseDashboard:{formatShipmentDate:v=>v}},esc:String});
 const row={customerId:'C',shipmentDates:[{customerId:'C',date:'2026-11-18'}]},saved=JSON.stringify(row);assert.match(f(row),/ETD: 2026-11-18/);assert.equal(JSON.stringify(row),saved);
 const grid=release.assets.get('purchase-live/task-grid.js').toString();assert.match(grid,/ETD: /);assert.doesNotMatch(grid,/">ETA: /);assert.match(grid,/shipmentDate\(row.estimatedShipmentDate/);
});
test('request dialogs, payment mutations, event handlers and document state rendering are unchanged',()=>{
 const tail='  function purchaseOrderDialog(';assert.equal(source.slice(source.indexOf(tail)),before.slice(before.indexOf(tail)));
 const from='  function purchaseDocumentIssues(',to='  function purchasePaymentCell(';assert.equal(source.slice(source.indexOf(from),source.indexOf('  function purchaseCreatedAge(')),before.slice(before.indexOf(from),before.indexOf(to)));
});
test('only four Purchase presentation assets change and every other resource remains exact',()=>{
 assert.equal(release.assets.size,98);assert.equal(release.changed.length,4);
 for(const[file,b]of release.assets){if(!release.changed.includes(file))assert.ok(b.equals(release.baseline.get(file)),file);if(file.endsWith('.js'))new vm.Script(b.toString(),{filename:file});}
 for(const file of ['master-shared/desk-delivery.js','purchase-live/task-info.js','purchase-live/customer-allocation.js','account-room/app.js'])assert.ok(release.assets.get(file).equals(release.baseline.get(file)),file);
 const css=release.assets.get('purchase-live/style.css').toString();assert.match(css,/po-requested-capsule\{[^}]*height:22px/);
});
test('scoped upload excludes generic publication and Wix differs by one version token only',()=>{
 const root=path.resolve(__dirname,'../..'),cp=require('node:child_process'),file='integration/wix/purchase-room-page.js';
 const original=cp.execFileSync('git',['show','6d758c7:'+file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'),after=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
 assert.equal(after,original.replace('20261031-purchase-receipt-info-v2',release.build));
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/pages-v64-same-origin.yml'),'utf8');assert.match(workflow,/inputs.static_ui != 'purchase-etd-requested-only'/);assert.equal((workflow.match(/inputs.static_ui == 'purchase-etd-requested-only'/g)||[]).length,2);
});
