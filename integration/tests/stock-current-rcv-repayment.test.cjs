const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createPurchaseTransferWorkspace}=require('../prototypes/stock-current-state/purchase-transfer-workspace.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=x=>JSON.parse(JSON.stringify(x));
function workspaceFixture(company='NCT'){
 const workspace={company,stockAllocationView:'CURRENT_V2',tasks:[{id:'A',archived:true,ord:100,stockActualReceived:80,stockAllocatedCumulative:90},
  {id:'B'},{id:'C'},{id:'SA',customerDemandTaskId:'A'}]},control={company,mode:'ACTIVE',generation:8,writerBuild:'TEST',transferIndexVersion:2};
 const relations=[{id:'R1',borrowerTaskId:'A',lenderTaskId:'B',lenderSourceId:'SB',replacementSourceId:'SA',quantity:10,repaid:3,returned:2},
  {id:'R2',borrowerTaskId:'A',lenderTaskId:'C',lenderSourceId:'SC',replacementSourceId:'SA',quantity:7,repaid:1,returned:0},
  {id:'R3',borrowerTaskId:'B',lenderTaskId:'A',lenderSourceId:'SA',replacementSourceId:'SB',quantity:4,repaid:0,returned:0}];
 let calls=0;
 const deps={company,authenticate:async()=>({memberId:'M',staffId:'P'}),protocol:{readSnapshot:async fn=>({rows:await fn(control),generation:8})},readWorkspace:async()=>workspace,
  readOutstanding:async(c,input)=>{calls++;const offset=input.cursor?.offset||0,items=relations.slice(offset,offset+50);return {schema:'CURRENT_BORROW_RELATIONS_V1',company:c,
   view:'OUTSTANDING',generation:8,version:'a'.repeat(32),offset,total:relations.length,items,nextCursor:offset+items.length<relations.length?{offset:offset+items.length,version:'a'.repeat(32)}:null};}};
 return {workspace,relations,deps,read:()=>createPurchaseTransferWorkspace(deps)(company),calls:()=>calls};
}
test('same complete relation snapshot supplies borrower-only remaining debt for both companies without changing receipt/allocation or archived identity',async()=>{
 for(const company of ['NCT','GHR']){const f=workspaceFixture(company),before=copy(f.workspace),result=await f.read(),a=result.tasks.find(t=>t.id==='A');
  assert.equal(a.stockBorrowedOutstanding,11);assert.equal(result.tasks.find(t=>t.id==='B').stockBorrowedOutstanding,4);
  assert.equal(result.tasks.find(t=>t.id==='C').stockBorrowedOutstanding,0);assert.equal(result.tasks.find(t=>t.id==='SA').stockBorrowedOutstanding,0);
  assert.equal(a.stockActualReceived,80);assert.equal(a.stockAllocatedCumulative,90);assert.equal(a.archived,true);assert.deepEqual(f.workspace,before);
  f.relations.length=0;assert.equal((await f.read()).tasks.find(t=>t.id==='A').stockBorrowedOutstanding,0);
 }
});
test('repayment total requires every relation page and never uses a partial first-page total',async()=>{
 const f=workspaceFixture(),r=f.relations[0];f.relations.splice(0,f.relations.length,...Array.from({length:51},(_,i)=>({...r,id:'R'+i,quantity:2,repaid:1,returned:0})));
 const result=await f.read();assert.equal(f.calls(),2);assert.equal(result.tasks[0].stockBorrowedOutstanding,51);
 const g=workspaceFixture();g.deps.readOutstanding=async()=>({schema:'CURRENT_BORROW_RELATIONS_V1',company:'NCT',view:'OUTSTANDING',generation:8,
  version:'a'.repeat(32),offset:0,total:2,items:[g.relations[0]],nextCursor:null});await assert.rejects(g.read(),/Complete current|incomplete/);
});
test('inconsistent remaining, self relation and overflowing repayment sum fail instead of publishing a false owed quantity',async()=>{
 for(const kind of ['remaining','self','overflow']){const f=workspaceFixture();if(kind==='remaining')f.relations[0].remaining=999;
  if(kind==='self')f.relations[0].lenderTaskId='A';if(kind==='overflow')for(const r of f.relations.slice(0,2))Object.assign(r,{quantity:Number.MAX_SAFE_INTEGER,repaid:0,returned:0});
  await assert.rejects(f.read(),/outstanding|repayment|quantity/i);
 }
});
test('repayment aggregation adds exact remainders without an unsafe quantity-before-repayment intermediate',async()=>{
 const f=workspaceFixture();f.relations.splice(2);Object.assign(f.relations[0],{quantity:Number.MAX_SAFE_INTEGER-1,repaid:0,returned:0});
 Object.assign(f.relations[1],{quantity:Number.MAX_SAFE_INTEGER,repaid:Number.MAX_SAFE_INTEGER-1,returned:0});
 assert.equal((await f.read()).tasks[0].stockBorrowedOutstanding,Number.MAX_SAFE_INTEGER);
});
function gridFixture({owed=10,current=true,split=false}={}){
 const window={};vm.runInNewContext(fs.readFileSync(path.join(folder,'purchase-ui/task-grid.js'),'utf8'),{window});
 const row={id:'A',orderId:'O',customerId:'C',ord:100,barcode:'BAR',packing:'24x1',name:'Product',po:'PO-A',supplierId:'S',inc:90,
  stockActualReceived:80,stockHasReceipt:true,stockAllocatedCumulative:90,stockBorrowedOutstanding:owed,stockTransferOutstanding:true,
  procurement:{totalCtn:90,customerCtn:90,revision:'P'},warehouse:{hasPhysicalReceipt:true,accepted:80},
  stockAllocatedBatches:[{id:'PLAN|1',demand:50,allocated:50},{id:'PLAN|2',demand:50,allocated:40}],
  stockReceiptBatches:[{id:'PLAN|1',received:50},{id:'PLAN|2',received:30}],batchEntitlements:[1,2].map(n=>({id:'PLAN|'+n,quantity:50,
   metrics:{committed:50,received:n===1?50:40},sources:[{id:'A',quantity:n===1?50:40}]}))};
 const args={rows:[row],tasks:[row],customers:[{id:'C'}],suppliers:[{id:'S'}],selected:new Set(),selectedSources:new Set(),expanded:new Set(),active:true,canMove:false,orders:[],age:()=>'',
  quantityCells:r=>'<td class="order-quantity">100 | 90</td><td class="received-quantity"><span class="quantity-reference">'+(r.sourcing?.receivedCtn??r.warehouse?.accepted??'')+'</span></td>',
  drafts:new Map(),riskDeal:()=>false,allocations:[],stockAllocationView:current?'CURRENT_V2':undefined,
  shipmentPlans:split?[{id:'PLAN',customerId:'C',orderId:'O',batches:[1,2].map(sequence=>({sequence,label:'Batch '+sequence,lines:[{taskId:'A',quantity:50}]}))}]:[]};
 return {row,args,render:()=>window.purchaseTaskGrid.render(args)};
}
test('main RCV shows actual80and separate read-only owed10 while ALLOC stays90; partial repayment decreases only owed badge',()=>{
 const f=gridFixture(),before=copy(f.row);let html=f.render();const rcv=html.match(/<td class="received-quantity[^\"]*">[\s\S]*?<\/td>/)[0];
 assert.match(rcv,/>80<\/span>/);assert.match(rcv,/class="borrow-repay-status"[^>]*>10<\/span>/);assert.doesNotMatch(rcv,/<button/);
 assert.match(rcv,/To repay 待补回 10 CTN/);assert.match(html,/<td class="allocated-quantity">90/);assert.deepEqual(f.row,before);
 f.row.stockBorrowedOutstanding=4;html=f.render();assert.match(html,/class="borrow-repay-status"[^>]*>4<\/span>/);assert.match(html,/>80<\/span>/);
 f.row.stockBorrowedOutstanding=0;html=f.render();assert.doesNotMatch(html,/class="borrow-repay-status"/);assert.match(html,/>80<\/span>/);assert.match(html,/<td class="allocated-quantity">90/);
});
test('split rows show whole-line debt once, never duplicate10on every batch or invent per-batch receipt',()=>{
 const f=gridFixture({split:true}),html=f.render();assert.equal((html.match(/class="borrow-repay-status"/g)||[]).length,1);
 assert.match(html,/Whole line owed 整行待补回 10 CTN/);assert.match(html,/<td class="received-quantity">50[\s\S]*?<\/td>/);assert.match(html,/<td class="received-quantity">30<\/td>/);
 assert.equal(f.row.stockActualReceived,80);assert.equal(f.row.stockBorrowedOutstanding,10);
});
test('unknown repayment is not false0, while legacy grid never displays candidate debt fields',()=>{
 for(const owed of [undefined,null,-1,'10']){const f=gridFixture({owed});if(owed===undefined)delete f.row.stockBorrowedOutstanding;
  const html=f.render();assert.doesNotMatch(html,/class="borrow-repay-status"/);assert.match(html,/Borrowing repayment unconfirmed 待补回尚未确认/);
 }
 assert.doesNotMatch(gridFixture({current:false}).render(),/borrow-repay-status|待补回尚未确认/);
});
test('read-only repayment statuses use pale red with dark text and do not introduce a receipt-editing control',()=>{
 const css=fs.readFileSync(path.join(folder,'purchase-ui/borrow-approval.css'),'utf8');assert.match(css,/\.borrow-repay-status[^}]*background:#FEE2E2[^}]*color:#991B1B/);
 assert.match(css,/\.has-borrow-repay[^}]*span\.quantity-reference[^}]*background:#FEE2E2/);
});
