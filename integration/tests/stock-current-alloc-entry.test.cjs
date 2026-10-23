const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),root=path.join(__dirname,'../prototypes/stock-current-state');
function fixture({planned=90,received=80,allocated=80,current=true,facts={usable:80,held:0,dispatched:0,availableToArrange:80,review:false}}={}){
  const controls=new Map(),container={innerHTML:'',querySelector(s){if(!controls.has(s))controls.set(s,{});return controls.get(s);}};
  const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'purchase-ui/borrow-approval.js'),'utf8'),{window});
  let opened=0,ready=true;const arranged=[];
  const workspace={stockCurrent:{schema:'PURCHASE_TRANSFERS_V2',stockProtocol:1,stockBuild:'TEST',generation:1,stockGeneration:1},stockAllocationView:current?'CURRENT_V2':undefined,allocations:[],tasks:[{id:'A',ord:100,stockArrangements:[],stockAllocatedCumulative:allocated,stockAllocationFacts:facts,procurement:{customerCtn:planned},warehouse:{accepted:received}}]};
  window.purchaseBorrowApproval.mountAllocation({container,workspace,rootId:'A',esc:String,canSubmit:()=>ready,showBorrow:()=>opened++,submitArrangement:input=>arranged.push(input)});
  return {container,controls,arranged,open:()=>opened,busy:()=>ready=false};
}
test('100 demand / 90 purchased / 80 received exposes borrowing while 10 unpurchased remains explicit',()=>{
  const f=fixture();assert.match(f.container.innerHTML,/Unpurchased 未采购 10/);assert.match(f.container.innerHTML,/Awaiting receipt 待到货 10/);
  f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),1);f.busy();f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),1);
});
test('fully received purchase does not authorize borrowing to cover unpurchased demand; unknown allocation cannot quote',()=>{
  for(const args of [{planned:80,received:80},{current:false}]){const f=fixture(args);f.controls.get('[data-alloc-borrow]').onclick();assert.equal(f.open(),0);assert.match(f.container.innerHTML,/data-alloc-borrow disabled/);}
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
