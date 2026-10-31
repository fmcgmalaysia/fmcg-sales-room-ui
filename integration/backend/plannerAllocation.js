import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { packingGuardVersion } from 'backend/packingListGuards.js';

import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readStockExceptions } from 'backend/inventoryExceptions.js';
import { readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { customerAllocationContext, readAllocationLoans } from 'backend/customerAllocationContext.js';
import { planCustomerAllocation, planCustomerRepayment, planCustomerReturn, planCustomerReconciliation } from 'backend/customerAllocationPlan.js';
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
export function readAllocations(activity){
 const pending=activity.filter(event=>event.action==='PLANNER_ALLOCATION_SAVED'&&event.result==='SAVED').flatMap(event=>{
  if(!event.details?.allocations)return [event];
  const changes=event.details.allocations;
  if(!Array.isArray(changes)||!changes.length||new Set(changes.map(row=>row.sourceTaskId)).size!==changes.length)throw Error('Grouped allocation identity requires review.');
  return changes.map(change=>({...event,title:event.title+'|'+change.sourceTaskId,imageAltText:change.sourceTaskId,details:change}));
 }).concat(activity.filter(event=>['SALES_ORDER_ADJUSTMENT_SAVED','DESK_SHORTLOAD_RESOLVED'].includes(event.action)&&event.result==='SAVED').flatMap(event=>(event.details.allocations||[]).map(change=>({...event,title:event.title+'|'+change.sourceTaskId,imageAltText:change.sourceTaskId,details:change})))),sources=new Map();
  while(pending.length){
    const candidates=pending.filter(event=>(sources.get(event.imageAltText)?.revision||'')===event.details?.beforeRevision);
    if(!candidates.length||new Set(candidates.map(event=>event.imageAltText)).size!==candidates.length)throw Error('Allocation history requires review.');
    for(const event of candidates){
      const detail=event.details;
      if(!event.title||!event.imageAltText||!Array.isArray(detail.targets)||new Set(detail.targets.map(row=>row.taskId)).size!==detail.targets.length||detail.targets.some(row=>!row.taskId||!qty(row.quantity)))throw Error('Allocation identity requires review.');
      sources.set(event.imageAltText,{sourceTaskId:event.imageAltText,revision:event.title,targets:detail.targets,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName});
      pending.splice(pending.indexOf(event),1);
    }
  }
  return [...sources.values()];
}
export function allocatedTo(taskId,activity){
  const sources=readAllocations(activity).filter(source=>source.targets.some(row=>row.taskId===taskId));
  return {quantity:sources.reduce((total,source)=>total+(source.targets.find(row=>row.taskId===taskId)?.quantity||0),0),at:sources.map(source=>source.at).sort().at(-1)||null,sources};
}
export function allocationVersion(workspace,activity){
  return packingGuardVersion({...workspace,activity},operationId(workspace.company,workspace.tasks.map(row=>[row.id,row.editVersion,row.ord,row.warehouse,row.salesInvoiceNumber,row.procurement,row.batchEntitlements]),readAllocations(activity),readCustomerShipments(activity),readStockExceptions(activity),readAllocationLoans(activity),readPhysicalOutflows(activity),activity.filter(row=>['CUSTOMER_SHIPMENT_PLAN_SAVED','SUPPORT_DESK_SAVED'].includes(row.action))));
}
export function createPlannerAllocationOperations({store,names,readWorkspace,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return async({company,staff,requestId,input})=>{
    if(!names[company]||input?.action!=='ALLOCATE')throw Error('Select a receiving line to allocate.');
    const collection=names[company].activity;
    return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{allocation:input},prepare:async()=>{
      const workspace=await readWorkspace(company,staff),activity=await store.all(collection),version=allocationVersion(workspace,activity);
      if(input.version!==version)throw Error('Stock or allocations changed. Refresh before allocating.');
      if(input.planMode){
        if(!['CUSTOMER','REPAY','RETURN','RECONCILE'].includes(input.planMode))throw Error('Select a customer allocation action.');
        const prior=readAllocations(activity),context=customerAllocationContext(workspace,activity,prior,version);
        const result=input.planMode==='CUSTOMER'?planCustomerAllocation(context,input):input.planMode==='RETURN'?planCustomerReturn(context,input):input.planMode==='RECONCILE'?planCustomerReconciliation(context,input):planCustomerRepayment(context,input);
        for(const change of result.changes){const source=context.sources.find(row=>row.id===change.sourceTaskId);if(!source||change.targets.reduce((n,target)=>n+target.quantity,0)>source.usableReceived)throw Error('Allocate no more than usable received stock.');for(const target of change.targets){const before=source.targets.find(row=>row.taskId===target.taskId);if(target.quantity<(before?.protectedQuantity||0))throw Error('Loaded or invoiced cartons cannot be removed.');}}
        const id=operationId(company,requestId,staff.memberId,'ALLOCATION'),at=now().toISOString();
        const changes=result.changes.map(change=>({...change,targets:change.targets.map(target=>{const task=workspace.tasks.find(row=>row.id===target.taskId),{protectedQuantity,...claim}=target;return {...claim,orderId:task.orderId,sourceLineId:task.sourceLineId,customerId:task.customerId};}),beforeRevision:prior.find(row=>row.sourceTaskId===change.sourceTaskId)?.revision||''}));
        const loan=result.loan?{...result.loan,id:result.loan.id||operationId(id,'BORROWING')}:null;
        const beforeLoan=loan&&context.loans.find(row=>row.id===loan.id);if(loan)delete loan.revision;
        return {expectedVersion:version,event:{_id:id,title:id,description:input.taskId||loan?.borrowerTaskId,image:context.tasks.find(row=>row.id===(input.taskId||loan?.borrowerTaskId))?.customerId||'',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:input.planMode==='REPAY'?'Borrowed stock repaid':'Customer received stock allocated',details:{company,mode:input.planMode,allocations:changes,loanChanges:loan?[{id:loan.id,beforeRevision:beforeLoan?.revision||'',state:loan}]:[],reason:input.planMode==='RECONCILE'?String(input.reason).trim():input.planMode==='REPAY'?'Explicit received stock repayment':input.planMode==='RETURN'?'Unshipped borrowed stock returned':'Customer allocation confirmed',taskId:input.taskId,batchId:input.batchId}}};
      }
      throw Error('Reload Purchase to use the customer allocation and borrowing workflow.');
    },apply:async plan=>{
      const existing=await store.read(collection,plan.event._id);
      if(!existing){
        const workspace=await readWorkspace(company,staff),activity=await store.all(collection);
        if(allocationVersion(workspace,activity)!==plan.expectedVersion)return {ok:false,company,requestId,retryable:false,error:'Stock or allocations changed while saving. Review current stock before making a new allocation.'};
        await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});
      }else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Allocation receipt conflict.');
      return {ok:true,company,requestId,sourceTaskId:plan.event.imageAltText,savedAt:plan.event.activityTime};
    }});
  };
}
