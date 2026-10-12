import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
const text=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function readShipmentPlans(activity){
 const pending=activity.filter(row=>row.action==='CUSTOMER_SHIPMENT_PLAN_SAVED'&&row.result==='SAVED'),plans=new Map();
 while(pending.length){
  const next=pending.filter(row=>(plans.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Shipment plan history requires review.');
  for(const event of next){const plan=event.details.plan;if(!event.title||plan?.id!==event.description||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Shipment plan identity requires review.');plans.set(plan.id,{...plan,revision:event.title});pending.splice(pending.indexOf(event),1);}
 }
 return [...plans.values()];
}
export function shipmentPlanVersion(context){return operationId(context.company,context.tasks.map(row=>[row.id,row.customerId,row.orderId,row.ord]),readShipmentPlans(context.activity));}
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
   for(const [taskId,total] of totals)if(total!==tasks.find(row=>row.id===taskId).ord)throw Error('Split batches must preserve the selected line original customer quantity.');
   const id=operationId(company,customerId,orderId,'SHIPMENT_PLAN'),prior=readShipmentPlans(context.activity).find(row=>row.id===id),at=now().toISOString();
   if(prior?.batches.some(batch=>batch.lines.some(line=>!totals.has(line.taskId))))throw Error('Select all previously planned products before revising this order split.');
   const plan={id,company,customerId,orderId,batches,reason,at,by:staff.staffName,byStaffId:staff.staffId};
   const eventId=operationId(company,requestId,staff.memberId,'SHIPMENT_PLAN_EVENT');
   return {version,event:{_id:eventId,title:eventId,description:id,image:customerId,action:'CUSTOMER_SHIPMENT_PLAN_SAVED',result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason,details:{beforeRevision:prior?.revision||'',plan}}};
  },apply:async plan=>{const existing=await store.read(names[company].activity,plan.event._id);if(!existing){if(shipmentPlanVersion(await readContext(company,staff))!==plan.version)throw Error('Shipment plan changed while saving.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Shipment plan receipt conflict.');return {ok:true,company,requestId,planId:plan.event.description};}});
 };
}
