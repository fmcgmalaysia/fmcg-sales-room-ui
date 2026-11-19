const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createPlannerAllocationOperations,allocatedTo,allocationVersion,readAllocations}=load('plannerAllocation.js');
function fixture(){
 const records=new Map(),tasks=['A','B'].map(id=>({id,customerId:id,orderId:'O'+id,sourceLineId:'L'+id,barcode:'001',packing:'12 x 1',ea:12,ord:10,po:'PO',supplierId:'S',warehouse:{hasPhysicalReceipt:id==='A',accepted:id==='A'?15:0}}));
 const store={all:async()=>[...records.values()],read:async(c,id)=>records.get(id)||null,insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,row);return row;},remove:async(c,id)=>records.delete(id)};
 const workspace={company:'NCT',tasks},staff={memberId:'M',staffId:'P',staffName:'LAW'};
 const save=createPlannerAllocationOperations({store,names:{NCT:{activity:'Activity'}},readWorkspace:async()=>workspace});
 const input=()=>({action:'ALLOCATE',planMode:'CUSTOMER',taskId:'B',batchId:'WHOLE',version:allocationVersion(workspace,[...records.values()]),borrow:false});
 const base={company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111'};
 return {records,tasks,workspace,save,input,base};
}
test('15 received cartons are explicitly split 10 / 5 across customers, once, with staff audit',async()=>{
 const f=fixture(),input=f.input();assert.equal(allocatedTo('A',[]).quantity,0);
 await f.save({...f.base,input});await f.save({...f.base,input});const activity=[...f.records.values()];
 assert.equal(allocatedTo('A',activity).quantity,10);assert.equal(allocatedTo('B',activity).quantity,5);
 assert.equal(readAllocations(activity).length,1);assert.equal(readAllocations(activity)[0].by,'LAW');assert.equal(f.tasks[0].ord,10);
});
test('customer entry rejects incompatible or invoiced stock and cannot over-allocate a stale quote',async()=>{
 for(const mutate of [f=>f.tasks[0].warehouse.hasPhysicalReceipt=false,f=>f.tasks[1].barcode='002',f=>f.tasks[1].salesInvoiceNumber='INV']){
  const f=fixture();mutate(f);await assert.rejects(f.save({...f.base,input:f.input()}));assert.equal(readAllocations([...f.records.values()]).length,0);
 }
 const f=fixture(),input=f.input();f.tasks[0].warehouse.accepted=16;await assert.rejects(f.save({...f.base,input}),/changed/);
});
test('customer reallocation uses explicit borrowing instead of silently rewriting another customer share, and guards forks',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});const input={...f.input(),borrow:true,donorTaskId:'A'};
 await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input});const events=[...f.records.values()];
 assert.equal(allocatedTo('A',events).quantity,5);assert.equal(allocatedTo('B',events).quantity,10);assert.equal(require('./load-master-module.cjs')('customerAllocationContext.js').readAllocationLoans(events)[0].outstanding,5);
 const last=events.filter(row=>row.action==='PLANNER_ALLOCATION_SAVED').at(-1);assert.throws(()=>readAllocations([...events,{...last,title:'FORK'}]),/history/);
});
test('retired arbitrary source-target writes cannot bypass borrowing responsibility',async()=>{const f=fixture();await assert.rejects(f.save({...f.base,input:{action:'ALLOCATE',sourceTaskId:'A',version:f.input().version,targets:[{taskId:'A',quantity:7},{taskId:'B',quantity:8}],reason:'Old client'}}),/Reload/);assert.equal(readAllocations([...f.records.values()]).length,0);});

test('allocated stock is not a supplier physical receipt on the receiving customer task',async()=>{const f=fixture();await f.save({...f.base,input:f.input()});const {readWarehouseTask}=load('warehouseReceiving.js');const row=readWarehouseTask({title:'B',description:'OB',imageAltText:'LB'},[...f.records.values()]);assert.equal(row.customerReceived,5);assert.equal(row.accepted,0);assert.equal(row.hasPhysicalReceipt,false);});
