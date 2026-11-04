'use strict';
// Read-only diagnostic of CURRENT unmodified modules. No Wix/network adapter.
// Expected deficiencies are observations, not acceptance of a proposed replacement.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const testFile=path.resolve(__dirname,'../../tests/purchase-operations.test.cjs');
const localRequire=createRequire(testFile);
const factory=vm.runInNewContext(fs.readFileSync(testFile,'utf8')+'\nfixture;',{
 require:name=>name==='node:test'?()=>{}:localRequire(name),Map,Buffer
});
const load=localRequire('./load-master-module.cjs');
const {taskEditVersion}=load('purchaseTaskIdentity.js');
const cp=x=>JSON.parse(JSON.stringify(x));
const rid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const actions=f=>[...f.rows.values()].filter(x=>x.action).reduce((a,x)=>(a[x.action]=(a[x.action]||0)+1,a),{});
function request(f,n=1,price=16){
 const row=f.workspace().tasks.find(x=>x.id===f.id);
 return {...f.base,requestId:rid(n),operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:row.procurement.revision||'',totalCtn:200,transportMode:'SUPPLIER_DELIVER',draftPlan:true,reason:'Offline boundary probe',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:200,freeCtn:0,prices:{lpPc:price/16,lpCtn:price,disc1:0,disc2:0,disc3:0}}}};
}
function meter(f){
 const calls=[];
 for(const method of ['all','read','one','insert','update','remove']){
  const original=f.store[method];
  f.store[method]=async(...args)=>{const result=await original(...args);calls.push({method,collection:args[0],returned:Array.isArray(result)?result.length:result?1:0});return result;};
 }
 return {calls,summary:()=>({allCalls:calls.filter(x=>x.method==='all'),allReturned:calls.filter(x=>x.method==='all').reduce((n,x)=>n+x.returned,0),pointReads:calls.filter(x=>['read','one'].includes(x.method)).length,writes:calls.filter(x=>['insert','update','remove'].includes(x.method)).length})};
}
function workspaceReader(f){
 const pages=[];
 function query(collection){
  let predicate=()=>true,size=50;
  const q={eq(k,v){const p=predicate;predicate=x=>p(x)&&x[k]===v;return q;},ne(k,v){const p=predicate;predicate=x=>p(x)&&x[k]!==v;return q;},isEmpty(k){const p=predicate;predicate=x=>p(x)&&(x[k]==null||x[k]==='');return q;},or(other){const p=predicate;predicate=x=>p(x)||other.matches(x);return q;},hasSome(k,values){const p=predicate;predicate=x=>p(x)&&values.includes(x[k]);return q;},matches:x=>predicate(x),limit(n){size=n;return q;},async find(){
   const rows=[...f.rows].filter(([key,row])=>key.startsWith(collection+'/')&&predicate(row)).map(([,row])=>cp(row));
   const page=offset=>{const items=rows.slice(offset,offset+size);pages.push({collection,returned:items.length});return {items,hasNext:()=>offset+size<rows.length,next:async()=>page(offset+size)};};return page(0);
  }};return q;
 }
 const source=fs.readFileSync(path.resolve(__dirname,'../../backend/purchaseWorkspace.web.js'),'utf8').replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');
 const bindings=Object.assign({},...['purchaseProjection.js','purchaseProgress.js','purchaseOrderWorkflow.js','purchaseMarginRefresh.js','purchaseReceiptInfo.js','purchaseOperationJournal.js'].map(name=>load(name)));
 const read=vm.runInNewContext(source+'\ngetPurchaseWorkspace',{...bindings,webMethod:(_p,fn)=>fn,Permissions:{SiteMember:1},wixData:{query},getPurchaseStaffContext:async()=>f.base.staff,readCustomerShortNames:async ids=>ids.map(customerId=>({customerId,shortName:'TEST'}))});
 return {read,pages};
}
const report={date:'2026-11-03',kind:'OFFLINE_CURRENT_CODE_DIAGNOSTIC',liveWrites:0,productionCodeChanges:0,adapter:'Existing in-memory fixture; immediate reads and unique-ID inserts. Not proof of Wix latency, replication or atomic transactions.',checks:[],findings:[],readBudgets:[]};
async function check(name,fn){const detail=await fn();report.checks.push({name,status:'OBSERVED_AS_ASSERTED',...detail});}
(async()=>{
 await check('Exact original request retry creates no additional rows',async()=>{
  const f=factory(),r=request(f);await f.operate(r);const before=cp([...f.rows]),m=meter(f);const result=await f.operate(r);
  assert.equal(result.ok,true);assert.deepEqual(cp([...f.rows]),before);assert.equal(m.summary().allReturned,0);
  return {reads:m.summary()};
 });
 await check('Same request identity with changed input is rejected',async()=>{
  const f=factory(),r=request(f);await f.operate(r);const before=cp([...f.rows]);
  await assert.rejects(f.operate({...r,input:{...r.input,totalCtn:199}}),/same save identity|different changes/i);assert.deepEqual(cp([...f.rows]),before);return {};
 });
 await check('Identical costing under a new request currently creates business revisions',async()=>{
  const f=factory();await f.operate(request(f));const before=actions(f),task=cp(f.task());const result=await f.operate(request(f,2));const after=actions(f);
  assert.equal(result.ok,true);assert.deepEqual(cp(f.task()),task);
  const added=Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v-(before[k]||0)]).filter(([,v])=>v));
  assert.equal(added.PURCHASE_PLAN_SAVED,1);report.findings.push({id:'D01',severity:'UNNECESSARY_WRITE',summary:'Identical costing saved with fresh request creates business revisions despite unchanged task',added});return {added};
 });
 for(const boundary of ['TASK_UPDATE_AFTER','PLAN_EVENT_BEFORE','RESULT_BEFORE','RESULT_AFTER']){
  await check('Original request resumes after '+boundary,async()=>{
   const f=factory();await f.operate(request(f));const r=request(f,2,32),before=actions(f);let hit=false;
   const update=f.store.update,insert=f.store.insert;
   f.store.update=async(c,row)=>{const result=await update(c,row);if(!hit&&boundary==='TASK_UPDATE_AFTER'&&c==='NCTTasks'){hit=true;throw Error('INJECTED_RESPONSE_LOSS');}return result;};
   f.store.insert=async(c,row)=>{const match=!hit&&(boundary==='PLAN_EVENT_BEFORE'&&row.action==='PURCHASE_PLAN_SAVED'||boundary.startsWith('RESULT_')&&row.action==='PURCHASE_OPERATION_RESULT');if(match){hit=true;if(boundary!=='RESULT_AFTER')throw Error('INJECTED_RESPONSE_LOSS');}const result=await insert(c,row);if(match)throw Error('INJECTED_RESPONSE_LOSS');return result;};
   await assert.rejects(f.operate(r),/INJECTED_RESPONSE_LOSS/);assert.equal(hit,true);
   const interruptedRows=actions(f);let observed;try{const row=f.workspace().tasks.find(x=>x.id===f.id);observed={readSucceeded:true,taskLpCtn:f.task().lpCtn,planAverage:row.procurement.costing?.averageCostCtn??null};}catch(e){observed={readSucceeded:false,error:e.message};}
   f.store.update=update;f.store.insert=insert;
   if(observed.readSucceeded&&observed.taskLpCtn!==observed.planAverage){
    await assert.rejects(f.operate(request(f,3,48)),/prior procurement save is pending/i);observed.newPlanBlocked=true;
   }
   const result=await f.operate(r);assert.equal(result.ok,true);
   const after=actions(f);assert.equal(after.PURCHASE_PLAN_SAVED-before.PURCHASE_PLAN_SAVED,1);assert.equal(after.PURCHASE_OPERATION_RESULT-before.PURCHASE_OPERATION_RESULT,1);
   assert.equal(f.task().lpCtn,32);const complete=cp([...f.rows]);await f.operate(r);assert.deepEqual(cp([...f.rows]),complete);
   if(observed.readSucceeded&&observed.taskLpCtn!==observed.planAverage)report.findings.push({id:'D02',severity:'PARTIAL_STATE_VISIBLE_IN_PROJECTION',boundary,observed});
   return {interruptedRows,observed,finalAddedPlanEvents:1,note:'Caught exception with normal finally cleanup; not process termination.'};
  });
 }
 for(const historicalRows of [0,1000,10000]){
  await check('Actual workspace handler query volume with '+historicalRows+' unrelated rows',async()=>{
   const f=factory();await f.operate(request(f));
   for(let i=0;i<historicalRows;i++)f.rows.set('NCTActivity/H'+i,{_id:'H'+i,title:'H'+i,action:'DIAGNOSTIC_UNRELATED_HISTORY',result:'SAVED',description:'UNRELATED',activityTime:'2020-01-01T00:00:00Z',details:{}});
   const before=cp([...f.rows]),reader=workspaceReader(f),result=await reader.read('NCT');assert.equal(result.tasks.length,2);assert.deepEqual(cp([...f.rows]),before);
   return {historicalRows,pages:reader.pages.length,rowsReturned:reader.pages.reduce((n,x)=>n+x.returned,0),activityRows:reader.pages.filter(x=>x.collection==='NCTActivity').reduce((n,x)=>n+x.returned,0),writes:0,note:'Actual handler and business projections; simulated query adapter and external staff/name services. No measured Wix latency.'};
  });
 }
 for(const historicalRows of [0,1000,10000]){
  await check('Save read amplification with '+historicalRows+' unrelated historical rows',async()=>{
   const f=factory();await f.operate(request(f));
   for(let i=0;i<historicalRows;i++)f.rows.set('NCTActivity/H'+i,{_id:'H'+i,title:'H'+i,action:'DIAGNOSTIC_UNRELATED_HISTORY',result:'SAVED',description:'UNRELATED',activityTime:'2020-01-01T00:00:00Z',details:{note:'Offline neutral row; no business effect'}});
   const r=request(f,2,32),m=meter(f);await f.operate(r);const budget={historicalRows,activeFixtureTasks:2,...m.summary()};report.readBudgets.push(budget);assert.equal(f.task().lpCtn,32);return {budget};
  });
 }
 assert.ok(report.readBudgets[2].allReturned>report.readBudgets[0].allReturned+10000);
 report.sourceHashes=Object.fromEntries(['purchaseOperations.js','purchaseOperationJournal.js','purchaseProjection.js','plannerAllocation.js'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../backend',name))).digest('hex')]));
 report.conclusion='Original-request retry survives tested caught errors; same-value costing creates unnecessary events; current reads still depend on total history. See partial-state observations before considering a current-state cutover.';
 fs.writeFileSync(process.argv[2]||path.join(__dirname,'save-boundary-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({checks:report.checks.length,findings:report.findings,readBudgets:report.readBudgets.map(x=>({historicalRows:x.historicalRows,allCalls:x.allCalls.length,allReturned:x.allReturned}))},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
