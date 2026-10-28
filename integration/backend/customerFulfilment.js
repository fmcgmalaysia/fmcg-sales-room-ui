import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { requirePackingReleased, packingGuardVersion } from 'backend/packingListGuards.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { stockPosition, readStockExceptions } from 'backend/inventoryExceptions.js';
import { calculateGrossProfitMargin } from 'backend/grossProfitMargin.js';
import { physicalOutflowVersion, selectLoadedForInvoice, validateInvoiceOutflows } from 'backend/physicalOutflow.js';
const text=value=>String(value??'').trim();
const qty=value=>Number.isSafeInteger(value)&&value>0&&value<=9999;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const cents=value=>Number.isSafeInteger(value)&&value>0&&value<=999999999999;
import { FULFILMENT_ACTION, readCustomerShipments, reservedCartons } from 'backend/customerShipmentLedger.js';
export function shipmentVersion(context){return packingGuardVersion(context,operationId(context.company,context.tasks.map(row=>[row.id,row.customerId,row.orderId,row.sourceLineId,row.ord,row.inc,row.barcode,row.packing,row.ea,row.netCostCtn,row.sellingPricePc,row.transactionCurrency]),readAllocations(context.activity),readCustomerShipments(context.activity),readStockExceptions(context.activity),physicalOutflowVersion(context.activity)));}
export function createCustomerFulfilmentOperations({store,names,readContext,readRates,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  const permission={SELECT:'canSelectShipment',CANCEL:'canSelectShipment',INVOICE:'canInvoiceShipment',DISPATCH:'canDispatchShipment'}[input?.action];
  if(!names[company]||!permission||staff?.[permission]!==true)throw Error('This shipment action is not authorized.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{fulfilment:input},prepare:async()=>{
   const context=await readContext(company,staff),version=shipmentVersion(context),shipments=readCustomerShipments(context.activity),reason=text(input.reason);
   if(context.company!==company||input.version!==version)throw Error('Shipment or allocation changed. Refresh before saving.');
   if(!reason||reason.length>2000)throw Error('Enter the shipment action reason.');
   const at=now().toISOString();let shipment,beforeRevision='';
   if(input.action==='SELECT'){
    if(!text(input.customerId)||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>300||new Set(input.lines.map(row=>row.taskId)).size!==input.lines.length)throw Error('Select distinct customer lines and quantities.');
    const selectedTasks=input.lines.map(entry=>{const task=context.tasks.find(row=>row.id===entry.taskId);if(!task||task.procurementSource||task.customerId!==input.customerId||task.archived||!qty(entry.quantity)||entry.quantity>Math.max(0,(task.inc||0)-reservedCartons(task.id,context.activity)))throw Error('Shipment exceeds available customer allocation.');return task;});
    requirePackingReleased({...context,activity:context.activity.filter(row=>!(row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details?.list?.status==='COMPLETED'&&row.details.list.customerId===input.customerId&&!row.details.list.change))},input.lines.map(line=>line.taskId));
    const lines=input.lines.map((entry,index)=>{const task=selectedTasks[index];
     const physical=selectLoadedForInvoice(context,task.id,entry.quantity);
     return {taskId:task.id,orderId:task.orderId,sourceLineId:task.sourceLineId,barcode:task.barcode,name:task.name,packing:task.packing,quantity:entry.quantity,...physical};});
    const currencies=[...new Set(lines.map(line=>context.tasks.find(task=>task.id===line.taskId).transactionCurrency))];if(currencies.length!==1||!currencies[0])throw Error('Select one customer and one invoice currency.');
    shipment={id:operationId(company,requestId,'SHIPMENT'),company,customerId:input.customerId,currency:currencies[0],status:'REQUESTED',lines,requestedAt:at,requestedBy:staff.staffName,requestedByStaffId:staff.staffId,reason};
   }else{
    const current=shipments.find(row=>row.id===input.id);if(!current||current.company!==company)throw Error('Shipment is unavailable.');
    if(staff.customerId&&staff.customerId!==current.customerId)throw Error('Shipment customer is not authorized.');
    beforeRevision=current.revision;shipment={...current};delete shipment.revision;
    if(input.action==='CANCEL'){if(current.status!=='REQUESTED')throw Error('Invoiced shipments require an Admin correction.');shipment.status='CANCELLED';shipment.cancelledAt=at;shipment.cancelledBy=staff.staffName;shipment.cancelReason=reason;}
    if(input.action==='INVOICE'){
     if(current.status!=='REQUESTED'||!text(input.number)||text(input.number).length>100||!validDate(input.date)||!cents(input.amountCents))throw Error('Enter Sales Invoice number, date and amount.');
     if(shipments.some(row=>row.company===company&&row.invoice?.number.toUpperCase()===text(input.number).toUpperCase()))throw Error('Sales Invoice number already exists.');
     const rates=await readRates([current.currency]),rate=rates.filter(row=>row.currency===current.currency);if(rate.length!==1||!(rate[0].rateToMyr>0))throw Error('Current Admin exchange rate is unavailable.');
     shipment.lines=current.lines.map(line=>{const task=context.tasks.find(row=>row.id===line.taskId);if(!task||!Number.isFinite(task.sellingPricePc)||task.sellingPricePc<=0||!qty(task.ea))throw Error('Sales price or packing is incomplete.');
      const costSources=line.sources.map(source=>{const stock=context.tasks.find(row=>row.id===source.sourceTaskId);if(!stock||!Number.isFinite(stock.netCostCtn)||stock.netCostCtn<0)throw Error('Allocated stock cost is incomplete.');return {...source,netCostCtn:stock.netCostCtn};}),netCostCtn=costSources.reduce((sum,source)=>sum+source.quantity*source.netCostCtn,0)/line.quantity;
      return {...line,costSources,sellingPricePc:task.sellingPricePc,eaPerCtn:task.ea,sellingPriceCtn:task.sellingPricePc*task.ea,rateToMyr:rate[0].rateToMyr,gp:calculateGrossProfitMargin({sellingPricePc:task.sellingPricePc,eaPerCtn:task.ea,netCostCtn,rateToMyr:rate[0].rateToMyr})};});
     shipment.status='INVOICED';shipment.invoice={number:text(input.number),date:input.date,amountCents:input.amountCents,currency:current.currency,rateToMyr:rate[0].rateToMyr,fxUpdatedAt:rate[0].updatedAt||null,at,by:staff.staffName,byStaffId:staff.staffId,reason};
    }
    if(input.action==='DISPATCH'){if(current.status!=='INVOICED')throw Error('Sales Invoice is required before dispatch.');if(!text(input.reference)||text(input.reference).length>120)throw Error('Dispatch reference is required (maximum 120 characters).');shipment.status='DISPATCHED';shipment.dispatch={at,by:staff.staffName,byStaffId:staff.staffId,reference:text(input.reference),reason};}
   }
   if(input.action!=='CANCEL')requirePackingReleased(validateInvoiceOutflows(context,shipment),shipment.lines.map(line=>line.taskId));
   if(staff.customerId&&staff.customerId!==shipment.customerId)throw Error('Shipment customer is not authorized.');
   if(input.action!=='CANCEL')for(const sourceId of new Set(shipment.lines.flatMap(line=>line.sources).map(source=>source.sourceTaskId))){
    const affected=readStockExceptions(context.activity).some(item=>item.sourceTaskId===sourceId);
    if(!affected)continue;
    const source=context.tasks.find(row=>row.id===sourceId),stock=stockPosition(sourceId,source?.warehouse?.accepted,context.activity);
    const reserved=shipments.filter(row=>row.status!=='CANCELLED'&&row.id!==shipment.id).concat(shipment).flatMap(row=>row.lines).flatMap(line=>line.sources).filter(row=>row.sourceTaskId===sourceId).reduce((sum,row)=>sum+row.quantity,0);
    if(reserved>stock.usableReceived)throw Error('Available stock changed. Purchase must confirm allocation before invoicing or dispatch.');
    if(input.action==='SELECT'&&readAllocations(context.activity).find(row=>row.sourceTaskId===sourceId)?.targets.reduce((sum,row)=>sum+row.quantity,0)>stock.usableReceived)throw Error('Available stock changed. Purchase must confirm allocation before invoicing or dispatch.');
   }
   const id=operationId(company,requestId,staff.memberId,'SHIPMENT_EVENT');return {expectedVersion:version,event:{_id:id,title:id,description:shipment.id,image:shipment.customerId,action:FULFILMENT_ACTION,result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason,details:{beforeRevision,shipment}}};
  },apply:async plan=>{const collection=names[company].activity,existing=await store.read(collection,plan.event._id);if(!existing){const context=await readContext(company,staff);if(shipmentVersion(context)!==plan.expectedVersion)throw Error('Shipment changed while saving.');if(plan.event.details.shipment.status!=='CANCELLED')requirePackingReleased(validateInvoiceOutflows(context,plan.event.details.shipment),plan.event.details.shipment.lines.map(line=>line.taskId));await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Shipment receipt conflict.');return {ok:true,requestId,company,shipmentId:plan.event.description,status:plan.event.details.shipment.status};}});
 };
}
