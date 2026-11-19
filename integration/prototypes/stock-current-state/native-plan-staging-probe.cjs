'use strict';
// Actual shared codec/SDK boundary; INSERT-ONLY isolated staging rehearsal.
// Deliberate first-fragment interruption, then one explicit exact continuation.
// NOT the segmented commit executor or native business preparation acceptance.
async function verifyNativePlanStaging({items,createSdkConditionalStore,createSegmentedPlanCodec,same,fixture,input,now=()=>Date.now()}){
 if(!input||Object.keys(input).length!==1||!['INTERRUPT_AFTER_FIRST_FRAGMENT','RESUME_EXACT_RETAINED_PLAN'].includes(input.step)
  ||fixture?.schema!=='STOCK_ACTUAL_300_PLAN_FIXTURE_V1'||fixture.businessLines!==300||fixture.writeImages!==901
  ||!items||['query','insert'].some(method=>typeof items[method]!=='function'))throw Error('Fixed insert-only staging input required');
 const collection='StockProtocolTest',prefix='SPT-STAGE300-20261023-a32d:',attempt='FIXED-RETAINED-STAGING-ATTEMPT';
 const codec=createSegmentedPlanCodec({company:'NCT',domainWrites:true});
 const encoded=codec.encode({...fixture,attempt}),logical=[...encoded.fragments,encoded.manifest];
 if(logical.length<3||logical.length>33||encoded.manifest.writeCount!==901)throw Error('Exact bounded actual300 staging fixture required');
 const physical=logical.map(row=>({...row,_id:prefix+row._id})),allowed=new Set(physical.map(row=>row._id));
 let queries=0,inserts=0,mutationAttempted=false,stage='PREFLIGHT';const started=now(),timings=[];
 const bounded={query:name=>{if(name!==collection||++queries>3)throw Error('Staging query scope/budget');return items.query(name);},
  insert:async(name,row)=>{if(name!==collection||!allowed.has(row?._id)||!same(row,physical.find(value=>value._id===row._id))||++inserts>33)throw Error('Exact staging insert scope/budget');
   mutationAttempted=true;const before=now(),result=await items.insert(name,row);timings.push(now()-before);return result;},
  patch:()=>{throw Error('No staging patch');},remove:()=>{throw Error('No staging deletion');}};
 const store=createSdkConditionalStore({items:bounded,company:'NCT',collections:[collection]});
 const report=(ok,extra={})=>({ok,schema:'STOCK_NATIVE_300_STAGING_V1',stage,step:input.step,businessLines:300,writeImages:901,
  fragmentCount:encoded.fragments.length,retainedFixtureMaximum:physical.length,operationsAttempted:{queries,inserts,patches:0,deletes:0},
  mutationAttempted,elapsedMs:now()-started,insertElapsedMs:timings,recordRetentionPolicy:'RETAIN_ALL_NEW_STAGING_FIXTURES',
  wholeBusinessPreparationAccepted:false,wholeCommitRecoveryAccepted:false,productionCapacityAccepted:false,activationReady:false,
  limitation:'Native insert-only staging/readback of the exact MOCK-prepared actual300 plan. Not original business schema/auth,901image application, lock release, termination, migration or activation acceptance.',...extra});
 try{
  const before=await store.readMany(collection,physical.map(row=>row._id));
  if(input.step==='INTERRUPT_AFTER_FIRST_FRAGMENT'){
   if(before.some(Boolean))throw Error('Occupied fixture; no adopt/reset/retry');
   stage='FIRST_FRAGMENT_INSERT';
   if(!same(await store.insert(collection,physical[0]),physical[0]))throw Error('Insert image unconfirmed');
   const retained=await store.readMany(collection,physical.map(row=>row._id));
   if(!same(retained[0],physical[0])||retained.slice(1).some(Boolean))throw Error('Exact interruption boundary unconfirmed');
   stage='INTERRUPTED_WITHOUT_MANIFEST';return report(true,{manifestAbsent:true,retainedCount:1});
  }
  if(!same(before[0],physical[0])||before.slice(1).some(Boolean))throw Error('Expected one exact interrupted fragment; no adopt/replay');
  stage='RETAINED_PLAN_CONTINUATION';
  for(const row of physical.slice(1))if(!same(await store.insert(collection,row),row))throw Error('Exact insert image unconfirmed');
  const after=await store.readMany(collection,physical.map(row=>row._id));
  if(!same(after,physical))throw Error('Native complete strong readback mismatch');
  const decodedRows=after.map((row,index)=>({...row,_id:logical[index]._id}));
  const decoded=codec.decode({manifest:decodedRows.at(-1),fragments:decodedRows.slice(0,-1),key:fixture.key,digest:fixture.digest,
   memberId:fixture.memberId,requestId:fixture.requestId});
  if(!same(decoded,encoded.plan)||JSON.stringify(decoded)!==JSON.stringify(encoded.plan))throw Error('Original full901image plan changed');
  const corrupt=decodedRows.slice(0,-1).map(row=>({...row}));corrupt[0].payload+=' ';
  let refused=false;try{codec.decode({manifest:decodedRows.at(-1),fragments:corrupt,key:fixture.key,digest:fixture.digest,memberId:fixture.memberId,requestId:fixture.requestId});}catch(_){refused=true;}
  if(!refused)throw Error('Corrupt in-memory copy accepted');
  stage='EXACT_300_PLAN_NATIVE_STAGING_CONFIRMED';
  return report(true,{manifestWrittenLast:true,fullPlanReadbackVerified:true,corruptCopyRejected:true,retainedCount:physical.length,
   planBytes:encoded.manifest.planBytes,planHash:encoded.manifest.planHash});
 }catch(_){return report(false,{error:'Staging unconfirmed. Retain every created fixture; no automatic retry, reset, cleanup or business recovery.'});}
}
module.exports={verifyNativePlanStaging};
