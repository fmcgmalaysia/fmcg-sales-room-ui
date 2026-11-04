import { operationId } from 'backend/purchaseOperationJournal.js';
const ACTION='SUPPORT_SHIPMENT_BOOKING_SAVED';
const transports=['LAND','SEA_20FT','SEA_40FT','OTHER'];
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const identity=(company,customerId,orderId)=>operationId(company,customerId,orderId,'SUPPORT_BOOKING');
export function readSupportBookings(activity,company){
 if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
 const pending=activity.filter(row=>row.action===ACTION&&row.result==='SAVED'),states=new Map(),requests=new Set();
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Shipment booking history requires review.');
  for(const event of next){
   const d=event.details,b=d?.booking;
   if(!b||b.company!==company||!b.customerId||!b.orderId||event.description!==identity(company,b.customerId,b.orderId)||!transports.includes(b.transport)||!dateValid(b.date)||!event.initiatedByStaffId||!event.initiatedByStaffName||!Number.isFinite(Date.parse(event.activityTime))||!d.memberId||!d.requestId||requests.has(d.memberId+'/'+d.requestId)||event._id!==operationId(event.description,d.beforeRevision,'NEXT')||event.title!==event._id)throw Error('Shipment booking identity requires review.');
   requests.add(d.memberId+'/'+d.requestId);states.set(event.description,{...b,revision:event.title,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName});pending.splice(pending.indexOf(event),1);
  }
 }
 return [...states.values()];
}
// A booking changes transport metadata only. It never reserves, invoices or dispatches stock.
// The deterministic successor ID admits only one revision after a given predecessor.
export function createSupportBookingOperations({store,names,readContext,now=()=>new Date()}){
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support access is required.');
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||typeof input.customerId!=='string'||!input.customerId||input.customerId.length>100||typeof input.orderId!=='string'||!input.orderId||input.orderId.length>100||typeof input.revision!=='string'||input.revision.length>100||!transports.includes(input.transport)||!dateValid(input.date))throw Error('Select transport and a valid shipment date.');
  const context=await readContext(company,staff);
  if(context.company!==company)throw Error('Company changed. Refresh before saving.');
  const states=readSupportBookings(context.activity,company),id=identity(company,input.customerId,input.orderId);
  const normalized={customerId:input.customerId,orderId:input.orderId,transport:input.transport,date:input.date,revision:input.revision},digest=operationId(normalized);
  const prior=context.activity.filter(row=>row.action===ACTION&&row.result==='SAVED'&&row.details?.memberId===staff.memberId&&row.details?.requestId===requestId);
  if(prior.length>1)throw Error('Shipment booking receipt requires review.');
  if(prior.length){if(prior[0].details.digest!==digest)throw Error('This save was already used for different booking details.');return {ok:true,company,requestId,booking:{...prior[0].details.booking,revision:prior[0].title,at:new Date(prior[0].activityTime).toISOString(),by:prior[0].initiatedByStaffName}};}
  const tasks=context.tasks.filter(row=>row.customerId===input.customerId&&row.orderId===input.orderId&&!row.procurementSource&&!row.specialPurchase);
  if(!tasks.some(row=>!row.archived))throw Error('Select an active customer order.');
  const before=states.find(row=>row.customerId===input.customerId&&row.orderId===input.orderId);
  if((before?.revision||'')!==input.revision)throw Error('Shipment details changed. Refresh before editing.');
  const eventId=operationId(id,input.revision,'NEXT'),at=now().toISOString(),booking={company,customerId:input.customerId,orderId:input.orderId,transport:input.transport,date:input.date};
  const event={_id:eventId,title:eventId,description:id,image:input.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:new Date(at),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support updated shipment booking details',details:{beforeRevision:input.revision,memberId:staff.memberId,requestId,digest,booking}};
  try{await store.insert(names[company].activity,event);}catch(error){const retained=await store.read(names[company].activity,eventId);if(!retained||retained.details?.requestId!==requestId||retained.details?.memberId!==staff.memberId||retained.details?.digest!==digest)throw error;}
  const receipt=await store.read(names[company].activity,eventId);
  if(!receipt||receipt.details?.requestId!==requestId||receipt.details?.memberId!==staff.memberId||receipt.details?.digest!==digest)throw Error('Booking save is not confirmed. Retry this same save.');
  return {ok:true,company,requestId,booking:{...booking,revision:eventId,at:new Date(receipt.activityTime).toISOString(),by:receipt.initiatedByStaffName}};
 };
}
