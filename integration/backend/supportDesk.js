import { operationId } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments, reservedCartons } from 'backend/customerShipmentLedger.js';
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
const copy=value=>JSON.parse(JSON.stringify(value));
const receiptState=value=>Array.isArray(value)?value.map(receiptState):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,receiptState(value[key])])):value;
const validDeliveryHolds=state=>state?.deliveryHolds===undefined||Array.isArray(state.deliveryHolds)&&state.deliveryHolds.length<=3&&new Set(state.deliveryHolds.map(row=>row.desk)).size===state.deliveryHolds.length&&state.deliveryHolds.every(row=>deskValid(row.desk)&&[row.listId,row.requestId,row.memberId,row.digest].every(textValid)&&Array.isArray(row.taskIds)&&row.taskIds.length>0&&new Set(row.taskIds).size===row.taskIds.length&&row.taskIds.every(textValid));
function validExtras(state){return (state.references===undefined||Array.isArray(state.references)&&new Set(state.references.map(r=>r.desk)).size===state.references.length&&state.references.every(r=>deskValid(r.desk)&&typeof r.soNo==='string'&&r.soNo.length<=100&&typeof r.poNo==='string'&&r.poNo.length<=100&&(r.detailsVersion!==3||detailReferenceValid(r))))&&(state.locks===undefined||Array.isArray(state.locks)&&new Set(state.locks.map(r=>r.desk)).size===state.locks.length&&state.locks.every(r=>deskValid(r.desk)&&textValid(r.requestId)&&textValid(r.memberId)&&textValid(r.number)&&textValid(r.digest)&&Array.isArray(r.taskIds)&&r.taskIds.every(textValid)&&r.snapshot?.number===r.desk));}
function validState(state,company){return state&&state.company===company&&textValid(state.customerId)&&validExtras(state)&&Array.isArray(state.assignments)&&new Set(state.assignments.map(row=>row.taskId)).size===state.assignments.length&&state.assignments.every(row=>textValid(row.taskId)&&(row.desk===0||deskValid(row.desk)))&&Array.isArray(state.shipments)&&new Set(state.shipments.map(row=>row.desk)).size===state.shipments.length&&state.shipments.every(row=>deskValid(row.desk)&&(row.detailsVersion===3?detailShipmentValid(row):transports.includes(row.transport)&&dateValid(row.date)&&(row.arrival===''||dateValid(row.arrival)&&row.arrival>=row.date)));}
export function readSupportDesks(activity,company){
 if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
 const pending=activity.filter(row=>row.action===ACTION&&row.result==='SAVED'),states=new Map(),requests=new Set();
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Desk history requires review.');
  for(const event of next){const d=event.details,state=d?.state,requestKey=d?.memberId+'/'+d?.requestId;
   if(!validState(state,company)||!validDeliveryHolds(state)||event.description!==identity(company,state.customerId)||event._id!==operationId(event.description,d.beforeRevision,'NEXT')||event.title!==event._id||!d.memberId||!d.requestId||requests.has(requestKey)||!event.initiatedByStaffId||!event.initiatedByStaffName||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Desk record identity requires review.');
   requests.add(requestKey);states.set(event.description,{...copy(state),revision:event.title});pending.splice(pending.indexOf(event),1);
  }
 }
 return [...states.values()];
}
export function supportDeskForTask(state,taskId){return state?.assignments.find(row=>row.taskId===taskId)?.desk||0;}
export async function reserveSupportDeskDelivery({store,names,context,staff,requestId,customerId,desk,revision,listId,taskIds,digest,now}){
 const company=context.company,before=readSupportDesks(context.activity,company).find(row=>row.customerId===customerId)||empty(company,customerId);
 const owned=(before.deliveryHolds||[]).find(row=>row.desk===desk&&row.requestId===requestId&&row.memberId===staff.memberId);
 if(owned){if(owned.digest!==digest||owned.listId!==listId)throw Error('Desk delivery save identity changed.');return copy(before);}
 if(before.revision!==revision)throw Error('Desk classification changed. Refresh before sending to Warehouse.');
 if(readSupportDeskLocks(context).some(row=>row.customerId===customerId&&row.desk===desk))throw Error('This Desk is locked by its Sales Invoice.');
 const previous=(before.deliveryHolds||[]).find(row=>row.desk===desk),previousList=previous&&context.activity.find(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details?.list?.id===previous.listId)?.details?.list;
 if(previous&&(!previousList||!['COMPLETED','CANCELLED'].includes(previousList.status)))throw Error('This Desk already has an active Warehouse task.');
 if(!deskValid(desk)||!taskIds.length||taskIds.some(taskId=>supportDeskForTask(before,taskId)!==desk))throw Error('Desk task membership changed.');
 const state=copy(before);delete state.revision;state.deliveryHolds=(state.deliveryHolds||[]).filter(row=>row.desk!==desk).concat({desk,listId,requestId,memberId:staff.memberId,digest,taskIds:[...taskIds]});
 const saved=await appendInvoiceDeskState({store,collection:names[company].activity,company,staff,requestId,before,state,kind:'authorized delivery',now});
 return {...saved.state,revision:saved.revision};
}
// Classification and shipping metadata only. No quantity, stock, invoice or payment writes.
export function createSupportDeskOperations({store,names,readContext,now=()=>new Date()}){
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support access is required.');
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||!textValid(input.customerId)||!(deskValid(input.desk)||input.action==='DESK_ASSIGN'&&input.desk===0)||typeof input.revision!=='string'||input.revision.length>100||!['DESK_ASSIGN','DESK_SHIPMENT','DESK_REFERENCES'].includes(input.action))throw Error('Select a customer and Desk 1, 2 or 3.');
  let normalized;
  if(input.action==='DESK_ASSIGN'){if(!textValid(input.taskId))throw Error('Select an active customer task.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,taskId:input.taskId};}
  else if(input.action==='DESK_SHIPMENT'){
   if(input.details){if(!detailShipmentValid(input)||!['poNo','soNo'].every(key=>referenceText(input.details[key]))||!detailReferenceValid(input.details))throw Error('Enter valid Desk references, deposit details and shipment dates.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,transport:input.transport,date:input.date,arrival:input.arrival,lastGateIn:input.lastGateIn,departureDate:input.departureDate,details:{poNo:input.details.poNo.trim(),soNo:input.details.soNo.trim(),invoiceNoDraft:input.details.invoiceNoDraft.trim(),depositAmountCents:input.details.depositAmountCents,depositDate:input.details.depositDate,depositCurrency:input.details.depositCurrency}};}
   else{if(!transports.includes(input.transport)||!dateValid(input.date)||!(input.arrival===''||dateValid(input.arrival)&&input.arrival>=input.date))throw Error('Enter valid shipment and arrival dates.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,transport:input.transport,date:input.date,arrival:input.arrival};}
  }
  else{if(['soNo','poNo'].some(k=>typeof input[k]!=='string'||input[k].length>100||/[\x00-\x1f]/.test(input[k])))throw Error('Enter valid SO and customer PO references.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,soNo:input.soNo.trim(),poNo:input.poNo.trim()};}
  const context=await readContext(company,staff);if(context.company!==company)throw Error('Company changed. Refresh before saving.');
  const digest=operationId(normalized),prior=context.activity.filter(row=>row.action===ACTION&&row.result==='SAVED'&&row.details?.memberId===staff.memberId&&row.details?.requestId===requestId);
  if(prior.length>1)throw Error('Desk save receipt requires review.');
  if(prior.length){if(prior[0].details.digest!==digest)throw Error('This save was already used for different Desk details.');return {ok:true,company,requestId,deskState:{...copy(prior[0].details.state),revision:prior[0].title}};}
  const tasks=context.tasks.filter(row=>row.customerId===input.customerId&&!row.archived&&!row.procurementSource&&!row.specialPurchase);
  if(!tasks.length||input.action==='DESK_ASSIGN'&&!tasks.some(row=>row.id===input.taskId))throw Error('Select an active customer task.');
  const before=readSupportDesks(context.activity,company).find(row=>row.customerId===input.customerId)||empty(company,input.customerId);
  if(input.action==='DESK_ASSIGN'&&(before.deliveryHolds||[]).some(hold=>hold.taskIds.includes(input.taskId)&&!context.activity.some(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details?.list?.id===hold.listId&&row.details.list.status==='CANCELLED')))throw Error('This task is authorized to Warehouse. Recall its unstarted delivery before moving it.');
  const locks=readSupportDeskLocks(context).filter(row=>row.customerId===input.customerId),affected=[input.desk,...(input.action==='DESK_ASSIGN'?[supportDeskForTask(before,input.taskId)]:[])];
  if(locks.some(row=>affected.includes(row.desk)||input.action==='DESK_ASSIGN'&&row.taskIds.includes(input.taskId)))throw Error('This Desk is locked by its Sales Invoice.');
  if(before.revision!==input.revision)throw Error('Desk details changed. Refresh before editing.');
  if(normalized.details?.depositAmountCents!==null&&normalized.details?.depositAmountCents!==undefined){const currencies=[...new Set(tasks.filter(task=>supportDeskForTask(before,task.id)===input.desk).map(task=>task.transactionCurrency))];if(currencies.length!==1||currencies[0]!==normalized.details.depositCurrency)throw Error('Desk deposit currency must match its assigned order currency.');}
  const state=copy(before);delete state.revision;
  if(input.action==='DESK_ASSIGN'){state.assignments=state.assignments.filter(row=>row.taskId!==input.taskId).concat({taskId:input.taskId,desk:input.desk}).sort((a,b)=>a.taskId.localeCompare(b.taskId));}
  else if(input.action==='DESK_SHIPMENT'){
   state.shipments=state.shipments.filter(row=>row.desk!==input.desk).concat({...state.shipments.find(row=>row.desk===input.desk),desk:input.desk,transport:input.transport,date:input.date,arrival:input.arrival,...(normalized.details?{detailsVersion:3,lastGateIn:normalized.lastGateIn,departureDate:normalized.departureDate}:{})}).sort((a,b)=>a.desk-b.desk);
   if(normalized.details)state.references=(state.references||[]).filter(row=>row.desk!==input.desk).concat({desk:input.desk,detailsVersion:3,...normalized.details}).sort((a,b)=>a.desk-b.desk);
  }
  else state.references=(state.references||[]).filter(row=>row.desk!==input.desk).concat({...state.references?.find(row=>row.desk===input.desk),desk:input.desk,soNo:normalized.soNo,poNo:normalized.poNo}).sort((a,b)=>a.desk-b.desk);
  const entityId=identity(company,input.customerId),id=operationId(entityId,input.revision,'NEXT');
  const event={_id:id,title:id,description:entityId,image:input.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:input.action==='DESK_ASSIGN'?'Support moved a task to Desk '+input.desk:'Support updated Desk '+input.desk+' shipment',details:{beforeRevision:input.revision,memberId:staff.memberId,requestId,digest,state}};
  try{await store.insert(names[company].activity,event);}catch(error){const retained=await store.read(names[company].activity,id);if(retained&&retained.details?.digest!==digest)throw Error('Desk details changed. Refresh before editing.');if(!retained||retained.details?.requestId!==requestId||retained.details?.memberId!==staff.memberId)throw error;}
  const receipt=await store.read(names[company].activity,id);if(!receipt||receipt.details?.digest!==digest||receipt.details?.requestId!==requestId||receipt.details?.memberId!==staff.memberId||operationId(receiptState(receipt.details.state))!==operationId(receiptState(state)))throw Error('Desk save is not confirmed. Retry the same save.');
  return {ok:true,company,requestId,deskState:{...state,revision:id}};
 };
}
// Optional Desk scope retains compatibility with previously prepared invoice requests.
export function checkSupportDeskInvoice(context,readiness,input,owner){
 const desk=input.desk;if(!desk)return null;
 if(!deskValid(desk.number)||typeof desk.revision!=='string')throw Error('Select one Desk before invoicing.');
 const state=readSupportDesks(context.activity,context.company).find(row=>row.customerId===input.customerId)||empty(context.company,input.customerId);
 const hold=readSupportDeskLocks(context).find(row=>row.customerId===input.customerId&&row.desk===desk.number);
 if(hold){if(owner&&hold.requestId===owner.requestId&&hold.memberId===owner.memberId&&hold.digest===owner.digest)return copy(hold.snapshot);throw Error('This Desk is locked by its Sales Invoice.');}
 if(state.revision!==desk.revision)throw Error('Desk classification changed. Refresh before invoicing.');
 const deskTasks=context.tasks.filter(task=>task.customerId===input.customerId&&!task.archived&&!task.specialPurchase&&!task.procurementSource&&supportDeskForTask(state,task.id)===desk.number);
 if(deskTasks.some(task=>{const remaining=Math.max(0,(task.requested??task.ord??0)-reservedCartons(task.id,context.activity));return remaining>0&&(readiness.lines.find(line=>line.taskId===task.id)?.maxInvoiceQty||0)<remaining;}))throw Error('Split unloaded quantities into an unassigned row before confirming this invoice.');
 const expected=context.tasks.filter(task=>task.customerId===input.customerId&&!task.archived&&!task.specialPurchase&&!task.procurementSource&&supportDeskForTask(state,task.id)===desk.number).map(task=>({taskId:task.id,quantity:readiness.lines.find(line=>line.taskId===task.id)?.maxInvoiceQty||0})).filter(line=>line.quantity>0).sort((a,b)=>a.taskId.localeCompare(b.taskId));
 const observed=input.lines.map(line=>({taskId:line.taskId,quantity:line.quantity})).sort((a,b)=>a.taskId.localeCompare(b.taskId));
 if(!expected.length||operationId(expected)!==operationId(observed))throw Error('Invoice lines must match the current Desk and confirmed loading.');
 return {number:desk.number,revision:desk.revision,shipment:copy(state.shipments.find(row=>row.desk===desk.number)||null),references:copy((state.references||[]).find(row=>row.desk===desk.number)||null)};
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
async function appendInvoiceDeskState({store,collection,company,staff,requestId,before,state,kind,now}){
 const entityId=identity(company,state.customerId),id=operationId(entityId,before.revision,'NEXT'),digest=operationId(kind,state);
 const event={_id:id,title:id,description:entityId,image:state.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support '+kind+' Desk invoice',details:{beforeRevision:before.revision,memberId:staff.memberId,requestId,digest,state}};
 try{await store.insert(collection,event);}catch(error){const retained=await store.read(collection,id);if(!retained||retained.details?.digest!==digest||retained.details?.requestId!==requestId||retained.details?.memberId!==staff.memberId)throw Error('Desk details changed. Refresh before invoicing.');}
 const receipt=await store.read(collection,id);if(!receipt||receipt.details?.digest!==digest)throw Error('Desk invoice hold is not confirmed. Retry the same confirmation.');
 return {revision:id,state};
}
export async function reserveSupportDeskInvoice({store,names,context,staff,requestId,input,digest,snapshot,now}){
 if(!input.desk)return;
 const company=context.company,collection=names[company].activity,before=readSupportDesks(context.activity,company).find(row=>row.customerId===input.customerId)||empty(company,input.customerId);
 const prior=readSupportDeskLocks(context).find(row=>row.customerId===input.customerId&&row.desk===input.desk.number);
 if(prior){if(prior.requestId===requestId&&prior.memberId===staff.memberId&&prior.digest===digest)return;throw Error('This Desk is locked by its Sales Invoice.');}
 if(before.revision!==input.desk.revision)throw Error('Desk classification changed. Refresh before invoicing.');
 const numberId=operationId(company,input.number.trim().toUpperCase(),'SUPPORT_INVOICE_NUMBER'),numberRecord={_id:numberId,title:numberId,description:input.customerId,image:String(input.desk.number),action:'SUPPORT_INVOICE_NUMBER_RESERVED',result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support reserved an invoice number for one Desk',details:{customerId:input.customerId,desk:input.desk.number,number:input.number.trim()}};
 const sameNumber=row=>row?.action===numberRecord.action&&row.details?.customerId===input.customerId&&row.details?.desk===input.desk.number;
 try{await store.insert(collection,numberRecord);}catch(error){if(!sameNumber(await store.read(collection,numberId)))throw Error('Sales Invoice number already belongs to another Desk.');}
 if(!sameNumber(await store.read(collection,numberId)))throw Error('Invoice number reservation is not confirmed. Retry the same confirmation.');
 const state=copy(before);delete state.revision;state.locks=(state.locks||[]).concat({desk:input.desk.number,memberId:staff.memberId,requestId,digest,number:input.number.trim(),taskIds:input.lines.map(row=>row.taskId),input:copy(input),snapshot:copy(snapshot)});
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
