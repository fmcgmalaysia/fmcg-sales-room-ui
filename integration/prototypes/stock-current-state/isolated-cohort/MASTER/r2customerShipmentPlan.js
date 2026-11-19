import { operationId, createOperationJournal } from 'backend/r2purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
const text=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
// Order dates remain immutable intake snapshots; later Sales amendments are read from this journal.
export function readSalesShipmentDate(orderId,customerId,submissionId,originalDate,activity){
 const original=originalDate&&Number.isFinite(new Date(originalDate).getTime())?new Date(originalDate).toISOString().slice(0,10):'';
 let current={date:original,revision:'',at:'',by:''};
 const pending=activity.filter(row=>row.action==='SALES_SHIPMENT_DATE_SAVED'&&row.result==='SAVED'&&row.description===orderId);
 while(pending.length){const next=pending.filter(row=>row.details?.beforeRevision===current.revision);if(next.length!==1)throw Error('Shipment date history requires review.');const event=next[0],detail=event.details;
  if(detail.customerId!==customerId||detail.submissionId!==submissionId||!event.title||!event.initiatedByStaffId||!event.initiatedByStaffName||!Number.isFinite(Date.parse(event.activityTime))||typeof detail.date!=='string'||detail.date&&(!validDate(detail.date)||Number(detail.date.slice(0,4))<1000))throw Error('Shipment date identity requires review.');
  current={date:detail.date,revision:event.title,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName};pending.splice(pending.indexOf(event),1);
 }
 return current;
}
export function shipmentDateLocked(tasks){const demand=tasks.filter(row=>!row.specialPurchase&&!row.procurementSource);return !demand.some(row=>{const goal=row.shortage?.customerDecision==='STOP'?(row.inc||0):row.ord;const dispatched=(row.salesFulfilment?.invoices||[]).reduce((sum,invoice)=>sum+(invoice.dispatched?invoice.quantity:0),0);return !row.archived&&goal>dispatched;});}
export function createSalesShipmentDateOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canEditShipmentDate!==true||input?.action!=='ORDER_DATE')throw Error('Only authorized Sales staff may change shipment dates.');
  if(staff.customerId!==input.customerId)throw Error('Shipment date customer is not authorized.');
  if(typeof input.date!=='string'||input.date&&(!validDate(input.date)||Number(input.date.slice(0,4))<1000)||typeof input.version!=='string'||typeof input.orderId!=='string'||!input.orderId||typeof input.submissionId!=='string'||!input.submissionId)throw Error('Enter a valid shipment date and order version.');
  const check=async()=>{const context=await readContext(company,staff),tasks=context.tasks.filter(row=>row.customerId===input.customerId&&row.orderId===input.orderId),receipts=context.activity.filter(row=>row.description===input.orderId&&row.action==='ORDER_RECEIVED'&&row.result==='ACCEPTED'&&row.details?.submissionId===input.submissionId);
   if(context.company!==company||staff.customerId!==input.customerId||!tasks.length||receipts.length!==1)throw Error('Shipment date order is not authorized.');
   if(shipmentDateLocked(tasks))throw Error('Shipment date is locked after the order has finished shipping.');
   const current=readSalesShipmentDate(input.orderId,input.customerId,input.submissionId,tasks[0].estimatedShipmentDate,context.activity);if(current.revision!==input.version)throw Error('Shipment date changed. Refresh before saving.');return current;
  };
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',entityId:input.orderId,requestId,staff,input:{salesShipmentDate:input},prepare:async()=>{await check();const at=now().toISOString(),id=operationId(company,requestId,staff.memberId,'SALES_SHIPMENT_DATE');return {event:{_id:id,title:id,description:input.orderId,image:input.customerId,action:'SALES_SHIPMENT_DATE_SAVED',result:'SAVED',actorType:'STAFF',activityTime:at,initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Sales adjusted estimated shipment date',details:{customerId:input.customerId,submissionId:input.submissionId,beforeRevision:input.version,date:input.date}}};},apply:async plan=>{const prior=await store.read(names[company].activity,plan.event._id);if(!prior){await check();await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}else if(operationId(prior.details)!==operationId(plan.event.details))throw Error('Shipment date receipt conflict.');return {ok:true,company,requestId,orderId:input.orderId,customerId:input.customerId,date:input.date,revision:plan.event.title,savedAt:plan.event.activityTime,by:staff.staffName};}});
 };
}
export function readShipmentPlans(activity){
 const pending=activity.filter(row=>['CUSTOMER_SHIPMENT_PLAN_SAVED','SALES_ORDER_ADJUSTMENT_SAVED'].includes(row.action)&&row.result==='SAVED'),plans=new Map();
 while(pending.length){
  const next=pending.filter(row=>(plans.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Shipment plan history requires review.');
  for(const event of next){const plan=event.details.plan;if(!event.title||plan?.id!==event.description||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Shipment plan identity requires review.');plans.set(plan.id,{...plan,revision:event.title});pending.splice(pending.indexOf(event),1);}
 }
 return [...plans.values()];
}
export function shipmentPlanVersion(context){return operationId(context.company,context.tasks.map(row=>[row.id,row.customerId,row.orderId,row.ord,row.requested,row.archived]),readShipmentPlans(context.activity),readCustomerShipments(context.activity),context.activity.filter(event=>event.action==='WAREHOUSE_PREPARATION_SAVED'&&event.result==='SAVED').map(event=>event.title).sort());}
// Plans express customer intent only: they never allocate stock, reserve cartons or post receivables.
export function createShipmentPlanOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canSelectShipment!==true||input?.action!=='PLAN')throw Error('Only authorized Sales staff may plan customer shipments.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{shipmentPlan:input},prepare:async()=>{
   const context=await readContext(company,staff),version=shipmentPlanVersion(context),reason=text(input.reason),customerId=text(input.customerId),orderId=text(input.orderId);
   if(context.company!==company||version!==input.version)throw Error('Shipment plan changed. Refresh before saving.');
   if(!customerId||!orderId||staff.customerId&&staff.customerId!==customerId)throw Error('Shipment plan customer is not authorized.');
   if(!reason||reason.length>2000||!Array.isArray(input.batches)||input.batches.length<2||input.batches.length>20)throw Error('Enter the split reason and two to twenty shipment batches.');
   const tasks=context.tasks.filter(row=>row.customerId===customerId&&row.orderId===orderId&&!row.specialPurchase&&!row.procurementSource);
   if(!tasks.length||tasks.every(row=>row.archived))throw Error('Select an active customer order.');
   const totals=new Map(),seen=new Set();
   const batches=input.batches.map((batch,index)=>{
    if(!text(batch.label)||text(batch.label).length>80||seen.has(text(batch.label))||batch.date&&!validDate(batch.date)||!Array.isArray(batch.lines)||!batch.lines.length||new Set(batch.lines.map(row=>row.taskId)).size!==batch.lines.length)throw Error('Enter distinct batch names, valid optional dates and product lines.');
    seen.add(text(batch.label));
    const lines=batch.lines.map(entry=>{const task=tasks.find(row=>row.id===entry.taskId);if(!task||!Number.isSafeInteger(entry.quantity)||entry.quantity<=0||entry.quantity>9999)throw Error('Select order lines and positive whole cartons.');totals.set(task.id,(totals.get(task.id)||0)+entry.quantity);return {taskId:task.id,quantity:entry.quantity};});
    return {sequence:index+1,label:text(batch.label),date:batch.date||null,lines};
   });
   for(const [taskId,total] of totals){const task=tasks.find(row=>row.id===taskId);if(total!==(task.requested??task.ord))throw Error('Split batches must preserve the selected line original customer quantity.');}
   const id=operationId(company,customerId,orderId,'SHIPMENT_PLAN'),prior=readShipmentPlans(context.activity).find(row=>row.id===id),at=now().toISOString();
   // Once quantities carry batch entitlements, legacy PLAN must not erase or renumber them.
   for(const previous of prior?.batches||[]){
    for(const line of previous.lines.filter(line=>line.coverage)){
     const batch=batches.find(batch=>batch.label===previous.label&&batch.date===previous.date),current=batch?.lines.find(row=>row.taskId===line.taskId);
     if(!current||current.quantity!==line.quantity||batch.sequence!==previous.sequence)throw Error('Use Order Adjustment to change an allocated shipment batch.');
     Object.assign(current,{coverage:line.coverage,sourceCoverage:line.sourceCoverage,stockCoverage:line.stockCoverage});
    }
   }
   if(prior?.batches.some(batch=>batch.lines.some(line=>!totals.has(line.taskId))))throw Error('Select all previously planned products before revising this order split.');
   for(const taskId of totals.keys()){
    const entries=list=>(list||[]).flatMap(batch=>{const line=batch.lines.find(line=>line.taskId===taskId);return line?[{label:batch.label,date:batch.date||null,quantity:line.quantity}]:[];});
    if(operationId(entries(prior?.batches))===operationId(entries(batches)))continue;
    if(readCustomerShipments(context.activity).some(shipment=>shipment.status!=='CANCELLED'&&shipment.lines.some(line=>line.taskId===taskId)))throw Error('Shipment already selected or invoiced. Resolve the shipment before changing its split.');
    const preparation=context.activity.filter(event=>event.action==='WAREHOUSE_PREPARATION_SAVED'&&event.result==='SAVED'&&event.details?.state?.taskId===taskId);
    const latest=preparation.filter(event=>!preparation.some(next=>next.details?.beforeRevision===event.title));
    if(new Set(latest.map(event=>event.details.state.id)).size!==latest.length||latest.some(event=>event.details.state.prepared||event.details.state.loaded>0))throw Error('Warehouse preparation must be reversed before changing this split.');
   }
   const plan={id,company,customerId,orderId,batches,...(prior?.sourceBaselines?{sourceBaselines:prior.sourceBaselines}:{}),reason,at,by:staff.staffName,byStaffId:staff.staffId};
   const eventId=operationId(company,requestId,staff.memberId,'SHIPMENT_PLAN_EVENT');
   return {version,event:{_id:eventId,title:eventId,description:id,image:customerId,action:'CUSTOMER_SHIPMENT_PLAN_SAVED',result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason,details:{beforeRevision:prior?.revision||'',plan}}};
  },apply:async plan=>{const existing=await store.read(names[company].activity,plan.event._id);if(!existing){if(shipmentPlanVersion(await readContext(company,staff))!==plan.version)throw Error('Shipment plan changed while saving.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Shipment plan receipt conflict.');return {ok:true,company,requestId,planId:plan.event.description};}});
 };
}
