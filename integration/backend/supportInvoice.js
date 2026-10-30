import { checkSupportDeskInvoice, reserveSupportDeskInvoice, releaseCancelledSupportDeskInvoice, readSupportDesks } from 'backend/supportDesk.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createCustomerFulfilmentOperations, shipmentVersion } from 'backend/customerFulfilment.js';
import { readCustomerShipments, reservedCartons } from 'backend/customerShipmentLedger.js';
import { projectPreparation } from 'backend/warehousePreparation.js';
import { packingTaskHeld } from 'backend/packingListGuards.js';
import { openSourceCost } from 'backend/purchaseMarginRefresh.js';
import { partialInvoiceMargin } from 'backend/partialInvoiceMargin.js';
import { calculateGrossProfitMargin } from 'backend/grossProfitMargin.js';
import { readPhysicalOutflows, deskLoadedInvoiceQuantity } from 'backend/physicalOutflow.js';
import { deskTaskPortions, shortloadStatus, readShortloadResolutions } from 'backend/shortloadResolutionModel.js';
const INTENT='SUPPORT_INVOICE_PREPARED',READY='SUPPORT_INVOICE_INPUT_SAVED';
const uuid=value=>/^[a-f0-9-]{36}$/i.test(value||'');
const derived=(...parts)=>{const h=operationId(...parts);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
const known=value=>typeof value==='number'&&Number.isFinite(value);
export function supportInvoiceState(context){
 const preparation=projectPreparation(context),outflows=readPhysicalOutflows(context.activity),lines=context.tasks.filter(row=>!row.archived&&!row.specialPurchase&&!row.procurementSource).map(task=>{
  const items=preparation.filter(row=>row.taskId===task.id),loaded=outflows.filter(row=>row.taskId===task.id&&(row.invoiceReady||row.kind==='HISTORICAL')).reduce((n,row)=>n+row.quantity,0),reserved=reservedCartons(task.id,context.activity),held=packingTaskHeld(context,task.id),completedPacking=outflows.filter(row=>row.taskId===task.id&&row.kind==='PACKING'&&row.invoiceReady).reduce((n,row)=>n+row.quantity,0);
  const issue=items.some(row=>row.stale||row.orphaned||row.planMismatch)||held>completedPacking;
  const maxInvoiceQty=issue?0:Math.max(0,Math.min(loaded-reserved,(task.inc||0)-reserved,(task.requested??task.ord)-reserved));
  return {taskId:task.id,loadedQty:loaded,maxInvoiceQty,reason:held>completedPacking?'Packing arrangement requires review':issue?'Warehouse loading requires review':maxInvoiceQty===0?'No uninvoiced loaded quantity':''};
 });
 const resolvedTasks=new Set(readShortloadResolutions(context.activity).map(row=>row.taskId));
 const desks=readSupportDesks(context.activity,context.company),deskLines=context.tasks.filter(task=>resolvedTasks.has(task.id)&&!task.archived&&!task.specialPurchase&&!task.procurementSource).flatMap(task=>deskTaskPortions(context.activity,desks.find(state=>state.customerId===task.customerId),task,outflows).filter(part=>part.desk>0).map(part=>{
  const loaded=deskLoadedInvoiceQuantity(context,task.id,part.desk),lists=context.activity.filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details?.list?.customerId===task.customerId&&row.details.list.desk?.number===part.desk&&row.details.list.status!=='CANCELLED').map(row=>row.details.list);
  const blocked=lists.some(list=>list.lines.some(line=>line.taskId===task.id&&(list.status!=='COMPLETED'||shortloadStatus(context.activity,list,line).issue||shortloadStatus(context.activity,list,line).pending)));
  return {taskId:task.id,desk:part.desk,loadedQty:loaded.loaded,maxInvoiceQty:blocked?0:Math.min(loaded.ready,Math.max(0,part.allocated-loaded.reserved)),reason:blocked?'Resolve the remaining Desk quantity first.':''};
 }));
 return {company:context.company,version:operationId(shipmentVersion(context),lines,deskLines),lines,deskLines};
}
// Compose the original SELECT and INVOICE operations. Their stock, FX and financial guards remain authoritative.
// Durable inputs retain both original operation versions across a lost acknowledgement.
export function createSupportInvoiceOperations({store,names,readContext,saveFulfilment,readRates,now=()=>new Date()}){
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support invoice access is required.');
  if(!uuid(requestId)||!input||typeof input.version!=='string'||typeof input.orderId!=='string'||!input.orderId||typeof input.customerId!=='string'||!input.customerId||typeof input.number!=='string'||!input.number.trim()||input.number.trim().length>100||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>300||new Set(input.lines.map(row=>row.taskId)).size!==input.lines.length)throw Error('Select order lines and enter a Sales Invoice number.');
  const orderIds=input.orderIds===undefined?[input.orderId]:input.orderIds;
  if(!Array.isArray(orderIds)||!orderIds.length||orderIds.length>300||new Set(orderIds).size!==orderIds.length||orderIds.some(id=>typeof id!=='string'||!id||id.length>100)||!orderIds.includes(input.orderId))throw Error('Select valid customer order dates.');
  const normalized={...(input.desk===undefined?{}:{desk:{number:input.desk?.number,revision:input.desk?.revision}}),...(input.orderIds===undefined?{}:{orderIds:[...orderIds].sort()}),version:input.version,customerId:input.customerId,orderId:input.orderId,number:input.number.trim(),lines:input.lines.map(row=>({taskId:row.taskId,quantity:row.quantity}))},digest=operationId(normalized),collection=names[company].activity,id=operationId(company,requestId,staff.memberId,INTENT),readyId=operationId(id,READY);
  let intent=await store.read(collection,id);
  if(!intent){
   const context=await readContext(company,staff),state=supportInvoiceState(context);
   if(context.company!==company||state.version!==input.version)throw Error('Order or loading changed. Refresh before creating the invoice.');
   const desk=checkSupportDeskInvoice(context,state,input,{requestId,memberId:staff.memberId,digest});
   let amountCents=0;const currencies=new Set();
   for(const line of normalized.lines){
    const task=context.tasks.find(row=>row.id===line.taskId&&row.customerId===input.customerId&&orderIds.includes(row.orderId)&&!row.archived&&!row.specialPurchase&&!row.procurementSource),available=(input.desk&&state.deskLines.find(row=>row.taskId===line.taskId&&row.desk===input.desk.number))||state.lines.find(row=>row.taskId===line.taskId);
    if(!task||!Number.isSafeInteger(line.quantity)||line.quantity<=0||line.quantity>9999||line.quantity>(available?.maxInvoiceQty||0))throw Error('Invoice quantity exceeds confirmed, uninvoiced loading.');
    if(!known(task.sellingPricePc)||task.sellingPricePc<=0||!Number.isSafeInteger(task.ea)||task.ea<=0)throw Error('Sales price or carton packing is incomplete.');
    currencies.add(task.transactionCurrency);amountCents+=Math.round(task.sellingPricePc*task.ea*line.quantity*100);
   }
   if(input.orderIds&&new Set(normalized.lines.map(line=>context.tasks.find(task=>task.id===line.taskId).orderId)).size!==orderIds.length)throw Error('Selected order dates do not match invoice lines.');
   if(currencies.size!==1||!(/^[A-Z]{3}$/).test([...currencies][0]||'')||!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>999999999999)throw Error('Invoice currency or total is invalid.');
   if(readCustomerShipments(context.activity).some(row=>row.invoice?.number.toUpperCase()===normalized.number.toUpperCase()))throw Error('Sales Invoice number already exists.');
   await reserveSupportDeskInvoice({store,names,context,staff,requestId,input:normalized,digest,snapshot:desk,now});
   const scoped=desk&&normalized.lines.some(line=>state.deskLines.some(row=>row.taskId===line.taskId&&row.desk===desk.number));
   const at=now().toISOString(),date=new Date(now().getTime()+8*60*60*1000).toISOString().slice(0,10),select={action:'SELECT',customerId:input.customerId,lines:normalized.lines,...(scoped?{desk:desk.number}:{}),version:shipmentVersion(context),reason:'Support selected confirmed loading for Sales Invoice '+normalized.number};
   const record={_id:id,title:id,description:input.orderId,image:input.customerId,action:INTENT,result:'PREPARED',actorType:'STAFF',activityTime:new Date(at),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support prepared Sales Invoice',details:{digest,memberId:staff.memberId,requestId,...(desk?{desk}:{}),select,invoice:{action:'INVOICE',number:normalized.number,date,amountCents,reason:'Support issued Sales Invoice '+normalized.number}}};
   try{intent=await store.insert(collection,record);}catch(error){intent=await store.read(collection,id);if(!intent)throw error;}
  }
  if(intent.details?.digest!==digest||intent.details?.memberId!==staff.memberId)throw Error('This invoice save was already used for different details.');
  const actor={...staff,canSelectShipment:true,canInvoiceShipment:true};
  const execute=async request=>{
   const checkedContext=async(...args)=>{
    const context=await readContext(...args),state=supportInvoiceState(context);
    const selected=request.input.action==='SELECT'?request.input.lines:readCustomerShipments(context.activity).find(row=>row.id===request.input.id)?.lines;
    if(!selected?.length)throw Error('Invoice loading evidence is unavailable.');
    for(const line of selected){const scope=intent.details.select.desk,current=(scope&&state.deskLines.find(row=>row.taskId===line.taskId&&row.desk===scope))||state.lines.find(row=>row.taskId===line.taskId),reserved=scope?deskLoadedInvoiceQuantity(context,line.taskId,scope).reserved:reservedCartons(line.taskId,context.activity);if(!current||current.reason&&current.reason!=='No uninvoiced loaded quantity'||(request.input.action==='SELECT'?line.quantity>current.maxInvoiceQty:reserved>current.loadedQty))throw Error('Warehouse loading changed. Review before invoicing.');}
    return context;
   };
   const original=createCustomerFulfilmentOperations({store,names,readContext:checkedContext,readRates,now});
   const result=await original(request);
   // Reuse the original post-invoice cache confirmation with the exact completed operation identity.
   return request.input.action==='INVOICE'?saveFulfilment(request):result;
  };
  const selected=await execute({company,staff:actor,requestId:derived(id,'SELECT'),input:intent.details.select});
  if(selected?.ok!==true||!selected.shipmentId)throw Error('Invoice selection could not be confirmed. Retry the same save.');
  let ready=await store.read(collection,readyId);
  if(!ready){const context=await readContext(company,staff),record={_id:readyId,title:readyId,description:selected.shipmentId,image:input.customerId,action:READY,result:'PREPARED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support retained invoice input',details:{digest,input:{...intent.details.invoice,id:selected.shipmentId,version:shipmentVersion(context)}}};try{ready=await store.insert(collection,record);}catch(error){ready=await store.read(collection,readyId);if(!ready)throw error;}}
  if(ready.details?.digest!==digest||ready.description!==selected.shipmentId)throw Error('Invoice input receipt requires review.');
  const result=await execute({company,staff:actor,requestId:derived(id,'INVOICE'),input:ready.details.input});
  if(result?.ok!==true||result.status!=='INVOICED')throw Error('Invoice creation could not be confirmed. Retry the same save.');
  return {ok:true,company,requestId,shipmentId:result.shipmentId,number:intent.details.invoice.number};
 };
}

export function createSupportInvoiceCancellation({store,names,readContext,saveFulfilment,now=()=>new Date()}){
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!uuid(requestId)||!uuid(input?.invoiceRequestId))throw Error('Support invoice recovery is not authorized.');
  const id=operationId(company,input.invoiceRequestId,staff.memberId,INTENT),intent=await store.read(names[company].activity,id);
  if(!intent||intent.details?.memberId!==staff.memberId)throw Error('This pending invoice is unavailable.');
  const context=await readContext(company,staff),shipmentId=operationId(company,derived(id,'SELECT'),'SHIPMENT'),shipment=readCustomerShipments(context.activity).find(row=>row.id===shipmentId);
  if(!shipment)throw Error('The earlier selection is not confirmed. Retry its original save before withdrawing it.');
  if(shipment.status==='CANCELLED'){await releaseCancelledSupportDeskInvoice({store,names,context,staff,requestId,intent,now});return {ok:true,company,requestId,cancelled:true};}
  if(shipment.status!=='REQUESTED')throw Error('This invoice has already been issued. Refresh to view its saved details.');
  const cancelId=operationId(id,'CANCEL_INPUT');let retained=await store.read(names[company].activity,cancelId);
  if(!retained){const record={_id:cancelId,title:cancelId,description:shipment.id,image:shipment.customerId,action:'SUPPORT_INVOICE_CANCEL_INPUT_SAVED',result:'PREPARED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support retained invoice withdrawal',details:{input:{action:'CANCEL',id:shipment.id,version:shipmentVersion(context),reason:'Support withdrew an unissued invoice request'}}};try{retained=await store.insert(names[company].activity,record);}catch(error){retained=await store.read(names[company].activity,cancelId);if(!retained)throw error;}}
  if(retained.description!==shipment.id||retained.details?.input?.action!=='CANCEL')throw Error('Invoice withdrawal receipt requires review.');
  const result=await saveFulfilment({company,staff:{...staff,canSelectShipment:true},requestId:derived(id,'CANCEL'),input:retained.details.input});
  if(result?.ok!==true||result.status!=='CANCELLED')throw Error('Cancellation is not confirmed. Retry the same cancellation.');
  await releaseCancelledSupportDeskInvoice({store,names,context:await readContext(company,staff),staff,requestId,intent,now});
  return {ok:true,company,requestId,cancelled:true};
 };
}

// Same source-cost and margin functions as Purchase; this projection performs no cache writes.
export async function readSupportInvoiceState(context,readRates){
 const state=supportInvoiceState(context),invoices=readCustomerShipments(context.activity).filter(row=>row.company===context.company&&['INVOICED','DISPATCHED'].includes(row.status)),rawTasks=context.tasks.map(row=>({...row,title:row.id}));let rates=[];
 try{rates=await readRates([...new Set(context.tasks.map(row=>row.transactionCurrency).filter(Boolean))]);}catch(_){}
 return {...state,lines:state.lines.map(line=>{const task=context.tasks.find(row=>row.id===line.taskId),invoiceLines=invoices.flatMap(row=>row.lines.filter(part=>part.taskId===line.taskId)),quantity=task.shortage?.customerDecision==='STOP'?(task.inc||0):task.ord,cost=openSourceCost(task,task,rawTasks,context,invoiceLines),matched=rates.filter(row=>row.currency===task.transactionCurrency),rate=matched.length===1?matched[0].rateToMyr:null;
 const gp=invoiceLines.length?partialInvoiceMargin({quantity,invoiceLines,sellingPricePc:task.sellingPricePc,eaPerCtn:task.ea,netCostCtn:cost,rateToMyr:rate}):calculateGrossProfitMargin({sellingPricePc:task.sellingPricePc,eaPerCtn:task.ea,netCostCtn:cost,rateToMyr:rate});
 return {...line,gpPercent:typeof gp==='number'&&Number.isFinite(gp)?gp*100:null};})};
}
