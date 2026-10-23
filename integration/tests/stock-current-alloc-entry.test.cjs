const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),root=path.join(__dirname,'../prototypes/stock-current-state');
function fixture({planned=90,received=80,ownReceived=received,sources=[],allocated=80,current=true,batchId,batches,batchFacts,instructions=[],facts={usable:80,held:0,dispatched:0,availableToArrange:80,review:false}}={}){
  const controls=new Map(),container={innerHTML:'',querySelector(s){if(!controls.has(s))controls.set(s,{});return controls.get(s);}};
  const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'purchase-ui/borrow-approval.js'),'utf8'),{window});
  let opened=0,ready=true;const arranged=[];
  const workspace={stockCurrent:{schema:'PURCHASE_TRANSFERS_V2',stockProtocol:1,stockBuild:'TEST',generation:1,stockGeneration:1},stockAllocationView:current?'CURRENT_V2':undefined,allocations:[],tasks:[{id:'A',ord:100,stockActualReceived:ownReceived,stockArrangements:instructions,stockAllocatedCumulative:allocated,stockAllocationFacts:facts,stockAllocatedBatches:batches,stockBatchAllocationFacts:batchFacts,procurement:{customerCtn:planned},warehouse:{accepted:received}},...sources]};
  window.purchaseBorrowApproval.mountAllocation({container,workspace,rootId:'A',batchId,esc:String,canSubmit:()=>ready,showBorrow:()=>opened++,submitArrangement:input=>arranged.push(input)});
  return {container,controls,arranged,open:()=>opened,busy:()=>ready=false};
}
test('100 demand / 90 purchased / 80 received exposes borrowing while 10 unpurchased remains explicit',()=>{
  const f=fixture();assert.match(f.container.innerHTML,/Unpurchased 未采购 10/);assert.match(f.container.innerHTML,/Awaiting receipt 待到货 10/);
  f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),1);f.busy();f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),1);
});
test('fully received purchase does not authorize borrowing to cover unpurchased demand; unknown allocation cannot quote',()=>{
  for(const args of [{planned:80,received:80},{current:false}]){const f=fixture(args);f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),0);assert.match(f.container.innerHTML,/data-alloc-borrow disabled/);}
});
test('allocation dialog uses own customer receipts, not gross PO receipts including extra stock from another source',()=>{
  const f=fixture({planned:70,received:80,ownReceived:80,sources:[{id:'AS',customerDemandTaskId:'A',procurement:{customerCtn:20,totalCtn:20},warehouse:{accepted:10}}]});
  assert.match(f.container.innerHTML,/Purchased 采购 <b>90<\/b> · Received 实收 <b>80<\/b>/);
  assert.match(f.container.innerHTML,/Awaiting receipt 待到货 10/);f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),1);
});
test('missing or malformed own receipt facts cannot be replaced by gross receipts or become a false zero shortfall',()=>{
  for(const ownReceived of [null,-1,NaN,'80']){
    const f=fixture({ownReceived,received:0});f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),0);
    assert.match(f.container.innerHTML,/Received 实收 <b>Unconfirmed 尚未确认<\/b>/);
    assert.match(f.container.innerHTML,/Awaiting receipt 待到货 Unconfirmed 尚未确认/);
  }
});
test('actual ALLOC batch choice uses verified linked holds, not another batch80as this batch20occupied',()=>{
  const args={planned:100,received:100,allocated:100,batchId:'P|2',batches:[{id:'P|1',demand:80,allocated:80},{id:'P|2',demand:20,allocated:20}],
    facts:{usable:100,held:80,dispatched:0,availableToArrange:20,review:false},
    batchFacts:[{id:'P|2',demand:20,allocated:20,held:0,unscopedHeld:0,unscopedDispatched:0,availableToArrange:20,review:false}]};
  const f=fixture(args);assert.match(f.container.innerHTML,/2 Send 20 CTN/);assert.match(f.container.innerHTML,/本批可安排 <b>20<\/b> · Batch held 本批占用 0/);f.controls.get('[data-alloc-existing]').onclick();assert.equal(f.arranged[0].quantity,20);assert.equal(f.arranged[0].batchId,'P|2');
  const conservative=fixture({...args,batchFacts:undefined});conservative.controls.get('[data-alloc-existing]').onclick();assert.equal(conservative.arranged.length,0);
  for(const batchFacts of [null,[],[{...args.batchFacts[0],availableToArrange:21}]]){
    const bad=fixture({...args,batchFacts});bad.controls.get('[data-alloc-existing]').onclick();assert.equal(bad.arranged.length,0);assert.match(bad.container.innerHTML,/data-alloc-existing disabled/);
  }
});
test('existing quantity choice requests Support once through callback without simulating dispatch',()=>{
  const f=fixture();f.controls.get('[data-alloc-existing]').onclick();assert.match(f.controls.get('[data-alloc-message]').textContent,/不确认实物发货/);assert.equal(f.open(),0);
  assert.equal(f.arranged.length,1);assert.equal(f.arranged[0].quantity,80);assert.equal(f.arranged[0].expectedRevision,'');
  f.controls.get('[data-alloc-existing]').onclick();assert.equal(f.arranged.length,1);
});
test('cumulative allocated80cannot be offered again when shipped, held or unconfirmed',()=>{
  for(const facts of [undefined,{usable:0,held:0,dispatched:80,availableToArrange:0,review:false},
    {usable:80,held:80,dispatched:0,availableToArrange:0,review:false},{usable:80,held:0,dispatched:0,availableToArrange:80,review:true}]){
    const f=fixture({facts:facts??null});f.controls.get('[data-alloc-existing]').onclick();
    assert.match(f.container.innerHTML,/data-alloc-existing disabled/);assert.equal(f.controls.get('[data-alloc-message]')?.textContent,undefined);
  }
  const f=fixture({facts:{usable:80,held:50,dispatched:0,availableToArrange:30,review:false}});assert.match(f.container.innerHTML,/可安排 <b>30/);
});
test('active linked packing disables another instruction; terminal list reuses exact current revision and only remaining unheld quantity',()=>{
 const instruction={batchId:'',revision:'CURRENT',status:'LINKED',packingListId:'PACK',packingStatus:'PROCESSING',currentPlanned:60,currentLoaded:40,mayRequestAgain:false};
 const active=fixture({instructions:[instruction]});active.controls.get('[data-alloc-existing]').onclick();assert.equal(active.arranged.length,0);
 const completed=fixture({instructions:[{...instruction,packingStatus:'COMPLETED',mayRequestAgain:true}],facts:{usable:80,held:40,dispatched:0,availableToArrange:40,review:false}});
 completed.controls.get('[data-alloc-existing]').onclick();assert.equal(completed.arranged[0].quantity,40);assert.equal(completed.arranged[0].expectedRevision,'CURRENT');
 assert.match(completed.container.innerHTML,/Planned 计划 60/);assert.match(completed.container.innerHTML,/Loaded 已装柜 40/);
});
test('actual grid inserts one aligned ALLOC cell per row; receipts stay 80 when current allocation becomes 90',()=>{
  const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'purchase-ui/task-grid.js'),'utf8'),{window});
  const row={id:'A',customerId:'C',ord:100,barcode:'BAR',packing:'24x1',name:'Product',po:'PO-A',supplierId:'S',
    stockAllocatedCumulative:90,procurement:{totalCtn:90,customerCtn:90,revision:'P'},warehouse:{hasPhysicalReceipt:true,accepted:80}};
  const args={rows:[row],tasks:[row],customers:[{id:'C',shortName:'Customer'}],suppliers:[{id:'S'}],selected:new Set(),selectedSources:new Set(),
    expanded:new Set(),active:true,canMove:false,orders:[],age:()=>'',quantityCells:()=>'<td class="order-quantity">100 | 90</td><td class="received-quantity">80</td>',drafts:new Map(),riskDeal:()=>false,
    allocations:[],stockAllocationView:'CURRENT_V2'};
  const html=window.purchaseTaskGrid.render(args),first=html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/)[0];
  assert.equal((first.match(/<td\b/g)||[]).length,12);assert.match(first,/<td class="received-quantity">80<\/td><td class="allocated-quantity">90/);
  row.stockAllocatedCumulative=100;const full=window.purchaseTaskGrid.render(args).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(full,/data-current-allocation/);
  row.stockTransferOutstanding=true;assert.match(window.purchaseTaskGrid.render(args),/Links 关系/);
  delete row.stockAllocatedCumulative;assert.doesNotMatch(window.purchaseTaskGrid.render(args),/<td class="allocated-quantity">80/);
});
test('actual split grid never displays borrowed coverage as Warehouse RCV; both explicit zero receipt and allocated30remain visible',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'purchase-ui/task-grid.js'),'utf8'),{window});
 const row={id:'A',orderId:'O',customerId:'C',ord:100,barcode:'BAR',packing:'24x1',name:'Product',po:'PO-A',supplierId:'S',inc:30,
   stockAllocatedCumulative:30,stockActualReceived:0,stockHasReceipt:true,procurement:{totalCtn:100,customerCtn:100,revision:'P'},warehouse:{hasPhysicalReceipt:true,accepted:0},
   stockAllocatedBatches:[{id:'PLAN|1',demand:50,allocated:30},{id:'PLAN|2',demand:50,allocated:0}],stockReceiptBatches:[{id:'PLAN|1',received:0},{id:'PLAN|2',received:0}],
   batchEntitlements:[1,2].map((n)=>({id:'PLAN|'+n,quantity:50,metrics:{committed:50,received:n===1?30:0},sources:[{id:'A',quantity:50}]}))};
 const args={rows:[row],tasks:[row],customers:[{id:'C'}],suppliers:[{id:'S'}],selected:new Set(),selectedSources:new Set(),expanded:new Set(),active:true,canMove:false,orders:[],age:()=>'',
   quantityCells:r=>'<td class="order-quantity">100</td><td class="received-quantity">'+(r.sourcing?.hasReceipt?r.sourcing.receivedCtn:'')+'</td>',drafts:new Map(),riskDeal:()=>false,
   allocations:[],stockAllocationView:'CURRENT_V2',shipmentPlans:[{id:'PLAN',customerId:'C',orderId:'O',batches:[1,2].map(sequence=>({sequence,label:'Batch '+sequence,lines:[{taskId:'A',quantity:50}]}))}]};
 const split=window.purchaseTaskGrid.render(args).match(/<tr class="split-demand-row"[\s\S]*?<\/tr>/g);
 assert.equal(split.length,2);for(const html of split)assert.match(html,/<td class="received-quantity">0<\/td>/);
 assert.match(split[0],/<td class="allocated-quantity">30/);assert.match(split[1],/<td class="allocated-quantity">0/);
 row.warehouse=undefined;row.stockHasReceipt=false;args.shipmentPlans=[];
 const main=window.purchaseTaskGrid.render(args).match(/<tr\b[\s\S]*?<\/tr>/)[0];assert.match(main,/<td class="received-quantity"><\/td>/);assert.match(main,/<td class="allocated-quantity">30/);
});
