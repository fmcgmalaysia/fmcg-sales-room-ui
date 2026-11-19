import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { projectWarehouseDeliveryReceipt } from 'backend/warehouseDeliveryView.js';
import { PROCUREMENT_SAVE_PENDING } from 'backend/purchasePlan.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { savePackingOperation, readPackingWorkroom } from 'backend/packingListService.js';
async function staffContext(department){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),department);}
export const getPackingLists=webMethod(Permissions.SiteMember,async(company,department)=>readPackingWorkroom(company,await staffContext(department)));
export const savePackingList=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 const staff=await staffContext(department);
 try{return await savePackingOperation({company,staff,requestId,input});}
 catch(error){if(error?.message===PROCUREMENT_SAVE_PENDING)return {ok:false,requestId,retryable:true,error:PROCUREMENT_SAVE_PENDING};const message=String(error?.message||'');const validation=/^(Desk|This Desk|This task|Packing |Stock or packing |Choose |Quantity |Usable |Warehouse (must |choose |photo (format |content |task |identity |history )|confirm |evidence )|This action |Only |Resolve |Explain |Loaded must |Confirm every |Start Warehouse |A processing |A pending |Unknown packing |Verified packing |This list |Master staff |Select |A save is still processing|This save identity)/.test(message);return {ok:false,requestId,retryable:!validation||message.startsWith('A save is still processing'),error:validation?message:'Packing save is unconfirmed. Retry this same save.'};}
});


export const getWarehouseDeliveryStatus=webMethod(Permissions.SiteMember,async(company,input)=>{
 const names=PURCHASE_COLLECTIONS[company],requestId=input?.saveRequestId,listId=input?.listId;
 if(!names||!/^[a-f0-9-]{36}$/i.test(requestId||'')||typeof listId!=='string'||!listId||listId.length>160)throw Error('Invalid Delivery Task identity.');
 const staff=await staffContext('WAREHOUSE');
 if(!staff.memberId||!staff.staffId)throw Error('Verified Warehouse employee is required.');
 const key=operationId(company+'/PURCHASE',requestId,staff.memberId);
 const row=await fulfilmentStore.read(names.activity,operationId(key,'RESULT')),result=row?.details?.outcome;
 if(row?.action!=='PURCHASE_OPERATION_RESULT'||row.details?.actorMemberId!==staff.memberId||row.details.actorStaffId!==staff.staffId||
    row.details.requestId!==requestId||result?.ok!==true||result.company!==company||result.requestId!==requestId||
    result.id!==listId||result.list?.id!==listId||result.list?.company!==company||!result.list?.desk)return {ok:false,pending:true,company,requestId};
 return projectWarehouseDeliveryReceipt(result);
});