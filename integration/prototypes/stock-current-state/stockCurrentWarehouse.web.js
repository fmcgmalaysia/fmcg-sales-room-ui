import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { items } from '@wix/data';
import { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } from 'backend/warehouseReceiving.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { projectWarehouseCustomerReadiness } from 'backend/warehouseCustomerReadiness.js';
import { warehouseCbm } from 'backend/warehouseCbm.js';
import { readCustomerShortNames } from 'backend/customerNamesClient.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation, createPreparationOperations, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/warehousePreparation.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentWarehouseReceiptSave, createCurrentWarehouseOrdersRead, createCurrentWarehousePreparationSave, createCurrentPurchaseTables, readCurrentPurchaseProjection } from 'backend/stockCurrentCommands.js';
// CLOSED until all original writers/native schemas/permissions/init/capacity/cutover
// and shadow acceptance pass. This is not browser-supplied activation evidence.
const writerCoverage = Object.freeze({});
const requiredWriters=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
const verifiedDateFields=Object.freeze({NCTActivity:['activityTime'],NCTActivity1:['activityTime']});
async function warehouseIdentity(){
  const member=await currentMember.getMember({fieldsets:['FULL']});
  if(!member?._id||!member.loginEmail||member.status!=='APPROVED')requireWarehouseStaff(member,[]);
  return {...requireWarehouseStaff(member,await fulfilmentStore.all('StaffMasterAccess')),memberId:member._id};
}
async function receiptSave(company,readOrders=false,expectedIdentity=null,preparation=false){
  if(!['NCT','GHR'].includes(company))throw Error('Known Warehouse company required');
  const identity=await warehouseIdentity(); // Original grant BEFORE current storage or company data.
  if(!readOrders&&(expectedIdentity?.staffId!==identity.staffId||expectedIdentity?.memberId!==identity.memberId))throw Error('Original Warehouse receipt session changed');
  const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
  const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:verifiedDateFields[journal]}});
  const protocol=createSegmentedFencedProof({company,store,domainWrites:true});
  const authorityDependencies={readMember:()=>currentMember.getMember({fieldsets:['FULL']}),
    readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),requireWarehouseStaff,
    readContext:readFulfilmentContext,readPurchaseRecords:async selected=>{
      if(selected!==company)throw Error('Warehouse purchase company conflict');
      return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company);
    },projectPurchaseOrders,projectWarehouseOrders,createWarehouseOperations,readAllocations,readCustomerShipments,readPackingLists,
    packingHeld,readPreparation,projectPreparation,readCurrentTaskRows:async(selected,ids)=>{
      if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000
        ||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current Warehouse task scope required');
      const rows=[];for(const id of ids)rows.push(await store.read(company==='NCT'?'NCTTasks':'NCTTasks1',id));return rows;
    },now:()=>new Date()};
  if(!readOrders&&!preparation)return createCurrentWarehouseReceiptSave({company,items,store,protocol,coverage:writerCoverage,authorityDependencies});
  if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2)throw Error('Paired original current Warehouse calculators required');
  const guardedProtocol={...protocol,readSnapshot:read=>protocol.readSnapshot(control=>{
    if(!control.writerBuild||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==control.writerBuild))throw Error('All current writers must be verified before Warehouse reads');
    return read(control);
  })};
  const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
  const readCurrentContext=async(selected,staff,control)=>{
    if(selected!==company)throw Error('Warehouse current read company conflict');
    const tables=await readTables(company,staff),names=company==='NCT'?{orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'}:{orders:'NCTOrders1',tasks:'NCTTasks1',activity:'NCTActivity1'};
    const originalArguments={company,staff,orders:tables[names.orders],tasks:tables[names.tasks],activity:tables[names.activity],suppliers:tables.SharedSuppliers};
    const originalContext={...projectPurchaseWorkspace(originalArguments),activity:tables[names.activity]};
    const retainedTaskIds=[...new Set([...readPreparation(originalContext.activity).values()].filter(state=>state.loaded>0).map(state=>state.taskId))];
    const current=await readCurrentPurchaseProjection({...authorityDependencies,company,context:originalContext,staff,control,items,store,
      originalArguments,projectPurchaseWorkspace,currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,retainedTaskIds,
      readPurchaseRecords:async()=>tables.PurchaseOrders});
    return {tables,originalContext,workspace:current.workspace,products:current.products,states:[...current.products.values()].map(product=>product.state)};
  };
  if(preparation)return createCurrentWarehousePreparationSave({...authorityDependencies,company,items,store,protocol:guardedProtocol,
    coverage:writerCoverage,authenticateOriginalWarehouse:warehouseIdentity,readCurrentContext,createPreparationOperations,
    currentReadyVersion:WAREHOUSE_CURRENT_READY_VERSION});
  return createCurrentWarehouseOrdersRead({company,protocol:guardedProtocol,authenticate:warehouseIdentity,readCurrentContext,
    projectPurchaseOrders,projectWarehouseOrders,projectWarehouseCustomerReadiness,projectPreparation,currentReadyVersion:WAREHOUSE_CURRENT_READY_VERSION,
    readAllocations,readCustomerShipments,readPreparation,warehouseCbm,readCustomerShortNames,now:authorityDependencies.now});
}
export const saveWarehouseReceiptCurrent=webMethod(Permissions.SiteMember,async(company,request)=>{
  try{
    if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
      ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!request.input||!Array.isArray(request.input.lines)
      ||request.input.lines.length<1||request.input.lines.length>300||JSON.stringify(request).length>1000000)throw Error('Original bounded Warehouse receipt required');
    return await(await receiptSave(company,false,request.stockIdentity))(request);
  }catch(_){return {ok:false,requestId:request?.requestId,error:'Current Warehouse receipt unconfirmed. Retain and retry the same original save. 当前收货尚未确认，请保留并重试原保存。'};}
});
export const getWarehouseOrdersCurrent=webMethod(Permissions.SiteMember,async company=>{
  try{return await(await receiptSave(company,true))(company);}
  catch(_){throw Error('Current Warehouse orders unavailable. Retain the original receipt or preparation. 当前货仓资料尚未确认，请保留原收货或备货请求。');}
});
export const saveWarehousePreparationCurrent=webMethod(Permissions.SiteMember,async(company,request)=>{
  try{
    if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
      ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!['PACK','LOAD','UNPACK'].includes(request.input?.action)
      ||request.input.photos!==undefined&&(!Array.isArray(request.input.photos)||request.input.photos.length)
      ||JSON.stringify(request).length>10000)throw Error('Original bounded non-file Warehouse preparation required');
    return await(await receiptSave(company,false,request.stockIdentity,true))(request);
  }catch(_){return{ok:false,requestId:request?.requestId,error:'Current Warehouse preparation unconfirmed. Retain and retry the same original save. 当前备货尚未确认，请保留并重试原保存。'};}
});
export const getWarehouseResumeContextCurrent=webMethod(Permissions.SiteMember,async company=>{
  try{
    if(!['NCT','GHR'].includes(company))throw Error('Known Warehouse company required');
    const staff=await warehouseIdentity();
    if(['staffId','staffName','memberId'].some(key=>typeof staff[key]!=='string'||!staff[key]||staff[key].length>200))throw Error('Original Warehouse identity required');
    return{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company,staff:{staffId:staff.staffId,staffName:staff.staffName,memberId:staff.memberId}};
  }catch(_){return{ok:false,error:'Original Warehouse identity unconfirmed. 原货仓员工身份尚未确认。'};}
});
