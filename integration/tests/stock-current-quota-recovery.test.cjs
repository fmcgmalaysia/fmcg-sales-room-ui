'use strict';
// Offline finite-capacity store around the ACTUAL existing authenticated root.
// Not a Wix quota experiment, upgrade, cleanup, lock deletion or native rehearsal.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {inspectStockRecovery}=require('../prototypes/stock-current-state/recovery-inspector.cjs');
const filename=require.resolve('./stock-current-warehouse-receipt-web.test.cjs');
const factory=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
 {require:createRequire(filename),__dirname:path.dirname(filename),Map,Buffer});
const copy=value=>JSON.parse(JSON.stringify(value));
async function fixture(boundary){
 const large=boundary==='fragment',f=await factory('NCT',true,large?300:2,large?100:20);
 const insert=f.store.insert.bind(f.store);let quota=Number.MAX_SAFE_INTEGER,triggered=false,fragments=0,positions=0,denied=0;
 const matches=(collection,row)=>boundary==='lock'?row._id===f.protocol.ids.lockId
  :boundary==='fragment'?row.action==='STOCK_PLAN_FRAGMENT'&&fragments===1
  :boundary==='domain'?collection==='StockPositions'&&positions===1:row.outcome?.ok===true;
 f.store.insert=async(collection,row)=>{
  if(!triggered&&matches(collection,row)){triggered=true;quota=f.db.size;}
  if(!f.db.has(collection+'/'+row._id)&&f.db.size>=quota){denied++;throw Error('SIMULATED_SITE_ITEM_QUOTA');}
  const result=await insert(collection,row);if(row.action==='STOCK_PLAN_FRAGMENT')fragments++;
  if(collection==='StockPositions')positions++;return result;
 };
 const envelope={company:'NCT',writer:'RECEIPT',input:f.initial.input,stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:f.initial.stockIdentity};
 return{...f,send:()=>f.api.saveWarehouseReceiptCurrent('NCT',f.initial),envelope,
  inspect:()=>inspectStockRecovery({company:'NCT',store:f.store,requestId:f.initial.requestId,memberId:'M',input:envelope,domainWrites:true}),
  restoreCapacity:()=>{quota=Number.MAX_SAFE_INTEGER;},stats:()=>({triggered,denied,fragments,positions})};
}
async function untilFailure(f){
 for(let attempt=0;attempt<100;attempt++){
  const result=await f.send();if(result.ok!==true&&!result.pending)return result;
  assert.equal(result.ok,false,'quota boundary must occur before success');
 }
 assert.fail('Quota boundary not reached');
}
async function finish(f){
 for(let attempt=0;attempt<100;attempt++){const result=await f.send();if(result.ok)return result;assert.equal(result.pending,true);}
 assert.fail('Original request did not complete');
}
for(const boundary of ['lock','fragment','domain','result'])test(`${boundary} quota exhaustion preserves original request and read barrier; restored capacity resumes without stock or receipt duplication`,async t=>{
 const f=await fixture(boundary),request=JSON.stringify(f.initial),failure=await untilFailure(f);
 assert.equal(f.stats().triggered,true);assert.ok(f.stats().denied>0);assert.equal(failure.pending,undefined);
 assert.equal(JSON.stringify(f.initial),request);assert.equal((await f.protocol.readControl()).generation,0);
 assert.equal(f.db.has(f.journal+'/'+f.protocol.ids.lockId),false,'known failed insert does not authorize retaining or stealing a lock');
 const report=await f.inspect(),before=JSON.stringify([...f.db]);assert.equal(report.recoveryPerformed,false);
 const pending=!!(await f.protocol.readControl()).pending;
 if(pending){
  assert.equal(report.status,'SAME_REQUEST_REVALIDATES_ON_RESUME');
  await assert.rejects(f.protocol.readSnapshot(()=>assert.fail('No mixed actionable inventory')),/pending/);
  assert.equal((await f.api.saveWarehouseReceiptCurrent('NCT',{...f.initial,requestId:'bbbbbbbb-1111-4111-8111-111111111111'})).ok,false);
 }else{
  assert.equal(report.status,'NO_RECEIPT_NOT_CONFIRMED');
  assert.equal([...f.db.values()].some(row=>row.action==='WAREHOUSE_RECEIPT_SAVED'),false);
  assert.equal([...f.db.keys()].some(key=>key.startsWith('StockPositions/')),false);
 }
 assert.equal(JSON.stringify([...f.db]),before,'failed retry/inspection does not repair, delete or change quantity');
 const manifest=[...f.db.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST'),capturedContexts=f.calls.filter(value=>value==='CONTEXT').length;
 const orphanFragments=manifest?[]:[...f.db].filter(([,row])=>row.action==='STOCK_PLAN_FRAGMENT').map(([key])=>key);
 f.restoreCapacity();const result=await finish(f);assert.equal(result.stockGeneration,1);
 assert.deepEqual(copy(await f.send()),copy(result));assert.equal(JSON.stringify(f.initial),request);
 assert.equal((await f.protocol.readControl()).pending,null);assert.equal((await f.protocol.readControl()).generation,1);
 assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
 assert.equal([...f.db.values()].filter(row=>row.action==='STOCK_PLAN_MANIFEST').length,1);
 assert.ok(orphanFragments.every(key=>f.db.has(key)),'pre-root orphan evidence is retained, not automatically deleted');
 if(manifest){
  assert.deepEqual([...f.db.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST'),manifest);
  assert.equal(f.calls.filter(value=>value==='CONTEXT').length,capturedContexts,'published plan resumes without recapturing quantities');
 }
 const rows=[...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE');
 assert.equal(rows.length,boundary==='fragment'?300:2);assert.equal(rows.reduce((sum,row)=>sum+row.onHand,0),boundary==='fragment'?30000:200);
 const finalInspection=await f.inspect();assert.equal(finalInspection.receiptVerified,true);
 assert.equal(finalInspection.status,boundary==='fragment'?'PAGED_RESULT_INSPECTION_ONLY':'CONFIRMED_RESULT');
 assert.equal(finalInspection.currentImagesVerified,boundary!=='fragment','one recovery page cannot verify901images');
 t.diagnostic('QUOTA_EVIDENCE '+JSON.stringify({boundary,products:rows.length,pendingAtFailure:pending,retainedOrphanFragments:orphanFragments.length,
  generation:1,receiptCount:1,inspection:finalInspection.status,nativeCapacityAccepted:false}));
});
