const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createPlannerAllocationOperations,allocationVersion,readAllocations}=load('plannerAllocation.js'),{operationId}=load('purchaseOperationJournal.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(mode){
 const rows=new Map(),staff={memberId:'M',staffId:'S',staffName:'TEST'},requestId='11111111-1111-4111-8111-111111111111',key=operationId('NCT/PURCHASE',requestId,'M'),lockId=operationId('NCT/PURCHASE','LOCK');let clock=Date.parse('2026-10-31T00:00:00Z'),interrupt=true;
 const product={barcode:'SKU',packing:'12x1',ea:12},tasks=[{...product,id:'A',ord:10,customerId:'CA',orderId:'OA',sourceLineId:'LA',warehouse:{hasPhysicalReceipt:false,accepted:0}},{...product,id:'FREE',specialPurchase:true,ord:0,po:'PO',supplierId:'SUP',procurement:{totalCtn:20,customerCtn:0},warehouse:{hasPhysicalReceipt:true,accepted:20}}];
 const workspace={company:'NCT',tasks};
 const store={read:async(c,id)=>copy(rows.get(id)||null),all:async()=>copy([...rows.values()]),insert:async(c,row)=>{if(rows.has(row._id))throw Error('duplicate');if(interrupt&&mode==='BEFORE'&&row.action==='PLANNER_ALLOCATION_SAVED')throw Error('process terminated');rows.set(row._id,copy(row));if(interrupt&&(mode==='AFTER'&&row.action==='PLANNER_ALLOCATION_SAVED'||mode==='RESULT'&&row.action==='PURCHASE_OPERATION_RESULT'))throw Error('process terminated');return copy(row);},remove:async(c,id)=>{if(!interrupt)rows.delete(id);},update:async(c,row)=>{rows.set(row._id,copy(row));return copy(row);}};
 const save=createPlannerAllocationOperations({store,names:{NCT:{activity:'N'}},readWorkspace:async()=>workspace,now:()=>new Date(clock)});
 const request={company:'NCT',staff,requestId,input:{action:'ALLOCATE',planMode:'CUSTOMER',taskId:'A',batchId:'WHOLE',borrow:false,version:allocationVersion(workspace,[])}};
 return {rows,store,save,request,key,lockId,advance:()=>{clock+=300001;interrupt=false;},resume:()=>{interrupt=false;},count:()=>[...rows.values()].filter(x=>x.action==='PLANNER_ALLOCATION_SAVED').length};
}
for(const mode of ['AFTER','RESULT','SUCCESS'])test('confirmed allocation recovers retained lock after '+mode+' interruption exactly once',async()=>{
 const f=fixture(mode);if(mode==='SUCCESS')await f.save(f.request);else await assert.rejects(f.save(f.request),/terminated/);
 assert.equal(f.rows.has(f.lockId),true);assert.equal(f.count(),1);f.advance();const r=await f.save(f.request);assert.equal(r.ok,true);assert.equal(f.rows.has(f.lockId),false);assert.equal(f.count(),1);assert.equal((await f.save(f.request)).ok,true);assert.equal(readAllocations([...f.rows.values()])[0].targets[0].quantity,10);
});
test('fresh completed result returns immediately without reclaiming a still-active lock',async()=>{const f=fixture('SUCCESS');await f.save(f.request);f.resume();assert.equal((await f.save(f.request)).ok,true);assert.equal(f.rows.has(f.lockId),true);});
test('uncommitted terminated save remains blocked without rebuilding or removing its lock',async()=>{const f=fixture('BEFORE');await assert.rejects(f.save(f.request),/terminated/);f.advance();await assert.rejects(f.save(f.request),/recovery is pending/);assert.equal(f.rows.has(f.lockId),true);assert.equal(f.count(),0);});
test('changed receipt, different actor and a competing request cannot clear original lock',async()=>{
 for(const change of ['RECEIPT','ACTOR','REQUEST']){const f=fixture('AFTER');await assert.rejects(f.save(f.request));f.advance();let request=f.request;if(change==='RECEIPT')[...f.rows.values()].find(x=>x.action==='PLANNER_ALLOCATION_SAVED').details.allocations[0].targets[0].quantity=9;if(change==='ACTOR')request={...request,staff:{...request.staff,memberId:'OTHER'}};if(change==='REQUEST')request={...request,requestId:'22222222-2222-4222-8222-222222222222'};await assert.rejects(f.save(request));assert.equal(f.rows.has(f.lockId),true);assert.equal(f.count(),1);}
});
test('CMS object field order can change, but source array order and receipt identity remain protected',async()=>{
 const reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reorder(v)])):x;
 const f=fixture('AFTER');await assert.rejects(f.save(f.request));f.advance();const read=f.store.read;f.store.read=async(c,id)=>reorder(await read(c,id));assert.equal((await f.save(f.request)).ok,true);assert.equal(f.count(),1);assert.equal(f.rows.has(f.lockId),false);
 const g=fixture('AFTER');await assert.rejects(g.save(g.request));g.advance();[...g.rows.values()].find(x=>x.action==='PLANNER_ALLOCATION_SAVED').image='WRONG-CUSTOMER';await assert.rejects(g.save(g.request),/recovery is pending/);assert.equal(g.rows.has(g.lockId),true);
});
for(const count of [1,5,10])test(count+' simultaneous allocation requests consume the same20 only once',async()=>{
 const f=fixture('NONE');f.resume();const requests=Array.from({length:count},(_,i)=>({...f.request,requestId:String(i+1).padStart(8,'0')+'-1111-4111-8111-111111111111'}));const results=await Promise.allSettled(requests.map(r=>f.save(r)));
 assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.ok).length,1);assert.equal(f.count(),1);assert.equal(f.rows.has(f.lockId),false);
});
