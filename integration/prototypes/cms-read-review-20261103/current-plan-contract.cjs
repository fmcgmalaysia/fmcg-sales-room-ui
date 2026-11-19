'use strict';
// OFFLINE feasibility experiment. No production module imports this file.
// Two hooks are injected ONLY into an in-memory copy of the actual PLAN writer.
// Existing business calculations/journal remain the oracle, not reimplemented here.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setup,request}=require('./read-growth-contract.cjs');
const load=require('../../tests/load-master-module.cjs');
const {confirmedPurchaseState,readPurchasePlan,readPurchaseShares}=load('purchasePlan.js');
const {taskEditVersion}=load('purchaseTaskIdentity.js');
const {operationId,canonical}=load('purchaseOperationJournal.js');
const cp=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
const FIELD='offlineProcurementReadState'; // proposed structure, NOT a production field
const backend=path.resolve(__dirname,'../../backend');
const source=fs.readFileSync(path.join(backend,'purchaseOperations.js'),'utf8');
const priceKeys=['lpPc','lpCtn','disc1','disc2','disc3'];
const report={schema:1,baseline:'4d26f89',productionWrites:0,productionSourceChanges:0,checks:[],growth:[],
 limitations:['Only PLAN for existing root tasks is instrumented; PO, ADD_SOURCE, SPECIAL and other writers are not migrated.',
 'Initialization and commit oracle still read full in-memory history. This does not solve save preparation or full-page dependencies.',
 'No Wix transaction, conditional-update, actual query latency or million-row capacity claim.',
 'Task metadata is a feasibility candidate; storage field, migration and production writes are NOT approved.',
 'Handled exceptions run existing finally cleanup; abrupt worker termination and stale-lock takeover are NOT simulated as recovered.']};
const check=(id,detail)=>report.checks.push({id,...detail});
function context(f){const rows=c=>[...f.rows].filter(([key])=>key.startsWith(c+'/')).map(([,r])=>cp(r));return {company:'NCT',tasks:rows('NCTTasks'),activity:rows('NCTActivity')};}
function confirmed(f,rootId){
 const raw=context(f),view=confirmedPurchaseState(raw);
 const members=view.tasks.filter(t=>t.title===rootId||t.customerDemandTaskId===rootId);
 const state={members:members.map(t=>({id:t.title,orderId:t.description,lineId:t.imageAltText,version:taskEditVersion(t),
  prices:Object.fromEntries(priceKeys.map(k=>[k,t[k]??null])),plan:cp(readPurchasePlan(t,view.activity))})).sort((a,b)=>a.id.localeCompare(b.id)),shares:cp(readPurchaseShares(rootId,view.activity))};
 return {state,pending:view.pending.filter(p=>p.rootId===rootId||members.some(t=>t.title===p.taskId))};
}
function instrumentedFactory(hooks){
 let text=source,bindings={};
 text=text.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{
  const exports=target.startsWith('backend/')?load(target.slice(8)):require(target);
  for(const part of names.split(',')){const [name,alias]=part.trim().split(/\s+as\s+/);bindings[alias||name]=exports[name];}return '';
 });
 const stage='        await each(plan.updates,async change=>{';
 const commit='        return {ok:true,company,requestId,operation,savedAt:plan.time,taskIds:plan.updates.map(change=>change.id)};';
 assert.equal(text.split(stage).length,2);assert.equal(text.split(commit).length,2);
 text=text.replace(stage,'        if(operation===\'PLAN\')await offline.stage({company,requestId,staff,plan});\n'+stage)
  .replace(commit,'        if(operation===\'PLAN\')await offline.commit({company,requestId,staff,plan});\n'+commit).replace(/^export /gm,'');
 return vm.runInNewContext('(function(){'+text+'\nreturn createPurchaseOperations;})()',{
  ...bindings,offline:hooks,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math
 });
}
async function harness(){
 const f=setup(),native={...f.store};let fault='',armed=false,pause=null;
 const stats={metadataWrites:0,pointReads:0,historyReads:0},hit=name=>{if(armed&&fault===name){armed=false;throw Error('OFFLINE_FAULT:'+name);}};
 // Initialization is an explicit offline maintenance operation, never a read side effect.
 async function initialize(rootId){const observed=confirmed(f,rootId);if(observed.pending.length)throw Error('INITIALIZATION_PENDING');
  const row=await native.read('NCTTasks',rootId);if(!row)throw Error('INITIALIZATION_MISSING');
  if(row[FIELD]){if(canonical(row[FIELD].confirmed)!==canonical(observed.state))throw Error('INITIALIZATION_CONFLICT');return;}
  await native.update('NCTTasks',{...row,[FIELD]:{schema:1,company:'NCT',rootId,revision:hash(observed.state),confirmed:observed.state,pending:null}});stats.metadataWrites++;
 }
 const rootFor=plan=>{assert.equal(plan.updates.length,1);return plan.updates[0].sharesRootId||plan.updates[0].id;};
 const hooks={
  async stage({company,requestId,staff,plan}){
   const rootId=rootFor(plan),row=await native.read(company+'Tasks',rootId),state=row?.[FIELD];
   if(!state||state.company!==company||state.rootId!==rootId)throw Error('CURRENT_STATE_UNAVAILABLE');
   const key=operationId(company+'/PURCHASE',requestId,staff.memberId),pending={key,requestId,taskId:plan.updates[0].id};
   if(state.pending){if(canonical(state.pending)!==canonical(pending))throw Error('ORIGINAL_REQUEST_REQUIRED');return;}
   // A retry after a lost response to the metadata commit must not re-stage an old state.
   const eventId=operationId(company,requestId,staff.memberId,plan.updates[0].id,'PURCHASE_PLAN_SAVED');
   if(state.confirmed.members.find(m=>m.id===plan.updates[0].id)?.plan.revision===eventId)return;
   const prior=state.confirmed.members.find(m=>m.id===plan.updates[0].id),change=plan.updates[0];
   if(!prior||prior.version!==change.expected||prior.plan.revision!==change.planRevision||state.confirmed.shares.revision!==change.sharesRevision)throw Error('CURRENT_STATE_CONFLICT');
   hit('BEFORE_STAGE');await native.update(company+'Tasks',{...row,[FIELD]:{...state,pending}});stats.metadataWrites++;hit('AFTER_STAGE');
   if(pause)await pause();
  },
  async commit({company,requestId,staff,plan}){
   const rootId=rootFor(plan),row=await native.read(company+'Tasks',rootId),state=row?.[FIELD];
   const eventId=operationId(company,requestId,staff.memberId,plan.updates[0].id,'PURCHASE_PLAN_SAVED');
   if(!state?.pending&&state?.confirmed.members.find(m=>m.id===plan.updates[0].id)?.plan.revision===eventId)return;
   if(state?.pending?.key!==operationId(company+'/PURCHASE',requestId,staff.memberId))throw Error('CURRENT_STATE_OWNER_CONFLICT');
   // Explicit full-history oracle on the WRITE path; candidate normal reads below never call this.
   const observed=confirmed(f,rootId);if(observed.pending.length)throw Error('BUSINESS_FACTS_INCOMPLETE');
   hit('BEFORE_COMMIT');await native.update(company+'Tasks',{...row,[FIELD]:{schema:1,company,rootId,revision:hash(observed.state),confirmed:observed.state,pending:null}});stats.metadataWrites++;hit('AFTER_COMMIT');
  }
 };
 f.store.update=async(c,row)=>{if(c==='NCTTasks'){hit('BEFORE_TASK');const out=await native.update(c,row);hit('AFTER_TASK');return out;}return native.update(c,row);};
 f.store.insert=async(c,row)=>{hit('BEFORE_'+row.action);const out=await native.insert(c,row);hit('AFTER_'+row.action);return out;};
 f.operate=instrumentedFactory(hooks)({store:f.store});
 await initialize(f.id);await initialize(f.second);
 async function read(company,rootId){
  if(!['NCT','GHR'].includes(company))throw Error('INVALID_COMPANY');
  stats.pointReads++;const row=await native.read(company+'Tasks',rootId),state=row?.[FIELD];
  if(!state||state.schema!==1||state.company!==company||state.rootId!==rootId||hash(state.confirmed)!==state.revision)throw Error('CURRENT_STATE_UNAVAILABLE');
  if(!state.pending){for(const member of state.confirmed.members){const task=member.id===rootId?row:await native.read(company+'Tasks',member.id);if(member.id!==rootId)stats.pointReads++;
   if(!task||task.title!==member.id||task.description!==member.orderId||task.imageAltText!==member.lineId||taskEditVersion(task)!==member.version)throw Error('CURRENT_STATE_CONFLICT');}}
  return {confirmed:cp(state.confirmed),blocked:Boolean(state.pending),requestId:state.pending?.requestId||null};
 }
 return {f,stats,read,initialize,arm:name=>{fault=name;armed=true;},pause:fn=>{pause=fn;},native};
}
async function compare(h){const got=await h.read('NCT',h.f.id),expected=confirmed(h.f,h.f.id);assert.equal(got.blocked,false);assert.equal(expected.pending.length,0);assert.equal(canonical(got.confirmed),canonical(expected.state));return got;}
async function run(){
 const h=await harness(),{f}=h,first=request(f,1);await f.operate(first);await compare(h);
 const baselineRows=f.rows.size,baselineMeta=h.stats.metadataWrites;await f.operate(first);assert.equal(f.rows.size,baselineRows);assert.equal(h.stats.metadataWrites,baselineMeta);
 check('C01',{observed:'Actual PLAN plus two in-memory hooks yields the same confirmed plan/prices/shares. Original request replay adds no rows or metadata writes.'});

 const boundaries=['BEFORE_STAGE','AFTER_STAGE','BEFORE_TASK','AFTER_TASK','BEFORE_PURCHASE_PRICE_SAVED','AFTER_PURCHASE_PRICE_SAVED',
  'BEFORE_PURCHASE_SOURCE_SHARES_SAVED','AFTER_PURCHASE_SOURCE_SHARES_SAVED','BEFORE_PURCHASE_PLAN_SAVED','AFTER_PURCHASE_PLAN_SAVED',
  'BEFORE_COMMIT','AFTER_COMMIT','BEFORE_PURCHASE_OPERATION_RESULT','AFTER_PURCHASE_OPERATION_RESULT'];
 const faults=[];
 for(const boundary of boundaries){
  const t=await harness();await t.f.operate(request(t.f,1));const before=(await compare(t)).confirmed,r=request(t.f,2,32,210);
  t.arm(boundary);await assert.rejects(t.f.operate(r),new RegExp('OFFLINE_FAULT:'+boundary));
  const observed=await t.read('NCT',t.f.id),legacy=confirmed(t.f,t.f.id);
  if(observed.blocked)assert.equal(canonical(observed.confirmed),canonical(before));
  else if(boundary==='BEFORE_STAGE')assert.equal(canonical(observed.confirmed),canonical(before));else await compare(t);
  const resultId=operationId(operationId('NCT/PURCHASE',r.requestId,t.f.base.staff.memberId),'RESULT');
  assert.ok(!t.f.rows.has('NCTActivity/'+resultId)||!observed.blocked,'RESULT must not precede current-state commit');
  await t.f.operate(r);await compare(t);const count=t.f.rows.size,meta=t.stats.metadataWrites;await t.f.operate(r);assert.equal(t.f.rows.size,count);assert.equal(t.stats.metadataWrites,meta);
  faults.push({boundary,readerBlocked:observed.blocked,legacyPending:legacy.pending.length,recoveredUsingSameRequest:true});
 }
 check('C02',{observed:'14 handled interruption/lost-response boundaries recover through the original request, with no repeated business rows.',faults});
 assert.ok(faults.some(x=>x.readerBlocked&&x.legacyPending===0));
 assert.ok(faults.some(x=>!x.readerBlocked&&x.legacyPending===1));
 check('C03',{observed:'Two acceptance failures: PREPARED exists before the candidate pending marker, so candidate misses a pending save; after final business event but before state publication candidate blocks a save already confirmed by the existing reader. These are NOT accepted behavior changes.'});

 // Keep the same production journal lock while intentionally pausing one actual writer.
 const concurrent=await harness();await concurrent.f.operate(request(concurrent.f,1));
 const a=request(concurrent.f,2,32),b=request(concurrent.f,3,48);let entered,release;
 const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);concurrent.pause(async()=>{entered();await gate;});
 const saving=concurrent.f.operate(a);await reached;
 await assert.rejects(concurrent.f.operate(b),/save is still processing/);assert.equal((await concurrent.read('NCT',concurrent.f.id)).blocked,true);
 const other=await concurrent.read('NCT',concurrent.f.second);assert.equal(other.blocked,false);release();await saving;await compare(concurrent);
 check('C04',{observed:'Actual company journal rejects a second concurrent PLAN; unrelated root remains readable. This does not prove all other writers share the same coordination.'});

 // A pending original request cannot be replaced by a new request identity.
 const pending=await harness();await pending.f.operate(request(pending.f,1));const original=request(pending.f,2,32);
 pending.arm('AFTER_TASK');await assert.rejects(pending.f.operate(original),/OFFLINE_FAULT/);
 await assert.rejects(pending.f.operate(request(pending.f,3,48)));await pending.f.operate(original);await compare(pending);
 check('C05',{observed:'A replacement request is rejected while the original save is incomplete; the original request still recovers.'});

 // No time/month argument exists in the direct reader; old confirmed state stays valid.
 const root=f.task(),state=root[FIELD];for(const member of state.confirmed.members){member.plan.updatedAt='2026-10-31T23:59:00Z';member.plan.confirmedAt=null;}state.revision=hash(state.confirmed);
 const oldMonth=await h.read('NCT',f.id);assert.equal(oldMonth.confirmed.members[0].plan.totalCtn,200);assert.equal(oldMonth.blocked,false);
 check('C06',{observed:'An unchanged prior-month confirmed plan is readable without fetching old-month Activity. This is a stored-state date fixture, not a real month-close test.'});

 for(const count of [0,1000,100000]){
  for(let i=(report.growth.at(-1)?.unrelatedRows||0);i<count;i++)f.rows.set('NCTActivity/NOISE'+i,{_id:'NOISE'+i,action:'OFFLINE_UNRELATED',details:{}});
  const rowCount=f.rows.size,mutations=f.mutations.length,reads=h.stats.pointReads,queries=f.queries.length;
  const result=await h.read('NCT',f.id);assert.equal(f.rows.size,rowCount);assert.equal(f.mutations.length,mutations);assert.equal(f.queries.length,queries);
  report.growth.push({unrelatedRows:count,pointReads:h.stats.pointReads-reads,activityQueries:0,writes:0,responseBytes:Buffer.byteLength(JSON.stringify(result)),resultHash:hash(result)});
 }
 assert.equal(new Set(report.growth.map(r=>r.resultHash)).size,1);assert.ok(report.growth.every(r=>r.pointReads===1));
 check('C07',{observed:'For this one-root PLAN reader, 0/1000/100000 unrelated rows require one task-ID read, no Activity query and no writes. Full Purchase page is NOT replaced.'});

 await assert.rejects(h.read('GHR',f.id),/UNAVAILABLE/);const save=cp(f.task()[FIELD]);delete f.task()[FIELD];
 await assert.rejects(h.read('NCT',f.id),/UNAVAILABLE/);f.task()[FIELD]=cp(save);f.task()[FIELD].confirmed.members[0].plan.totalCtn=999;
 await assert.rejects(h.read('NCT',f.id),/UNAVAILABLE/);f.task()[FIELD]=cp(save);
 check('C08',{observed:'Wrong company, missing state and payload/hash mismatch stop explicitly; no zero default, automatic initialization or history fallback. Hash is an integrity check, not a security signature.'});

 const init=await harness(),writes=init.stats.metadataWrites;await init.initialize(init.f.id);assert.equal(init.stats.metadataWrites,writes);
 await init.f.operate(request(init.f,1));const beforeInit=cp(init.f.task()[FIELD]);init.f.task()[FIELD].confirmed.members[0].plan.totalCtn=123;
 await assert.rejects(init.initialize(init.f.id),/CONFLICT/);init.f.task()[FIELD]=beforeInit;
 init.arm('AFTER_TASK');await assert.rejects(init.f.operate(request(init.f,2,32)),/OFFLINE_FAULT/);await assert.rejects(init.initialize(init.f.id),/PENDING/);
 check('C09',{observed:'Explicit offline initialization is no-op when equal and refuses conflicting or pending records. It never silently overwrites confirmed values.'});

 const uncovered=await harness();await uncovered.f.operate(request(uncovered.f,1));
 await uncovered.f.operate({...uncovered.f.base,requestId:'00000002-1111-4111-8111-111111111111',operation:'PO',input:{taskIds:[uncovered.f.id],versions:uncovered.f.versions(),poNumber:'OFFLINE-CURRENT'}});
 await assert.rejects(uncovered.read('NCT',uncovered.f.id),/CURRENT_STATE_CONFLICT/);
 check('C10',{observed:'Real PO assignment, not instrumented in this PLAN-only experiment, changes task version and makes candidate stop. Updating PLAN alone is insufficient.'});

 // A stale whole-item writer can restore a self-consistent old envelope when prices stay unchanged.
 // Deliberate storage counterexample; NOT claimed to occur in a specific live writer.
 const stale=await harness();await stale.f.operate(request(stale.f,1));const old=cp(stale.f.task());
 await stale.f.operate(request(stale.f,2,16,200,'SELF_COLLECT'));await compare(stale);
 await stale.native.update('NCTTasks',{...old,costStatus:'REFERENCE_REFRESHED'});
 const incorrectlyOld=await stale.read('NCT',stale.f.id),actual=confirmed(stale.f,stale.f.id);
 assert.equal(incorrectlyOld.blocked,false);assert.equal(incorrectlyOld.confirmed.members[0].plan.transportMode,'SUPPLIER_DELIVER');
 assert.equal(actual.state.members[0].plan.transportMode,'SELF_COLLECT');
 check('C11',{observed:'Counterexample: an uncoordinated stale whole-task update can roll back a valid state envelope without changing taskEditVersion. Existing-item reuse requires all writers to preserve current metadata under compatible locks; candidate NOT production-ready.'});

 const growth=await harness();const initial=growth.f.rows.size,meta=growth.stats.metadataWrites;
 for(let i=1;i<=20;i++)await growth.f.operate(request(growth.f,i,i%2?16:32,200));
 await compare(growth);assert.equal(growth.stats.metadataWrites-meta,40);
 const history=[...growth.f.rows.values()].filter(r=>r.action==='PURCHASE_PLAN_SAVED').length;assert.equal(history,20);
 check('C12',{observed:'20 actual PLAN revisions replace one metadata envelope, adding zero extra CMS rows but 40 extra metadata writes. Existing journal/event rows are unchanged and still grow.',revisions:20,extraMetadataWrites:40,extraMetadataRows:0,totalFixtureRowGrowth:growth.f.rows.size-initial});
 const added=await harness();await added.f.operate(request(added.f,1));
 const {createPurchaseSourceOperations,purchaseSourcesVersion}=load('purchaseSources.js');
 const add=createPurchaseSourceOperations({store:added.f.store,names:{NCT:{orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'}},readWorkspace:async()=>added.f.workspace()});
 await add({...added.f.base,requestId:'00000002-1111-4111-8111-111111111111',staff:{...added.f.base.staff,canAddPurchaseSource:true},input:{action:'ADD_SOURCE',parentTaskId:added.f.id,version:purchaseSourcesVersion(added.f.workspace()),quantity:50,supplierId:'S',poNumber:'',draftPlan:true,transportMode:'SUPPLIER_DELIVER',reason:'',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:50,freeCtn:0,prices:{lpPc:1,lpCtn:16,disc1:0,disc2:0,disc3:0}}}});
 const staleMembers=await added.read('NCT',added.f.id),actualMembers=confirmed(added.f,added.f.id);
 assert.equal(staleMembers.blocked,false);assert.equal(staleMembers.confirmed.members.length,1);assert.equal(actualMembers.state.members.length,2);
 assert.equal(staleMembers.confirmed.shares.shares.reduce((n,s)=>n+s.totalCtn,0),200);assert.equal(actualMembers.state.shares.shares.reduce((n,s)=>n+s.totalCtn,0),250);
 check('C13',{observed:'Actual ADD_SOURCE200+50 leaves root taskEditVersion unchanged; PLAN-only candidate silently returns200 and one source, while actual history confirms250 and two sources. All source writers must publish the same root state; this is a candidate bug, not a live regression.'});
 report.candidateAcceptance={readyForProduction:false,decision:'REJECT_CURRENT_TWO_HOOK_CANDIDATE',blockers:['PREPARED-before-marker gap','Complete-events-before-current-publication gap','Real PO assignment conflicts and ADD_SOURCE silently misses new source','Stale whole-item overwrite counterexample','Abrupt process death/recovery not proven'],productionScopeApproved:false};
 report.sourceHashes=Object.fromEntries(['purchaseOperations.js','purchasePlan.js','purchaseOperationJournal.js','purchaseTaskIdentity.js','purchaseCostRetry.js','purchaseSources.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(backend,name))).digest('hex')]));
 return report;
}
if(require.main===module)run().then(result=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:result.checks,growth:result.growth,productionWrites:0},null,2));}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
