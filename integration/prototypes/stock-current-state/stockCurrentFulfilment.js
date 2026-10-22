import { items } from '@wix/data';
import { fulfilmentStore, readFulfilmentContext, readCustomerFulfilment, CUSTOMER_CURRENT_FULFILMENT_VERSION } from 'backend/customerFulfilmentService.js';
import { createCustomerFulfilmentOperations, SHIPMENT_CURRENT_ALLOCATION_VERSION } from 'backend/customerFulfilment.js';
import { PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/warehousePreparation.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentWarehouseDispatchSave, createCurrentWarehouseShipmentRead } from 'backend/stockCurrentCommands.js';
// Empty until all writers/native schemas/permissions/platform/cutover accepted.
const writerCoverage=Object.freeze({});
const requiredWriters=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
export async function createCurrentMasterFulfilment({company,authenticateOriginalWarehouse}){
 if(!['NCT','GHR'].includes(company)||typeof authenticateOriginalWarehouse!=='function')throw Error('Private original Master fulfilment scope required');
 const staff=await authenticateOriginalWarehouse();
 if(['memberId','staffId','staffName'].some(key=>typeof staff?.[key]!=='string'||!staff[key]||staff[key].length>200)
  ||staff.customerId||staff.canDispatchShipment!==true&&staff.readFinancial!==true)throw Error('Original Master fulfilment grant required');
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||CUSTOMER_CURRENT_FULFILMENT_VERSION!==2||SHIPMENT_CURRENT_ALLOCATION_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2)throw Error('Paired original current fulfilment modules required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime']}});
 const protocol=createSegmentedFencedProof({company,store,domainWrites:true});
 const guardedProtocol={...protocol,readSnapshot:read=>protocol.readSnapshot(control=>{
  if(!control.writerBuild||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==control.writerBuild))throw Error('All current writers required before fulfilment read');
  return read(control);
 })};
 const dependencies={company,items,store,protocol:guardedProtocol,coverage:writerCoverage,authenticateOriginalWarehouse,
  readContext:readFulfilmentContext,readPurchaseRecords:async selected=>{if(selected!==company)throw Error('Fulfilment PO company conflict');return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company);},
  readCurrentTaskRows:async(selected,ids)=>{
   if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current fulfilment task scope required');
   const rows=[];for(const id of ids)rows.push(await store.read(company==='NCT'?'NCTTasks':'NCTTasks1',id));return rows;
  },projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation,
  createCustomerFulfilmentOperations,currentAllocationVersion:SHIPMENT_CURRENT_ALLOCATION_VERSION,now:()=>new Date()};
 const read=createCurrentWarehouseShipmentRead({...dependencies,readOriginalCustomerFulfilment:readCustomerFulfilment,currentFulfilmentVersion:CUSTOMER_CURRENT_FULFILMENT_VERSION});
 const save=createCurrentWarehouseDispatchSave(dependencies);
 return {read,save:async request=>{
  if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
   ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||request.input?.action!=='DISPATCH'||JSON.stringify(request).length>200000
   ||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId)throw Error('Original current dispatch request/identity required; real invoicing remains closed');
  return save(request);
 }};
}
