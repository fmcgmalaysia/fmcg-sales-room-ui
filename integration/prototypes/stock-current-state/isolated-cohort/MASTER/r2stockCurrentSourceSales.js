import { items } from '@wix/data';
import { fulfilmentStore, readFulfilmentContext, readCustomerFulfilment, CUSTOMER_CURRENT_FULFILMENT_VERSION } from 'backend/r2customerFulfilmentService.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/r2purchaseProjection.js';
import { readAllocations } from 'backend/r2plannerAllocation.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readPackingLists } from 'backend/r2packingListOperations.js';
import { packingHeld } from 'backend/r2packingListModel.js';
import { readPreparation, projectPreparation, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/r2warehousePreparation.js';
import { createSalesOrderAdjustmentOperations } from 'backend/r2salesOrderAdjustment.js';
import { createCustomerAccountOperations } from 'backend/r2customerAccountLedger.js';
import { requestPurchaseDocument } from 'backend/r2purchaseDocumentClient.js';
import { readShipmentPlans, shipmentPlanVersion, createShipmentPlanOperations, createSalesShipmentDateOperations } from 'backend/r2customerShipmentPlan.js';
import { createCustomerFulfilmentOperations, SHIPMENT_CURRENT_ALLOCATION_VERSION } from 'backend/r2customerFulfilment.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, requireOriginalSalesDelegation, createCurrentSalesRead, createCurrentSalesDemandSave, createCurrentSalesShipmentSave, createCurrentSalesArrangementSave, createCurrentSalesDocumentSave, createCustomerDocumentFencedStore } from 'backend/r2stockCurrentCommands.js';
// No source staff claims are authenticated here. ONLY original bearer gateway may
// construct the server callback. Empty coverage intentionally prevents activation.
const writerCoverage=Object.freeze({});
const requiredWriters=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
export async function createCurrentSourceSales({company,authenticateOriginalDelegation}){
 if(!['NCT','GHR'].includes(company)||typeof authenticateOriginalDelegation!=='function')throw Error('Original private source Sales scope required');
 const actor=await authenticateOriginalDelegation();requireOriginalSalesDelegation(actor,actor?.customerId);
 const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1',control=await fulfilmentStore.read(journal,operationId(company,'STOCK_CONTROL'));
 if(control?._id!==operationId(company,'STOCK_CONTROL')||control.company!==company||typeof control.stockCommitVersion!=='string'||!control.stockCommitVersion||control.schemaVersion!==1
  ||!Number.isSafeInteger(control.generation)||control.generation<0||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode))throw Error('Source Sales inventory control unavailable; no fallback');
 if(control.mode==='LEGACY'){if(control.pending!==null)throw Error('Source Sales legacy inventory pending');return{mode:'LEGACY'};}
 if(control.mode!=='ACTIVE')return{mode:control.mode};
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||CUSTOMER_CURRENT_FULFILMENT_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2||SHIPMENT_CURRENT_ALLOCATION_VERSION!==2)throw Error('Paired original current Sales calculators required');
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],
  [company==='NCT'?'R2NCTOrders':'R2NCTOrders1']:['masterReceivedTime','salesSubmissionTime'],
  [company==='NCT'?'R2NCTTasks':'R2NCTTasks1']:['lastCostCaptureTime']}});
 const protocol=createSegmentedFencedProof({company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true}),guardedProtocol={...protocol,readSnapshot:read=>protocol.readSnapshot(checkpoint=>{
  if(!checkpoint.writerBuild||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==checkpoint.writerBuild))throw Error('All original writers required before current Sales read');return read(checkpoint);
 })};
 const authenticate=async()=>{const staff=await authenticateOriginalDelegation();requireOriginalSalesDelegation(staff,actor.customerId);
  if(staff.staffId!==actor.staffId||staff.memberId!==actor.memberId)throw Error('Source Sales delegation changed');return staff;};
 const dependencies={company,items,store,protocol:guardedProtocol,coverage:writerCoverage,authenticateOriginalDelegation:authenticate,
  readContext:readFulfilmentContext,readPurchaseRecords:async selected=>{if(selected!==company)throw Error('Source Sales PO company conflict');return(await fulfilmentStore.all('R2PurchaseOrders')).filter(row=>row.company===company);},
  readCurrentTaskRows:async(selected,ids)=>{
   if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current source Sales task scope required');
   const rows=[];for(const id of ids)rows.push(await store.read(company==='NCT'?'R2NCTTasks':'R2NCTTasks1',id));return rows;
  },projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation,
  createSalesOrderAdjustmentOperations,createCustomerFulfilmentOperations,currentAllocationVersion:SHIPMENT_CURRENT_ALLOCATION_VERSION,createCustomerAccountOperations,
  createDocumentProtocol:({request,staff})=>createSegmentedFencedProof({company,store:createCustomerDocumentFencedStore({company,staff,request,store,documentService:requestPurchaseDocument}),domainWrites:true,stepsPerInvocation:1}),
  allocateDocumentSlot:async selected=>{if(selected!==company)throw Error('Original document company conflict');const allocated=await requestPurchaseDocument({action:'ALLOCATE',company});if(!/^[A-Za-z0-9_-]{10,200}$/.test(allocated?.fileId||''))throw Error('Original document identity unavailable');return allocated.fileId;},
  readPlans:readShipmentPlans,planVersion:shipmentPlanVersion,createShipmentPlanOperations,createSalesShipmentDateOperations,now:()=>new Date()};
 const protect=(save,actions)=>request=>{
  if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
   ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!actions.includes(request.input?.action)||request.input.customerId!==actor.customerId||JSON.stringify(request).length>(actions.length===1&&actions[0]==='DOCUMENT'?4300000:200000)
   ||request.stockIdentity?.staffId!==actor.staffId||request.stockIdentity?.memberId!==actor.memberId)throw Error('Original current source Sales request/identity required');return save(request);
 };
 return{mode:'ACTIVE',read:createCurrentSalesRead({...dependencies,readOriginalCustomerFulfilment:readCustomerFulfilment,currentFulfilmentVersion:CUSTOMER_CURRENT_FULFILMENT_VERSION}),
  save:protect(createCurrentSalesDemandSave(dependencies),['ADJUST']),
  shipmentSave:protect(createCurrentSalesShipmentSave(dependencies),['SELECT','CANCEL']),
  arrangementSave:protect(createCurrentSalesArrangementSave(dependencies),['PLAN','ORDER_DATE']),documentSave:protect(createCurrentSalesDocumentSave(dependencies),['DOCUMENT'])};
}
