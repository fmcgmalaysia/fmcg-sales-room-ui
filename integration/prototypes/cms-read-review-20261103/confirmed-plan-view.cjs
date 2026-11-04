// OFFLINE DESIGN PROBE ONLY. Not imported by a production entry point.
// Existing PREPARED evidence supplies a read view; it never writes or resumes saves.
const load=require('../../tests/load-master-module.cjs');
const {operationId,canonical}=load('purchaseOperationJournal.js');
const {taskEditVersion}=load('purchaseTaskIdentity.js');
const {readPurchasePlan,readPurchaseShares}=load('purchasePlan.js');
const fail=()=>{throw Error('Procurement recovery evidence requires review.');};
function confirmedPlanView({company,tasks,activity}) {
  if(!['NCT','GHR'].includes(company))fail();
  const byId=new Map(),pending=[],omitted=new Set(),replacements=new Map();
  for(const row of activity){if(byId.has(row.title))fail();byId.set(row.title,row);}
  for(const prepared of activity){
    if(prepared.action!=='PURCHASE_OPERATION_PREPARED'||prepared.details?.plan?.operation!=='PLAN')continue;
    const {requestId,actorMemberId,actorStaffId,plan}=prepared.details;
    if(prepared.title!==operationId(company+'/PURCHASE',requestId,actorMemberId))fail();
    if(plan.updates?.length!==1||!Array.isArray(plan.events)||!plan.events.length)fail();
    const change=plan.updates[0],saved=[];
    if(!change.expected||change.planRevision===undefined)fail();
    for(const event of plan.events){
      if(event.taskId!==change.id||!['PURCHASE_PRICE_SAVED','PURCHASE_SOURCE_SHARES_SAVED','PURCHASE_PLAN_SAVED'].includes(event.action))fail();
      const id=operationId(company,requestId,actorMemberId,event.taskId,event.action),actual=byId.get(id);
      if(actual){
        if(actual.action!==event.action||actual.result!=='SAVED'||actual.description!==change.orderId||actual.image!==change.lineId||actual.imageAltText!==(event.shareRootId||event.taskId)||actual.initiatedByStaffId!==actorStaffId||actual.details?.requestId!==requestId||Object.entries(event).some(([key,value])=>canonical(actual.details[key])!==canonical(value)))fail();
        saved.push(id);
      }
    }
    // RESULT may be omitted by a read query, or its response may have been lost.
    // Complete historical events must not be compared with a later task revision.
    if(saved.length===plan.events.length)continue;
    if(byId.has(operationId(prepared.title,'RESULT')))fail();
    const current=tasks.find(row=>row._id===change.id);
    if(!current||current.title!==change.id||current.description!==change.orderId||current.imageAltText!==change.lineId||replacements.has(change.id))fail();
    const price=plan.events.find(event=>event.action==='PURCHASE_PRICE_SAVED');
    let prior={...current};
    if(taskEditVersion(current)!==change.expected){
      if(!price||canonical(price.after)!==canonical(change.patch)||Object.keys(change.patch).some(key=>!Object.hasOwn(price.before,key)))fail();
      prior={...current,...price.before};
      if(taskEditVersion(prior)!==change.expected||taskEditVersion({...prior,...change.patch})!==taskEditVersion(current))fail();
    }
    if(change.targetVersion&&taskEditVersion({...prior,...change.patch})!==change.targetVersion)fail();
    for(const id of saved)omitted.add(id);
    replacements.set(change.id,prior);
    pending.push({taskId:change.id,rootId:change.sharesRootId||current.customerDemandTaskId||change.id,requestId,priorPlanRevision:change.planRevision,priorSharesRevision:change.sharesRevision});
  }
  const visible=activity.filter(row=>!omitted.has(row.title));
  for(const item of pending){
    if(readPurchasePlan(replacements.get(item.taskId),visible).revision!==item.priorPlanRevision)fail();
    if(item.priorSharesRevision!==undefined&&readPurchaseShares(item.rootId,visible).revision!==item.priorSharesRevision)fail();
  }
  return {tasks:tasks.map(row=>replacements.get(row._id)||row),activity:visible,pending};
}
module.exports={confirmedPlanView};
