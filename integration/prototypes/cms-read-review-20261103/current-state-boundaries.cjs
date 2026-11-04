'use strict';
// OFFLINE ONLY. Real journal/writers loaded with in-memory hooks; no production file changes.
// Fixed current records below exist only in fixture maps, never Wix.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setup,request}=require('./read-growth-contract.cjs'),load=require('../../tests/load-master-module.cjs');
const {operationId,canonical}=load('purchaseOperationJournal.js'),{taskEditVersion}=load('purchaseTaskIdentity.js');
const {readPurchasePlan,readPurchaseShares,confirmedPurchaseState}=load('purchasePlan.js');
const cp=x=>JSON.parse(JSON.stringify(x)),equal=(a,b)=>canonical(a)===canonical(b);
const backend=path.resolve(__dirname,'../../backend'),CURRENT='OFFLINE_PROCUREMENT_CURRENT';
const cid=(company,id)=>operationId(company,id,CURRENT);
const fields=['_id','title','description','imageAltText','customerDemandTaskId','procurementSource','supplierId','lpPc','lpCtn','disc1','disc2','disc3','ourPoNumber','rowPosition','purchaseStage','purchaseQtyInCtn','specialPurchase','specialPurchaseReason','risk','riskReason','manualCostField'];
const pick=row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,cp(row[k])]));
function oracle(f,company,root){
 const all=c=>[...f.rows].filter(([key])=>key.startsWith(c+'/')).map(([,r])=>cp(r));
 const view=confirmedPurchaseState({company,tasks:all(company+'Tasks'),activity:all(company+'Activity')});
 return {members:view.tasks.filter(t=>t.title===root||t.customerDemandTaskId===root).map(t=>({id:t.title,task:pick(t),plan:cp(readPurchasePlan(t,view.activity))})).sort((a,b)=>a.id.localeCompare(b.id)),shares:cp(readPurchaseShares(root,view.activity))};
}
function instrument(hooks){
 const cache={};function get(name){if(cache[name])return cache[name];let source=fs.readFileSync(path.join(backend,name),'utf8'),bindings={};
  if(name==='purchaseOperationJournal.js'){
   const before="      if(!prepared) prepared = await store.insert(collection,event(key,'PREPARED',{plan:await prepare()}));";
   assert.equal(source.split(before).length,2);
   source=source.replace(before,"      if(!prepared){const proposed=event(key,'PREPARED',{plan:await prepare()});prepared=await store.insert(collection,await offline.annotate(proposed));}");
   const after='      const outcome = await apply(copy(prepared.details.plan));';assert.equal(source.split(after).length,2);
   source=source.replace(after,after+'\n      await offline.commit(prepared);');
  }
  source=source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{const exports=target.startsWith('backend/')?get(target.slice(8)):require(target);for(const part of names.split(',')){const [name,alias]=part.trim().split(/\s+as\s+/);bindings[alias||name]=exports[name];}return '';});
  const exports=[...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(m=>m[1]);source=source.replace(/^export /gm,'');
  return cache[name]=vm.runInNewContext('(function(){'+source+'\nreturn {'+exports.join(',')+'};})()',{...bindings,offline:hooks,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math});
 }return get;
}
async function harness(initialRows){
 const f=setup();if(initialRows){f.rows.clear();for(const [k,r]of initialRows)f.rows.set(k,cp(r));}
 const native={...f.store},stats={currentWrites:0,receiptUpdates:0,readIds:[],pendingQueries:0,pendingRows:0},control={fault:null,crashed:false,afterRead:null,gate:null,now:'2026-10-31T04:00:00Z'};
 // In-memory stand-in for a REQUIRED indexed, consistent pending-only database query.
 // Building this fixture index is setup, not a production full-scan read implementation.
 const pendingIndex=new Map();
 function index(c,row){if(row.action!=='PURCHASE_OPERATION_PREPARED')return;for(const [key,ids]of pendingIndex)if(key.startsWith(c+'|'))ids.delete(row._id);for(const root of row.pendingReadRoots||[]){const key=c+'|'+root;if(!pendingIndex.has(key))pendingIndex.set(key,new Set());pendingIndex.get(key).add(row._id);}}
 for(const [key,row]of f.rows)index(key.split('/')[0],row);
 async function pendingFor(company,root){stats.pendingQueries++;const ids=[...(pendingIndex.get(company+'Activity|'+root)||[])];if(ids.length>1)throw Error('MULTIPLE_PENDING_REQUIRES_REVIEW');const rows=[];for(const id of ids){const row=await native.read(company+'Activity',id);if(row?.pendingReadRoots?.includes(root))rows.push(row);}stats.pendingRows+=rows.length;return rows;}
 const hit=name=>{const fault=control.fault;if(fault?.name===name){control.fault=null;if(fault.crash)control.crashed=true;throw Error('OFFLINE_FAULT:'+name);}};
 const get=async(c,id)=>{stats.readIds.push(c+'/'+id);return native.read(c,id);};
 async function current(company,root){const row=await get(company+'Activity',cid(company,root));if(!row||row.action!==CURRENT||row.details.company!==company||row.details.root!==root||row.details.checksum!==operationId(row.details.confirmed))throw Error('CURRENT_STATE_UNAVAILABLE');return row;}
 async function write(company,root,details,insert=false){const id=cid(company,root),record={_id:id,title:id,action:CURRENT,details:{...details,company,root,checksum:operationId(details.confirmed)}};hit('BEFORE_CURRENT_WRITE');await native[insert?'insert':'update'](company+'Activity',record);stats.currentWrites++;hit('AFTER_CURRENT_WRITE');}
 async function initialize(company,root){const id=cid(company,root);if(await native.read(company+'Activity',id))throw Error('EXPLICIT_INITIALIZATION_ALREADY_PRESENT');const confirmed=oracle(f,company,root);if(!confirmed.members.length)throw Error('NO_ROOT');await write(company,root,{confirmed,pending:null,lastOperation:'',stamp:'INITIAL'},true);}
 if(!initialRows){await initialize('NCT',f.id);await initialize('NCT',f.second);}
 async function normalize(prepared){
  const d=prepared.details,plan=d.plan,company=prepared.description.split('/')[0];
  if(!['NCT','GHR'].includes(company)||prepared.title!==operationId(company+'/PURCHASE',d.requestId,d.actorMemberId)||prepared.action!=='PURCHASE_OPERATION_PREPARED')throw Error('PREPARED_IDENTITY');
  let changes,events;
  if(['PLAN','PO'].includes(plan.operation)){
   changes=await Promise.all(plan.updates.map(async change=>{const raw=await get(company+'Tasks',change.id);if(!raw)throw Error('TASK_MISSING');return {...cp(change),root:raw.customerDemandTaskId||raw.title};}));
   events=plan.events.map(event=>{const change=changes.find(c=>c.id===event.taskId);if(!change)throw Error('EVENT_TASK');const id=operationId(company,d.requestId,d.actorMemberId,event.taskId,event.action);return {_id:id,title:id,action:event.action,result:'SAVED',description:change.orderId,image:change.lineId,imageAltText:event.shareRootId||event.taskId,initiatedByStaffId:d.actorStaffId,initiatedByStaffName:d.actorStaffName,activityTime:plan.time,details:{requestId:d.requestId,...cp(event)}};});
  }else if(plan.task&&plan.events?.some(e=>e.action==='PURCHASE_SOURCE_ADDED')){
   changes=[{id:plan.task._id,root:plan.task.customerDemandTaskId,expected:null,patch:pick(plan.task),orderId:plan.task.description,lineId:plan.task.imageAltText}];events=cp(plan.events);
  }else throw Error('OFFLINE_UNSUPPORTED_WRITER');
  if(!changes.length||new Set(events.map(e=>e._id)).size!==events.length)throw Error('PREPARED_SHAPE');
  return {company,d,plan,changes,events,roots:[...new Set(changes.map(c=>c.root))]};
 }
 function assertEvent(actual,expected){
  const keys=['_id','title','action','result','description','image','imageAltText','initiatedByStaffId','initiatedByStaffName'];
  if(keys.some(k=>actual[k]!==expected[k])||Date.parse(actual.activityTime)!==Date.parse(expected.activityTime)||!equal(actual.details,expected.details))throw Error('BUSINESS_EVIDENCE_CONFLICT');
 }
 // Derive only from validated predecessor checkpoints and actual complete business facts.
 // The existing single-event parsers are reused; resetting beforeRevision is LOCAL to the
 // parser input after checking the real predecessor. No stored event is rewritten.
 async function resolve(company,root,row,prepared){
  const state=row.details;if(!prepared||state.lastOperation===prepared.title)return {confirmed:cp(state.confirmed),blocked:false,requestId:null};
  if(prepared.readStateSchema!==1||!prepared.pendingReadRoots?.includes(root))throw Error('PENDING_IDENTITY');
  const pending={key:prepared.title,requestId:prepared.details.requestId};
  const n=await normalize(prepared);if(n.company!==company||!n.roots.includes(root)||!equal([...n.roots].sort(),[...prepared.pendingReadRoots].sort()))throw Error('PENDING_SCOPE');
  const saved=[];let complete=true;
  for(const expected of n.events){const actual=await get(company+'Activity',expected._id);if(actual){assertEvent(actual,expected);saved.push(actual);}else complete=false;}
  if(!complete)return {confirmed:cp(state.confirmed),blocked:true,requestId:pending.requestId};
  // Validate every affected task, including other roots of a merged PO, before returning any new state.
  const targets=new Map();
  for(const change of n.changes){
   const other=change.root===root?row:await current(company,change.root),member=other.details.confirmed.members.find(m=>m.id===change.id);
   const already=other.details.lastOperation===pending.key&&!other.details.pending;
   if(change.expected!==null&&!member)throw Error('MEMBER_MISSING');
   if(!already&&change.expected!==null&&taskEditVersion(member.task)!==change.expected)throw Error('PREDECESSOR_CONFLICT');
   const target=already?member.task:pick({...member?.task,...change.patch,_id:change.id});
   const actual=await get(company+'Tasks',change.id);
   if(!actual||actual.title!==change.id||actual.description!==change.orderId||actual.imageAltText!==change.lineId||taskEditVersion(actual)!==taskEditVersion(target))throw Error('TASK_EVIDENCE_CONFLICT');
   targets.set(change.id,pick(actual));
  }
  const after=cp(state.confirmed);
  for(const change of n.changes.filter(c=>c.root===root)){
   let member=after.members.find(m=>m.id===change.id);if(!member){member={id:change.id,task:targets.get(change.id),plan:cp(readPurchasePlan(targets.get(change.id),[]))};after.members.push(member);}else member.task=targets.get(change.id);
   const planEvent=saved.find(e=>e.action==='PURCHASE_PLAN_SAVED'&&e.imageAltText===change.id);
   if(planEvent){if(planEvent.details.beforeRevision!==member.plan.revision)throw Error('PLAN_PREDECESSOR');member.plan=cp(readPurchasePlan(member.task,[{...planEvent,details:{...planEvent.details,beforeRevision:''}}]));}
  }
  const shares=saved.filter(e=>e.action==='PURCHASE_SOURCE_SHARES_SAVED'&&e.imageAltText===root);if(shares.length>1)throw Error('SHARES_COUNT');
  if(shares.length){if(shares[0].details.beforeRevision!==after.shares.revision)throw Error('SHARES_PREDECESSOR');after.shares=cp(readPurchaseShares(root,[{...shares[0],details:{...shares[0].details,beforeRevision:''}}]));}
  after.members.sort((a,b)=>a.id.localeCompare(b.id));return {confirmed:after,blocked:false,requestId:null};
 }
 async function read(company,root){
  const first=await current(company,root),firstPending=await pendingFor(company,root),value=await resolve(company,root,first,firstPending[0]);
  if(!value.blocked){for(const member of value.confirmed.members){const task=await get(company+'Tasks',member.id);if(!task||task.title!==member.id||task.description!==member.task.description||task.imageAltText!==member.task.imageAltText||taskEditVersion(task)!==taskEditVersion(member.task))throw Error('CURRENT_TASK_CONFLICT');}}
  if(control.afterRead){const hook=control.afterRead;control.afterRead=null;await hook();}
  const last=await current(company,root),lastPending=await pendingFor(company,root);if(!equal(first.details,last.details)||!equal(firstPending,lastPending))throw Error('READ_CHANGED_RETRY');return value;
 }
 const hooks={
  async annotate(prepared){
   const n=await normalize(prepared);hit('BEFORE_DECLARATION');
   // Existing company journal lock is held. Finalize ONLY already-complete projection
   // evidence before adding a later operation; never reapply business changes or insert RESULT.
   const outstanding=new Map();for(const root of n.roots)for(const p of await pendingFor(n.company,root))outstanding.set(p.title,p);
   for(const prior of outstanding.values()){if(prior.title===prepared.title)throw Error('PREPARED_ALREADY_PRESENT');await hooks.commit(prior);}
   for(const root of n.roots){const row=await current(n.company,root),s=row.details;
    for(const c of n.changes.filter(c=>c.root===root&&c.expected!==null)){const member=s.confirmed.members.find(m=>m.id===c.id);if(!member||taskEditVersion(member.task)!==c.expected)throw Error('CURRENT_PREDECESSOR');if(c.planRevision!==undefined&&member.plan.revision!==c.planRevision)throw Error('CURRENT_PLAN_PREDECESSOR');}
    const oldShares=n.plan.allocation?.beforeRevision??n.changes.find(c=>c.root===root)?.sharesRevision;
    if(oldShares!==undefined&&oldShares!==s.confirmed.shares.revision)throw Error('CURRENT_SHARES_PREDECESSOR');
   }
   hit('AFTER_DECLARATION');return {...prepared,readStateSchema:1,pendingReadRoots:n.roots};
  },
  async commit(prepared){
   const n=await normalize(prepared),stored=await get(n.company+'Activity',prepared.title);if(stored?.readStateSchema===1&&stored.pendingReadRoots?.length===0)return;hit('BEFORE_COMMIT');
   for(const root of n.roots){const row=await current(n.company,root);if(row.details.lastOperation===prepared.title&&!row.details.pending)continue;
    const pending=await pendingFor(n.company,root);if(pending[0]?.title!==prepared.title)throw Error('COMMIT_OWNER');const value=await read(n.company,root);if(value.blocked)throw Error('COMMIT_INCOMPLETE');
    await write(n.company,root,{confirmed:value.confirmed,pending:null,lastOperation:prepared.title,stamp:operationId(prepared.title,'COMMITTED')});
    hit('AFTER_COMMIT_ROOT:'+root);
   }
   const refreshed=await get(n.company+'Activity',prepared.title);if(!equal(refreshed.details,prepared.details))throw Error('PREPARED_CHANGED');
   hit('BEFORE_PENDING_CLEAR');await native.update(n.company+'Activity',{...refreshed,pendingReadRoots:[]});index(n.company+'Activity',{...refreshed,pendingReadRoots:[]});stats.receiptUpdates++;hit('AFTER_PENDING_CLEAR');
   hit('AFTER_COMMIT');
  }
 };
 f.store.insert=async(c,row)=>{hit('BEFORE_'+row.action);const out=await native.insert(c,row);index(c,row);hit('AFTER_'+row.action);if(row.action==='PURCHASE_OPERATION_PREPARED'&&control.gate)await control.gate();return out;};
 f.store.update=async(c,row)=>{if(c.endsWith('Tasks'))hit('BEFORE_TASK');const out=await native.update(c,row);if(c.endsWith('Tasks'))hit('AFTER_TASK');return out;};
 f.store.remove=async(c,id)=>control.crashed?false:native.remove(c,id); // models persisted state with finally cleanup unavailable
 const modules=instrument(hooks);f.operate=modules('purchaseOperations.js').createPurchaseOperations({store:f.store,now:()=>new Date(control.now)});
 const sourceModule=modules('purchaseSources.js'),add=sourceModule.createPurchaseSourceOperations({store:f.store,names:{NCT:{orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'}},readWorkspace:async()=>f.workspace(),now:()=>new Date(control.now)});
 function addRequest(serial,qty=50){return {...f.base,requestId:String(serial).padStart(8,'0')+'-1111-4111-8111-111111111111',staff:{...f.base.staff,canAddPurchaseSource:true},input:{action:'ADD_SOURCE',parentTaskId:f.id,version:sourceModule.purchaseSourcesVersion(f.workspace()),quantity:qty,supplierId:'S',poNumber:'',draftPlan:true,transportMode:'SUPPLIER_DELIVER',reason:'',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:qty,freeCtn:0,prices:{lpPc:1,lpCtn:16,disc1:0,disc2:0,disc3:0}}}};}
 return {f,read,add,addRequest,stats,control,native,arm:(name,crash=false)=>{control.fault={name,crash};},snapshot:()=>cp([...f.rows]),currentId:root=>cid('NCT',root)};
}
const report={schema:2,baseline:'c1cfa56',rejectedMarkerExperiment:'f15f86e',productionCodeChanges:0,productionWrites:0,checks:[],growth:[],limitations:[
 'Only PLAN/PO/ADD_SOURCE use experimental journal hooks; no production import or schema change.',
 'Existing write preparation still loads history; this experiment only bounds the procurement state reader and final state publication.',
 'Crash model suppresses cleanup and reloads persisted fixture rows; no distributed Wix crash or strong-read latency measurement.',
 'Missing/inconsistent state stops; no automatic initialization or full-history fallback on reads.',
 'Current record per root adds rows. It is an offline candidate, not an approved storage migration.',
 'Other writers, initialization rollout, whole-page task discovery, inventory/financial dependencies and hard-stop lock recovery remain outside acceptance.',
 'Pending-query index is maintained by the in-memory fixture adapter. Real Wix index support and query latency MUST be verified; bounded returned rows are not proof of bounded physical scanning.'
]};
const record=(id,data)=>report.checks.push({id,...data});
async function compare(h,root=h.f.id){const got=await h.read('NCT',root);assert.equal(got.blocked,false);assert.ok(equal(got.confirmed,oracle(h.f,'NCT',root)),'current state differs from actual complete-history oracle');return got;}
async function seed(){const h=await harness();await h.f.operate(request(h.f,1));return h;}
async function run(){
 const h=await seed();await compare(h);
 record('B01',{observed:'Actual confirmed PLAN equals existing full-history oracle using fixed current record in offline Activity, without modifying Tasks.'});
 const faults=[];
 const boundaries=['BEFORE_DECLARATION','AFTER_DECLARATION','BEFORE_PURCHASE_OPERATION_PREPARED','AFTER_PURCHASE_OPERATION_PREPARED','BEFORE_TASK','AFTER_TASK','BEFORE_PURCHASE_PRICE_SAVED','AFTER_PURCHASE_PRICE_SAVED','BEFORE_PURCHASE_SOURCE_SHARES_SAVED','AFTER_PURCHASE_SOURCE_SHARES_SAVED','BEFORE_PURCHASE_PLAN_SAVED','AFTER_PURCHASE_PLAN_SAVED','BEFORE_COMMIT','BEFORE_CURRENT_WRITE','AFTER_CURRENT_WRITE','BEFORE_PENDING_CLEAR','AFTER_PENDING_CLEAR','AFTER_COMMIT','BEFORE_PURCHASE_OPERATION_RESULT','AFTER_PURCHASE_OPERATION_RESULT'];
 for(const boundary of boundaries){const t=await seed(),before=(await compare(t)).confirmed,r=request(t.f,2,32,210);t.arm(boundary);await assert.rejects(t.f.operate(r),/OFFLINE_FAULT/);
  const got=await t.read('NCT',t.f.id),actual=confirmedPurchaseState({company:'NCT',tasks:[...t.f.rows].filter(([k])=>k.startsWith('NCTTasks/')).map(([,v])=>v),activity:[...t.f.rows].filter(([k])=>k.startsWith('NCTActivity/')).map(([,v])=>v)});
  if(got.blocked)assert.ok(equal(got.confirmed,before));else await compare(t);
  if(actual.pending.length)assert.equal(got.blocked,true,'pending PREPARED must never disappear');
  const hasPlan=[...t.f.rows.values()].some(e=>e.action==='PURCHASE_PLAN_SAVED'&&e.details.requestId===r.requestId);if(hasPlan)assert.equal(got.blocked,false,'complete facts must not be overblocked');
  await t.f.operate(r);await compare(t);const count=t.f.rows.size,writes=t.stats.currentWrites;await t.f.operate(r);assert.equal(t.f.rows.size,count);assert.equal(t.stats.currentWrites,writes);
  faults.push({boundary,blocked:got.blocked,legacyPending:actual.pending.length,recoveredSameRequest:true});
 }
 record('B02',{observed:'20 handled failures: PREPARED and all affected-root identifiers are stored in one existing record write; complete facts stay confirmed before publication; same request recovers without duplicate rows.',faults});
 const source=await seed(),add=source.addRequest(2);await source.add(add);const got=await compare(source);assert.equal(got.confirmed.members.length,2);assert.equal(got.confirmed.shares.shares.reduce((n,r)=>n+r.totalCtn,0),250);
 const size=source.f.rows.size,writes=source.stats.currentWrites;await source.add(add);assert.equal(source.f.rows.size,size);assert.equal(source.stats.currentWrites,writes);
 record('B03',{observed:'Real ADD_SOURCE200+50 returns250 and both sources; exact retry adds no rows/current writes.'});
 for(const boundary of ['AFTER_PURCHASE_OPERATION_PREPARED','AFTER_PURCHASE_PLAN_SAVED','AFTER_PURCHASE_SOURCE_SHARES_SAVED','AFTER_PURCHASE_SOURCE_ADDED','BEFORE_COMMIT']){const t=await seed(),r=t.addRequest(2);t.arm(boundary);await assert.rejects(t.add(r),/OFFLINE_FAULT/);const state=await t.read('NCT',t.f.id);assert.equal(state.blocked,!['AFTER_PURCHASE_SOURCE_ADDED','BEFORE_COMMIT'].includes(boundary));await t.add(r);await compare(t);}
 record('B04',{observed:'Five ADD_SOURCE interruption boundaries retain old state until source acceptance; final complete facts are visible before publication.'});
 const po=await seed(),p={...po.f.base,requestId:'00000002-1111-4111-8111-111111111111',operation:'PO',input:{taskIds:[po.f.id],versions:po.f.versions(),poNumber:'OFFLINE-CURRENT-V2'}};po.arm('BEFORE_COMMIT');await assert.rejects(po.f.operate(p),/OFFLINE_FAULT/);await compare(po);await po.f.operate(p);await compare(po);
 record('B05',{observed:'Real PO assignment updates the same confirmed state, including interruption after business facts; no stale task-version failure from v1.'});
 const concurrent=await seed(),a=request(concurrent.f,2,32),b=request(concurrent.f,3,48);let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let once=true;
 concurrent.control.gate=async()=>{if(once){once=false;entered();await gate;}};const saving=concurrent.f.operate(a);await reached;await assert.rejects(concurrent.f.operate(b),/save is still processing/);assert.equal((await concurrent.read('NCT',concurrent.f.id)).blocked,true);assert.equal((await concurrent.read('NCT',concurrent.f.second)).blocked,false);release();await saving;await compare(concurrent);
 record('B06',{observed:'Two real concurrent PLAN calls preserve existing company lock; affected root pending, unrelated root readable.'});
 const crashResults=[];
 for(const boundary of ['AFTER_PURCHASE_OPERATION_PREPARED','AFTER_TASK','AFTER_PURCHASE_PLAN_SAVED']){const t=await seed(),r=request(t.f,2,32);t.arm(boundary,true);await assert.rejects(t.f.operate(r),/OFFLINE_FAULT/);const restarted=await harness(t.snapshot()),state=await restarted.read('NCT',t.f.id);assert.equal(state.blocked,boundary!=='AFTER_PURCHASE_PLAN_SAVED');await assert.rejects(restarted.f.operate(r),/save is still processing/);assert.ok(restarted.f.rows.has('NCTActivity/'+operationId('NCT/PURCHASE','LOCK')));crashResults.push({boundary,readBlocked:state.blocked,existingLockRetained:true,recovery:'BLOCKED_EXISTING_LOCK_NOT_STOLEN'});}
 record('B07',{observed:'Reloading persisted rows with cleanup suppressed keeps pending/confirmed status correct. Hard-stopped PLAN remains blocked by existing lock: automatic write recovery is NOT solved.',cases:crashResults});
 const stale=await seed(),oldTask=cp(stale.f.task());await stale.f.operate(request(stale.f,2,16,200,'SELF_COLLECT'));await stale.native.update('NCTTasks',{...oldTask,costStatus:'REFERENCE_REFRESHED'});assert.equal((await compare(stale)).confirmed.members[0].plan.transportMode,'SELF_COLLECT');await stale.f.operate(request(stale.f,3,32));await stale.native.update('NCTTasks',oldTask);await assert.rejects(stale.read('NCT',stale.f.id),/CURRENT_TASK_CONFLICT/);
 record('B08',{observed:'Old whole-task writes cannot overwrite separate current metadata; unchanged-price transport stays correct, stale price overwrite stops explicitly.'});
 const racing=await seed();racing.control.afterRead=()=>racing.f.operate(request(racing.f,2,32));await assert.rejects(racing.read('NCT',racing.f.id),/READ_CHANGED_RETRY/);await compare(racing);
 record('B09',{observed:'Writer committing between reader checkpoints causes explicit retry, not mixed old/new result. No automatic read-side write or history fallback.'});
 for(const count of [0,1000,100000]){const start=report.growth.at(-1)?.unrelatedRows||0;for(let i=start;i<count;i++)h.f.rows.set('NCTActivity/NOISE'+i,{_id:'NOISE'+i,action:'OFFLINE_NOISE'});const before=h.stats.readIds.length,pq=h.stats.pendingQueries,pr=h.stats.pendingRows,updates=h.f.mutations.length,currentWrites=h.stats.currentWrites,queries=h.f.queries.length,result=await h.read('NCT',h.f.id);assert.equal(h.f.mutations.length,updates);assert.equal(h.stats.currentWrites,currentWrites);assert.equal(h.f.queries.length,queries);report.growth.push({unrelatedRows:count,pointReads:h.stats.readIds.length-before,pendingIndexQueries:h.stats.pendingQueries-pq,pendingRows:h.stats.pendingRows-pr,historyQueries:0,writes:0,responseHash:operationId(result)});}
 assert.equal(new Set(report.growth.map(r=>r.responseHash)).size,1);assert.ok(report.growth.every(r=>r.pointReads===3));
 record('B10',{observed:'Stable one-root read uses3ID reads plus2modeled indexed pending-only queries, zero history queries/writes with100000 unrelated records. Real Wix index/scan behavior not proven.'});
 await assert.rejects(h.read('GHR',h.f.id),/UNAVAILABLE/);const id=h.currentId(h.f.id),original=cp(h.f.rows.get('NCTActivity/'+id));h.f.rows.delete('NCTActivity/'+id);await assert.rejects(h.read('NCT',h.f.id),/UNAVAILABLE/);h.f.rows.set('NCTActivity/'+id,original);
 const wrong=await seed(),r=request(wrong.f,2,32);wrong.arm('AFTER_PURCHASE_PRICE_SAVED');await assert.rejects(wrong.f.operate(r),/OFFLINE_FAULT/);const evidence=[...wrong.f.rows.values()].find(row=>row.action==='PURCHASE_PRICE_SAVED'&&row.details.requestId===r.requestId);evidence.details.after.lpCtn=999;await assert.rejects(wrong.read('NCT',wrong.f.id),/EVIDENCE_CONFLICT/);
 record('B11',{observed:'Wrong company, absent current record and altered existing business evidence fail explicitly.'});
 async function mergedSeed(){const t=await seed(),r=request(t.f,2,16,150);r.input.taskId=t.f.second;r.input.version=t.f.versions()[t.f.second];r.input.planRevision='';await t.f.operate(r);return t;}
 const multi=await mergedSeed(),merged={...multi.f.base,requestId:'00000003-1111-4111-8111-111111111111',operation:'PO',input:{taskIds:[multi.f.id,multi.f.second],versions:multi.f.versions(),poNumber:'OFFLINE-MERGED'}};
 multi.arm('AFTER_COMMIT_ROOT:'+multi.f.id);await assert.rejects(multi.f.operate(merged),/OFFLINE_FAULT/);await compare(multi);await compare(multi,multi.f.second);await multi.f.operate(merged);await compare(multi);await compare(multi,multi.f.second);
 record('B12',{observed:'Merged PO with first current root published and second root still pending remains readable from complete evidence; original request recovers both.'});
 for(const boundary of ['BEFORE_PURCHASE_OPERATION_PREPARED','AFTER_PURCHASE_OPERATION_PREPARED']){
  const partial=await mergedSeed(),oldPo={...partial.f.base,requestId:'00000003-1111-4111-8111-111111111111',operation:'PO',input:{taskIds:[partial.f.id,partial.f.second],versions:partial.f.versions(),poNumber:'OFFLINE-ATOMIC-ROOTS'}};
  partial.arm(boundary);await assert.rejects(partial.f.operate(oldPo),/OFFLINE_FAULT/);const pending=boundary.startsWith('AFTER');assert.equal((await partial.read('NCT',partial.f.id)).blocked,pending);assert.equal((await partial.read('NCT',partial.f.second)).blocked,pending);
  const next=request(partial.f,4,32,150);next.input.taskId=partial.f.second;next.input.version=partial.f.versions()[partial.f.second];next.input.planRevision=partial.f.workspace().tasks.find(t=>t.id===partial.f.second).procurement.revision;
  if(pending){await assert.rejects(partial.f.operate(next),/COMMIT_INCOMPLETE/);await partial.f.operate(oldPo);await compare(partial);await compare(partial,partial.f.second);}else{await partial.f.operate(next);await compare(partial,partial.f.second);await assert.rejects(partial.f.operate(oldPo));assert.equal((await partial.read('NCT',partial.f.id)).blocked,false);}
 }
 record('B13',{observed:'Single PREPARED write declares both roots: before persistence neither is orphan-marked; after persistence both are protected. This closes the experimentally proven fan-out marker gap.'});
 const later=await seed(),lost=request(later.f,2,32);later.arm('BEFORE_COMMIT');await assert.rejects(later.f.operate(lost),/OFFLINE_FAULT/);await compare(later);
 const oldFacts=cp([...later.f.rows.values()].filter(r=>r.result==='SAVED'&&r.details?.requestId===lost.requestId));
 await later.f.operate(request(later.f,3,48));await compare(later);
 assert.ok(equal(oldFacts,[...later.f.rows.values()].filter(r=>r.result==='SAVED'&&r.details?.requestId===lost.requestId)));
 assert.equal(later.f.rows.has('NCTActivity/'+operationId(operationId('NCT/PURCHASE',lost.requestId,later.f.base.staff.memberId),'RESULT')),false);
 record('B14',{observed:'A later real save first publishes complete prior read evidence under the existing company journal lock; it does not redo prior business events or insert a prior RESULT. Latest state remains48.'});
 const growth=await harness(),initial=growth.f.rows.size,initialCurrent=growth.stats.currentWrites;for(let i=1;i<=20;i++)await growth.f.operate(request(growth.f,i,i%2?16:32));await compare(growth);
 assert.equal(growth.stats.currentWrites-initialCurrent,20);assert.equal(growth.stats.receiptUpdates,20);assert.equal([...growth.f.rows.values()].filter(r=>r.action===CURRENT).length,2);assert.equal(growth.f.rows.size-initial,100);
 record('B15',{observed:'20real PLAN changes retain100existing journal/event rows. Two fixture roots have2fixed current rows; each save adds1current update and1existing PREPARED status update, not new per-save metadata rows.',revisions:20,existingRowsAdded:100,fixedCurrentRows:2,currentUpdates:20,preparedUpdates:20});
 const pendingGrowth=await seed();pendingGrowth.arm('AFTER_PURCHASE_PRICE_SAVED');await assert.rejects(pendingGrowth.f.operate(request(pendingGrowth.f,2,32)),/OFFLINE_FAULT/);const measurements=[];
 for(const count of [0,1000,100000]){const previous=measurements.at(-1)?.unrelatedRows||0;for(let i=previous;i<count;i++)pendingGrowth.f.rows.set('NCTActivity/NOISE'+i,{_id:'NOISE'+i,action:'OFFLINE_NOISE'});const ids=pendingGrowth.stats.readIds.length,queries=pendingGrowth.stats.pendingQueries,rows=pendingGrowth.stats.pendingRows,updates=pendingGrowth.stats.currentWrites,results=pendingGrowth.stats.receiptUpdates;const value=await pendingGrowth.read('NCT',pendingGrowth.f.id);assert.equal(value.blocked,true);assert.equal(pendingGrowth.stats.currentWrites,updates);assert.equal(pendingGrowth.stats.receiptUpdates,results);measurements.push({unrelatedRows:count,pointReads:pendingGrowth.stats.readIds.length-ids,pendingQueries:pendingGrowth.stats.pendingQueries-queries,pendingRows:pendingGrowth.stats.pendingRows-rows,hash:operationId(value)});}
 assert.equal(new Set(measurements.map(x=>x.hash)).size,1);assert.equal(new Set(measurements.map(x=>x.pointReads)).size,1);assert.ok(measurements.every(x=>x.pendingQueries===2&&x.pendingRows===2));
 record('B16',{observed:'Positive pending-query case: incomplete request remains visible with100000unrelated rows, constant evidence reads and no read-side updates.',measurements});
 const month=await seed();month.control.now='2026-11-01T04:00:00Z';assert.equal((await compare(month)).confirmed.members[0].plan.updatedAt,'2026-10-31T04:00:00.000Z');await month.f.operate(request(month.f,2,32));const november=await compare(month);assert.equal(november.confirmed.members[0].plan.updatedAt,'2026-11-01T04:00:00.000Z');assert.equal(november.confirmed.members[0].plan.totalCtn,200);
 record('B17',{observed:'Real PLAN writer runs across Oct31/Nov1: unchanged prior-month plan is still visible, new revision becomes current without monthly cutoff. Not a financial month-close test.'});
 await assert.rejects(later.f.operate(lost),/Task changed/);assert.equal((await compare(later)).confirmed.members[0].task.lpCtn,48);
 const legacy=setup();await legacy.operate(request(legacy,1));const legacyLost=request(legacy,2,32),insert=legacy.store.insert;
 legacy.store.insert=async(c,row)=>{if(row.action==='PURCHASE_OPERATION_RESULT'&&row.details.requestId===legacyLost.requestId)throw Error('OFFLINE_LOST_RESULT');return insert(c,row);};
 await assert.rejects(legacy.operate(legacyLost),/OFFLINE_LOST_RESULT/);legacy.store.insert=insert;await legacy.operate(request(legacy,3,48));await assert.rejects(legacy.operate(legacyLost),/Task changed/);assert.equal(legacy.task().lpCtn,48);
 record('B18',{observed:'Existing limitation reproduced in both unmodified writer and candidate: missing old RESULT, then newer price revision, then old retry is rejected as Task changed; latest48 is preserved. This is not repaired or silently rolled back by read optimization.'});
 report.acceptance={boundedPlanPoSourceContract:'PASSED_LISTED_OFFLINE_SCENARIOS',productionReady:false,remaining:['Actual-site Wix index/scan verification (official docs support scalar arrays and hasSome)','Other writers and new-order initialization','Live-original comparison, storage approval and migration preview','Full-page dependency/query and save-preparation growth'],inheritedLimitations:['Hard-stopped PLAN remains locked; reader safety verified, no stale-lock takeover added.','Old missing RESULT retry after a newer price revision rejects Task changed in both baseline and candidate. Latest value is preserved.']};
 report.sourceHashes=Object.fromEntries(['purchaseOperations.js','purchaseSources.js','purchasePlan.js','purchaseOperationJournal.js','purchaseTaskIdentity.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(backend,name))).digest('hex')]));return report;
}
if(require.main===module)run().then(r=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({checks:r.checks,growth:r.growth,acceptance:r.acceptance},null,2));}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,harness,oracle,pick};
