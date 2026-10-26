import { createCustomerAccountOperations, customerAccountVersion } from 'backend/customerAccountLedger.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { projectCustomerDebtors, projectCustomerAccount } from 'backend/customerDebtor.js';
import wixData from 'wix-data';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { createCustomerFulfilmentOperations, shipmentVersion } from 'backend/customerFulfilment.js';
import { readCustomerShipments, reservedCartons } from 'backend/customerShipmentLedger.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { warehouseCbm } from 'backend/warehouseCbm.js';
import { createPurchaseMarginRefresh } from 'backend/purchaseMarginRefresh.js';
import { createShipmentPlanOperations, readShipmentPlans, shipmentPlanVersion, createSalesShipmentDateOperations } from 'backend/customerShipmentPlan.js';
import { createSalesOrderAdjustmentOperations, salesAdjustmentVersion } from 'backend/salesOrderAdjustment.js';
const options={suppressAuth:true,consistentRead:true};
export const fulfilmentStore={
 async all(collection){let page=await wixData.query(collection).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
 async read(collection,id){const page=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(page.items.length>1)throw Error('Duplicate fulfilment record.');return page.items[0]||null;},
 insert:(collection,row)=>wixData.insert(collection,row,{suppressAuth:true}),update:(collection,row)=>wixData.update(collection,row,{suppressAuth:true}),remove:(collection,id)=>wixData.remove(collection,id,{suppressAuth:true})
};
export async function readFulfilmentContext(company,staff){const names=PURCHASE_COLLECTIONS[company];if(!names)throw Error('Select NCT or GHR.');const [orders,tasks,activity,suppliers]=await Promise.all([fulfilmentStore.all(names.orders),fulfilmentStore.all(names.tasks),fulfilmentStore.all(names.activity),fulfilmentStore.all('SharedSuppliers')]);const workspace=projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff});if(staff.customerId&&staff.customerName&&!workspace.customers.some(row=>row.id===staff.customerId))workspace.customers.push({id:staff.customerId,name:staff.customerName});return {...workspace,activity,tasks:workspace.tasks.map(task=>({...task,sellingPricePc:orders.find(order=>order.title===task.orderId&&order.sourceLineId===task.sourceLineId)?.sellingPricePc}))};}
const saveFulfilmentEvent=createCustomerFulfilmentOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,readRates:readCurrentAdminFx});
const refreshInvoiceCache=createPurchaseMarginRefresh({store:fulfilmentStore,readRates:readCurrentAdminFx});
const saveShipmentPlan=createShipmentPlanOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const saveSalesShipmentDate=createSalesShipmentDateOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const saveSalesOrderAdjustment=createSalesOrderAdjustmentOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,readPlans:readShipmentPlans,planVersion:shipmentPlanVersion});
export async function saveCustomerFulfilment(request){
 if(request.input.action==='ADJUST')return saveSalesOrderAdjustment(request);
 if(request.input.action==='ORDER_DATE')return saveSalesShipmentDate(request);
 if(request.input.action==='PLAN')return saveShipmentPlan(request);
 const result=await saveFulfilmentEvent(request);
 if(request.input.action==='INVOICE'){
  const {company,staff}=request,names=PURCHASE_COLLECTIONS[company],context=await readFulfilmentContext(company,staff);
  const [orders,tasks]=await Promise.all([fulfilmentStore.all(names.orders),fulfilmentStore.all(names.tasks)]);
  const shipment=readCustomerShipments(context.activity).find(row=>row.id===result.shipmentId);
  const workspace={...context,tasks:context.tasks.filter(row=>shipment.lines.some(line=>line.taskId===row.id||line.taskId===row.customerDemandTaskId))};
  const refreshed=await refreshInvoiceCache({company,names,orders,tasks,workspace,activity:context.activity});
  if(shipment.lines.some(line=>refreshed.get(line.taskId)===null||!refreshed.has(line.taskId)))throw Error('Invoice saved; CMS cache confirmation pending. Retry this same request.');
 }
 return result;
}
export const saveCustomerAccountDocument=createCustomerAccountOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,documentService:requestPurchaseDocument});
export async function readCustomerFulfilment(company,staff,customerId=''){
 const context=await readFulfilmentContext(company,staff),shipments=readCustomerShipments(context.activity).filter(row=>!customerId||row.customerId===customerId);
 const account=projectCustomerAccount(context);for(const entry of account.entries)if(!context.customers.some(row=>row.id===entry.customerId))context.customers.push({id:entry.customerId,name:entry.customerName});
 return {company,adjustmentVersion:salesAdjustmentVersion(context,shipmentPlanVersion),plans:readShipmentPlans(context.activity).filter(row=>!customerId||row.customerId===customerId),planVersion:shipmentPlanVersion(context),customerAccount:{entries:account.entries.filter(row=>!customerId||row.customerId===customerId),balances:account.balances.filter(row=>!customerId||row.customerId===customerId)},accountVersion:customerAccountVersion(context),debtorInvoices:projectCustomerDebtors({company,activity:context.activity,customers:context.customers}).filter(row=>!customerId||row.customerId===customerId),version:shipmentVersion(context),staff:{staffName:staff.staffName},customers:context.customers.filter(row=>!customerId||row.id===customerId),
 lines:context.tasks.filter(row=>(!customerId||row.customerId===customerId)&&!row.archived&&!row.specialPurchase&&!row.procurementSource).map(row=>({taskId:row.id,customerId:row.customerId,orderId:row.orderId,sourceLineId:row.sourceLineId,estimatedShipmentDate:row.estimatedShipmentDate,shipmentDate:row.shipmentDate,barcode:row.barcode,name:row.name,packing:row.packing,requested:row.ord,originalRequested:row.requested??row.ord,allocated:row.inc||0,reserved:reservedCartons(row.id,context.activity),available:Math.max(0,(row.inc||0)-reservedCartons(row.id,context.activity)),sellingPriceCtn:row.sellingPricePc*row.ea,currency:row.transactionCurrency,...(staff.readSupportDetails===true?{sellingPricePc:row.sellingPricePc,cbmPerCtn:warehouseCbm(company,row,context.activity)}:{})})),
 shipments:shipments.map(row=>({...row,lines:row.lines.map(line=>({taskId:line.taskId,orderId:line.orderId,sourceLineId:line.sourceLineId,estimatedShipmentDate:context.tasks.find(task=>task.id===line.taskId)?.estimatedShipmentDate||null,barcode:line.barcode,name:line.name,packing:line.packing,quantity:line.quantity,sellingPriceCtn:line.sellingPriceCtn??(()=>{const task=context.tasks.find(row=>row.id===line.taskId);return task?task.sellingPricePc*task.ea:null;})()}))})),readAt:new Date().toISOString()};
}
