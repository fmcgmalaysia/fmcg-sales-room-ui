const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createPlannerAllocationOperations,allocatedTo,allocationVersion,readAllocations}=load('plannerAllocation.js');
function fixture(){
 const records=new Map(),tasks=['A','B'].map(id=>({id,customerId:id,orderId:'O'+id,sourceLineId:'L'+id,barcode:'001',packing:'12 x 1',ea:12,ord:10,po:'PO',supplierId:'S',warehouse:{accepted:id==='A'?15:0}}));
 const store={all:async()=>[...records.values()],read:async(c,id)=>records.get(id)||null,insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,row);return row;},remove:async(c,id)=>records.delete(id)};
 const workspace={company:'NCT',tasks},staff={memberId:'M',staffId:'P',staffName:'LAW'};
 const save=createPlannerAllocationOperations({store,names:{NCT:{activity:'Activity'}},readWorkspace:async()=>workspace});
 const input=()=>({action:'ALLOCATE',sourceTaskId:'A',version:allocationVersion(workspace,[...records.values()]),targets:[{taskId:'A',quantity:10},{taskId:'B',quantity:5}],reason:'Split supplier delivery'});
 const base={company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111'};
 return {records,tasks,workspace,save,input,base};
}
test('15 received cartons are explicitly split 10 / 5 across customers, once, with staff audit',async()=>{
 const f=fixture(),input=f.input();assert.equal(allocatedTo('A',[]).quantity,0);
 await f.save({...f.base,input});await f.save({...f.base,input});const activity=[...f.records.values()];
 assert.equal(allocatedTo('A',activity).quantity,10);assert.equal(allocatedTo('B',activity).quantity,5);
 assert.equal(readAllocations(activity).length,1);assert.equal(readAllocations(activity)[0].by,'LAW');assert.equal(f.tasks[0].ord,10);
});
test('over-allocation, incompatible product, stale version and invoiced changes are rejected',async()=>{
 for(const mutate of [f=>f.tasks[0].warehouse.accepted=14,f=>f.tasks[1].barcode='002',f=>f.tasks[1].salesInvoiceNumber='INV']){
  const f=fixture();mutate(f);await assert.rejects(f.save({...f.base,input:f.input()}));assert.equal(readAllocations([...f.records.values()]).length,0);
 }
 const f=fixture(),input=f.input();f.tasks[0].warehouse.accepted=16;await assert.rejects(f.save({...f.base,input}),/changed/);
});
test('allocation revision replaces the prior split without duplicating stock and guards revision forks',async()=>{
 const f=fixture();await f.save({...f.base,input:f.input()});const input=f.input();input.targets=[{taskId:'A',quantity:7},{taskId:'B',quantity:8}];
 await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input});const events=[...f.records.values()];
 assert.equal(allocatedTo('A',events).quantity,7);assert.equal(allocatedTo('B',events).quantity,8);
 const last=events.filter(row=>row.action==='PLANNER_ALLOCATION_SAVED').at(-1);assert.throws(()=>readAllocations([...events,{...last,title:'FORK'}]),/history/);
});

test('allocated stock is not a supplier physical receipt on the receiving customer task',async()=>{const f=fixture();await f.save({...f.base,input:f.input()});const {readWarehouseTask}=load('warehouseReceiving.js');const row=readWarehouseTask({title:'B',description:'OB',imageAltText:'LB'},[...f.records.values()]);assert.equal(row.customerReceived,5);assert.equal(row.accepted,0);assert.equal(row.hasPhysicalReceipt,false);});
