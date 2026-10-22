'use strict';
// Private actual original service composition and minimum existing gateway seams.
const fs=require('node:fs'),path=require('node:path');
const source=`import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { requirePackingStaff, projectPackingContext } from 'backend/packingListContext.js';
import { createPackingListOperations, projectPackingWorkroom, readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPreparation, projectPreparation, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/warehousePreparation.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPackingService } from 'backend/stockCurrentCommands.js';
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
 const authorityDependencies={readMember:()=>currentMember.getMember({fieldsets:['FULL']}),readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),
  requirePackingStaff:(member,records,selected)=>{const employee=requirePackingStaff(member,records,selected);
   if(employee.staffId!==staff.staffId||employee.memberId!==staff.memberId||employee.packingDepartment!==department)throw Error('Original packing session changed');return employee;},
  readContext:readFulfilmentContext,projectPackingContext,createPackingListOperations,projectPackingWorkroom,
  readPurchaseRecords:async selected=>{if(selected!==company)throw Error('Packing PO company conflict');return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company);},
  readCurrentTaskRows:async(selected,ids)=>{
   if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current packing task scope required');
   const rows=[];for(const id of ids)rows.push(await store.read(company==='NCT'?'NCTTasks':'NCTTasks1',id));return rows;
  },projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation,now:()=>new Date()};
 const service=createCurrentPackingService({company,items,store,protocol,coverage:writerCoverage,authorityDependencies});
 return{read:()=>service.read({department}),save:request=>{
  if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
   ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!request.input||request.input.action==='PHOTOS'||JSON.stringify(request).length>200000
   ||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId)throw Error('Original non-file current packing request required');
  return service.save({...request,department});
 }};
}
`;
let gateway=fs.readFileSync(path.join(__dirname,'../../backend/packingLists.web.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(gateway.split(before).length!==2)throw Error('Exact original packing gateway anchor changed');gateway=gateway.replace(before,()=>after);}
gateway="import { createCurrentMasterPacking } from 'backend/stockCurrentPacking.js';\nimport { createCurrentWarehouseReceiptRouter, createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\nimport { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';\n"+gateway;
once('export const getPackingLists=',`async function currentPacking(company,department,staff){return createCurrentMasterPacking({company,department,authenticateOriginalPacking:async()=>{
 const employee=await staffContext(department);if(employee.staffId!==staff.staffId||employee.memberId!==staff.memberId||employee.packingDepartment!==staff.packingDepartment)throw Error('Original packing identity changed');return employee;
}});}
export const getPackingLists=`);
once('async(company,department)=>readPackingWorkroom(company,await staffContext(department))',`async(company,department,resume)=>{const staff=await staffContext(department);
 if(resume!==undefined){if(!['NCT','GHR'].includes(company)||resume?.resume!=='PACKING_V1'||Object.keys(resume).length!==1)throw Error('Original packing recovery identity required');return{ok:true,company,department,schema:'PACKING_RESUME_CONTEXT_V1',staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName,packingDepartment:staff.packingDepartment}};}
 return createCurrentWarehouseOrdersRouter({company,readControl:()=>fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),
 readCurrent:async()=> (await currentPacking(company,department,staff)).read(),readLegacy:()=>readPackingWorkroom(company,staff)})();
}`);
once('async(company,department,requestId,input)=>{','async(company,department,requestId,input,stockCurrent)=>{');
once('try{return await savePackingOperation({company,staff,requestId,input});}',`try{return await createCurrentWarehouseReceiptRouter({company,readControl:()=>fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),
 saveCurrent:async(selected,request)=>(await currentPacking(selected,department,staff)).save(request),saveLegacy:()=>savePackingOperation({company,staff,requestId,input})})({requestId,input,stockCurrent});}`);
for(const[name,text]of [['stockCurrentPacking.js',source],['packingLists.web.candidate.js',gateway]]){
 new Function(text.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));const target=path.join(__dirname,name);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Current original packing differs: '+name);}else fs.writeFileSync(target,text);
}
process.stdout.write('Original Master packing private current root/wrapper '+(process.argv.includes('--check')?'verified':'built')+'; no public grant or deployment\n');
