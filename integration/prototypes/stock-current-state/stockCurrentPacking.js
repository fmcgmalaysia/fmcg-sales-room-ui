import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { requirePackingStaff, projectPackingContext } from 'backend/packingListContext.js';
import { createPackingListOperations, projectPackingWorkroom, readPackingLists, PACKING_CURRENT_DAMAGE_READ_VERSION } from 'backend/packingListOperations.js';
import { packingHeld, PACKING_CURRENT_DAMAGE_VERSION } from 'backend/packingListModel.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPreparation, projectPreparation, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/warehousePreparation.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPackingService, createPackingPhotoFencedStore } from 'backend/stockCurrentCommands.js';
// CLOSED until actual ALL-writer/native/file/recovery/capacity/cutover acceptance.
const writerCoverage=Object.freeze({});
export async function createCurrentMasterPacking({company,department,authenticateOriginalPacking}){
 if(!['NCT','GHR'].includes(company)||!['SUPPORT','WAREHOUSE'].includes(department)||typeof authenticateOriginalPacking!=='function')throw Error('Original private packing scope required');
 const staff=await authenticateOriginalPacking();
 if(staff?.packingDepartment!==department||['staffId','staffName','memberId'].some(field=>typeof staff[field]!=='string'||!staff[field]||staff[field].length>200)||staff.customerId)throw Error('Original packing employee required');
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2)throw Error('Paired current packing calculators required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime']}});
 const protocol=createSegmentedFencedProof({company,store,domainWrites:true});
 const authorityDependencies={currentDamageVersion:typeof PACKING_CURRENT_DAMAGE_VERSION==='number'&&typeof PACKING_CURRENT_DAMAGE_READ_VERSION==='number'&&PACKING_CURRENT_DAMAGE_VERSION===PACKING_CURRENT_DAMAGE_READ_VERSION?PACKING_CURRENT_DAMAGE_VERSION:0,readMember:()=>currentMember.getMember({fieldsets:['FULL']}),readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),
  requirePackingStaff:(member,records,selected)=>{const employee=requirePackingStaff(member,records,selected);
   if(employee.staffId!==staff.staffId||employee.memberId!==staff.memberId||employee.packingDepartment!==department)throw Error('Original packing session changed');return employee;},
  readContext:readFulfilmentContext,projectPackingContext,createPackingListOperations,projectPackingWorkroom,
  readPurchaseRecords:async selected=>{if(selected!==company)throw Error('Packing PO company conflict');return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company);},
  readCurrentTaskRows:async(selected,ids)=>{
   if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current packing task scope required');
   const rows=[];for(const id of ids)rows.push(await store.read(company==='NCT'?'NCTTasks':'NCTTasks1',id));return rows;
  },projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation,now:()=>new Date(),
  createPhotoProtocol:({request,staff})=>({...createSegmentedFencedProof({company,domainWrites:true,stepsPerInvocation:1,
    store:createPackingPhotoFencedStore({company,staff,request,store,documentService:requestPurchaseDocument})}),readSnapshot:protocol.readSnapshot}),
  allocatePhotoSlots:async count=>{if(!Number.isSafeInteger(count)||count<1||count>3)throw Error('Bounded packing photo allocation required');
   const slots=[];for(let index=0;index<count;index++){const result=await requestPurchaseDocument({action:'ALLOCATE',company});if(result?.ok!==true)throw Error('Packing photo ID allocation unconfirmed');slots.push(result.fileId);}return slots;}};
 const service=createCurrentPackingService({company,items,store,protocol,coverage:writerCoverage,authorityDependencies});
 return{read:()=>service.read({department}),save:request=>{
  if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
   ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!request.input||JSON.stringify(request).length>(request.input.action==='PHOTOS'?3100000:200000)
   ||request.input.action==='PHOTOS'&&(department!=='WAREHOUSE'||!Array.isArray(request.input.photos)||request.input.photos.length<1||request.input.photos.length>3)
   ||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId)throw Error('Original bounded current packing request required');
  return service.save({...request,department});
 }};
}
