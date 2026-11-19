import { operationId, createOperationJournal } from 'backend/r2purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readStockResolutions } from 'backend/r2stockExceptionState.js';
const text=value=>String(value??'').trim();
const quantity=value=>Number.isSafeInteger(value)&&value>0&&value<=9999;
export const STOCK_EXCEPTION_ACTION='STOCK_EXCEPTION_REPORTED';

// A quarantine changes usable stock, never the historical accepted receipt.
export function readStockExceptions(activity){
 const events=activity.filter(event=>event.action===STOCK_EXCEPTION_ACTION&&event.result==='SAVED'),resolutions=readStockResolutions(activity);
 if(new Set(events.map(event=>event.title)).size!==events.length)throw Error('Duplicate stock exception requires review.');
 return events.map(event=>{
  const item=event.details;
  if(!event.title||!event.imageAltText||!item||!['NCT','GHR'].includes(item.company)||!quantity(item.quantity)||!['INTERNAL_DAMAGE','WRONG_ITEM','SHORT_EXPIRY'].includes(item.kind)||!text(item.reason)||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Stock exception record requires review.');
  const resolution=resolutions.get(event.title)||null;
  let owner=item.kind==='INTERNAL_DAMAGE'?(resolution?.adminApproval?'ACCOUNT':'ADMIN'):'PURCHASE';
  if(item.kind!=='INTERNAL_DAMAGE'&&resolution?.decision&&resolution.decision.value!=='PENDING')owner=resolution.decision.disposition==='RETURN'&&(resolution.returns||[]).reduce((n,row)=>n+row.quantity,0)<item.quantity||resolution.decision.value==='REPLACE'&&(resolution.replacements||[]).reduce((n,row)=>n+row.quantity,0)<item.quantity?'WAREHOUSE':'ACCOUNT';
  return {id:event.title,sourceTaskId:event.imageAltText,company:item.company,quantity:item.quantity,kind:item.kind,reason:item.reason,referenceCostCents:Number.isSafeInteger(item.referenceCostCents)?item.referenceCostCents:null,resolution,status:resolution?.financeApproval?'RESOLVED':'OPEN',owner,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName,byStaffId:event.initiatedByStaffId};
 });
}
export function stockPosition(sourceTaskId,received,activity){
 const cases=readStockExceptions(activity).filter(row=>row.sourceTaskId===sourceTaskId);
 const excluded=cases.filter(row=>row.resolution?.financeApproval?.outcome!=='RELEASED').reduce((sum,row)=>sum+row.quantity,0);
 const replacementReceived=cases.reduce((sum,row)=>sum+(row.resolution?.replacements||[]).reduce((n,entry)=>n+entry.quantity,0),0);
 const held=cases.filter(row=>row.status!=='RESOLVED').reduce((sum,row)=>sum+row.quantity-(row.resolution?.returns||[]).reduce((n,entry)=>n+entry.quantity,0),0);
 const shipped=readCustomerShipments(activity).filter(row=>row.status==='DISPATCHED').flatMap(row=>row.lines).flatMap(line=>line.sources).filter(source=>source.sourceTaskId===sourceTaskId).reduce((sum,row)=>sum+row.quantity,0);
 if(!Number.isSafeInteger(received)||received<0||excluded+shipped>received+replacementReceived)throw Error('Stock exception exceeds unshipped physical stock.');
 return {received,held,excluded,replacementReceived,shipped,usableReceived:received-excluded+replacementReceived,availablePhysical:received-excluded+replacementReceived-shipped,cases};
}
export function stockExceptionVersion(context){return operationId(context.company,context.tasks.map(row=>[row.id,row.warehouse?.accepted]),readStockExceptions(context.activity),readCustomerShipments(context.activity));}
export function createStockExceptionOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canReportStockException!==true||input?.action!=='QUARANTINE')throw Error('Stock quarantine is not authorized.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{stockException:input},prepare:async()=>{
   const context=await readContext(company,staff);
   if(context.company!==company||input.version!==stockExceptionVersion(context))throw Error('Stock changed. Refresh before reporting.');
   const source=context.tasks.find(row=>row.id===input.sourceTaskId),reason=text(input.reason);
   if(!source?.warehouse||source.warehouse.hasPhysicalReceipt===false||!source.po||!source.supplierId)throw Error('Select a physically received supplier line.');
   if(!quantity(input.quantity)||!['INTERNAL_DAMAGE','WRONG_ITEM','SHORT_EXPIRY'].includes(input.kind)||!reason||reason.length>2000)throw Error('Enter affected cartons, issue type and internal reason.');
   const stock=stockPosition(source.id,source.warehouse.accepted,context.activity);
   if(input.quantity>stock.availablePhysical)throw Error('Cannot quarantine more than the unshipped physical stock.');
   const id=operationId(company,requestId,staff.memberId,'STOCK_EXCEPTION');
   const referenceCostCents=Number.isFinite(source.netCostCtn)&&source.netCostCtn>=0?Math.round(source.netCostCtn*input.quantity*100):null;
   return {version:input.version,event:{_id:id,title:id,description:source.orderId,image:source.sourceLineId,imageAltText:source.id,action:STOCK_EXCEPTION_ACTION,result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:now().toISOString(),message:'Stock quarantined; internal review required',details:{company,quantity:input.quantity,kind:input.kind,reason,referenceCostCents}}};
  },apply:async plan=>{
   const existing=await store.read(names[company].activity,plan.event._id);
   if(!existing){if(stockExceptionVersion(await readContext(company,staff))!==plan.version)throw Error('Stock changed while reporting.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Stock exception identity conflict.');
   return {ok:true,company,requestId,caseId:plan.event.title};
  }});
 };
}
