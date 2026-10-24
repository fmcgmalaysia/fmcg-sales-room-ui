'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {build}=require('../prototypes/stock-current-state/build-native-plan-staging-fixture.cjs');
const {verifyNativePlanStaging}=require('../prototypes/stock-current-state/native-plan-staging-probe.cjs');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {createSegmentedPlanCodec,same}=require('../prototypes/stock-current-state/segmented-plan.cjs');
const fixture=require('../prototypes/stock-current-state/native-plan-staging.fixture.json');
const copy=v=>JSON.parse(JSON.stringify(v)),interrupt={step:'INTERRUPT_AFTER_FIRST_FRAGMENT'},resume={step:'RESUME_EXACT_RETAINED_PLAN'};
function setup({lostReply=false,corruptRead=false}={}){
 const rows=new Map(),calls=[];let tick=0;
 const items={query:collection=>{assert.equal(collection,'StockProtocolTest');let ids=[];const q={hasSome:(key,values)=>{assert.equal(key,'_id');ids=values;return q;},
  limit:()=>q,find:async options=>{assert.deepEqual(copy(options),{consistentRead:true,returnTotalCount:true});calls.push('READ');
   const result=ids.filter(id=>rows.has(id)).map(id=>copy(rows.get(id)));
   if(corruptRead&&result.length)result[0].payload+=' ';
   return{items:result,totalCount:result.length};}};return q;},
  insert:async(collection,row)=>{assert.equal(collection,'StockProtocolTest');assert.match(row._id,/^SPT-STAGE300-20261023-a32d:/);
   calls.push(row.action);assert.equal(rows.has(row._id),false);rows.set(row._id,copy(row));if(lostReply)throw Error('Unknown insert reply');return copy(row);},
  patch:()=>assert.fail('No native patch'),remove:()=>assert.fail('No native deletion')};
 return{rows,calls,items,run:input=>verifyNativePlanStaging({items,createSdkConditionalStore,createSegmentedPlanCodec,same,fixture,input,now:()=>++tick})};
}
test('frozen native fixture retains exact original business plan; current actual300 root adds only confirmed PO display labels',async()=>{
 const current=await build(),positions=current.plan.writes.filter(w=>w.collection==='StockPositions');
 assert.equal(positions.length,300);assert.ok(positions.every(w=>w.after.poNumber==='PO-001'));
 // The native continuation/outcome is UNKNOWN. Never regenerate its retained
 // fixture or compiled probe just to accommodate newer display-only metadata.
 const businessOnly=copy(current);
 for(const write of businessOnly.plan.writes)if(write.collection==='StockPositions')delete write.after.poNumber;
 assert.deepEqual(businessOnly,fixture);
 assert.ok(fixture.plan.writes.filter(w=>w.collection==='StockPositions').every(w=>!Object.hasOwn(w.after,'poNumber')));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../prototypes/stock-current-state/native-plan-staging.fixture.json'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),
  '85144205ea40633f4f3556e4ed44afc7003d28ec8cc99a35851114e86d59bae1');
 assert.equal(fixture.plan.writes.length,901);assert.equal(fixture.plan.writes.filter(w=>w.after.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
 assert.equal(fixture.plan.writes.filter(w=>w.collection==='StockProducts').length,300);
 assert.equal(fixture.plan.writes.filter(w=>w.collection==='StockPositions').length,300);
 assert.equal(fixture.plan.writes.filter(w=>w.collection==='StockClaims').length,300);
});
test('exact first-fragment interruption then explicit continuation preserves every901image and publishes manifest LAST',async()=>{
 const f=setup(),first=await f.run(interrupt);assert.equal(first.ok,true);assert.equal(first.stage,'INTERRUPTED_WITHOUT_MANIFEST');
 assert.equal(f.rows.size,1);assert.equal([...f.rows.values()].some(row=>row.action==='STOCK_PLAN_MANIFEST'),false);
 const retained=copy([...f.rows]);const final=await f.run(resume);
 assert.equal(final.ok,true);assert.equal(final.fullPlanReadbackVerified,true);assert.equal(final.corruptCopyRejected,true);
 assert.equal(final.stage,'EXACT_300_PLAN_NATIVE_STAGING_CONFIRMED');assert.deepEqual([...f.rows][0],retained[0]);
 assert.equal(final.operationsAttempted.queries,2);assert.equal(final.operationsAttempted.inserts,final.fragmentCount);
 assert.equal(final.retainedCount,final.fragmentCount+1);assert.equal(f.calls.filter(s=>s!=='READ').at(-1),'STOCK_PLAN_MANIFEST');
 for(const flag of ['wholeBusinessPreparationAccepted','wholeCommitRecoveryAccepted','productionCapacityAccepted','activationReady'])assert.equal(final[flag],false);
 assert.equal(final.operationsAttempted.deletes,0);assert.equal(final.operationsAttempted.patches,0);
});
test('wrong or browser-expanded input refuses before storage',async()=>{
 for(const input of [{step:'OTHER'},{...interrupt,collection:'NCTActivity'},null]){
  const f=setup();await assert.rejects(f.run(input));assert.equal(f.calls.length,0);
 }
});
test('interruption grant never resets occupied fixed namespace and continuation never replays completed fixture',async()=>{
 const f=setup();await f.run(interrupt);const before=JSON.stringify([...f.rows]);
 const repeated=await f.run(interrupt);assert.equal(repeated.ok,false);assert.equal(repeated.mutationAttempted,false);assert.equal(JSON.stringify([...f.rows]),before);
 await f.run(resume);const completed=JSON.stringify([...f.rows]);const replay=await f.run(resume);
 assert.equal(replay.ok,false);assert.equal(replay.mutationAttempted,false);assert.equal(JSON.stringify([...f.rows]),completed);
});
test('lost insert reply retains fixture and does NOT retry, clean up or claim planned interruption success',async()=>{
 const f=setup({lostReply:true}),result=await f.run(interrupt);
 assert.equal(result.ok,false);assert.equal(result.operationsAttempted.inserts,1);assert.equal(f.rows.size,1);
 assert.equal(f.calls.filter(s=>s==='STOCK_PLAN_FRAGMENT').length,1);assert.equal(result.activationReady,false);
});
test('corrupt strong readback stops without automatically continuing or replacing the retained fragment',async()=>{
 const f=setup({corruptRead:true}),result=await f.run(interrupt);assert.equal(result.ok,false);assert.equal(f.rows.size,1);
 assert.equal(result.operationsAttempted.inserts,1);const before=JSON.stringify([...f.rows]);
 assert.equal((await f.run(resume)).ok,false);assert.equal(JSON.stringify([...f.rows]),before);
});
test('continuation before a confirmed first fragment performs no writes',async()=>{
 const f=setup(),result=await f.run(resume);assert.equal(result.ok,false);assert.equal(result.mutationAttempted,false);assert.equal(f.rows.size,0);
});
test('generated Admin module uses exact shared implementations and exports only bounded staging function',async()=>{
 const source=fs.readFileSync(require.resolve('../prototypes/stock-current-state/stockProtocolPlanStaging.web.js'),'utf8');
 const f=setup(),grants=[];
 const api=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyStockPlanStaging;',
  {items:f.items,createHash:crypto.createHash,Permissions:{Admin:'ADMIN'},webMethod:(grant,fn)=>{grants.push(grant);return fn;}});
 assert.deepEqual(grants,['ADMIN']);const result=await api(interrupt);assert.equal(result.ok,true);assert.equal(f.rows.size,1);
 assert.equal(result.productionCapacityAccepted,false);assert.equal(source.includes('const fixture='),true);
});
