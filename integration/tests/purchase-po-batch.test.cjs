const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createPurchaseOperations}=load('purchaseOperations.js'),{taskEditVersion}=load('purchaseTaskIdentity.js');
const copy=value=>JSON.parse(JSON.stringify(value)),pause=()=>new Promise(resolve=>setTimeout(resolve,2));
function batch(count=8,failUpdate=false){
 const rows=new Map(),ids=Array.from({length:count},(_,i)=>(i+1).toString(16).padStart(32,'0')),calls=[];
 for(const [i,id]of ids.entries()){
  rows.set('NCTTasks/'+id,{_id:id,title:id,description:'ORDER',imageAltText:'L'+i,purchaseQtyInCtn:10,rowPosition:i+1,supplierId:'S',purchaseStage:'NEW_INCOMING',lpPc:1,lpCtn:10,disc1:0,disc2:0,disc3:0,manualCostField:[]});
  rows.set('NCTOrders/O'+i,{_id:'O'+i,title:'ORDER',sourceLineId:'L'+i,submissionId:'SUB',customerId:'C',customerCompanyName:'CUSTOMER',description:'BAR'+i,image:'PRODUCT '+i,imageAltText:'10EA',orderId:10,sellingPricePc:2,orderQtyInCtn:10});
 }
 rows.set('NCTActivity/R',{_id:'R',title:'R',description:'ORDER',action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB',taskIds:ids}});
 rows.set('SharedSuppliers/S',{_id:'S',title:'S',companyName:'SUPPLIER',supplierStatus:'ACTIVE'});
 let active=0,maxActive=0,failed=false,lateCleanup=false,clock=Date.now();
 const io=async(label,fn)=>{active++;maxActive=Math.max(maxActive,active);calls.push(['start',label]);await pause();try{return fn();}finally{calls.push(['end',label]);active--;}};
 const store={all:async c=>[...rows].filter(([key])=>key.startsWith(c+'/')).map(([,row])=>copy(row)),
  one:async(c,where)=>io('one '+c,()=>copy([...rows].filter(([key])=>key.startsWith(c+'/')).map(([,r])=>r).find(r=>Object.entries(where).every(([k,v])=>r[k]===v))||null)),
  read:async(c,id)=>io('read '+c+'/'+id,()=>copy(rows.get(c+'/'+id)||null)),
  insert:async(c,row)=>io('insert '+(row.action||'cost lock'),()=>{if(rows.has(c+'/'+row._id))throw Error('duplicate');rows.set(c+'/'+row._id,copy(row));return copy(row);}),
  update:async(c,row)=>io('update '+row._id,()=>{if(failUpdate&&!failed){failed=true;throw Error('response lost');}rows.set(c+'/'+row._id,copy(row));return copy(row);}),
  remove:async(c,id)=>io('remove '+id,()=>{if(active>1&&calls.some(([kind,label])=>kind==='start'&&label.startsWith('update ')&&!calls.some(([end,target])=>end==='end'&&target===label)))lateCleanup=true;rows.delete(c+'/'+id);})};
 const request={company:'NCT',requestId:'11111111-1111-4111-8111-111111111111',staff:{staffId:'STF',staffName:'LAW',memberId:'MEMBER',role:'SUPER ADMIN'},operation:'PO',input:{taskIds:ids,versions:Object.fromEntries(ids.map(id=>[id,taskEditVersion(rows.get('NCTTasks/'+id))])),poNumber:'NCT-PO-TEST'}};
 return {rows,ids,calls,store,request,advance:ms=>clock+=ms,operate:createPurchaseOperations({store,now:()=>new Date(clock)}),metrics:()=>({active,maxActive,lateCleanup})};
}
test('eight-line PO overlaps at most four independent I/O calls while retaining phase barriers and exact replay',async()=>{
 const f=batch(),result=await f.operate(f.request);assert.equal(result.ok,true);assert.equal(f.metrics().maxActive,4);assert.equal(f.metrics().active,0);
 assert.ok(f.ids.every(id=>f.rows.get('NCTTasks/'+id).ourPoNumber==='NCT-PO-TEST'));
 const firstAudit=f.calls.findIndex(([kind,label])=>kind==='start'&&label==='insert PURCHASE_PO_ASSIGNED');
 assert.ok(f.ids.every(id=>f.calls.findIndex(([kind,label])=>kind==='end'&&label==='update '+id)<firstAudit));
 assert.equal([...f.rows.values()].filter(r=>r.action==='PURCHASE_PO_ASSIGNED').length,8);
 assert.equal([...f.rows.values()].filter(r=>!r.action&&r.details?.requestId===f.request.requestId).length,0);
 const before=copy([...f.rows]);assert.deepEqual(await f.operate(f.request),result);assert.deepEqual(copy([...f.rows]),before);
});
test('a failed PO worker joins in-flight updates before releasing locks, then retries only the original prepared operation',async()=>{
 const f=batch(8,true);await assert.rejects(f.operate(f.request),/response lost/);assert.equal(f.metrics().active,0);assert.equal(f.metrics().lateCleanup,false);
 assert.equal([...f.rows.values()].filter(r=>r.action==='PURCHASE_PO_ASSIGNED').length,0);
 assert.equal([...f.rows.values()].filter(r=>!r.action&&r.details?.requestId===f.request.requestId).length,0);
 await f.operate(f.request);assert.equal([...f.rows.values()].filter(r=>r.action==='PURCHASE_PO_ASSIGNED').length,8);
});
test('a larger PO retains the same concurrency ceiling rather than firing one worker per task',async()=>{
 const f=batch(24);await f.operate(f.request);assert.equal(f.metrics().maxActive,4);assert.equal([...f.rows.values()].filter(r=>r.action==='PURCHASE_PO_ASSIGNED').length,24);
});
async function interruptedCompleted(){
 const f=batch(),outcome=await f.operate(f.request),{operationId}=load('purchaseOperationJournal.js');
 const prepared=[...f.rows.values()].find(row=>row.action==='PURCHASE_OPERATION_PREPARED'),key=prepared._id,lockId=operationId('NCT/PURCHASE','LOCK'),resultId=operationId(key,'RESULT');
 f.rows.delete('NCTActivity/'+resultId);
 f.rows.set('NCTActivity/'+lockId,{_id:lockId,title:lockId,action:'PURCHASE_OPERATION_LOCK',details:{...prepared.details,kind:'LOCK',owner:key}});
 for(const id of f.ids){const costId=operationId('NCT',id,'COST_LOCK');f.rows.set('NCTActivity/'+costId,{_id:costId,title:costId,description:'ORDER',details:{requestId:f.request.requestId,actorMemberId:f.request.staff.memberId}});}
 return {...f,outcome,prepared,key,lockId,resultId,operationId};
}
test('completed PO recovery confirms every task and audit, restores one receipt and releases only its original locks',async()=>{
 const f=await interruptedCompleted(),tasks=copy([...f.rows].filter(([key])=>key.startsWith('NCTTasks/')));f.advance(300001);
 const result=await f.operate(f.request);assert.deepEqual(result,f.outcome);assert.deepEqual(copy([...f.rows].filter(([key])=>key.startsWith('NCTTasks/'))),tasks);
 assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,8);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PLAN_SAVED').length,8);
 assert.equal(f.rows.has('NCTActivity/'+f.lockId),false);assert.equal(f.rows.get('NCTActivity/'+f.resultId).details.recovered,true);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_OPERATION_RECOVERY'&&row.result==='SAVED').length,1);
 const before=copy([...f.rows]);assert.deepEqual(await f.operate(f.request),result);assert.deepEqual(copy([...f.rows]),before);
});
test('an old lock alone never authorizes recovery of an incomplete, changed, foreign, or invoice-locked PO',async()=>{
 for(const failure of ['missing audit','changed task','foreign task lock','invoice','foreign company lock','changed input','fresh writer']){
  const f=await interruptedCompleted();if(failure!=='fresh writer')f.advance(300001);
  if(failure==='missing audit'){const item=[...f.rows].find(([,r])=>r.action==='PURCHASE_PO_ASSIGNED');f.rows.delete(item[0]);}
  if(failure==='changed task')f.rows.get('NCTTasks/'+f.ids[0]).lpCtn=11;
  if(failure==='foreign task lock')f.rows.get('NCTActivity/'+f.operationId('NCT',f.ids[0],'COST_LOCK')).details.requestId='22222222-2222-4222-8222-222222222222';
  if(failure==='invoice')f.rows.get('NCTOrders/O0').salesInvoiceNumber='INV';
  if(failure==='foreign company lock')f.rows.get('NCTActivity/'+f.lockId).details.owner='OTHER';
  if(failure==='changed input')f.request.input.poNumber='OTHER';
  const before=copy([...f.rows]);await assert.rejects(f.operate(f.request),/processing|recovery|identity/);assert.deepEqual(copy([...f.rows]),before,failure);
 }
});
test('two simultaneous original retries elect only one recovery executor without repeating task or audit writes',async()=>{
 const f=await interruptedCompleted();f.advance(300001);const results=await Promise.allSettled([f.operate(f.request),f.operate(f.request)]);
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_OPERATION_RECOVERY').length,1);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,8);assert.equal(f.rows.has('NCTActivity/'+f.lockId),false);
});
test('a recovered receipt with interrupted cleanup stays resumable and the next executor waits for prior recovery quiescence',async()=>{
 const f=await interruptedCompleted();f.advance(300001);const remove=f.store.remove;let fail=true;
 f.store.remove=async(c,id)=>{if(fail&&id!==f.lockId)throw Error('cleanup response lost');return remove(c,id);};
 await assert.rejects(f.operate(f.request),/cleanup response lost/);assert.equal(f.rows.get('NCTActivity/'+f.resultId).details.recovered,true);assert.equal(f.rows.has('NCTActivity/'+f.lockId),true);
 await assert.rejects(f.operate(f.request),/recovery is still processing/);fail=false;f.advance(300001);assert.deepEqual(await f.operate(f.request),f.outcome);assert.equal(f.rows.has('NCTActivity/'+f.lockId),false);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,8);
});
test('lost recovery claim, result and final-lock-delete acknowledgements cannot replay any business writes',async()=>{
 for(const point of ['claim','result','scope cleanup']){
  const f=await interruptedCompleted();f.advance(300001);const insert=f.store.insert,remove=f.store.remove;let lost=false;
  f.store.insert=async(c,row)=>{const value=await insert(c,row);if(!lost&&(point==='claim'&&row.action==='PURCHASE_OPERATION_RECOVERY'||point==='result'&&row._id===f.resultId)){lost=true;throw Error('response lost');}return value;};
  f.store.remove=async(c,id)=>{const value=await remove(c,id);if(!lost&&point==='scope cleanup'&&id===f.lockId){lost=true;throw Error('response lost');}return value;};
  if(point==='scope cleanup'){await assert.rejects(f.operate(f.request),/response lost/);assert.deepEqual(await f.operate(f.request),f.outcome);}else assert.deepEqual(await f.operate(f.request),f.outcome);
  assert.equal(lost,true);assert.equal(f.rows.has('NCTActivity/'+f.lockId),false);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,8);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_OPERATION_RESULT').length,1);
 }
});

const reordered=value=>Array.isArray(value)?value.map(reordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reordered(item)])):value;
test('CMS object-key reordering cannot block original result recovery after a lost insert acknowledgement',async()=>{
 const f=await interruptedCompleted();f.advance(300001);const insert=f.store.insert,read=f.store.read;let lost=false;
 f.store.read=async(c,id)=>reordered(await read(c,id));f.store.insert=async(c,row)=>{const result=await insert(c,row);if(!lost&&row._id===f.resultId){lost=true;throw Error('response lost');}return result;};
 assert.deepEqual(await f.operate(f.request),f.outcome);assert.equal(lost,true);assert.equal(f.rows.has('NCTActivity/'+f.lockId),false);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,8);
});
test('CMS-reordered existing recovered result resumes cleanup without repeating business writes',async()=>{
 const f=await interruptedCompleted();f.advance(300001);const remove=f.store.remove;f.store.remove=async()=>{throw Error('cleanup response lost');};await assert.rejects(f.operate(f.request),/cleanup response lost/);f.store.remove=remove;f.advance(300001);
 const read=f.store.read;f.store.read=async(c,id)=>reordered(await read(c,id));assert.deepEqual(await f.operate(f.request),f.outcome);assert.equal(f.rows.has('NCTActivity/'+f.lockId),false);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PO_ASSIGNED').length,8);
});
test('reordered JSON with altered values or task-array order remains rejected before lock cleanup',async()=>{
 for(const change of [value=>value.savedAt='2020-01-01T00:00:00.000Z',value=>value.taskIds.reverse(),value=>value.unexpected=true]){
  const f=await interruptedCompleted();f.advance(300001);const remove=f.store.remove;f.store.remove=async()=>{throw Error('cleanup response lost');};await assert.rejects(f.operate(f.request),/cleanup response lost/);f.store.remove=remove;f.advance(300001);
  change(f.rows.get('NCTActivity/'+f.resultId).details.outcome);const read=f.store.read;f.store.read=async(c,id)=>reordered(await read(c,id));const before=copy([...f.rows].filter(([key])=>key.startsWith('NCTTasks/')));await assert.rejects(f.operate(f.request),/requires review/);assert.equal(f.rows.has('NCTActivity/'+f.lockId),true);assert.deepEqual(copy([...f.rows].filter(([key])=>key.startsWith('NCTTasks/'))),before);
 }
});
