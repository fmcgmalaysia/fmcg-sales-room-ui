'use strict';
// Isolated native rehearsal of the EXACT segmented executor, not business auth.
// A separate compiled server gate defaults CLOSED for conditional lock deletion.
async function verifyNative300Commit({items,createSdkConditionalStore,createSegmentedPlanCodec,createSegmentedFencedProof,
 same,copy,hash,source,input,newAttempt,allowConditionalLockRelease=false,now=()=>Date.now()}){
 const steps=['SEED','INSPECT','ADVANCE','INTERRUPT_APPLY','REPLAY_COMPLETED'];
 if(!input||typeof input!=='object'||Array.isArray(input)||!steps.includes(input.step)
  ||Object.keys(input).some(key=>!['step',...(input.step==='SEED'?['batch']:[])].includes(key))
  ||input.step==='SEED'&&(!Number.isSafeInteger(input.batch)||input.batch<0||input.batch>=15)
  ||typeof newAttempt!=='function'||typeof allowConditionalLockRelease!=='boolean'
  ||source?.schema!=='STOCK_NATIVE_300_COMMIT_SOURCE_V1')throw Error('Fixed native300 test input required');
 const collection='StockProtocolTest',prefix='SPT-COMMIT300-20261023-b19d:',company='NCT',journal='NCTActivity';
 const started=now(),counts={queries:0,inserts:0,patches:0,deletes:0};let stage='PREFLIGHT',mutationAttempted=false;
 const report=(ok,extra={})=>({ok,schema:'STOCK_NATIVE_300_COMMIT_V1',stage,step:input.step,operationsAttempted:{...counts},
  mutationAttempted,elapsedMs:now()-started,recordRetentionPolicy:'RETAIN_ALL_NONLOCK_TEST_RECORDS',
  originalBusinessCollectionsAccepted:false,wholeBusinessPreparationAccepted:false,productionCapacityAccepted:false,activationReady:false,...extra});
 // These mutation-capable steps are rejected before storage when no exact native
 // lock-release grant has been compiled. A browser flag can never open the gate.
 if(['ADVANCE','INTERRUPT_APPLY','REPLAY_COMPLETED'].includes(input.step)&&!allowConditionalLockRelease){
  stage='EXACT_CONDITIONAL_TEST_LOCK_RELEASE_GRANT_REQUIRED';return report(false,{blocked:true});
 }
 const lockId=hash('NCT/PURCHASE','LOCK'),controlId=hash(company,'STOCK_CONTROL'),key=source.key,resultId=hash(key,'RESULT');
 const physicalLock=prefix+journal+':'+lockId;
 const sourceIds=new Set(source.physicalIds||[]);
 if(sourceIds.size!==12||source.company!==company||source.planBytes!==596928||source.planHash!=='79d177a3ccd56f4672d5656f05834bc6')throw Error('Exact retained native300 source required');
 const bounded={query:name=>{if(name!==collection||++counts.queries>200)throw Error('Native300 query budget');return items.query(name);},
  insert:async(name,row)=>{if(name!==collection||typeof row?._id!=='string'||!row._id.startsWith(prefix)||++counts.inserts>33)throw Error('Native300 insert scope/budget');
   mutationAttempted=true;return items.insert(name,row);},
  patch:(name,id)=>{if(name!==collection||typeof id!=='string'||!id.startsWith(prefix)||++counts.patches>30)throw Error('Native300 patch scope/budget');
   mutationAttempted=true;return items.patch(name,id);},
  remove:async(name,id,options)=>{if(!allowConditionalLockRelease||name!==collection||id!==physicalLock||++counts.deletes>1
   ||options?.condition?.company?.$eq!==company||typeof options?.condition?.attempt?.$eq!=='string'||!options.condition.attempt.$eq.startsWith('COMMIT300-'))throw Error('Exact conditional test lock release required');
   mutationAttempted=true;return items.remove(name,id,options);}};
 const raw=createSdkConditionalStore({items:bounded,company,collections:[collection],dateTimeFields:{[collection]:['activityTime']}});
 const codec=createSegmentedPlanCodec({company,domainWrites:true});
 try{
  // Read-only reuse of previously accepted retained staging evidence. This test
  // NEVER edits/adopts/resets those rows as its own operation/control/locks.
  const retained=await raw.readMany(collection,source.physicalIds);
  if(retained.some((row,index)=>!row||row._id!==source.physicalIds[index]))throw Error('Complete retained source required');
  const logical=retained.map((row,index)=>({...row,_id:source.logicalIds[index]})),manifest=logical.at(-1);
  if(manifest.planHash!==source.planHash||manifest.planBytes!==source.planBytes)throw Error('Retained source fingerprint conflict');
  const plan=codec.decode({manifest,fragments:logical.slice(0,-1),key,digest:source.digest,memberId:source.memberId,requestId:source.requestId});
  if(plan.writes.length!==901)throw Error('Exact actual300 plan required');
  const allowed=new Set(['NCTActivity','StockPositions','StockClaims','StockProducts']);
  const address=(name,id)=>{if(!allowed.has(name)||typeof id!=='string'||!id)throw Error('Fixed logical test scope');return prefix+name+':'+id;};
  const decode=(name,id,row)=>{if(!row)return null;if(row._id!==address(name,id))throw Error('Native test identity conflict');return{...row,_id:id};};
  const encode=(name,row)=>({...row,_id:address(name,row._id)});
  const store={read:async(name,id)=>decode(name,id,await raw.read(collection,address(name,id))),
   readMany:async(name,ids)=>(await raw.readMany(collection,ids.map(id=>address(name,id)))).map((row,index)=>decode(name,ids[index],row)),
   insert:async(name,row)=>decode(name,row._id,await raw.insert(collection,encode(name,row))),
   compareAndSet:async(name,id,version,row)=>{if(row?._id!==id)throw Error('Exact test image required');return decode(name,id,await raw.compareAndSet(collection,address(name,id),version,encode(name,row)));},
   compareAndRemove:async(name,id,attempt)=>decode(name,id,await raw.compareAndRemove(collection,address(name,id),attempt))};
  const protocol=createSegmentedFencedProof({store,company,domainWrites:true,newAttempt:()=> 'COMMIT300-'+newAttempt()});
  const genesis={_id:controlId,company,generation:0,pending:null,_version:'GENESIS'};
  const seeds=plan.writes.filter(change=>change.before!==null);
  if(seeds.length!==300||seeds.some(change=>change.collection!=='StockProducts'||change.before.onHand!==0))throw Error('Exact zero product seed scope required');
  if(input.step==='SEED'){
   stage='SEED_BATCH_PREFLIGHT';
   const control=await store.read(journal,controlId),root=await store.read(journal,key),result=await store.read(journal,resultId),lock=await store.read(journal,lockId);
   if(root||result||lock||(input.batch===0?!!control:!same(control,genesis)))throw Error('Fresh sequential seed scope required');
   // All expected domain IDs, not just seed rows, must match the exact prefix.
   const images=new Map();for(const name of allowed){const changes=plan.writes.filter(change=>change.collection===name);
    const rows=await store.readMany(name,changes.map(change=>change.after._id));changes.forEach((change,index)=>images.set(name+'/'+change.after._id,rows[index]));}
   const completed=input.batch*20;
   for(const change of plan.writes){const seed=seeds.indexOf(change),expected=seed>=0&&seed<completed?change.before:null;
    if(!same(images.get(change.collection+'/'+change.after._id),expected))throw Error('Occupied or nonsequential native seed; no reset/adopt');}
   if(input.batch===0)await protocol.initialize();
   const batch=seeds.slice(completed,completed+20);stage='SEED_BATCH_INSERT';
   for(const change of batch)if(!same(await store.insert(change.collection,change.before),change.before))throw Error('Seed insert reply mismatch');
   const confirmed=await store.readMany('StockProducts',batch.map(change=>change.before._id));
   if(!same(confirmed,batch.map(change=>change.before))||!same(await protocol.readControl(),genesis))throw Error('Exact seed batch readback unconfirmed');
   stage='SEED_BATCH_CONFIRMED';return report(true,{batch:input.batch,seededProducts:completed+20,seedComplete:input.batch===14,
    nextBatch:input.batch===14?null:input.batch+1,wholeCommitRecoveryAccepted:false});
  }
  const control=await protocol.readControl(),prior=await store.read(journal,key),lock=await store.read(journal,lockId);
  if(lock||Object.hasOwn(control,'mode')||control.generation>1)throw Error('Isolated nonbusiness control/absent lock required');
  const inspect=async()=>{
   if(control.pending){let blocked=false;try{await protocol.readSnapshot(()=>{throw Error('Mixed read callback must not run');});}catch(error){blocked=error?.message==='Inventory pending';}
    if(!blocked)throw Error('Pending read barrier unconfirmed');return{generation:control.generation,pending:true,phase:control.pending.phase,cursor:control.pending.cursor,mixedActionableReadBlocked:true};}
   if(control.generation!==1)return{generation:0,pending:false,seedComplete:(await store.readMany('StockProducts',seeds.map(change=>change.before._id))).every((row,index)=>same(row,seeds[index].before))};
   const verified=await protocol.readSnapshot(async()=>{for(const name of allowed){const changes=plan.writes.filter(change=>change.collection===name);
    const rows=await store.readMany(name,changes.map(change=>change.after._id));if(!same(rows,changes.map(change=>change.after)))throw Error('Full901image native parity unconfirmed');}return true;});
   const result=await store.read(journal,resultId);if(verified.generation!==1||result?.outcome?.ok!==true||result.outcome.operationId!==key
    ||result.outcome.generation!==1||result.baseGeneration!==0||result.digest!==hash({isolatedPlanHash:source.planHash})
    ||prior?.planHash!==source.planHash||prior.memberId!==source.memberId||prior.requestId!==source.requestId)throw Error('Final native result unconfirmed');
   return{generation:1,pending:false,full901ImagesVerified:true,positions:300,claims:300,products:300,receiptCount:1,totalOnHand:30000};
  };
  if(input.step==='INSPECT'){stage='READ_ONLY_NATIVE_COMMIT_INSPECTION';return report(true,{inspection:await inspect(),wholeCommitRecoveryAccepted:false});}
  if(input.step==='REPLAY_COMPLETED'?control.generation!==1||control.pending:control.generation!==0)throw Error('Expected exact operation phase required');
  if(!prior){
   const initialProducts=await store.readMany('StockProducts',seeds.map(change=>change.before._id));
   if(!same(control,genesis)||!initialProducts.every((row,index)=>same(row,seeds[index].before)))throw Error('Complete exact seed required before lock acquisition');
  }
  let writes=0,injected=false;
  const changeIds=new Set(plan.writes.map(change=>change.collection+'/'+change.after._id));
  const beforeMutation=async(name,row,forward)=>{
   if(input.step==='INTERRUPT_APPLY'&&changeIds.has(name+'/'+row._id)){
    if(writes===10){injected=true;throw Error('INJECTED_KNOWN_NATIVE_APPLY_INTERRUPTION');}writes++;
   }
   return forward();
  };
  if(input.step==='INTERRUPT_APPLY'&&(!control.pending||control.pending.phase!=='APPLY'||control.pending.cursor>880))throw Error('Known application boundary required');
  const executionStore=input.step==='INTERRUPT_APPLY'?{...store,insert:(name,row)=>beforeMutation(name,row,()=>store.insert(name,row)),
   compareAndSet:(name,id,version,row)=>beforeMutation(name,row,()=>store.compareAndSet(name,id,version,row))}:store;
  const executor=input.step==='INTERRUPT_APPLY'?createSegmentedFencedProof({store:executionStore,company,domainWrites:true,newAttempt:()=> 'COMMIT300-'+newAttempt()}):protocol;
  stage='EXACT_SEGMENTED_EXECUTOR';let outcome;
  try{outcome=await executor.commit({requestId:source.requestId,memberId:source.memberId,input:{isolatedPlanHash:source.planHash},
   prepare:async()=>{if(prior)throw Error('Published original plan must not be recaptured');return copy(plan);},
   authorize:operation=>{if(operation.key!==key||operation.control.company!==company||Object.hasOwn(operation.control,'mode')||operation.control.generation>1)throw Error('Isolated original operation only');}});
  }catch(error){
   if(!injected||error?.message!=='INJECTED_KNOWN_NATIVE_APPLY_INTERRUPTION')throw error;
   if(await store.read(journal,lockId))throw Error('Known application failure lock release unconfirmed');
   const after=await protocol.readControl();if(!same(after,control)||writes!==10)throw Error('Known interrupted progress changed');
   for(let index=control.pending.cursor;index<control.pending.cursor+11;index++){const change=plan.writes[index];
    if(!same(await store.read(change.collection,change.after._id),index<control.pending.cursor+10?change.after:change.before))throw Error('Exact partial native application boundary unconfirmed');}
   stage='KNOWN_APPLY_INTERRUPTION_CONFIRMED';return report(true,{appliedBeforeFault:10,inspection:await inspect(),lockAbsent:true,wholeCommitRecoveryAccepted:false});
  }
  if(await store.read(journal,lockId))throw Error('Exact completed invocation lock release unconfirmed');
  if(outcome?.pending===true&&outcome.ok===false){
   const after=await protocol.readControl();if(!after.pending||after.generation!==0)throw Error('Durable native pending missing');
   let blocked=false;try{await protocol.readSnapshot(()=>{throw Error('Mixed read callback must not run');});}catch(error){blocked=error?.message==='Inventory pending';}
   if(!blocked)throw Error('Pending read barrier unconfirmed');
   stage='SAME_REQUEST_PENDING_CONFIRMED';return report(true,{progress:{phase:outcome.phase,completedCount:outcome.completedCount,totalRecords:outcome.totalRecords},mixedActionableReadBlocked:true,lockAbsent:true,wholeCommitRecoveryAccepted:false});
  }
  if(outcome?.ok!==true||outcome.generation!==1)throw Error('Final original executor outcome unconfirmed');
  stage=input.step==='REPLAY_COMPLETED'?'COMPLETED_REPLAY_UNCHANGED':'NATIVE_901_IMAGE_APPLICATION_CONFIRMED';
  // Fresh control captured inside a NEW inspector invocation, not this precommit
  // control. Completion report alone never claims full901 image verification.
  return report(true,{generation:1,pending:false,lockAbsent:true,requiresFinalReadOnlyInspection:true,wholeCommitRecoveryAccepted:false});
 }catch(_){return report(false,{error:'Native300 test unconfirmed. Retain all records and original request. No automatic retry, reset, unlock or cleanup performed.',wholeCommitRecoveryAccepted:false});}
}
module.exports={verifyNative300Commit};
