const test=require('node:test'),assert=require('node:assert/strict');
const {attachBatchAvailability}=require('../prototypes/stock-current-state/purchase-batch-availability.cjs');
const {prepareArrangement,linkArrangement,arrangementLimit}=require('../prototypes/stock-current-state/purchase-arrangement.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const load=require('./load-master-module.cjs'),{packingHeld}=load('packingListModel.js'),{readPackingLists}=load('packingListOperations.js');
function fixture(batchId='P|1'){
 const staff={memberId:'M',staffId:'P',staffName:'Purchaser'},task={id:'A',customerId:'C',orderId:'O',stockAllocatedCumulative:100,
  stockAllocationFacts:{usable:100,held:0,dispatched:0,availableToArrange:100,review:false},
  stockAllocatedBatches:[{id:'P|1',demand:80,allocated:80},{id:'P|2',demand:20,allocated:20}]};
 const workspace={company:'NCT',stockAllocationView:'CURRENT_V2',staff,tasks:[task]},at='2026-10-24T02:00:00.000Z';
 const before={...prepareArrangement({company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111',
  input:{taskId:'A',batchId,quantity:80,expectedRevision:'',reason:'First batch'},workspace,before:null,at}).writes[0].after,_version:'V1'};
 const list={id:'PACK1',company:'NCT',customerId:'C',currency:'USD',revision:'PV1',status:'DRAFT',lines:[{taskId:'A',quantity:80,packed:0,loaded:0}]};
 const linkPlan=linkArrangement({company:'NCT',before,reference:{taskId:'A',batchId,revision:before.details.revision},list,
  staff:{...staff,packingDepartment:'SUPPORT'},requestId:'22222222-2222-4222-8222-222222222222',at}),linked=linkPlan.writes[0].after;
 const record={_id:hash('NCT','PACK1','PACKING_CURRENT'),title:hash('NCT','PACK1','PACKING_CURRENT'),description:'PACK1',company:'NCT',action:'SUPPORT_PACKING_LIST_CURRENT',details:{list}};
 const activity=[linked,record,linkPlan.writes[1].after],args={company:'NCT',workspace,activity,readPackingLists,packingHeld};
 return{task,workspace,activity,list,record,linked,args,read:()=>attachBatchAvailability(args)};
}
test('actual linked first batch hold80does not falsely consume the second confirmed batch20; DRAFT still holds zero',()=>{
 const f=fixture();f.read();assert.equal(arrangementLimit(f.task,'P|2'),20);
 f.list.status='SENT';f.task.stockAllocationFacts.held=80;f.task.stockAllocationFacts.availableToArrange=20;f.read();
 assert.equal(f.task.stockBatchAllocationFacts[0].held,80);assert.equal(arrangementLimit(f.task,'P|1'),0);assert.equal(arrangementLimit(f.task,'P|2'),20);
 const command=prepareArrangement({company:'NCT',staff:f.workspace.staff,requestId:'33333333-3333-4333-8333-333333333333',
  input:{taskId:'A',batchId:'P|2',quantity:20,expectedRevision:'',reason:'Second batch available stock'},workspace:f.workspace,before:null,at:'2026-10-24T03:00:00.000Z'});
 assert.equal(command.writes[0].after.details.batchId,'P|2');assert.equal(command.writes[0].after.details.quantity,20);
 assert.equal(f.list.lines[0].quantity,80);assert.equal(f.task.stockAllocatedCumulative,100);
});
test('pending change reserves the original or larger proposed hold; COMPLETED retains only Loaded using original packingHeld',()=>{
 const f=fixture();f.list.status='PROCESSING';f.list.change={lines:[{taskId:'A',quantity:90,packed:0,loaded:0}],reason:'Increase'};
 f.task.stockAllocationFacts.held=90;f.task.stockAllocationFacts.availableToArrange=10;f.read();assert.equal(arrangementLimit(f.task,'P|2'),10);
 delete f.list.change;f.list.status='COMPLETED';f.list.lines[0].packed=40;f.list.lines[0].loaded=40;
 f.task.stockAllocationFacts.held=40;f.task.stockAllocationFacts.availableToArrange=60;f.read();
 assert.equal(arrangementLimit(f.task,'P|1'),40);assert.equal(arrangementLimit(f.task,'P|2'),20);
});
test('unlinked, whole-task and replaced Sales batch identities remain unscoped; dispatch is never assigned to a guessed batch',()=>{
 for(const mode of ['missing','whole','oldBatch']){const f=fixture(mode==='whole'?'':'P|1');if(mode==='missing')f.activity.splice(2,1),f.activity.shift();else if(mode==='oldBatch'){
   f.task.stockAllocatedBatches=[{id:'NEW|1',demand:80,allocated:80},{id:'NEW|2',demand:20,allocated:20}];}
  f.list.status='SENT';f.task.stockAllocationFacts.held=80;f.task.stockAllocationFacts.availableToArrange=20;f.read();
  assert.equal(f.task.stockBatchAllocationFacts[1].unscopedHeld,80);assert.equal(f.task.stockBatchAllocationFacts[1].availableToArrange,0);
 }
 const f=fixture();f.task.stockAllocationFacts={usable:60,held:0,dispatched:40,availableToArrange:60,review:false};f.read();
 assert.equal(arrangementLimit(f.task,'P|2'),0);assert.equal(f.task.stockBatchAllocationFacts[1].unscopedDispatched,40);
});
test('immutable link identity preserves old Loaded40attribution after a fresh instruction replaces CURRENT; no audit quantity is reused as a hold',()=>{
 const f=fixture();f.list.status='COMPLETED';f.list.lines[0].packed=40;f.list.lines[0].loaded=40;
 f.task.stockAllocationFacts.held=40;f.task.stockAllocationFacts.availableToArrange=60;
 const next=prepareArrangement({company:'NCT',staff:f.workspace.staff,requestId:'44444444-4444-4444-8444-444444444444',
  input:{taskId:'A',batchId:'P|1',quantity:40,expectedRevision:f.linked.details.revision,reason:'Remaining first batch'},workspace:f.workspace,
  before:{...f.linked,_version:'V2'},linkedPackingRecord:f.record,at:'2026-10-24T03:00:00.000Z'});
 f.activity[0]=next.writes[0].after;f.read();
 assert.equal(f.activity[2].details.quantity,80);assert.equal(f.task.stockBatchAllocationFacts[0].held,40);assert.equal(arrangementLimit(f.task,'P|2'),20);
 f.activity[2].details.batchId='CONFLICT';f.activity[0]=f.linked;assert.throws(f.read,/Ambiguous batch packing link/);
});
test('inconsistent hold totals or malformed attributed facts fail closed instead of widening arrangement quantity',()=>{
 const f=fixture();f.list.status='SENT';assert.throws(f.read,/authoritative task holds/);
 f.task.stockAllocationFacts.held=80;f.task.stockAllocationFacts.availableToArrange=20;f.read();
 f.task.stockBatchAllocationFacts[1].availableToArrange=21;assert.throws(()=>arrangementLimit(f.task,'P|2'),/availability/);
 f.task.stockBatchAllocationFacts=null;assert.throws(()=>arrangementLimit(f.task,'P|2'),/availability/);
});
test('a linked identity cannot move to another order or use a malformed audit even though current quantities still balance',()=>{
 const f=fixture();f.task.orderId='ANOTHER-ORDER';assert.throws(f.read,/Actual batch packing list required/);
 const g=fixture();g.activity.push({action:'PURCHASE_ARRANGEMENT_LINKED',company:'NCT',result:'SAVED'});
 assert.throws(g.read,/link audit requires review/);
});
