const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),assert=require('node:assert/strict');
const testFile=path.resolve(__dirname,'../../tests/purchase-operations.test.cjs'),req=createRequire(testFile),load=req('./load-master-module.cjs');
const fixture=vm.runInNewContext(fs.readFileSync(testFile,'utf8')+'\nfixture;',{require:n=>n==='node:test'?()=>{}:req(n),Map,Buffer});
const {projectPurchaseOrders}=load('purchaseOrderWorkflow.js'),{operationId}=load('purchaseOperationJournal.js');
const rid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
function request(f,n,price=16,qty=200){const r=f.workspace().tasks.find(t=>t.id===f.id);return {...f.base,requestId:rid(n),operation:'PLAN',input:{taskId:f.id,version:r.editVersion,planRevision:r.procurement.revision||'',totalCtn:qty,transportMode:'SUPPLIER_DELIVER',draftPlan:true,reason:'Offline read-contract probe',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:qty,freeCtn:0,prices:{lpPc:price/16,lpCtn:price,disc1:0,disc2:0,disc3:0}}}};}
const observations=[];
(async()=>{
for(const qty of [200,220])for(const boundary of ['TASK','PRICE','SHARES','PLAN','RESULT']){
 const f=fixture();await f.operate(request(f,1));await f.operate({...f.base,requestId:rid(2),operation:'PO',input:{taskIds:[f.id],versions:f.versions(),poNumber:'OFFLINE-PROBE'}});
 const r=request(f,3,32,qty),beforeOther=JSON.stringify(f.task(f.second)),before=f.workspace().tasks.find(t=>t.id===f.id);let hit=false;
 const update=f.store.update,insert=f.store.insert,actions={PRICE:'PURCHASE_PRICE_SAVED',SHARES:'PURCHASE_SOURCE_SHARES_SAVED',PLAN:'PURCHASE_PLAN_SAVED',RESULT:'PURCHASE_OPERATION_RESULT'};
 f.store.update=async(c,row)=>{const v=await update(c,row);if(boundary==='TASK'&&!hit&&c==='NCTTasks'){hit=true;throw Error('SIMULATED');}return v;};
 f.store.insert=async(c,row)=>{if(boundary!=='TASK'&&!hit&&row.action===actions[boundary]){hit=true;throw Error('SIMULATED');}return insert(c,row);};
 await assert.rejects(f.operate(r),/SIMULATED/);assert.ok(hit);let observed;
 try{const workspace=f.workspace(),t=workspace.tasks.find(t=>t.id===f.id),po=projectPurchaseOrders({company:'NCT',workspace,records:[]})[0];observed={workspaceReadable:true,unrelatedPresent:workspace.tasks.some(t=>t.id===f.second),rawTaskPrice:f.task().lpCtn,taskPrice:t.lpCtn,planAverage:t.procurement.costing?.averageCostCtn,planQuantity:t.procurement.totalCtn,poAmount:po.amount};}catch(e){observed={workspaceReadable:false,error:e.message};}
 const activity=await f.store.all('NCTActivity'),prepared=activity.find(e=>e.action==='PURCHASE_OPERATION_PREPARED'&&e.details.requestId===r.requestId),ids=new Set(activity.map(e=>e.title));
 const missingEvents=prepared.details.plan.events.filter(e=>!ids.has(operationId('NCT',r.requestId,f.base.staff.memberId,e.taskId,e.action))).map(e=>e.action);
 assert.equal(JSON.stringify(f.task(f.second)),beforeOther);f.store.update=update;f.store.insert=insert;await f.operate(r);const after=f.workspace().tasks.find(t=>t.id===f.id);assert.equal(after.lpCtn,32);assert.equal(after.procurement.totalCtn,qty);
 observations.push({quantity:qty,boundary,observed,missingEvents,unrelatedRawTaskUnchanged:true,originalRetryRecovered:true,oldPrice:before.lpCtn});
}
const result={date:'2026-11-03',mode:'OFFLINE_DIAGNOSTIC_AFTER_D01',productionWrites:0,productionCodeChanges:0,observations,limitation:'Immediate-read in-memory fixture. Not live latency, process-kill or Wix replication proof.'};
fs.writeFileSync(path.join(__dirname,'partial-read-contract-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
