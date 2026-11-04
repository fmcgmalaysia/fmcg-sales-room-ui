import { createCurrentMasterPacking } from 'backend/stockCurrentPacking.js';
import { createCurrentWarehouseReceiptRouter, createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { savePackingOperation, readPackingWorkroom } from 'backend/packingListService.js';
async function staffContext(department){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),department);}
async function currentPacking(company,department,staff){return createCurrentMasterPacking({company,department,authenticateOriginalPacking:async()=>{
 const employee=await staffContext(department);if(employee.staffId!==staff.staffId||employee.memberId!==staff.memberId||employee.packingDepartment!==staff.packingDepartment)throw Error('Original packing identity changed');return employee;
}});}
export const getPackingLists=webMethod(Permissions.SiteMember,async(company,department,resume)=>{const staff=await staffContext(department);
 if(resume!==undefined){if(!['NCT','GHR'].includes(company)||resume?.resume!=='PACKING_V1'||Object.keys(resume).length!==1)throw Error('Original packing recovery identity required');return{ok:true,company,department,schema:'PACKING_RESUME_CONTEXT_V1',staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName,packingDepartment:staff.packingDepartment}};}
 return createCurrentWarehouseOrdersRouter({company,readControl:()=>fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),
 readCurrent:async()=> (await currentPacking(company,department,staff)).read(),readLegacy:()=>readPackingWorkroom(company,staff)})();
});
export const savePackingList=webMethod(Permissions.SiteMember,async(company,department,requestId,input,stockCurrent)=>{
 const staff=await staffContext(department);
 try{return await createCurrentWarehouseReceiptRouter({company,readControl:()=>fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),
 saveCurrent:async(selected,request)=>(await currentPacking(selected,department,staff)).save(request),saveLegacy:()=>savePackingOperation({company,staff,requestId,input})})({requestId,input,stockCurrent});}
 catch(error){const message=String(error?.message||'');const validation=/^(Packing |Stock or packing |Choose |Quantity |Usable |Warehouse (must |choose |photo (format |content |task |identity |history )|confirm |evidence )|This action |Only |Resolve |Explain |Loaded must |Confirm every |Start Warehouse |A processing |A pending |Unknown packing |Verified packing |This list |Master staff |Select |A save is still processing|This save identity)/.test(message);return {ok:false,requestId,retryable:!validation||message.startsWith('A save is still processing'),error:validation?message:'Packing save is unconfirmed. Retry this same save.'};}
});
