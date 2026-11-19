'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {verifyNative300Commit}=require('../prototypes/stock-current-state/native-300-commit-probe.cjs');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {createSegmentedPlanCodec,same,copy}=require('../prototypes/stock-current-state/segmented-plan.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const fixture=require('../prototypes/stock-current-state/native-plan-staging.fixture.json');
const encoded=createSegmentedPlanCodec({company:'NCT',domainWrites:true}).encode({...fixture,attempt:'FIXED-RETAINED-STAGING-ATTEMPT'});
const logical=[...encoded.fragments,encoded.manifest],prefix='SPT-COMMIT300-20261023-b19d:';
const source={schema:'STOCK_NATIVE_300_COMMIT_SOURCE_V1',company:'NCT',key:fixture.key,digest:fixture.digest,
 memberId:fixture.memberId,requestId:fixture.requestId,planHash:encoded.manifest.planHash,planBytes:encoded.manifest.planBytes,
 logicalIds:logical.map(row=>row._id),physicalIds:logical.map(row=>'SPT-STAGE300-20261023-a32d:'+row._id)};
const clone=value=>Object.prototype.toString.call(value)==='[object Date]'?new Date(value.getTime()):Array.isArray(value)?value.map(clone)
 :value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
function setup(){
 const rows=new Map(logical.map((row,index)=>[source.physicalIds[index],clone({...row,_id:source.physicalIds[index]})]));
 const removed=[],writes=[];let attempt=0,tick=0,loseInsertReply=null,loseRemoveReply=false;
 const items={query:collection=>{assert.equal(collection,'StockProtocolTest');let predicate=()=>true,limit=2;
  const q={eq:(key,value)=>{assert.equal(key,'_id');predicate=row=>row._id===value;return q;},
   hasSome:(key,values)=>{assert.equal(key,'_id');predicate=row=>values.includes(row._id);return q;},limit:n=>{limit=n;return q;},
   find:async options=>{assert.equal(options.consistentRead,true);const all=[...rows.values()].filter(predicate);return{items:all.slice(0,limit).map(clone),totalCount:all.length};}};return q;},
  insert:async(collection,row)=>{assert.equal(collection,'StockProtocolTest');assert.match(row._id,/^SPT-COMMIT300-20261023-b19d:/);
   assert.equal(rows.has(row._id),false);rows.set(row._id,clone(row));writes.push(['insert',row._id]);if(loseInsertReply?.(row))throw Error('Lost seed insert response');return clone(row);},
  patch:(collection,id)=>{assert.equal(collection,'StockProtocolTest');assert.ok(id.startsWith(prefix));const fields=new Map(),removedFields=[];
   const p={setField:(field,value)=>{fields.set(field,clone(value));return p;},removeField:field=>{removedFields.push(field);return p;},
    run:async options=>{const row=rows.get(id);assert.equal(row?.company,options.condition.company.$eq);assert.equal(row?.stockCommitVersion,options.condition.stockCommitVersion.$eq);
     const next=clone(row);for(const key of removedFields)delete next[key];for(const[key,value]of fields)next[key]=value;
     rows.set(id,next);writes.push(['patch',id]);return clone(next);}};return p;},
  remove:async(collection,id,options)=>{assert.equal(collection,'StockProtocolTest');assert.equal(id,prefix+'NCTActivity:'+hash('NCT/PURCHASE','LOCK'));
   const row=rows.get(id);assert.equal(row?.company,options.condition.company.$eq);assert.equal(row?.attempt,options.condition.attempt.$eq);
   rows.delete(id);removed.push(clone(row));if(loseRemoveReply)throw Error('Unknown lock release reply');return clone(row);}};
 return{rows,writes,removed,items,run:(input,grant=false)=>verifyNative300Commit({items,createSdkConditionalStore,createSegmentedPlanCodec,
  createSegmentedFencedProof,same,copy,hash,source,input,newAttempt:()=>String(++attempt),allowConditionalLockRelease:grant,now:()=>++tick}),
  loseInsertReply:fn=>{loseInsertReply=fn;},loseRemoveReply:()=>{loseRemoveReply=true;}};
}
async function seed(f){for(let batch=0;batch<15;batch++){const result=await f.run({step:'SEED',batch});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.seededProducts,(batch+1)*20);}}
test('seed batches are exact, insert-only, cannot skip/reset/adopt and preserve source rows',async()=>{
 const f=setup(),before=JSON.stringify([...f.rows]);let result=await f.run({step:'SEED',batch:1});assert.equal(result.ok,false);assert.equal(JSON.stringify([...f.rows]),before);
 result=await f.run({step:'SEED',batch:0});assert.equal(result.ok,true);assert.equal(result.operationsAttempted.inserts,21);
 const seeded=JSON.stringify([...f.rows]);result=await f.run({step:'SEED',batch:0});assert.equal(result.ok,false);assert.equal(result.mutationAttempted,false);assert.equal(JSON.stringify([...f.rows]),seeded);
 assert.deepEqual([...f.rows].slice(0,12),JSON.parse(before));assert.equal(f.removed.length,0);
});
test('all executor paths default closed BEFORE any storage or mutation; browser extra grant fields refuse',async()=>{
 const f=setup();for(const step of ['ADVANCE','INTERRUPT_APPLY','REPLAY_COMPLETED']){
  const result=await f.run({step});assert.equal(result.blocked,true);assert.equal(result.operationsAttempted.queries,0);assert.equal(result.mutationAttempted,false);
 }
 await assert.rejects(f.run({step:'ADVANCE',allowConditionalLockRelease:true},true));assert.equal(f.writes.length,0);assert.equal(f.removed.length,0);
});
test('incomplete seed stops before acquiring/deleting lock; exact occupied root/result never bypass seed preflight',async()=>{
 const f=setup();await f.run({step:'SEED',batch:0});let result=await f.run({step:'ADVANCE'},true);assert.equal(result.ok,false);assert.equal(result.mutationAttempted,false);assert.equal(f.removed.length,0);
 const g=setup();g.rows.set(prefix+'NCTActivity:'+fixture.key,{_id:prefix+'NCTActivity:'+fixture.key,company:'NCT',action:'OCCUPIED'});
 result=await g.run({step:'SEED',batch:0});assert.equal(result.ok,false);assert.equal(result.mutationAttempted,false);assert.equal(g.writes.length,0);
});
test('lost seed reply retains exact partial batch with no retry/delete/reset and reports NOT confirmed',async()=>{
 const f=setup();f.loseInsertReply(row=>row._id.includes('StockProducts:'));const result=await f.run({step:'SEED',batch:0});
 assert.equal(result.ok,false);assert.equal(result.operationsAttempted.inserts,2);assert.equal(f.rows.size,14);assert.equal(f.removed.length,0);
});
test('exact shared executor applies901images, known partial failure blocks reads, SAME request resumes once, full inspection and completed replay preserve all quantities',async t=>{
 const f=setup();await seed(f);let result,invocations=0,injected=false,maxQueries=0;const totals={queries:0,inserts:0,patches:0,deletes:0};
 do{
  const control=[...f.rows.values()].find(row=>row._id===prefix+'NCTActivity:'+hash('NCT','STOCK_CONTROL'));
  const step=!injected&&control.pending?.phase==='APPLY'?'INTERRUPT_APPLY':'ADVANCE';
  result=await f.run({step},true);assert.equal(result.ok,true,JSON.stringify(result));assert.ok(++invocations<150);
  maxQueries=Math.max(maxQueries,result.operationsAttempted.queries);assert.equal(result.operationsAttempted.deletes,1);
  for(const key of Object.keys(totals))totals[key]+=result.operationsAttempted[key];
  if(step==='INTERRUPT_APPLY'){assert.equal(result.stage,'KNOWN_APPLY_INTERRUPTION_CONFIRMED');assert.equal(result.appliedBeforeFault,10);
   assert.equal(result.inspection.mixedActionableReadBlocked,true);injected=true;
  }else if(result.stage==='SAME_REQUEST_PENDING_CONFIRMED'){assert.equal(result.mixedActionableReadBlocked,true);assert.equal(result.progress.totalRecords,901);}
 }while(result.stage!=='NATIVE_901_IMAGE_APPLICATION_CONFIRMED');
 assert.equal(injected,true);const final=await f.run({step:'INSPECT'});assert.equal(final.ok,true);assert.equal(final.inspection.full901ImagesVerified,true);
 assert.equal(final.inspection.receiptCount,1);assert.equal(final.inspection.totalOnHand,30000);assert.equal(final.operationsAttempted.deletes,0);
 const before=JSON.stringify([...f.rows]);const replay=await f.run({step:'REPLAY_COMPLETED'},true);assert.equal(replay.ok,true);assert.equal(replay.stage,'COMPLETED_REPLAY_UNCHANGED');
 assert.equal(JSON.stringify([...f.rows]),before);assert.equal(f.removed.length,invocations+1);assert.equal([...f.rows.keys()].filter(id=>id.startsWith(prefix)).length,915);
 for(const key of Object.keys(totals))totals[key]+=replay.operationsAttempted[key];
 const finished=JSON.stringify([...f.rows]);assert.equal((await f.run({step:'ADVANCE'},true)).ok,false);assert.equal(JSON.stringify([...f.rows]),finished);
 for(const flag of ['originalBusinessCollectionsAccepted','wholeBusinessPreparationAccepted','productionCapacityAccepted','activationReady'])assert.equal(final[flag],false);
 const damaged=fixture.plan.writes.find(change=>change.collection==='StockProducts').after._id;
 f.rows.get(prefix+'StockProducts:'+damaged).onHand=99;const damageBefore=JSON.stringify([...f.rows]);
 assert.equal((await f.run({step:'INSPECT'})).ok,false);assert.equal(JSON.stringify([...f.rows]),damageBefore,'read inspection never repairs corrupt data');
 t.diagnostic(JSON.stringify({mockExecutorInvocations:invocations,conditionalMockLockRemovals:f.removed.length,maxQueriesPerInvocation:maxQueries,executorTotals:totals,retainedNewRecords:915,nativeExecutionAccepted:false}));
});
test('unknown native lock release reply is NOT a successful phase and never auto-retries or resets the retained request',async()=>{
 const f=setup();await seed(f);f.loseRemoveReply();const result=await f.run({step:'ADVANCE'},true);
 assert.equal(result.ok,false);assert.equal(result.operationsAttempted.deletes,1);assert.equal(f.removed.length,1);
 assert.equal([...f.rows.values()].filter(row=>row.action==='STOCK_PLAN_MANIFEST'&&row._id.startsWith(prefix)).length,1);
 const control=f.rows.get(prefix+'NCTActivity:'+hash('NCT','STOCK_CONTROL'));assert.equal(control.generation,0);assert.ok(control.pending);
 assert.equal([...f.rows.values()].some(row=>row.sourceKind==='PURCHASE_SOURCE'),false);
});
test('corrupt retained source blocks before creating any new fixture or lock',async()=>{
 const f=setup();f.rows.get(source.physicalIds[0]).payload+=' ';const result=await f.run({step:'SEED',batch:0});assert.equal(result.ok,false);assert.equal(result.mutationAttempted,false);assert.equal(f.writes.length,0);
});
test('generated Admin wrapper keeps native lock deletion gate CLOSED and cannot accept a browser permission boolean',async()=>{
 const f=setup(),sourceText=fs.readFileSync(require.resolve('../prototypes/stock-current-state/stockProtocol300Commit.web.js'),'utf8'),grants=[];
 assert.match(sourceText,/const NATIVE_TEST_LOCK_RELEASE_GRANTED=false;/);
 const api=vm.runInNewContext(sourceText.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyStock300Commit;',
  {items:f.items,createHash:crypto.createHash,randomBytes:crypto.randomBytes,Permissions:{Admin:'ADMIN'},webMethod:(grant,fn)=>{grants.push(grant);return fn;}});
 assert.deepEqual(grants,['ADMIN']);const blocked=await api({step:'ADVANCE'});assert.equal(blocked.blocked,true);assert.equal(blocked.operationsAttempted.queries,0);
 assert.equal((await api({step:'SEED',batch:0})).ok,true);assert.equal(f.removed.length,0);
});
