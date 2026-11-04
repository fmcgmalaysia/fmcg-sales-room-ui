'use strict';
// Fixed, nonbusiness native acceptance. Distinct from both stopped lock tests.
// No deletion, old-prefix access, activation or business-table capability exists.
async function verifyR2CasAcceptance({items,createSdkConditionalStore,createSegmentedFencedProof,hash,copy,same,input,enabled=false,now=()=>Date.now()}) {
 if(!input||Array.isArray(input)||Object.keys(input).length!==1||!['SEED','ADVANCE','FAULT','INSPECT','REPLAY'].includes(input.step))throw Error('Fixed R2 CAS test step required');
 const started=now(),counts={queries:0,inserts:0,patches:0,deletes:0},prefix='SPT-R2CAS-20261024-6d31:',collection='StockProtocolTest',company='NCT',journal='NCTActivity';
 let mutationAttempted=false,stage='PREFLIGHT';
 const report=(ok,extra={})=>({ok,schema:'R2_CAS_NATIVE_ACCEPTANCE_V1',step:input.step,stage,elapsedMs:now()-started,
  operationsAttempted:{...counts},mutationAttempted,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,
  originalBusinessCollectionsAccepted:false,productionCapacityAccepted:false,activationReady:false,...extra});
 if(!enabled){stage='CLOSED';return report(false,{blocked:true});}
 const address=(name,id)=>{if(![journal,'StockPositions'].includes(name)||typeof id!=='string'||!id)throw Error('Fixed logical test scope');return prefix+name+':'+id;};
 const bounded={query:name=>{if(name!==collection||++counts.queries>100)throw Error('Query budget');return items.query(name);},
  insert:async(name,row)=>{if(name!==collection||!row?._id?.startsWith(prefix)||++counts.inserts>24)throw Error('Insert scope/budget');mutationAttempted=true;return items.insert(name,row);},
  patch:(name,id)=>{if(name!==collection||!id?.startsWith(prefix)||++counts.patches>14)throw Error('Patch scope/budget');mutationAttempted=true;return items.patch(name,id);},
  remove:()=>{throw Error('NO_DELETE_CAPABILITY');}};
 const raw=createSdkConditionalStore({items:bounded,company,collections:[collection]});
 const decode=(name,id,row)=>{if(!row)return null;if(row._id!==address(name,id))throw Error('Test image identity');return{...row,_id:id};};
 const store={read:async(name,id)=>decode(name,id,await raw.read(collection,address(name,id))),
  readMany:async(name,ids)=>(await raw.readMany(collection,ids.map(id=>address(name,id)))).map((row,index)=>decode(name,ids[index],row)),
  insert:async(name,row)=>decode(name,row._id,await raw.insert(collection,{...row,_id:address(name,row._id)})),
  compareAndSet:async(name,id,version,row)=>{if(row?._id!==id)throw Error('Exact test image');return decode(name,id,await raw.compareAndSet(collection,address(name,id),version,{...row,_id:address(name,id)}));},
  compareAndRemove:()=>{throw Error('NO_LOCK_REMOVAL_CAPABILITY');}};
 const options={company,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,stepsPerInvocation:10},protocol=createSegmentedFencedProof({...options,store});
 const seeds=Array.from({length:20},(_,index)=>({_id:'CAS-S'+index,company,onHand:100,_version:'CAS-INITIAL-'+index}));
 const genesis={_id:protocol.ids.controlId,company,generation:0,pending:null,_version:'GENESIS'};
 const requestId='6d310000-1111-4111-8111-111111111111',memberId='FIXED-R2-CAS-TEST',requestInput={receipt:10},key=hash(company+'/PURCHASE',requestId,memberId);
 const expected=seeds.map(row=>({...row,onHand:110,_version:hash(key,'StockPositions',row._id)}));
 const request={requestId,memberId,input:requestInput,prepare:async()=>({writes:seeds.map(before=>({collection:'StockPositions',before:copy(before),after:{...before,onHand:110}}))})};
 try{
  const lock=await store.read(journal,protocol.ids.lockId);if(lock)throw Error('Unexpected company lock; never remove');
  if(input.step==='SEED'){
   stage='FRESH_TEST_ONLY';
   const control=await store.read(journal,protocol.ids.controlId),manifest=await store.read(journal,key),result=await store.read(journal,hash(key,'RESULT'));
   if(control||manifest||result||(await store.readMany('StockPositions',seeds.map(row=>row._id))).some(Boolean))throw Error('Occupied test, no reset or adoption');
   await protocol.initialize();for(const row of seeds)await store.insert('StockPositions',row);
   if(!same(await store.readMany('StockPositions',seeds.map(row=>row._id)),seeds)||!same(await protocol.readControl(),genesis))throw Error('Seed readback unconfirmed');
   stage='SEEDED';return report(true,{seeded:20,generation:0});
  }
  const control=await protocol.readControl();
  if(Object.hasOwn(control,'mode')||control.generation>1)throw Error('Nonbusiness fixed control only');
  if(input.step==='INSPECT'){
   stage='READ_ONLY_INSPECTION';const rows=await store.readMany('StockPositions',seeds.map(row=>row._id));
   if(control.pending){let blocked=false;try{await protocol.readSnapshot(()=>[]);}catch(error){blocked=error.message==='Inventory pending';}
    if(!blocked)throw Error('Read barrier missing');
    if(rows.some((row,index)=>!same(row,seeds[index])&&!same(row,expected[index])))throw Error('Unexpected partial image');
    return report(true,{generation:0,pending:copy(control.pending),applied:rows.filter((row,index)=>same(row,expected[index])).length,mixedReadBlocked:true});}
   if(control.generation!==1||!same(rows,expected))throw Error('Final twenty images unconfirmed');
   const receipt=await store.read(journal,hash(key,'RESULT'));
   if(receipt?.outcome?.ok!==true||receipt.outcome.generation!==1||receipt.outcome.operationId!==key)throw Error('Durable result unconfirmed');
   const snapshot=await protocol.readSnapshot(()=>store.readMany('StockPositions',seeds.map(row=>row._id)));
   if(snapshot.generation!==1||!same(snapshot.rows,expected))throw Error('Final snapshot unconfirmed');
   return report(true,{generation:1,pending:null,verifiedImages:20,totalOnHand:2200,resultCount:1,noLockCreated:true});
  }
  if(input.step==='REPLAY'?control.generation!==1||control.pending:control.generation!==0)throw Error('Exact operation phase required');
  let writes=0,injected=false;
  const executionStore=input.step==='FAULT'?{...store,compareAndSet:async(name,id,version,row)=>{
   if(name==='StockPositions'){if(writes===3){injected=true;throw Error('KNOWN_R2_CAS_INTERRUPTION');}writes++;}
   return store.compareAndSet(name,id,version,row);}}:store;
  if(input.step==='FAULT'&&(!control.pending||!(control.pending.phase==='APPLY'&&control.pending.cursor===0
   ||control.pending.phase==='BEFORE'&&control.pending.cursor===20)))throw Error('Exact first APPLY boundary required');
  stage='EXECUTING';let outcome;
  try{outcome=await createSegmentedFencedProof({...options,store:executionStore}).commit(request);}
  catch(error){if(!injected||error.message!=='KNOWN_R2_CAS_INTERRUPTION')throw error;
   const checkpoint=await protocol.readControl();
   if(checkpoint.generation!==0||checkpoint.pending?.key!==control.pending.key||checkpoint.pending?.phase!=='APPLY'||checkpoint.pending.cursor!==0||writes!==3)throw Error('Partial cursor changed');
   const rows=await store.readMany('StockPositions',seeds.map(row=>row._id));
   if(!same(rows,expected.slice(0,3).concat(seeds.slice(3))))throw Error('Exact three partial images unconfirmed');
   stage='KNOWN_INTERRUPTION_CONFIRMED';return report(true,{applied:3,pending:copy(checkpoint.pending),cursorUnchanged:true,noLockCreated:true});}
  const after=await protocol.readControl();
  if(await store.read(journal,protocol.ids.lockId))throw Error('Unexpected lock created');
  stage=input.step==='REPLAY'?'COMPLETED_REPLAY':'CHECKPOINT_CONFIRMED';
  return report(true,{outcome,control:{generation:after.generation,pending:after.pending},noLockCreated:true});
 }catch(error){return report(false,{error:error.message,retainRequest:true,noAutomaticRetryResetOrCleanup:true});}
}
module.exports={verifyR2CasAcceptance};
