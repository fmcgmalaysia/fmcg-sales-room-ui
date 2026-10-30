const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../../support-room/workroom.js'),source=fs.readFileSync(file,'utf8');
const code=source.slice(source.indexOf('  function quantityTotals('),source.indexOf('  function deskHeader('));
const context={number:(value,places)=>Number.isFinite(value)?value.toFixed(places):'—'};vm.runInNewContext(code,context);
const line=(extra={})=>({taskId:'T',currency:'USD',allocQty:200,loadedQty:180,priceCtn:50,cbm:.02,...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
test('200 allocated and 180 loaded have independent amount and volume without mutating a task',()=>{
 const lines=[line()],before=JSON.stringify(lines);
 assert.deepEqual(plain(context.quantityTotals(lines,'allocQty')),{qty:200,amount:10000,cbm:4});
 assert.deepEqual(plain(context.quantityTotals(lines,'loadedQty')),{qty:180,amount:9000,cbm:3.6});assert.equal(JSON.stringify(lines),before);
});
test('unloaded task retains planning values while actual confirmed zero remains zero',()=>{const lines=[line({loadedQty:0})];assert.equal(context.quantityTotals(lines,'allocQty').amount,10000);assert.deepEqual(plain(context.quantityTotals(lines,'loadedQty')),{qty:0,amount:0,cbm:0});});
test('unknown loading is incomplete, not zero or planned quantity',()=>{const lines=[line({loadedQty:null})];assert.deepEqual(plain(context.quantityTotals(lines,'loadedQty')),{qty:null,amount:null,cbm:null});assert.equal(context.quantityTotals(lines,'allocQty').qty,200);});
test('missing CBM in a positive quantity makes its whole total incomplete',()=>{const rows=[line(),line({cbm:null,loadedQty:0})];assert.equal(context.quantityTotals(rows,'allocQty').cbm,null);assert.equal(context.quantityTotals(rows,'loadedQty').cbm,3.6);rows[1].loadedQty=1;assert.equal(context.quantityTotals(rows,'loadedQty').cbm,null);});
test('missing price cannot silently become zero; known zero price remains zero',()=>{assert.equal(context.quantityTotals([line({priceCtn:null})],'allocQty').amount,null);assert.equal(context.quantityTotals([line({priceCtn:0})],'allocQty').amount,0);});
test('zero quantity with unavailable numeric metadata remains a genuine zero',()=>{assert.deepEqual(plain(context.quantityTotals([line({loadedQty:0,cbm:Infinity,priceCtn:Infinity})],'loadedQty')),{qty:0,cbm:0,amount:0});});
test('mixed or missing currencies never produce a fabricated single-currency total',()=>{for(const currency of ['MYR',null,''])assert.equal(context.quantityTotals([line(),line({currency})],'allocQty').amount,null);});
test('totals sum rounded line amounts to match invoice convention',()=>{const rows=[line({allocQty:1,priceCtn:1.005}),line({allocQty:1,priceCtn:1.005})];assert.equal(context.quantityTotals(rows,'allocQty').amount,rows.reduce((n,r)=>n+Math.round(r.allocQty*r.priceCtn*100),0)/100);});
test('invalid quantities are incomplete and cannot reduce totals',()=>{for(const allocQty of [-1,NaN,Infinity,undefined,'200'])assert.deepEqual(plain(context.quantityTotals([line({allocQty})],'allocQty')),{qty:null,amount:null,cbm:null});});
test('the compact display labels both bases and retains zero and missing distinctions',()=>{const html=context.quantityPair(10000,0,2,'USD');assert.match(html,/Planned/);assert.match(html,/Loaded/);assert.match(html,/10000\.00/);assert.match(html,/>0\.00 /);assert.match(context.quantityPair(null,null,3),/Incomplete/);});
test('frozen invoice displays its actual invoice basis, never a fabricated historical plan',()=>{const html=context.quantityPair(10000,9000,2,'USD',true);assert.match(html,/Invoiced/);assert.match(html,/9000\.00/);assert.doesNotMatch(html,/Planned|Loaded|10000/);});
test('actual header uses authoritative frozen invoice amount and does not net manual deposit',()=>{
 const stub={...context,deskLock:()=>null,currentDeskInvoice:()=>({number:'INV',id:'INV',amountCents:123456}),deskState:()=>({shipments:[]}),deskReferences:()=>({depositAmountCents:10000,depositCurrency:'USD'}),deskPending:()=>false,invoiceAttempts:new Map(),company:'NCT',activeDesk:1,data:{deskMetadataVersion:2,delivery:{deskDeliveryVersion:2}},deskBusy:false,esc:x=>String(x??''),countryLabel:x=>x,day:()=>'',transportLabel:()=>'',headerDocuments:()=>''};
 vm.runInNewContext(source.slice(source.indexOf('  function deskHeader('),source.indexOf('  function orderContent(')),stub);
 const html=stub.deskHeader({id:'O',customerName:'Sample',currency:'USD'},[line()]);assert.match(html,/1234\.56/);assert.doesNotMatch(html,/1134\.56|10000\.00|Planned/);
});
test('actual task renderer shows planned and loaded values and preserves original controls',()=>{
 const stub={...context,currentDeskInvoice:()=>null,viewLines:o=>o.lines,$:()=>({}),deskHeader:()=>'',data:{deskLocks:[],deskAvailable:true,deskMetadataVersion:2},selectedCustomer:'C',deskBusy:false,deskPending:()=>false,invoiceBusy:false,invoiceAttempts:new Map(),company:'NCT',taskDesk:()=>1,deskLock:()=>false,esc:x=>String(x??''),day:x=>x,window:{},table:(_h,rows)=>rows.join('')};
 vm.runInNewContext(source.slice(source.indexOf('  function orderContent('),source.indexOf('  function render(){')),stub);const html=stub.orderContent({id:'O',lines:[line()]});assert.match(html,/10000\.00/);assert.match(html,/9000\.00/);assert.match(html,/4\.000/);assert.match(html,/3\.600/);assert.match(html,/data-desk-task/);assert.match(html,/data-drag-task/);
});
