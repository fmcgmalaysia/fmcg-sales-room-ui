import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { resolveBatchEntitlements, allocateBatchSources, batchEntries, preferredSourceBatch, stockBatchEntries } from 'backend/shipmentBatchAllocation.js';
export const SALES_ADJUSTMENT_ACTION='SALES_ORDER_ADJUSTMENT_SAVED';
const qty=value=>Number.isSafeInteger(value)&&value>0&&value<=9999;
// Original intake, supplier P.O. and receipt rows remain immutable. Customer demand is a journal view.
export function readSalesDemand(taskId,original,activity){
 const pending=activity.filter(event=>event.action===SALES_ADJUSTMENT_ACTION&&event.result==='SAVED'&&event.imageAltText===taskId);
 let requested=original,revision='';
 while(pending.length){const next=pending.filter(event=>event.details?.beforeDemandRevision===revision);if(next.length!==1)throw Error('Sales demand history requires review.');
  const event=next[0],d=event.details;
  if(!event.title||!qty(d.beforeRequested)||!qty(d.requested)||d.beforeRequested!==requested||!['INCREASE','SPLIT','REDUCE'].includes(d.mode)||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Sales demand identity requires review.');
  const delta=d.afterQuantity-d.beforeQuantity,lines=d.plan?.batches?.flatMap(batch=>batch.lines.filter(line=>line.taskId===taskId));
  if(!qty(d.beforeQuantity)||!qty(d.afterQuantity)||!Array.isArray(lines)||!lines.length||lines.some(line=>!qty(line.quantity))||lines.reduce((sum,line)=>sum+line.quantity,0)!==d.requested||d.plan.id!==event.description||d.plan.customerId!==event.image||d.customerId!==event.image||d.plan.orderId!==d.orderId||(d.mode==='SPLIT'&&(!(delta<0)||d.requested!==requested)))throw Error('Sales demand quantities require review.');
  if(d.mode==='INCREASE'&&(!(delta>0)||d.requested-requested!==delta)||d.mode==='REDUCE'&&(!(delta<0)||d.requested-requested!==delta))throw Error('Sales demand adjustment requires review.');
  requested=d.requested;revision=event.title;pending.splice(pending.indexOf(event),1);
 }
 return {requested,revision};
}
export function salesAdjustmentVersion(context,planVersion){return operationId(planVersion(context),context.allocations||[],context.tasks.map(row=>[row.id,row.editVersion,row.procurement?.revision,row.procurement?.totalCtn,row.inc]));}
export function createSalesOrderAdjustmentOperations({store,names,readContext,readPlans,planVersion,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canSelectShipment!==true||input?.action!=='ADJUST'||!['INCREASE','SPLIT','REDUCE'].includes(input.mode)||staff.customerId!==input.customerId)throw Error('Sales order adjustment is not authorized.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{salesOrderAdjustment:input},prepare:async()=>{
   const context=await readContext(company,staff),task=context.tasks.find(row=>row.id===input.taskId&&row.customerId===input.customerId&&row.orderId===input.orderId&&!row.procurementSource&&!row.specialPurchase&&!row.archived);
   if(context.company!==company||!task)throw Error('Select an active customer order line.');
   if(salesAdjustmentVersion(context,planVersion)!==input.version)throw Error('Order or stock changed. Refresh before saving.');
   const total=task.requested??task.ord,prior=readPlans(context.activity).find(plan=>plan.customerId===task.customerId&&plan.orderId===task.orderId);
   if(!qty(total)||!qty(input.quantity))throw Error('Enter whole cartons between 1 and 9999.');
   const planId=prior?.id||operationId(company,task.customerId,task.orderId,'SHIPMENT_PLAN');
   const batches=(prior?.batches||[{sequence:1,label:'This shipment',date:null,lines:[{taskId:task.id,quantity:total}]}]).map(batch=>({...batch,lines:batch.lines.map(line=>({...line}))}));
   const alreadyPlanned=prior?.batches.some(batch=>batch.lines.some(line=>line.taskId===task.id));
   const index=alreadyPlanned?batches.findIndex(batch=>planId+'|'+batch.sequence===input.batchId&&batch.lines.some(line=>line.taskId===task.id)):input.batchId? -1:0;
   if(index<0)throw Error('Shipment row changed. Refresh before saving.');
   if(!alreadyPlanned&&!batches[index].lines.some(line=>line.taskId===task.id))batches[index].lines.push({taskId:task.id,quantity:total});
   const beforePlan={id:planId,batches},group=context.tasks.filter(row=>row.id===task.id||row.customerDemandTaskId===task.id);
   const sourceTotals=group.map(row=>({id:row.id,quantity:Math.max(0,(row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0)),batchId:preferredSourceBatch(row.id,context.activity)})).filter(row=>row.quantity>0);
   const stockSources=(context.allocations||[]).flatMap(allocation=>{const own=allocation.targets.find(row=>row.taskId===task.id);return own?[{id:allocation.sourceTaskId,quantity:own.quantity,batchId:preferredSourceBatch(allocation.sourceTaskId,context.activity)}]:[];});
   const stockBefore=allocateBatchSources(stockBatchEntries(beforePlan,task.id),stockSources);
   const entitlement=resolveBatchEntitlements(beforePlan,task.id,{committed:task.salesCommittedQty??task.ord,received:Math.max(0,task.inc||0)},sourceTotals);
   for(const batch of batches){const line=batch.lines.find(line=>line.taskId===task.id);if(!line)continue;const saved=entitlement.find(row=>row.id===planId+'|'+batch.sequence);line.coverage={...saved.metrics};line.sourceCoverage=saved.sources;line.stockCoverage=stockBefore[entitlement.indexOf(saved)];}
   const target=batches[index].lines.find(line=>line.taskId===task.id),before=target.quantity,n=input.quantity;
   if(!qty(before)||input.mode!=='INCREASE'&&n>=before)throw Error('Enter a quantity smaller than this shipment row.');
   const after=input.mode==='INCREASE'?before+n:input.mode==='REDUCE'?before-n:n;
   const requested=total+(input.mode==='INCREASE'?n:input.mode==='REDUCE'?-n:0);
   if(!qty(requested)||!qty(after))throw Error('Adjusted demand must stay between 1 and 9999 cartons.');
   // Do not rewrite an invoice, shipment reservation or physical packing instruction silently.
   if(readCustomerShipments(context.activity).some(shipment=>shipment.status!=='CANCELLED'&&shipment.lines.some(line=>line.taskId===task.id)))throw Error('Shipment already selected or invoiced. Resolve it before adjusting this product.');
   const preparations=context.activity.filter(event=>event.action==='WAREHOUSE_PREPARATION_SAVED'&&event.result==='SAVED'&&event.details?.state?.taskId===task.id);
   const latest=preparations.filter(event=>!preparations.some(next=>next.details?.beforeRevision===event.title));
   if(latest.some(event=>event.details.state.prepared||event.details.state.loaded>0))throw Error('Warehouse preparation must be reversed before adjusting this product.');
   target.quantity=after;
   for(const key of Object.keys(target.coverage))target.coverage[key]=Math.min(after,target.coverage[key]);
   let sourceLimit=after;target.sourceCoverage=target.sourceCoverage.map(row=>{const quantity=Math.min(sourceLimit,row.quantity);sourceLimit-=quantity;return {...row,quantity};}).filter(row=>row.quantity>0);
   let stockLimit=after;target.stockCoverage=target.stockCoverage.map(row=>{const quantity=Math.min(stockLimit,row.quantity);stockLimit-=quantity;return {...row,quantity};}).filter(row=>row.quantity>0);
   if(input.mode==='SPLIT'){
    if(batches.length>=20)throw Error('This order already has twenty shipment batches.');
    const sequence=Math.max(...batches.map(batch=>batch.sequence))+1;
    const originalEntitlement=entitlement.find(row=>row.id===planId+'|'+batches[index].sequence),coverage=Object.fromEntries(Object.entries(originalEntitlement.metrics).map(([key,value])=>[key,Math.max(0,value-target.coverage[key])]));
    const sourceCoverage=originalEntitlement.sources.map(row=>({id:row.id,quantity:row.quantity-(target.sourceCoverage.find(kept=>kept.id===row.id)?.quantity||0)})).filter(row=>row.quantity>0);
    const originalStock=stockBefore[entitlement.indexOf(originalEntitlement)],stockCoverage=originalStock.map(row=>({id:row.id,quantity:row.quantity-(target.stockCoverage.find(kept=>kept.id===row.id)?.quantity||0)})).filter(row=>row.quantity>0);
    batches.splice(index+1,0,{sequence,label:sequence===2?'Next shipment':'Shipment '+sequence,date:null,lines:[{taskId:task.id,quantity:before-n,coverage,sourceCoverage,stockCoverage}]});
   }
   const at=now().toISOString(),id=operationId(company,requestId,staff.memberId,'SALES_ORDER_ADJUSTMENT'),old=readSalesDemand(task.id,total,[]),latestDemand=context.activity.filter(event=>event.action===SALES_ADJUSTMENT_ACTION&&event.result==='SAVED'&&event.imageAltText===task.id);
   const previousRevision=latestDemand.find(event=>!latestDemand.some(next=>next.details?.beforeDemandRevision===event.title))?.title||old.revision;
   const allocations=[];
   if(input.mode==='REDUCE'){
    // A cancellation releases its saved cartons; never refill another batch's gap with them.
    const stockAfter=batchEntries({id:planId,batches},task.id).map(row=>row.stockCoverage||[]);
    for(const allocation of [...(context.allocations||[])].sort((a,b)=>a.sourceTaskId.localeCompare(b.sourceTaskId))){
     const own=allocation.targets.find(row=>row.taskId===task.id);if(!own)continue;
     const quantity=Math.min(own.quantity,stockAfter.flat().filter(row=>row.id===allocation.sourceTaskId).reduce((sum,row)=>sum+row.quantity,0));
     if(quantity!==own.quantity)allocations.push({sourceTaskId:allocation.sourceTaskId,beforeRevision:allocation.revision,targets:allocation.targets.map(row=>row.taskId===task.id?{...row,quantity}:row)});
    }
   }
   const sourceBaselines=[...(prior?.sourceBaselines||[]).filter(row=>row.taskId!==task.id),{taskId:task.id,sources:group.map(source=>({id:source.id,totalCtn:source.procurement?.totalCtn||0,customerCtn:batches.flatMap(batch=>batch.lines.filter(line=>line.taskId===task.id)).flatMap(line=>line.sourceCoverage||[]).filter(row=>row.id===source.id).reduce((sum,row)=>sum+row.quantity,0)}))}];
   const plan={id:planId,company,customerId:task.customerId,orderId:task.orderId,batches,sourceBaselines,reason:'Sales '+input.mode.toLowerCase()+' '+before+' to '+after,at,by:staff.staffName,byStaffId:staff.staffId};
   return {version:input.version,event:{_id:id,title:id,description:planId,image:task.customerId,imageAltText:task.id,action:SALES_ADJUSTMENT_ACTION,result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:plan.reason,details:{orderId:task.orderId,sourceLineId:task.sourceLineId,customerId:task.customerId,beforeDemandRevision:previousRevision,beforeRequested:total,requested,mode:input.mode,batchId:input.batchId||'',beforeQuantity:before,afterQuantity:after,beforeRevision:prior?.revision||'',plan,allocations}}};
  },apply:async plan=>{
   const prior=await store.read(names[company].activity,plan.event._id);
   if(!prior){if(salesAdjustmentVersion(await readContext(company,staff),planVersion)!==plan.version)throw Error('Order or stock changed while saving.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(prior.details)!==operationId(plan.event.details))throw Error('Sales adjustment receipt conflict.');
   return {ok:true,company,requestId,taskId:plan.event.imageAltText,requested:plan.event.details.requested};
  }});
 };
}
