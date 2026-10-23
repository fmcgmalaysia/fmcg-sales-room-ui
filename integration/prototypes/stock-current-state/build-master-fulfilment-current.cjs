'use strict';
// PRIVATE actual composition; no new web method or copied staff authority.
const fs=require('node:fs'),path=require('node:path'),{WRITERS}=require('./stock-admission.cjs');
const source=`import { items } from '@wix/data';
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
// Initial human acceptance ends at Loaded. A later verified release must opt in
// here independently; neither writer coverage nor browser flags open physical exit.
export const CURRENT_PHYSICAL_DISPATCH_ENABLED=false;
const requiredWriters=Object.freeze(${JSON.stringify(WRITERS)});
export async function createCurrentMasterFulfilment({company,authenticateOriginalWarehouse}){
 if(!['NCT','GHR'].includes(company)||typeof authenticateOriginalWarehouse!=='function')throw Error('Private original Master fulfilment scope required');
 const staff=await authenticateOriginalWarehouse();
 if(['memberId','staffId','staffName'].some(key=>typeof staff?.[key]!=='string'||!staff[key]||staff[key].length>200)
  ||staff.customerId||staff.canDispatchShipment!==true&&staff.readFinancial!==true)throw Error('Original Master fulfilment grant required');
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||CUSTOMER_CURRENT_FULFILMENT_VERSION!==2||SHIPMENT_CURRENT_ALLOCATION_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2)throw Error('Paired original current fulfilment modules required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],
  [company==='NCT'?'NCTOrders':'NCTOrders1']:['masterReceivedTime','salesSubmissionTime'],
  [company==='NCT'?'NCTTasks':'NCTTasks1']:['lastCostCaptureTime']}});
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
  if(CURRENT_PHYSICAL_DISPATCH_ENABLED!==true)throw Error('Current stock test ends at Loaded. Physical dispatch is not enabled. 当前库存测试止于装柜确认，尚未开放实际出库。');
  return save(request);
 }};
}
`;
let gateway=fs.readFileSync(path.join(__dirname,'../../backend/customerFulfilment.web.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(gateway.split(before).length!==2)throw Error('Exact original Master fulfilment anchor changed');gateway=gateway.replace(before,()=>after);}
gateway="import { createCurrentMasterFulfilment, CURRENT_PHYSICAL_DISPATCH_ENABLED } from 'backend/stockCurrentFulfilment.js';\nimport { createCurrentWarehouseReceiptRouter, createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\nimport { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';\n"+gateway;
once('export const getCustomerFulfilment=',`async function currentMasterFulfilment(company,staff){return createCurrentMasterFulfilment({company,authenticateOriginalWarehouse:async()=>{
 const current=await staffContext();if(JSON.stringify(current)!==JSON.stringify(staff))throw Error('Master fulfilment identity changed. Retain original request.');return current;
}});}
export const getCustomerFulfilment=`);
once("async company=>{const staff=await staffContext();const result=",`async(company,resume)=>{const staff=await staffContext();
 if(resume!==undefined){if(!['NCT','GHR'].includes(company)||resume?.resume!=='WAREHOUSE_DISPATCH_V1'||Object.keys(resume).length!==1||staff.canDispatchShipment!==true)throw Error('Original dispatch recovery identity required');return {ok:true,company,schema:'WAREHOUSE_DISPATCH_RESUME_V1',staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName}};}
 const result=`);
once('const result=await readCustomerFulfilment(company,staff);',`const result=await createCurrentWarehouseOrdersRouter({company,readControl:()=>fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),
 readCurrent:async()=> (await currentMasterFulfilment(company,staff)).read(company),readLegacy:()=>readCustomerFulfilment(company,staff)})();`);
once('async(company,requestId,input)=>{const staff=await staffContext();try{return await saveCustomerFulfilment({company,staff,requestId,input});}',`async(company,requestId,input,stockCurrent)=>{const staff=await staffContext();try{return await createCurrentWarehouseReceiptRouter({company,
 readControl:()=>fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),
 saveCurrent:async(selected,request)=>(await currentMasterFulfilment(selected,staff)).save(request),saveLegacy:()=>saveCustomerFulfilment({company,staff,requestId,input})})({requestId,input,stockCurrent});}`);
once('return {...result,permissions:{invoice:staff.canInvoiceShipment,dispatch:staff.canDispatchShipment}};',
 'return {...result,permissions:{invoice:staff.canInvoiceShipment&&result.stockCurrent?.stockProtocol!==1,dispatch:staff.canDispatchShipment&&(result.stockCurrent?.stockProtocol!==1||CURRENT_PHYSICAL_DISPATCH_ENABLED===true)}};');
for(const[name,text]of [['stockCurrentFulfilment.js',source],['customerFulfilment.web.candidate.js',gateway]]){
 new Function(text.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));const target=path.join(__dirname,name);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Current Master fulfilment differs: '+name);}else fs.writeFileSync(target,text);
}
process.stdout.write('Original Master fulfilment private current root/wrapper '+(process.argv.includes('--check')?'verified':'built')+'; no public grant or deployment\n');
