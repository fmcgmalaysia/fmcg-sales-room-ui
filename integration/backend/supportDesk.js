import { requireConfirmedProcurement } from 'backend/purchasePlan.js';
import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments, reservedCartons } from 'backend/customerShipmentLedger.js';
import { adjustableDeliveryLine, deskTaskPortions, readShortloadResolutions, readDeskCommitments } from 'backend/shortloadResolutionModel.js';
import { readPhysicalOutflows, deskLoadedInvoiceQuantity } from 'backend/physicalOutflow.js';
const ACTION='SUPPORT_DESK_SAVED';
const deskValid=value=>Number.isSafeInteger(value)&&value>=1&&value<=3;
const textValid=value=>typeof value==='string'&&value.length>0&&value.length<=100;
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const optionalDate=value=>value===''||dateValid(value);
const gateValid=value=>value===''||typeof value==='string'&&dateValid(value.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const referenceText=value=>typeof value==='string'&&value.length<=100&&!/[\x00-\x1f]/.test(value);
const detailReferenceValid=row=>referenceText(row.invoiceNoDraft)&&optionalDate(row.depositDate)&&(row.depositAmountCents===null||Number.isSafeInteger(row.depositAmountCents)&&row.depositAmountCents>=0&&row.depositAmountCents<=999999999999)&&typeof row.depositCurrency==='string'&&/^[A-Z]{3}$|^$/.test(row.depositCurrency)&&(row.depositAmountCents===null||Boolean(row.depositCurrency));
const detailShipmentValid=row=>optionalDate(row.date)&&optionalDate(row.arrival)&&(!row.date||!row.arrival||row.arrival>=row.date)&&gateValid(row.lastGateIn)&&optionalDate(row.departureDate)&&(row.transport===''||transports.includes(row.transport));
const transports=['LAND','SEA_20FT','SEA_40FT','OTHER'];
const identity=(company,customerId)=>operationId(company,customerId,'SUPPORT_DESK');
const empty=(company,customerId)=>({company,customerId,revision:'',assignments:[],shipments:[]});
export const supportDeskBatchId=(state,desk)=>state?.batches?.find(row=>row.desk===desk)?.id||operationId(state.company,state.customerId,desk,'INITIAL_DESK_BATCH');
export function invoiceDeskSnapshots(activity){
 const saved=new Map(activity.map(row=>[row.title,row.description])),snapshots=new Map();
 for(const intent of activity)if(intent.action==='SUPPORT_INVOICE_PREPARED'&&intent.details?.desk){const invoiceId=saved.get(operationId(intent._id,'SUPPORT_INVOICE_INPUT_SAVED'));if(invoiceId){if(snapshots.has(invoiceId))throw Error('Invoice Desk identity requires review.');snapshots.set(invoiceId,intent.details.desk);}}
 return snapshots;
}
export function invoiceDeskSnapshot(activity,invoiceId){return invoiceDeskSnapshots(activity).get(invoiceId)||null;}
const copy=value=>JSON.parse(JSON.stringify(value));
const validParts=parts=>Array.isArray(parts)&&parts.length>0&&parts.length<=4&&new Set(parts.map(part=>part.desk)).size===parts.length&&parts.every(part=>(part.desk===0||deskValid(part.desk))&&Number.isSafeInteger(part.quantity)&&part.quantity>0&&part.quantity<=9999);
const receiptState=value=>Array.isArray(value)?value.map(receiptState):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,receiptState(value[key])])):value;
const validDeliveryHolds=state=>state?.deliveryHolds===undefined||Array.isArray(state.deliveryHolds)&&state.deliveryHolds.length<=3&&new Set(state.deliveryHolds.map(row=>row.desk)).size===state.deliveryHolds.length&&state.deliveryHolds.every(row=>deskValid(row.desk)&&[row.listId,row.requestId,row.memberId,row.digest].every(textValid)&&Array.isArray(row.taskIds)&&row.taskIds.length>0&&new Set(row.taskIds).size===row.taskIds.length&&row.taskIds.every(textValid));
function validExtras(state){return (state.references===undefined||Array.isArray(state.references)&&new Set(state.references.map(r=>r.desk)).size===state.references.length&&state.references.every(r=>deskValid(r.desk)&&typeof r.soNo==='string'&&r.soNo.length<=100&&typeof r.poNo==='string'&&r.poNo.length<=100&&(r.detailsVersion!==3||detailReferenceValid(r))))&&(state.locks===undefined||Array.isArray(state.locks)&&new Set(state.locks.map(r=>r.desk)).size===state.locks.length&&state.locks.every(r=>deskValid(r.desk)&&textValid(r.requestId)&&textValid(r.memberId)&&textValid(r.number)&&textValid(r.digest)&&Array.isArray(r.taskIds)&&r.taskIds.every(textValid)&&r.snapshot?.number===r.desk));}
function validState(state,company){return state&&state.company===company&&textValid(state.customerId)&&(state.batches===undefined||Array.isArray(state.batches)&&state.batches.length<=3&&new Set(state.batches.map(row=>row.desk)).size===state.batches.length&&state.batches.every(row=>deskValid(row.desk)&&textValid(row.id)))&&validExtras(state)&&(state.rowOrders===undefined||Array.isArray(state.rowOrders)&&state.rowOrders.length<=3&&new Set(state.rowOrders.map(row=>row.desk)).size===state.rowOrders.length&&state.rowOrders.every(row=>deskValid(row.desk)&&textValid(row.batchId)&&Array.isArray(row.taskIds)&&row.taskIds.length>=2&&row.taskIds.length<=300&&row.taskIds.every(textValid)&&new Set(row.taskIds).size===row.taskIds.length))&&Array.isArray(state.assignments)&&new Set(state.assignments.map(row=>row.taskId)).size===state.assignments.length&&state.assignments.every(row=>textValid(row.taskId)&&(row.desk===0||deskValid(row.desk)))&&Array.isArray(state.shipments)&&new Set(state.shipments.map(row=>row.desk)).size===state.shipments.length&&state.shipments.every(row=>deskValid(row.desk)&&(row.detailsVersion===3?detailShipmentValid(row):transports.includes(row.transport)&&dateValid(row.date)&&(row.arrival===''||dateValid(row.arrival)&&row.arrival>=row.date)));}
export function readSupportDesks(activity,company){
 if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
 const pending=activity.filter(row=>[ACTION,'DESK_SHORTLOAD_RESOLVED'].includes(row.action)&&row.result==='SAVED').map(row=>row.action===ACTION?row:{...row,description:identity(company,row.details.customerId),details:{...row.details,beforeRevision:row.details.deskBeforeRevision}}),states=new Map(),requests=new Set();
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Desk history requires review.');
  for(const event of next){const d=event.details,state=d?.state,requestKey=d?.memberId+'/'+d?.requestId;
   if(!validState(state,company)||state.assignments.some(row=>row.parts!==undefined&&(!validParts(row.parts)||row.dispositionRevision!==undefined&&typeof row.dispositionRevision!=='string'))||!validDeliveryHolds(state)||event.description!==identity(company,state.customerId)||event._id!==operationId(event.description,d.beforeRevision,'NEXT')||event.title!==event._id||!d.memberId||!d.requestId||requests.has(requestKey)||!event.initiatedByStaffId||!event.initiatedByStaffName||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Desk record identity requires review.');
   requests.add(requestKey);states.set(event.description,{...copy(state),revision:event.title});pending.splice(pending.indexOf(event),1);
  }
 }
 return [...states.values()];
}
export function supportDeskForTask(state,taskId){return state?.assignments.find(row=>row.taskId===taskId)?.desk||0;}
export async function reserveSupportDeskDelivery({store,names,context,staff,requestId,customerId,desk,revision,listId,taskIds,digest,now}){
 const company=context.company,before=currentSupportDeskState(context,readSupportDesks(context.activity,company).find(row=>row.customerId===customerId)||empty(company,customerId));
 const owned=(before.deliveryHolds||[]).find(row=>row.desk===desk&&row.requestId===requestId&&row.memberId===staff.memberId);
 if(owned){if(owned.digest!==digest||owned.listId!==listId)throw Error('Desk delivery save identity changed.');return copy(before);}
 if(before.revision!==revision)throw Error('Desk classification changed. Refresh before sending to Warehouse.');
 if(currentSupportDeskLocks(context).some(row=>row.customerId===customerId&&row.desk===desk))throw Error('This Desk is locked by its Sales Invoice.');
 const previous=(before.deliveryHolds||[]).find(row=>row.desk===desk),previousList=previous&&context.activity.find(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details?.list?.id===previous.listId)?.details?.list;
 if(previous&&(!previousList||!['COMPLETED','CANCELLED'].includes(previousList.status)))throw Error('This Desk already has an active Warehouse task.');
 if(!deskValid(desk)||!taskIds.length||taskIds.some(taskId=>{const task=context.tasks.find(row=>row.id===taskId);return !task||!deskTaskPortions(context.activity,before,task).some(row=>row.desk===desk&&row.quantity>0);}))throw Error('Desk task membership changed.');
 const state=copy(before);delete state.revision;state.deliveryHolds=(state.deliveryHolds||[]).filter(row=>row.desk!==desk).concat({desk,listId,requestId,memberId:staff.memberId,digest,taskIds:[...taskIds]});
 const saved=await appendInvoiceDeskState({store,collection:names[company].activity,company,staff,requestId,before,state,kind:'authorized delivery',now});
 return {...saved.state,revision:saved.revision};
}
// Classification and shipping metadata only. No quantity, stock, invoice or payment writes.
function membershipBaseline(context,taskId,customerId){
 const task=context.tasks.find(row=>row.id===taskId&&row.customerId===customerId);
 const deliveries=context.activity.filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details?.list?.customerId===customerId)
  .map(row=>[row.details.list.id,row.details.list.revision]).sort(([a],[b])=>a.localeCompare(b));
 return operationId(task?.requested??task?.ord,task?.archived,task?.transactionCurrency,deliveries);
}
export function createSupportDeskOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async request=>{
  const {company,staff,requestId,input}=request;
  if(!['DESK_ASSIGN','DESK_SPLIT'].includes(input?.action))return save(request);
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT')throw Error('Support access is required.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{deskMembership:input},
   prepare:async()=>save(request,true),apply:async plan=>{
    if(!plan.event)return plan.receipt;
    const existing=await store.read(names[company].activity,plan.event._id);
    if(!existing){
     const context=await readContext(company,staff);
     requireConfirmedProcurement(context,[input.taskId]);
     if(membershipBaseline(context,input.taskId,input.customerId)!==plan.baseline)throw Error('Desk details changed. Refresh before editing.');
    }
    return persist(plan.event,request,plan.state,plan.digest);
   }});
 };
 async function save({company,staff,requestId,input},prepareOnly=false){
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support access is required.');
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||!textValid(input.customerId)||!(deskValid(input.desk)||['DESK_ASSIGN','DESK_SPLIT'].includes(input.action)&&input.desk===0)||typeof input.revision!=='string'||input.revision.length>100||!['DESK_ASSIGN','DESK_SPLIT','DESK_SHIPMENT','DESK_REFERENCES','DESK_ARCHIVE','DESK_ORDER'].includes(input.action))throw Error('Select a customer and Desk 1, 2 or 3.');
  let normalized;
  if(['DESK_ASSIGN','DESK_SPLIT'].includes(input.action)){if(!textValid(input.taskId)||input.action==='DESK_SPLIT'&&!validParts(input.parts))throw Error('Select an active customer task and valid Desk quantities.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,taskId:input.taskId,...(input.action==='DESK_SPLIT'?{parts:input.parts.map(part=>({desk:part.desk,quantity:part.quantity})).sort((a,b)=>a.desk-b.desk)}:{})};}
  else if(input.action==='DESK_SHIPMENT'){
   if(input.details){if(!detailShipmentValid(input)||!['poNo','soNo'].every(key=>referenceText(input.details[key]))||!detailReferenceValid(input.details))throw Error('Enter valid Desk references, deposit details and shipment dates.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,transport:input.transport,date:input.date,arrival:input.arrival,lastGateIn:input.lastGateIn,departureDate:input.departureDate,details:{poNo:input.details.poNo.trim(),soNo:input.details.soNo.trim(),invoiceNoDraft:input.details.invoiceNoDraft.trim(),depositAmountCents:input.details.depositAmountCents,depositDate:input.details.depositDate,depositCurrency:input.details.depositCurrency}};}
   else{if(!transports.includes(input.transport)||!dateValid(input.date)||!(input.arrival===''||dateValid(input.arrival)&&input.arrival>=input.date))throw Error('Enter valid shipment and arrival dates.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,transport:input.transport,date:input.date,arrival:input.arrival};}
  }
  else if(input.action==='DESK_ORDER'){
   if(!textValid(input.batchId)||!Array.isArray(input.taskIds)||input.taskIds.length<2||input.taskIds.length>300||!input.taskIds.every(textValid)||new Set(input.taskIds).size!==input.taskIds.length)throw Error('Select valid Desk row order.');
   normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,batchId:input.batchId,taskIds:[...input.taskIds]};
  }
  else if(input.action==='DESK_ARCHIVE'){
   if(!textValid(input.invoiceId)||!textValid(input.batchId))throw Error('Select the issued invoice for this Desk batch.');
   normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,invoiceId:input.invoiceId,batchId:input.batchId};
  }
  else{if(['soNo','poNo'].some(k=>typeof input[k]!=='string'||input[k].length>100||/[\x00-\x1f]/.test(input[k])))throw Error('Enter valid SO and customer PO references.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,soNo:input.soNo.trim(),poNo:input.poNo.trim()};}
  const context=await readContext(company,staff);if(context.company!==company)throw Error('Company changed. Refresh before saving.');
  const digest=operationId(normalized),prior=context.activity.filter(row=>row.action===ACTION&&row.result==='SAVED'&&row.details?.memberId===staff.memberId&&row.details?.requestId===requestId);
  if(prior.length>1)throw Error('Desk save receipt requires review.');
  if(prior.length){if(prior[0].details.digest!==digest)throw Error('This save was already used for different Desk details.');const receipt={ok:true,company,requestId,deskState:{...copy(prior[0].details.state),revision:prior[0].title},...(normalized.action==='DESK_ARCHIVE'?{archivedInvoiceId:normalized.invoiceId}:{})};return prepareOnly?{receipt}:receipt;}
  if(normalized.action==='DESK_ARCHIVE'){
   const stored=readSupportDesks(context.activity,company).find(row=>row.customerId===normalized.customerId);
   const locks=readSupportDeskLocks(context);
   const issued=locks.find(lock=>lock.customerId===normalized.customerId&&lock.desk===normalized.desk
    &&lock.status==='ISSUED'&&lock.archiveRequired===true&&lock.invoiceId===normalized.invoiceId&&lock.snapshot.batchId===normalized.batchId);
   if(!stored||stored.revision!==normalized.revision||supportDeskBatchId(stored,normalized.desk)!==normalized.batchId
    ||!issued||!stored.locks?.some(lock=>lock.requestId===issued.requestId&&lock.memberId===issued.memberId))throw Error('Issued Desk batch changed or was already archived. Refresh before continuing.');
   const state=currentSupportDeskState(context,stored,locks.map(lock=>lock===issued?{...lock,archiveRequired:false}:lock));
   delete state.revision;
   const saved=await appendInvoiceDeskState({store,collection:names[company].activity,company,staff,requestId,before:stored,state,kind:'archived',digest,now});
   return {ok:true,company,requestId,deskState:{...saved.state,revision:saved.revision},archivedInvoiceId:normalized.invoiceId};
  }
  if(['DESK_ASSIGN','DESK_SPLIT'].includes(input.action))requireConfirmedProcurement(context,[input.taskId]);
  const tasks=context.tasks.filter(row=>row.customerId===input.customerId&&!row.archived&&!row.procurementSource&&!row.specialPurchase);
  if(!tasks.length||['DESK_ASSIGN','DESK_SPLIT'].includes(input.action)&&!tasks.some(row=>row.id===input.taskId))throw Error('Select an active customer task.');
  const before=currentSupportDeskState(context,readSupportDesks(context.activity,company).find(row=>row.customerId===input.customerId)||empty(company,input.customerId));
  const locks=currentSupportDeskLocks(context).filter(row=>row.customerId===input.customerId),affected=[input.desk,...(['DESK_ASSIGN','DESK_SPLIT'].includes(input.action)?[supportDeskForTask(before,input.taskId),...(normalized.parts||[]).map(part=>part.desk)]:[])];
  if(input.action!=='DESK_SPLIT'&&locks.some(row=>affected.includes(row.desk)||input.action==='DESK_ASSIGN'&&row.taskIds.includes(input.taskId)))throw Error('This Desk is locked by its Sales Invoice.');
  if(before.revision!==input.revision)throw Error('Desk details changed. Refresh before editing.');
  if(normalized.action==='DESK_ORDER'){
   const flows=readPhysicalOutflows(context.activity);
   if(supportDeskBatchId(before,input.desk)!==input.batchId||normalized.taskIds.some(id=>!tasks.some(task=>task.id===id&&deskTaskPortions(context.activity,before,task,flows).some(part=>part.desk===input.desk))))
    throw Error('Desk details changed. Refresh before editing.');
  }
  const savedDraft=before.references?.find(row=>row.desk===input.desk)?.invoiceNoDraft||'';
  if(normalized.details&&normalized.details.invoiceNoDraft!==savedDraft&&!deskReceiptsComplete(context,before,input.customerId,input.desk))
   throw Error('Complete receiving for every line on this Desk before editing the Invoice No.');
  const previousShipment=before.shipments.find(row=>row.desk===input.desk);
  const shipmentFields=normalized.details?['transport','date','arrival','lastGateIn','departureDate']:['transport','date','arrival'];
  const changedShipmentFields=input.action==='DESK_SHIPMENT'?shipmentFields.filter(key=>(normalized[key]||'')!==(previousShipment?.[key]||'')):[];
  if(changedShipmentFields.length){
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
   if(changedShipmentFields.some(key=>key!=='transport'&&normalized[key]&&normalized[key].slice(0,10)<today))throw Error('New shipment dates must be today or later (Malaysia time).');
   if(changedShipmentFields.includes('lastGateIn')&&normalized.lastGateIn&&!/:(00|15|30|45)$/.test(normalized.lastGateIn))throw Error('Select Last Gate In minutes 00, 15, 30 or 45.');
  }
  if(normalized.details?.depositAmountCents!==null&&normalized.details?.depositAmountCents!==undefined){const currencies=[...new Set(tasks.filter(task=>(readShortloadResolutions(context.activity).some(row=>row.taskId===task.id)||before.assignments.find(row=>row.taskId===task.id)?.parts)?deskTaskPortions(context.activity,before,task).some(part=>part.desk===input.desk&&part.quantity>0):supportDeskForTask(before,task.id)===input.desk).map(task=>task.transactionCurrency))];if(currencies.length!==1||currencies[0]!==normalized.details.depositCurrency)throw Error('Desk deposit currency must match its assigned order currency.');}
  const state=copy(before);delete state.revision;
  if(['DESK_ASSIGN','DESK_SPLIT'].includes(input.action)){
   const split=input.action==='DESK_SPLIT';
   if(!split&&before.assignments.find(row=>row.taskId===input.taskId)?.parts)throw Error('Use the Desk split form to preserve the other batch quantities.');
    const task=tasks.find(row=>row.id===input.taskId);
    const total=task.requested??task.ord,requested=split?normalized.parts:[{desk:input.desk,quantity:total}];
    if(requested.reduce((n,part)=>n+part.quantity,0)!==total)throw Error('Desk quantities must preserve the whole customer demand.');
    const flows=readPhysicalOutflows(context.activity).filter(flow=>flow.taskId===task.id),committed=readDeskCommitments(context.activity,company,task.id,task,before,flows),portions=deskTaskPortions(context.activity,before,task,flows);
    const lists=context.activity.filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT').map(row=>row.details.list);
    for(const desk of [1,2,3]){
     const wanted=requested.find(part=>part.desk===desk)?.quantity||0,previous=portions.find(part=>part.desk===desk)?.quantity||0;
     if(wanted===previous)continue;
     const hold=state.deliveryHolds?.find(row=>row.desk===desk),list=hold&&lists.find(row=>row.id===hold.listId);
     if(hold&&!list)throw Error('Desk authorization is still processing. Retry its original save first.');
     const line=list?.lines.find(row=>row.taskId===task.id),loaded=flows.filter(flow=>(flow.desk??supportDeskForTask(before,task.id))===desk).reduce((n,flow)=>n+flow.quantity,0);
     const adjustable=list?.desk?.taskScope==='ALL'&&list.status!=='CANCELLED'&&adjustableDeliveryLine(context.activity,list,line);
     const fixed=committed.batches.filter(batch=>batch.desk===desk&&(!adjustable||batch.id!==list.id)).reduce((n,batch)=>n+batch.quantity,0);
     if(wanted<Math.max(fixed,loaded,line?.packed||0)||locks.some(lock=>lock.desk===desk))throw Error('Confirmed, loaded or invoiced Desk quantities cannot be moved. Resolve its delivery remainder first.');
     if(list?.status!=='CANCELLED'&&list&&(!adjustable||list.currency!==task.transactionCurrency))throw Error('This Desk has saved Warehouse work or uses a different currency. Resolve it before changing this task.');
     if(adjustable)hold.membershipChanges={...hold.membershipChanges,[task.id]:requestId};
    }
   const dispositionRevision=readShortloadResolutions(context.activity).filter(row=>row.taskId===input.taskId&&row.customerId===input.customerId).at(-1)?.revision||'';
   state.assignments=state.assignments.filter(row=>row.taskId!==input.taskId).concat({taskId:input.taskId,desk:input.desk,...(split||dispositionRevision?{parts:requested,dispositionRevision}:{})}).sort((a,b)=>a.taskId.localeCompare(b.taskId));
  }
  else if(input.action==='DESK_SHIPMENT'){
   state.shipments=state.shipments.filter(row=>row.desk!==input.desk).concat({...previousShipment,desk:input.desk,transport:input.transport,date:input.date,arrival:input.arrival,...(normalized.details?{detailsVersion:3,lastGateIn:normalized.lastGateIn,departureDate:normalized.departureDate}:{}),...(changedShipmentFields.length?{bookedBy:staff.staffName}:{})}).sort((a,b)=>a.desk-b.desk);
   if(normalized.details)state.references=(state.references||[]).filter(row=>row.desk!==input.desk).concat({desk:input.desk,detailsVersion:3,...normalized.details}).sort((a,b)=>a.desk-b.desk);
  }
  else if(input.action==='DESK_ORDER')state.rowOrders=(state.rowOrders||[]).filter(row=>row.desk!==input.desk).concat({desk:input.desk,batchId:input.batchId,taskIds:normalized.taskIds});
  else state.references=(state.references||[]).filter(row=>row.desk!==input.desk).concat({...state.references?.find(row=>row.desk===input.desk),desk:input.desk,soNo:normalized.soNo,poNo:normalized.poNo}).sort((a,b)=>a.desk-b.desk);
  const entityId=identity(company,input.customerId),id=operationId(entityId,input.revision,'NEXT');
  const event={_id:id,title:id,description:entityId,image:input.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:input.action==='DESK_ASSIGN'?'Support moved a task to Desk '+input.desk:'Support updated Desk '+input.desk+' shipment',details:{beforeRevision:input.revision,memberId:staff.memberId,requestId,digest,state}};
  if(prepareOnly)return {event,state,digest,baseline:membershipBaseline(context,normalized.taskId,input.customerId)};
  return persist(event,{company,staff,requestId,input},state,digest);
 }
 async function persist(event,{company,staff,requestId},state,digest){
  const id=event._id;event.activityTime=new Date(event.activityTime);
  try{await store.insert(names[company].activity,event);}catch(error){const retained=await store.read(names[company].activity,id);if(retained&&retained.details?.digest!==digest)throw Error('Desk details changed. Refresh before editing.');if(!retained||retained.details?.requestId!==requestId||retained.details?.memberId!==staff.memberId)throw error;}
  const receipt=await store.read(names[company].activity,id);if(!receipt||receipt.details?.digest!==digest||receipt.details?.requestId!==requestId||receipt.details?.memberId!==staff.memberId||operationId(receiptState(receipt.details.state))!==operationId(receiptState(state)))throw Error('Desk save is not confirmed. Retry the same save.');
  return {ok:true,company,requestId,deskState:{...state,revision:id}};
 }
}
export function deskReceiptsComplete(context,state,customerId,desk,flows=readPhysicalOutflows(context.activity)){
 const parts=context.tasks.filter(task=>task.customerId===customerId&&!task.archived&&!task.procurementSource&&!task.specialPurchase)
  .flatMap(task=>deskTaskPortions(context.activity,state,task,flows))
  .filter(part=>part.desk===desk&&part.quantity>0);
 return parts.length>0&&parts.every(part=>Number.isSafeInteger(part.allocated)&&part.allocated>=part.quantity);
}
// Optional Desk scope retains compatibility with previously prepared invoice requests.
export function checkSupportDeskInvoice(context,readiness,input,owner){
 const desk=input.desk;if(!desk)return null;
 if(!deskValid(desk.number)||typeof desk.revision!=='string')throw Error('Select one Desk before invoicing.');
 const state=currentSupportDeskState(context,readSupportDesks(context.activity,context.company).find(row=>row.customerId===input.customerId)||empty(context.company,input.customerId));
 const hold=currentSupportDeskLocks(context).find(row=>row.customerId===input.customerId&&row.desk===desk.number);
 if(hold){if(owner&&hold.requestId===owner.requestId&&hold.memberId===owner.memberId&&hold.digest===owner.digest)return copy(hold.snapshot);throw Error('This Desk is locked by its Sales Invoice.');}
 if(state.revision!==desk.revision)throw Error('Desk classification changed. Refresh before invoicing.');
 if(!deskReceiptsComplete(context,state,input.customerId,desk.number))throw Error('Complete receiving for every line on this Desk before confirming its invoice.');
 const resolved=new Set(readShortloadResolutions(context.activity).map(row=>row.taskId));
 const portions=context.tasks.filter(task=>task.customerId===input.customerId&&!task.archived&&!task.specialPurchase&&!task.procurementSource).flatMap(task=>((resolved.has(task.id)||state.assignments.find(row=>row.taskId===task.id)?.parts)?deskTaskPortions(context.activity,state,task,readPhysicalOutflows(context.activity)):[{desk:supportDeskForTask(state,task.id),quantity:task.requested??task.ord??0}]).filter(part=>part.desk===desk.number).map(part=>({task,...part})));
 const scoped=task=>readiness.deskLines?.find(line=>line.taskId===task.id&&line.desk===desk.number);
 const ready=task=>(scoped(task)||readiness.lines.find(line=>line.taskId===task.id))?.maxInvoiceQty||0;
 if(portions.some(part=>{const reserved=scoped(part.task)?deskLoadedInvoiceQuantity(context,part.task.id,desk.number).reserved:reservedCartons(part.task.id,context.activity),confirmed=readDeskCommitments(context.activity,context.company,part.task.id).batches.filter(row=>row.desk===desk.number).reduce((n,row)=>n+row.quantity,0);return ready(part.task)<Math.max(0,(confirmed||part.quantity)-reserved);}))throw Error('Resolve the remaining Desk quantities before confirming this invoice.');
 const expected=portions.map(part=>({taskId:part.task.id,quantity:ready(part.task)})).filter(line=>line.quantity>0).sort((a,b)=>a.taskId.localeCompare(b.taskId));
 requireConfirmedProcurement(context,expected.map(line=>line.taskId));
 const savedOrder=(state.rowOrders||[]).find(row=>row.desk===desk.number&&row.batchId===supportDeskBatchId(state,desk.number))?.taskIds||[];
 const invoiceIds=new Set(expected.map(line=>line.taskId));
 const rowOrder=savedOrder.filter(id=>invoiceIds.has(id));
 rowOrder.push(...expected.map(line=>line.taskId).filter(id=>!rowOrder.includes(id)).sort((a,b)=>a<b?-1:a>b?1:0));
 const observed=input.lines.map(line=>({taskId:line.taskId,quantity:line.quantity})).sort((a,b)=>a.taskId.localeCompare(b.taskId));
 if(!expected.length||operationId(expected)!==operationId(observed))throw Error('Invoice lines must match the current Desk and confirmed loading.');
 return {number:desk.number,revision:desk.revision,rowOrder,batchId:supportDeskBatchId(state,desk.number),shipment:copy(state.shipments.find(row=>row.desk===desk.number)||null),references:copy((state.references||[]).find(row=>row.desk===desk.number)||null)};
}

// Invoice admission shares the Desk revision chain with task moves and shipment edits.
// This is a business hold, never a timeout-expiring application lock.
export function readSupportDeskLocks(context){
 const locks=readSupportDesks(context.activity,context.company).flatMap(state=>(state.locks||[]).map(lock=>({...copy(lock),customerId:state.customerId,status:'PENDING'})));
 const shipments=readCustomerShipments(context.activity);
 for(const intent of context.activity.filter(row=>row.action==='SUPPORT_INVOICE_PREPARED'&&row.details?.desk)){
  const ready=context.activity.find(row=>row.title===operationId(intent._id,'SUPPORT_INVOICE_INPUT_SAVED')),shipment=ready&&shipments.find(row=>row.id===ready.description);
  if(shipment?.status==='CANCELLED')continue;
  const found=locks.find(row=>row.customerId===intent.image&&row.desk===intent.details.desk.number&&row.requestId===intent.details.requestId&&row.memberId===intent.details.memberId);
  const value={customerId:intent.image,desk:intent.details.desk.number,requestId:intent.details.requestId,memberId:intent.details.memberId,digest:intent.details.digest,number:intent.details.invoice.number,snapshot:copy(intent.details.desk),taskIds:intent.details.select.lines.map(row=>row.taskId),invoiceId:shipment?.id||'',status:shipment?.invoice?'ISSUED':'PENDING'};
  if(found)Object.assign(found,value);else locks.push(value);
 }
 return locks;
}
// Existing invoices retain automatic release. New issued batches stay on the
// Desk until Support records the archive action against the issued invoice.
export function currentSupportDeskLocks(context){return readSupportDeskLocks(context).filter(row=>row.status!=='ISSUED'||row.archiveRequired===true);}
// Derive the next use for legacy issued invoices without a read-time write.
// The explicit archive path also uses this same transition.
export function currentSupportDeskState(context,state,locks=readSupportDeskLocks(context)){
 const closed=(state.locks||[]).map(held=>locks.find(row=>row.customerId===state.customerId&&row.requestId===held.requestId&&row.memberId===held.memberId&&row.status==='ISSUED'&&row.archiveRequired!==true)).filter(Boolean);
 if(!closed.length)return state;
 const next=copy(state),numbers=new Set(closed.map(row=>row.desk));
 if(context.tasks){const flows=readPhysicalOutflows(context.activity);next.assignments=next.assignments.map(assignment=>{
  const task=context.tasks.find(row=>row.id===assignment.taskId&&row.customerId===state.customerId);if(!task||!closed.some(row=>row.taskIds.includes(task.id)))return assignment;
  const parts=deskTaskPortions(context.activity,state,task,flows).map(({desk,quantity})=>({desk,quantity}));
  return {...assignment,parts,dispositionRevision:readShortloadResolutions(context.activity).filter(row=>row.taskId===task.id&&row.customerId===state.customerId).at(-1)?.revision||''};
 });}
 next.locks=(next.locks||[]).filter(row=>!numbers.has(row.desk));
 next.deliveryHolds=(next.deliveryHolds||[]).filter(row=>!numbers.has(row.desk));
 next.rowOrders=(next.rowOrders||[]).filter(row=>!numbers.has(row.desk));
 next.references=(next.references||[]).filter(row=>!numbers.has(row.desk));
 next.shipments=next.shipments.filter(row=>!numbers.has(row.desk));
 next.batches=(next.batches||[]).filter(row=>!numbers.has(row.desk)).concat(closed.map(row=>({desk:row.desk,id:operationId(context.company,state.customerId,row.invoiceId,'NEXT_DESK_BATCH')})));
 return next;
}
async function appendInvoiceDeskState({store,collection,company,staff,requestId,before,state,kind,now,digest=operationId(kind,state)}){
 const entityId=identity(company,state.customerId),id=operationId(entityId,before.revision,'NEXT');
 const event={_id:id,title:id,description:entityId,image:state.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support '+kind+' Desk invoice',details:{beforeRevision:before.revision,memberId:staff.memberId,requestId,digest,state}};
 try{await store.insert(collection,event);}catch(error){const retained=await store.read(collection,id);if(!retained||retained.details?.digest!==digest||retained.details?.requestId!==requestId||retained.details?.memberId!==staff.memberId)throw Error('Desk details changed. Refresh before invoicing.');}
 const receipt=await store.read(collection,id);if(!receipt||receipt.details?.digest!==digest||receipt.details?.memberId!==staff.memberId||receipt.details?.requestId!==requestId||operationId(receiptState(receipt.details.state))!==operationId(receiptState(state)))throw Error('Desk invoice hold is not confirmed. Retry the same confirmation.');
 return {revision:id,state};
}
export async function reserveSupportDeskInvoice({store,names,context,staff,requestId,input,digest,snapshot,now}){
 if(!input.desk)return;
 const company=context.company,collection=names[company].activity,before=currentSupportDeskState(context,readSupportDesks(context.activity,company).find(row=>row.customerId===input.customerId)||empty(company,input.customerId));
 const prior=currentSupportDeskLocks(context).find(row=>row.customerId===input.customerId&&row.desk===input.desk.number);
 if(prior){if(prior.requestId===requestId&&prior.memberId===staff.memberId&&prior.digest===digest)return;throw Error('This Desk is locked by its Sales Invoice.');}
 if(before.revision!==input.desk.revision)throw Error('Desk classification changed. Refresh before invoicing.');
 const numberId=operationId(company,input.number.trim().toUpperCase(),'SUPPORT_INVOICE_NUMBER'),numberRecord={_id:numberId,title:numberId,description:input.customerId,image:String(input.desk.number),action:'SUPPORT_INVOICE_NUMBER_RESERVED',result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support reserved an invoice number for one Desk',details:{customerId:input.customerId,desk:input.desk.number,number:input.number.trim()}};
 const sameNumber=row=>row?.action===numberRecord.action&&row.details?.customerId===input.customerId&&row.details?.desk===input.desk.number;
 try{await store.insert(collection,numberRecord);}catch(error){if(!sameNumber(await store.read(collection,numberId)))throw Error('Sales Invoice number already belongs to another Desk.');}
 if(!sameNumber(await store.read(collection,numberId)))throw Error('Invoice number reservation is not confirmed. Retry the same confirmation.');
 const state=copy(before);delete state.revision;state.locks=(state.locks||[]).concat({desk:input.desk.number,memberId:staff.memberId,requestId,digest,number:input.number.trim(),taskIds:input.lines.map(row=>row.taskId),input:copy(input),snapshot:copy(snapshot),archiveRequired:true});
 await appendInvoiceDeskState({store,collection,company,staff,requestId,before,state,kind:'reserved',now});
}
export async function releaseCancelledSupportDeskInvoice({store,names,context,staff,requestId,intent,now}){
 if(!intent.details?.desk)return;
 const company=context.company,before=readSupportDesks(context.activity,company).find(row=>row.customerId===intent.image),hold=before?.locks?.find(row=>row.requestId===intent.details.requestId&&row.memberId===intent.details.memberId);
 if(!hold)return;
 const ready=context.activity.find(row=>row.title===operationId(intent._id,'SUPPORT_INVOICE_INPUT_SAVED'));
 if(!ready||!readCustomerShipments(context.activity).some(row=>row.id===ready.description&&row.status==='CANCELLED'))throw Error('Unissued invoice withdrawal is not confirmed.');
 const state=copy(before);delete state.revision;state.locks=state.locks.filter(row=>row!==undefined&&(row.requestId!==hold.requestId||row.memberId!==hold.memberId));
 await appendInvoiceDeskState({store,collection:names[company].activity,company,staff,requestId,before,state,kind:'withdrew',now});
}
