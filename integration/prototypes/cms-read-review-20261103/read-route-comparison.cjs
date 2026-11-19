'use strict';
// OFFLINE ONLY. Snapshot annotation is an oracle-assisted migration simulation,
// not a production rootIds writer, backfill, index or complete workspace reader.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {harness,pick}=require('./current-state-boundaries.cjs');
const {request}=require('./read-growth-contract.cjs');
const load=require('../../tests/load-master-module.cjs');
const {confirmedPurchaseState,readPurchasePlan,readPurchaseShares}=load('purchasePlan.js');
const {canonical,operationId}=load('purchaseOperationJournal.js');
const cp=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>canonical(a)===canonical(b);
const report={baseline:'a394c75',productionChanges:0,checks:[],unrelatedGrowth:[],relatedGrowth:[],limitations:[
 'All data and index maps are in memory; no Wix latency, scan plan, quota or production snapshot acceptance.',
 'rootIds are derived at snapshot construction from known tasks and PREPARED; this is not a deployed incremental writer or approved historical backfill.',
 'Comparison covers procurement component only; discovery, receipt, loan, stock, finance and whole-page consistency remain separate dependencies.',
 'The root-index route reuses existing confirmedPurchaseState and deliberately adds no new save semantics.',
 'Current-state candidate still has extra updates and unsupported writers; neither route reduces durable history capacity.'
]};
const record=(id,observed,data={})=>report.checks.push({id,observed,...data});
function snapshot(h){
 const rows=cp([...h.f.rows]),tasks=rows.filter(([k])=>k.startsWith('NCTTasks/')).map(([,r])=>r),all=rows.filter(([k])=>k.startsWith('NCTActivity/')).map(([,r])=>r);
 const roots=new Map(tasks.map(t=>[t.title,t.customerDemandTaskId||t.title]));
 const prepared=all.filter(r=>r.action==='PURCHASE_OPERATION_PREPARED');
 // Future source identity must be known from PREPARED even before Tasks insertion.
 for(const r of prepared)if(r.details?.plan?.task){const t=r.details.plan.task;roots.set(t.title,t.customerDemandTaskId||t.title);}
 const byRequest=new Map(),byPrepared=new Map();
 for(const r of prepared){const p=r.details.plan,ids=[...(p.updates||[]).map(c=>c.sharesRootId||c.id),p.task?.customerDemandTaskId,p.task?.title,p.allocation?.rootId].filter(Boolean);const linked=[...new Set(ids.map(id=>roots.get(id)).filter(Boolean))];byRequest.set(r.details.requestId,linked);byPrepared.set(r.title,linked);}
 const supported=new Set(['PURCHASE_PLAN_SAVED','PURCHASE_SOURCE_SHARES_SAVED','PURCHASE_PRICE_SAVED','PURCHASE_PO_ASSIGNED','PURCHASE_SOURCE_ADDED','PURCHASE_OPERATION_PREPARED','PURCHASE_OPERATION_RESULT']);
 const annotated=all.filter(r=>supported.has(r.action)).map(r=>{
  const d=r.details||{},ids=[r.imageAltText,d.taskId,d.parentTaskId].map(id=>roots.get(id)).filter(Boolean);
  const fromRequest=byRequest.get(d.requestId)||byPrepared.get(r.title)||[];
  const clean={...r};delete clean.readStateSchema;delete clean.pendingReadRoots;
  return {...clean,rootIds:[...new Set([...ids,...fromRequest])].sort()};
 });
 return {tasks,all,annotated};
}
function indexedReader(s,mutate=()=>{}){
 const rows=cp(s.annotated);mutate(rows);const index=new Map();
 for(const row of rows)for(const root of row.rootIds||[]){if(!index.has(root))index.set(root,[]);index.get(root).push(row);}
 return root=>{
  const activity=cp(index.get(root)||[]),tasks=s.tasks.filter(t=>t.title===root||t.customerDemandTaskId===root);
  const view=confirmedPurchaseState({company:'NCT',tasks,activity});
  return {confirmed:{members:view.tasks.map(t=>({id:t.title,task:pick(t),plan:cp(readPurchasePlan(t,view.activity))})).sort((a,b)=>a.id.localeCompare(b.id)),shares:cp(readPurchaseShares(root,view.activity))},blocked:view.pending.length>0,metrics:{indexQueries:1,activityRows:activity.length,pagesAt1000:Math.max(1,Math.ceil(activity.length/1000)),jsonBytes:Buffer.byteLength(JSON.stringify(activity))}};
 };
}
async function compare(h,root=h.f.id){const before=JSON.stringify([...h.f.rows]),s=snapshot(h),a=indexedReader(s)(root),b=await h.read('NCT',root);assert.ok(same(a.confirmed,b.confirmed),'root-index vs current mismatch');assert.equal(a.blocked,b.blocked);assert.equal(JSON.stringify([...h.f.rows]),before);return {indexed:a,current:b,snapshot:s};}
async function seed(){const h=await harness();await h.f.operate(request(h.f,1));return h;}
async function merged(){const h=await seed(),r=request(h.f,2,16,150);r.input.taskId=h.f.second;r.input.version=h.f.versions()[h.f.second];r.input.planRevision='';await h.f.operate(r);return h;}
const po=h=>({...h.f.base,requestId:'00000003-1111-4111-8111-111111111111',operation:'PO',input:{taskIds:[h.f.id,h.f.second],versions:h.f.versions(),poNumber:'OFFLINE-COMPARE-PO'}});
async function run(){
 const h=await seed();await compare(h);await h.f.operate(request(h.f,2,32));await compare(h);
 record('C01','Root-index and current-record readers agree after actual PLAN saves; reads write nothing.');
 const faults=['AFTER_PURCHASE_OPERATION_PREPARED','AFTER_TASK','AFTER_PURCHASE_PRICE_SAVED','AFTER_PURCHASE_SOURCE_SHARES_SAVED','AFTER_PURCHASE_PLAN_SAVED','BEFORE_COMMIT'];
 for(const fault of faults){const t=await seed();t.arm(fault);const r=request(t.f,2,32,210);await assert.rejects(t.f.operate(r),/OFFLINE_FAULT/);await compare(t);await t.f.operate(r);await compare(t);}
 record('C02','Both readers agree at six actual PLAN interruption boundaries when the complete root association is present.',{faults});
 const source=await seed();await source.add(source.addRequest(2));const added=await compare(source);assert.equal(added.indexed.confirmed.members.reduce((n,m)=>n+m.plan.totalCtn,0),250);
 record('C03','Completed ADD_SOURCE200+50 returns both sources and250 on both routes. Interrupted source acceptance is not accepted here.');
 const m=await merged();await m.f.operate(po(m));await compare(m);await compare(m,m.f.second);
 const mp=snapshot(m).annotated.find(r=>r.action==='PURCHASE_OPERATION_PREPARED'&&r.details.plan.operation==='PO');assert.deepEqual(mp.rootIds,[m.f.id,m.f.second]);
 record('C04','Merged PO preparation is associated with both roots and completed results agree.');
 const interrupted=await merged();interrupted.arm('AFTER_TASK');await assert.rejects(interrupted.f.operate(po(interrupted)),/OFFLINE_FAULT/);
 const p=indexedReader(snapshot(interrupted))(interrupted.f.id),c=await interrupted.read('NCT',interrupted.f.id);
 assert.equal(p.blocked,false);assert.equal(c.blocked,true);
 record('C05','Counterexample: root indexing alone inherits existing PLAN-only pending reader. Interrupted PO exposes changed task with no pending flag, while current candidate blocks it.',{indexBlocked:p.blocked,currentBlocked:c.blocked});
 const missing=await seed();missing.arm('AFTER_TASK');await assert.rejects(missing.f.operate(request(missing.f,2,32)),/OFFLINE_FAULT/);
 const s=snapshot(missing),complete=indexedReader(s)(missing.f.id),invisible=indexedReader(s,rows=>{for(const r of rows)if(r.action==='PURCHASE_OPERATION_PREPARED')r.rootIds=[];})(missing.f.id);
 assert.equal(complete.blocked,true);assert.equal(complete.confirmed.members[0].task.lpCtn,16);assert.equal(invisible.blocked,false);assert.equal(invisible.confirmed.members[0].task.lpCtn,32);
 record('C06','Counterexample: missing PREPARED associations silently expose unconfirmed price32 instead of confirmed16. The index query cannot detect an excluded record.');
 const tail=await seed(),later=request(tail.f,2,16,200,'SELF_COLLECT');await tail.f.operate(later);const ts=snapshot(tail),full=indexedReader(ts)(tail.f.id),lost=indexedReader(ts,rows=>{for(const r of rows)if(r.details?.requestId===later.requestId)r.rootIds=[];})(tail.f.id);
 assert.equal(full.confirmed.members[0].plan.transportMode,'SELF_COLLECT');assert.equal(lost.confirmed.members[0].plan.transportMode,'SUPPLIER_DELIVER');assert.equal(lost.blocked,false);
 record('C07','Counterexample: omission of an entire latest transport-only operation returns a valid but old chain without an error. Revision continuity alone does not prove association completeness.');
 for(const n of [0,1000,100000]){
  const t=await seed();for(let i=0;i<n;i++)t.f.rows.set('NCTActivity/OTHER'+i,{title:'OTHER'+i,action:'OFFLINE_UNRELATED',details:{}});
  const s=snapshot(t),index=indexedReader(s),before=t.stats.readIds.length,pending=t.stats.pendingQueries;const result=await t.read('NCT',t.f.id),selected=index(t.f.id);assert.ok(same(result.confirmed,selected.confirmed));
  report.unrelatedGrowth.push({unrelated:n,indexRows:selected.metrics.activityRows,indexBytes:selected.metrics.jsonBytes,currentPointReads:t.stats.readIds.length-before,currentPendingQueries:t.stats.pendingQueries-pending});
 }
 assert.equal(new Set(report.unrelatedGrowth.map(x=>x.indexRows)).size,1);
 record('C08','Both modeled routes ignore unrelated history at0/1000/100000. Index construction is offline setup, not production discovery.');
 const history=await harness();for(let i=1;i<=100;i++){
  await history.f.operate(request(history.f,i,i%2?16:32));
  if([1,10,100].includes(i)){const before=history.stats.readIds.length,pending=history.stats.pendingQueries,selected=await compare(history);report.relatedGrowth.push({revisions:i,indexRows:selected.indexed.metrics.activityRows,indexBytes:selected.indexed.metrics.jsonBytes,currentPointReads:history.stats.readIds.length-before,currentPendingQueries:history.stats.pendingQueries-pending});}
 }
 assert.equal(report.relatedGrowth[2].indexRows,report.relatedGrowth[0].indexRows*100);
 record('C09','Same real100-revision fixture: root history grows per revision; current read count remains fixed. Saves still scan history on both routes.');
 const page=await merged(),beforeCurrent=await page.read('NCT',page.f.id),beforeIndexed=indexedReader(snapshot(page))(page.f.id);await page.f.operate(po(page));const afterCurrent=await page.read('NCT',page.f.second),afterIndexed=indexedReader(snapshot(page))(page.f.second);
 assert.equal(beforeCurrent.confirmed.members[0].task.ourPoNumber,undefined);assert.equal(afterCurrent.confirmed.members[0].task.ourPoNumber,'OFFLINE-COMPARE-PO');assert.equal(beforeIndexed.confirmed.members[0].task.ourPoNumber,undefined);assert.equal(afterIndexed.confirmed.members[0].task.ourPoNumber,'OFFLINE-COMPARE-PO');assert.equal(beforeIndexed.blocked,false);assert.equal(afterIndexed.blocked,false);
 record('C10','Both individually valid root reads can straddle a merged PO commit and produce a mixed-time page. Per-root validation is not a page-wide snapshot.');
 const sourceBoundaries=[];
 for(const fault of ['AFTER_PURCHASE_OPERATION_PREPARED','AFTER_PURCHASE_PLAN_SAVED','AFTER_PURCHASE_SOURCE_SHARES_SAVED','AFTER_PURCHASE_SOURCE_ADDED','BEFORE_COMMIT']){
  const t=await seed();t.arm(fault);await assert.rejects(t.add(t.addRequest(2)),/OFFLINE_FAULT/);const current=await t.read('NCT',t.f.id);let indexed,error=null;try{indexed=indexedReader(snapshot(t))(t.f.id);}catch(e){error=e.message;}
  sourceBoundaries.push({fault,indexError:error,indexBlocked:indexed?.blocked??null,currentBlocked:current.blocked,equivalent:!!indexed&&same(indexed.confirmed,current.confirmed)&&indexed.blocked===current.blocked});
 }
 assert.ok(sourceBoundaries.some(x=>!x.equivalent));assert.ok(sourceBoundaries.filter(x=>['AFTER_PURCHASE_SOURCE_ADDED','BEFORE_COMMIT'].includes(x.fault)).every(x=>x.equivalent));
 record('C11','Five source interruption comparisons: index filtering preserves old reader semantics and does not supply source-acceptance pending protection by itself.',{sourceBoundaries});
 report.decision='Neither production-ready. Test root-associated reader first as the smaller option, but complete dependency/index coverage and PO/source pending semantics before rollout. Current-record design remains offline alternative, not default deployment.';
 report.sourceHashes=Object.fromEntries(['purchasePlan.js','purchaseOperationJournal.js','purchaseOperations.js','purchaseSources.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../backend',name))).digest('hex')]));return report;
}
if(require.main===module)run().then(r=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({checks:r.checks,unrelatedGrowth:r.unrelatedGrowth,relatedGrowth:r.relatedGrowth,decision:r.decision},null,2));}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
