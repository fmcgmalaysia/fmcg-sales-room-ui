import { operationId, canonical } from 'backend/purchaseOperationJournal.js';
import { taskEditVersion } from 'backend/purchaseTaskIdentity.js';
// Supplier plans are immutable activity revisions, not warehouse stock receipts.
export function readPurchasePlan(task, activity) {
  const pending=activity.filter(event=>event.action==='PURCHASE_PLAN_SAVED'&&event.result==='SAVED'&&event.imageAltText===task.title);
  let revision='',totalCtn=null,last=null;
  while(pending.length){
    const next=pending.filter(event=>event.details?.beforeRevision===revision);
    if(next.length!==1)throw Error('Procurement plan history requires review.');
    const event=next[0],details=event.details;
    if(event.description!==task.description||event.image!==task.imageAltText||!event.title||!Number.isSafeInteger(details.totalCtn)||details.totalCtn<1||details.totalCtn>9999)throw Error('Procurement plan identity or quantity requires review.');
    if(details.extraCtn!==undefined&&(!Number.isSafeInteger(details.extraCtn)||details.extraCtn<0||details.extraCtn>details.totalCtn))throw Error('Procurement stock quantity requires review.');
    if(details.transportMode!==undefined&&!['SUPPLIER_DELIVER','SELF_COLLECT'].includes(details.transportMode))throw Error('Procurement transport history requires review.');
    revision=event.title;totalCtn=details.totalCtn;last=event;pending.splice(pending.indexOf(event),1);
  }
  return {revision,totalCtn,transportMode:last?.details?.transportMode||'',costing:last?.details?.costing||null,draftPlan:last?.details?.draftPlan===true,extraCtn:Number.isSafeInteger(last?.details?.extraCtn)?last.details.extraCtn:null,extraKind:last?.details?.extraKind||'',supplierId:last?.details?.supplierId||'',updatedAt:last?.activityTime||null,updatedBy:last?.initiatedByStaffName||'',confirmedAt:last?.details?.supplierConfirmed===true?last.activityTime:null,confirmedBy:last?.details?.supplierConfirmed===true?last.initiatedByStaffName:''};
}

// The plan revision owns the original inputs; legacy task prices are a derived average.
export function calculatePlanCosting(input,totalCtn,ea) {
  if(!input||input.schema!==1||!['NORMAL','FOC'].includes(input.mode)||!['PRICES','TOTAL'].includes(input.moneySource))throw Error('Check the procurement costing method.');
  const {paidCtn,freeCtn}=input,keys=['lpPc','lpCtn','disc1','disc2','disc3'],raw=input.prices;
  if(!Number.isSafeInteger(paidCtn)||paidCtn<1||!Number.isSafeInteger(freeCtn)||freeCtn<0||paidCtn+freeCtn!==totalCtn||totalCtn>9999||input.mode==='NORMAL'&&freeCtn!==0)throw Error('Paid cartons plus FOC cartons must equal the supplier total.');
  if(!Number.isSafeInteger(ea)||ea<1)throw Error('EA is unavailable. Cost cannot be calculated.');
  if(!raw||keys.some(key=>input.moneySource==='TOTAL'&&raw[key]===null?false:typeof raw[key]!=='number'||!Number.isFinite(raw[key])||raw[key]<0)||raw.disc1>1||raw.disc2>1)throw Error('Confirm all original supplier prices and discounts.');
  const paidUnit=keys.every(key=>Number.isFinite(raw[key]))?raw.lpCtn*(1-raw.disc1)*(1-raw.disc2)-raw.disc3:null;
  if(paidUnit<0)throw Error('Net cost cannot be negative.');
  const amountCents=input.moneySource==='TOTAL'?input.amountCents:Math.round(paidUnit*paidCtn*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>99999999900)throw Error('Confirm a positive supplier line amount. Zero-value procurement needs separate financial review.');
  const average=amountCents/100/totalCtn;
  return {schema:1,mode:input.mode,moneySource:input.moneySource,paidCtn,freeCtn,totalCtn,prices:Object.fromEntries(keys.map(key=>[key,raw[key]])),amountCents,averageCostCtn:average,ea,
    manualFields:keys.filter(key=>input.manualFields?.includes(key)),reference:input.reference?{at:String(input.reference.at||''),source:String(input.reference.source||'POINTBASE')}:null};
}

// A revision freezes all existing sibling shares. Editing B never reallocates A or C.
export function readPurchaseShares(rootId,activity) {
  const pending=activity.filter(event=>event.action==='PURCHASE_SOURCE_SHARES_SAVED'&&event.result==='SAVED'&&event.imageAltText===rootId);
  let revision='',shares=null;
  while(pending.length){const next=pending.filter(event=>event.details?.beforeRevision===revision);if(next.length!==1)throw Error('Supplier allocation history requires review.');
    const event=next[0];if(!event.title||!Array.isArray(event.details.shares)||event.details.shares.some(row=>!row.taskId||!Number.isSafeInteger(row.totalCtn)||row.totalCtn<0||!Number.isSafeInteger(row.customerCtn)||row.customerCtn<0||row.customerCtn>row.totalCtn)||new Set(event.details.shares.map(row=>row.taskId)).size!==event.details.shares.length)throw Error('Supplier allocation identity or shares require review.');
    revision=event.title;shares=event.details.shares;pending.splice(pending.indexOf(event),1);
  }
  return {revision,shares};
}

export function planPurchaseShares(workspace,activity,rootId,taskId,totalCtn) {
  const root=workspace.tasks.find(row=>row.id===rootId);if(!root)throw Error('Customer demand is unavailable.');
  const previous=readPurchaseShares(rootId,activity),group=workspace.tasks.filter(row=>row.id===rootId||row.customerDemandTaskId===rootId);
  const shares=group.filter(row=>row.id!==taskId).map(row=>({taskId:row.id,totalCtn:row.procurement?.totalCtn||0,customerCtn:Math.max(0,(row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0))}));
  const otherCustomer=shares.reduce((sum,row)=>sum+row.customerCtn,0);
  if(otherCustomer>root.ord)throw Error('Existing customer allocations exceed demand. Review them before saving.');
  const customerCtn=Math.min(totalCtn,root.ord-otherCustomer);shares.push({taskId,totalCtn,customerCtn});
  return {rootId,beforeRevision:previous.revision,shares:shares.sort((a,b)=>a.taskId.localeCompare(b.taskId)),customerCtn,extraCtn:totalCtn-customerCtn};
}

// Read-only recovery view over the existing journal and business events.
const recoveryEvidenceError=()=>{throw Error('Procurement recovery evidence requires review.');};
export function confirmedPurchaseState({company,tasks,activity,recoveringPoRequestId='',recoveringPoActorMemberId=''}) {
  if(!['NCT','GHR'].includes(company))recoveryEvidenceError();
  const byId=new Map(),tasksById=new Map(tasks.map(task=>[task._id,task])),pending=[],omitted=new Set(),replacements=new Map(),complete=[];
  const unique=id=>{const matches=byId.get(id)||[];if(matches.length>1)recoveryEvidenceError();return matches[0];};
  for(const row of activity){const bucket=byId.get(row.title)||[];bucket.push(row);byId.set(row.title,bucket);}
  for(const prepared of activity){
    if(prepared.action!=='PURCHASE_OPERATION_PREPARED'||!['PLAN','PO'].includes(prepared.details?.plan?.operation))continue;
    const {requestId,actorMemberId,actorStaffId,plan}=prepared.details;
    if(unique(prepared.title)!==prepared||!requestId||!actorMemberId||prepared.title!==operationId(company+'/PURCHASE',requestId,actorMemberId))recoveryEvidenceError();
    if(plan.operation==='PO'){
      if(!Array.isArray(plan.updates)||!plan.updates.length||!Array.isArray(plan.events)||!plan.events.length||new Set(plan.updates.map(change=>change.id)).size!==plan.updates.length)recoveryEvidenceError();
      const groups=[],affected=new Set(plan.updates.map(change=>change.id));let saved=0;
      for(const change of plan.updates){
        const assigned=plan.events.filter(event=>event.taskId===change.id&&event.action==='PURCHASE_PO_ASSIGNED');
        if(!change.expected||assigned.length!==1||!assigned[0].after||assigned[0].after!==change.patch?.ourPoNumber||Object.keys(change.patch).some(key=>!['ourPoNumber','purchaseStage'].includes(key)))recoveryEvidenceError();
      }
      const eventIds=new Set();
      for(const event of plan.events){
        const change=plan.updates.find(row=>row.id===event.taskId),id=operationId(company,requestId,actorMemberId,event.taskId,event.action),actual=unique(id);
        if(!change||!['PURCHASE_PO_ASSIGNED','PURCHASE_PLAN_SAVED'].includes(event.action)||eventIds.has(id))recoveryEvidenceError();eventIds.add(id);
        if(actual){if(actual.action!==event.action||actual.result!=='SAVED'||actual.description!==change.orderId||actual.image!==change.lineId||actual.imageAltText!==change.id||actual.initiatedByStaffId!==actorStaffId||actual.details?.requestId!==requestId||Object.entries(event).some(([key,value])=>canonical(actual.details[key])!==canonical(value)))recoveryEvidenceError();saved++;}
      }
      // Complete facts remain confirmed even if RESULT was lost. Later task edits
      // must not invalidate a completed historical assignment.
      if(saved===plan.events.length)continue;
      if(unique(operationId(prepared.title,'RESULT')))recoveryEvidenceError();
      for(const change of plan.updates){
        const task=tasksById.get(change.id),assigned=plan.events.find(event=>event.taskId===change.id&&event.action==='PURCHASE_PO_ASSIGNED');
        if(!task||task.title!==change.id||task.description!==change.orderId||task.imageAltText!==change.lineId)recoveryEvidenceError();
        groups.push({supplierId:task.supplierId,numbers:[assigned.before,assigned.after].filter(Boolean)});
      }
      // Only the owning journal apply may resume this exact prepared request.
      // Its digest, company lock, task versions and financial locks still apply.
      if(requestId===recoveringPoRequestId&&actorMemberId===recoveringPoActorMemberId)continue;
      for(const task of tasks)if(groups.some(group=>group.supplierId===task.supplierId&&group.numbers.includes(task.ourPoNumber)))affected.add(task.title);
      for(const id of affected){const task=tasksById.get(id);if(!task)recoveryEvidenceError();pending.push({operation:'PO',taskId:id,rootId:task.customerDemandTaskId||id,requestId});}
      continue;
    }
    if(plan.updates?.length!==1||!Array.isArray(plan.events)||!plan.events.length)recoveryEvidenceError();
    const change=plan.updates[0],saved=[];
    if(!change.expected||change.planRevision===undefined)recoveryEvidenceError();
    for(const event of plan.events){
      if(event.taskId!==change.id||!['PURCHASE_PRICE_SAVED','PURCHASE_SOURCE_SHARES_SAVED','PURCHASE_PLAN_SAVED'].includes(event.action))recoveryEvidenceError();
      const id=operationId(company,requestId,actorMemberId,event.taskId,event.action),actual=unique(id);
      if(actual){
        if(actual.action!==event.action||actual.result!=='SAVED'||actual.description!==change.orderId||actual.image!==change.lineId||actual.imageAltText!==(event.shareRootId||event.taskId)||actual.initiatedByStaffId!==actorStaffId||actual.details?.requestId!==requestId||Object.entries(event).some(([key,value])=>canonical(actual.details[key])!==canonical(value)))recoveryEvidenceError();
        saved.push(id);
      }
    }
    // RESULT may be omitted by a read query, or its response may have been lost.
    // Complete historical events must not be compared with a later task revision.
    if(saved.length===plan.events.length){complete.push({change,requestId,actorMemberId});continue;}
    if(unique(operationId(prepared.title,'RESULT')))recoveryEvidenceError();
    const current=tasks.find(row=>row._id===change.id);
    if(!current||current.title!==change.id||current.description!==change.orderId||current.imageAltText!==change.lineId||replacements.has(change.id))recoveryEvidenceError();
    const price=plan.events.find(event=>event.action==='PURCHASE_PRICE_SAVED');
    let prior={...current};
    if(taskEditVersion(current)!==change.expected){
      const before=price?price.before:change.draftPriceBefore;
      if(!before||(price?canonical(price.after)!==canonical(change.patch):Boolean(current.ourPoNumber))||Object.keys(change.patch).some(key=>!Object.hasOwn(before,key)))recoveryEvidenceError();
      prior={...current,...before};
      if(taskEditVersion(prior)!==change.expected||taskEditVersion({...prior,...change.patch})!==taskEditVersion(current))recoveryEvidenceError();
    }
    if(change.targetVersion&&taskEditVersion({...prior,...change.patch})!==change.targetVersion)recoveryEvidenceError();
    for(const id of saved)omitted.add(id);
    replacements.set(change.id,prior);
    pending.push({taskId:change.id,rootId:change.sharesRootId||current.customerDemandTaskId||change.id,requestId,priorPlanRevision:change.planRevision,priorSharesRevision:change.sharesRevision});
  }
  const visible=activity.filter(row=>!omitted.has(row.title)),plans=new Map();
  const planFor=task=>{if(!plans.has(task.title))plans.set(task.title,readPurchasePlan(task,visible));return plans.get(task.title);};
  for(const item of pending){
    if(item.operation==='PO')continue;
    if(planFor(replacements.get(item.taskId)).revision!==item.priorPlanRevision)recoveryEvidenceError();
    if(item.priorSharesRevision!==undefined&&readPurchaseShares(item.rootId,visible).revision!==item.priorSharesRevision)recoveryEvidenceError();
  }
  // Detect a stale task query paired with the latest complete costing revision.
  // Later confirmed revisions and pending-task recovery are checked independently.
  const completedByRevision=new Map(complete.map(item=>[operationId(company,item.requestId,item.actorMemberId,item.change.id,'PURCHASE_PLAN_SAVED'),item]));
  const completedTasks=new Set(complete.map(item=>item.change.id));
  for(const task of tasks){
    if(replacements.has(task._id)||!completedTasks.has(task._id))continue;
    const latest=planFor(task),item=completedByRevision.get(latest.revision);
    if(item&&latest.costing&&Object.entries(item.change.patch).some(([key,value])=>['lpPc','lpCtn','disc1','disc2','disc3'].includes(key)&&canonical(task[key])!==canonical(value)))recoveryEvidenceError();
  }
  return {tasks:tasks.map(row=>replacements.get(row._id)||row),activity:visible,pending,plans};
}

export const PROCUREMENT_SAVE_PENDING = 'Procurement save pending. Recover the original save before continuing.';

// Pending flags are produced once from the existing read evidence, never stored.
export function requireConfirmedProcurement(context,taskIds) {
  if(context?.procurementSavePending===true)throw Error(PROCUREMENT_SAVE_PENDING);
  const ids=new Set(taskIds||[]),workspace=context?.physicalContext||context;
  if((workspace?.pending||[]).some(item=>ids.has(item.taskId)||ids.has(item.rootId)))throw Error(PROCUREMENT_SAVE_PENDING);
  if((workspace?.tasks||[]).some(row=>ids.has(row.id||row.taskId)&&row.procurementSavePending===true))throw Error(PROCUREMENT_SAVE_PENDING);
}
