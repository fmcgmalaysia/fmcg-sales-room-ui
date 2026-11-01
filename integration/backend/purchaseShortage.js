import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';

export function readShortage(taskId,activity){
 const pending=activity.filter(event=>event.imageAltText===taskId&&event.action==='PURCHASE_SHORTAGE_DECIDED'&&event.result==='SAVED');let current=null;
 while(pending.length){
  const next=pending.filter(event=>event.details?.beforeRevision===(current?.revision||''));
  if(next.length!==1)throw Error('Shortage decision history requires review.');
  const event=next[0],detail=event.details;
  if(!event.title||!['WAIT','STOP','PENDING'].includes(detail.customerDecision)||!['REPLENISH','REFUND','CREDIT','PENDING'].includes(detail.supplierDecision)||!detail.reason)throw Error('Shortage decision requires review.');
  current={...detail,revision:event.title,at:event.activityTime,by:event.initiatedByStaffName};pending.splice(pending.indexOf(event),1);
 }
 return current;
}
export function shortageVersion(row,activity){return operationId(row.id,row.editVersion,row.ord,row.inc,row.procurement?.revision,row.warehouse,readShortage(row.id,activity)?.revision||'');}
export function createShortageOperations({store,names,readWorkspace,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||input?.action!=='SHORTAGE')throw Error('Select a purchase shortage.');
  const collection=names[company].activity;
  return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{shortage:input},prepare:async()=>{
   const workspace=await readWorkspace(company,staff),activity=await store.all(collection),row=workspace.tasks.find(row=>row.id===input.taskId);
   if(!row||row.archived||!row.supplierId||!row.po)throw Error('An active supplier P.O. is required.');
   if(shortageVersion(row,activity)!==input.version)throw Error('Quantity or shortage decision changed. Refresh before saving.');
   if(!(row.ord-(row.inc||0)>0||row.warehouse?.issue))throw Error('This task has no outstanding quantity or receiving issue.');
   const reason=String(input.reason||'').trim(),customerMessage=String(input.customerMessage||'').trim();
   if(!reason||reason.length>2000||!customerMessage||customerMessage.length>1000)throw Error('Enter an internal reason and customer-facing update.');
   if(!['WAIT','STOP','PENDING'].includes(input.customerDecision)||!['REPLENISH','REFUND','CREDIT','PENDING'].includes(input.supplierDecision))throw Error('Select customer waiting and supplier resolution separately.');
   if((input.customerDecision==='WAIT'||input.supplierDecision==='REPLENISH')&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate||'')||!Number.isFinite(Date.parse(input.expectedDate))||new Date(input.expectedDate).toISOString().slice(0,10)!==input.expectedDate))throw Error('Enter the expected replenishment date.');
   const prior=readShortage(row.id,activity),id=operationId(company,requestId,staff.memberId,'SHORTAGE'),at=now().toISOString();
   return {expectedVersion:input.version,event:{_id:id,title:id,description:row.orderId,image:row.sourceLineId,imageAltText:row.id,action:'PURCHASE_SHORTAGE_DECIDED',result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:reason,details:{beforeRevision:prior?.revision||'',customerDecision:input.customerDecision,supplierDecision:input.supplierDecision,customerMessage,reason,expectedDate:input.expectedDate||null,shortCtn:Math.max(0,row.ord-(row.inc||0)),allocatedCtn:row.inc||0,financeRequired:prior?.financeRequired===true||input.financeRequired===true||row.warehouse?.issue===true||['REFUND','CREDIT'].includes(input.supplierDecision)}}};
  },apply:async plan=>{
   const existing=await store.read(collection,plan.event._id);
   if(!existing){const workspace=await readWorkspace(company,staff),activity=await store.all(collection),row=workspace.tasks.find(row=>row.id===plan.event.imageAltText);if(!row||shortageVersion(row,activity)!==plan.expectedVersion)throw Error('Shortage decision changed while saving.');await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Shortage receipt conflict.');
   return {ok:true,company,requestId,taskId:plan.event.imageAltText,savedAt:plan.event.activityTime};
  }});
 };
}
