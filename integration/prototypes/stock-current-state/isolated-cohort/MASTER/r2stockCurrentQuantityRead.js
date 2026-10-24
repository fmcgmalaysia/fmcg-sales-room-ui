import { items } from '@wix/data';
import { fulfilmentStore } from 'backend/r2customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/r2purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { projectPurchaseQuantities, PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION } from 'backend/r2purchaseQuantityProjection.js';
import { readAllocations } from 'backend/r2plannerAllocation.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readPackingLists } from 'backend/r2packingListOperations.js';
import { packingHeld } from 'backend/r2packingListModel.js';
import { readPreparation, projectPreparation, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/r2warehousePreparation.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseTables, readCurrentPurchaseProjection } from 'backend/r2stockCurrentCommands.js';
// Private constructor ONLY after the original shared-secret/customer-body checks.
// This read-only system identity grants no Sales, Purchase or Warehouse mutation.
const writerCoverage=Object.freeze({});
const requiredWriters=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
export async function createCurrentPurchaseQuantityRead(company){
 if(!['NCT','GHR'].includes(company))throw Error('Known original quantity company required');
 const names=PURCHASE_COLLECTIONS[company],id=operationId(company,'STOCK_CONTROL'),control=await fulfilmentStore.read(names.activity,id);
 if(!control||control._id!==id||control.company!==company||typeof control.stockCommitVersion!=='string'||!control.stockCommitVersion||control.schemaVersion!==1||!Number.isSafeInteger(control.generation)||control.generation<0||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode))throw Error('Original quantity control unavailable; no fallback');
 if(control.mode==='LEGACY'){if(control.pending!==null)throw Error('Original quantity legacy pending');return{mode:'LEGACY'};}
 if(control.mode!=='ACTIVE')return{mode:control.mode};
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2)throw Error('Paired current quantity calculators required');
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[names.activity]:['activityTime'],
  [names.orders]:['masterReceivedTime','salesSubmissionTime'],[names.tasks]:['lastCostCaptureTime']}}),protocol=createSegmentedFencedProof({company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true});
 const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
 const staff={memberId:'SYSTEM_CUSTOMER_READ',staffId:'SYSTEM_CUSTOMER_READ',staffName:'System'};
 return{mode:'ACTIVE',read:async body=>{
  if(body?.company!==company||typeof body.customerId!=='string'||!body.customerId||!Array.isArray(body.orders)||!body.orders.length||body.orders.length>100)throw Error('Original customer quantity scope required');
  const snapshot=await protocol.readSnapshot(async checkpoint=>{
   if(checkpoint.mode!=='ACTIVE'||!checkpoint.writerBuild||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==checkpoint.writerBuild))throw Error('All original writers required before current quantity read');
   const tables=await readTables(company,staff),args={company,staff,orders:tables[names.orders],tasks:tables[names.tasks],activity:tables[names.activity],suppliers:tables.SharedSuppliers};
   const context={...projectPurchaseWorkspace(args),activity:args.activity};
   const retainedTaskIds=context.tasks.filter(task=>task.customerId===body.customerId&&body.orders.some(order=>order.orderId===task.orderId)&&!task.procurementSource&&!task.specialPurchase).map(task=>task.id);
   const current=await readCurrentPurchaseProjection({company,context,staff,control:checkpoint,items,store,originalArguments:args,retainedTaskIds,projectPurchaseWorkspace,currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,
    readCurrentTaskRows:async(selected,ids)=>{if(selected!==company||!Array.isArray(ids)||ids.length>2000||new Set(ids).size!==ids.length)throw Error('Bounded original quantity task scope required');const rows=[];for(const id of ids)rows.push(await store.read(names.tasks,id));return rows;},
    readPurchaseRecords:async()=>tables.R2PurchaseOrders,projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation});
   const workspace={...current.workspace,activity:args.activity},purchaseOrders=projectPurchaseOrders({company,workspace,records:tables.R2PurchaseOrders});
   // Validate the ORIGINAL accepted customer/order/submission identities BEFORE
   // querying any per-customer claim timestamp. No arbitrary requested task IDs.
   projectPurchaseQuantities({...args,customerId:body.customerId,requests:body.orders,purchaseOrders,workspace:context});
   const selected=workspace.tasks.filter(task=>task.customerId===body.customerId&&body.orders.some(order=>order.orderId===task.orderId)&&!task.procurementSource&&!task.specialPurchase);
   const timestamps={};
   for(const task of selected){
    const page=await items.query('R2StockClaims').eq('company',company).eq('taskId',task.id).descending('_updatedDate').limit(1).find({consistentRead:true,returnTotalCount:true});
    if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount<0||page.items.length!==Math.min(1,page.totalCount))throw Error('Current quantity timestamp unavailable');
    const row=page.items[0];
    if(row){
     const exact=await store.read('R2StockClaims',row._id);
     const key=JSON.stringify([company,task.barcode,task.packing,task.ea]);
     if(row.company!==company||row.taskId!==task.id||row.stockKey!==key||row._id!==operationId(company,row.positionId,task.id))throw Error('Current quantity timestamp identity changed');
     if(!exact||exact.company!==company||exact.taskId!==task.id||exact.stockKey!==key||row.stockCommitVersion!==exact._version||Object.prototype.toString.call(row._updatedDate)!=='[object Date]'||!Number.isFinite(row._updatedDate.getTime()))throw Error('Current quantity timestamp version changed');
     timestamps[task.id]=row._updatedDate.toISOString();
    }else{
     if(task.inc!==0)throw Error('Current customer allocation timestamp missing');
     const receipt=args.activity.find(event=>event.action==='ORDER_RECEIVED'&&event.result==='ACCEPTED'&&event.description===task.orderId&&event.details?.taskIds?.includes(task.id));
     if(!Number.isFinite(Date.parse(receipt?.activityTime)))throw Error('Original zero-stock receipt time missing');timestamps[task.id]=new Date(receipt.activityTime).toISOString();
    }
   }
   return projectPurchaseQuantities({...args,customerId:body.customerId,requests:body.orders,purchaseOrders,workspace:{...workspace,stockQuantityUpdatedAtByTask:timestamps}});
  });return snapshot.rows;
 }};
}
