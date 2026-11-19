import { operationId } from 'backend/purchaseOperationJournal.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS, requirePurchaseStaff } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { createStockExceptionOperations } from 'backend/inventoryExceptions.js';
import { createStockResolutionOperations } from 'backend/stockExceptionResolution.js';
import { requireStockStaff, projectStockWorkspace } from 'backend/stockExceptionWorkspace.js';
import { createDepartmentMessageOperations, projectDepartmentMessages, requireMessageStaff } from 'backend/departmentMessages.js';
import { requireAccountStaff } from 'backend/accountPurchaseReview.js';
import { requireWarehouseStaff } from 'backend/warehouseReceiving.js';
async function staffContext(){return requireStockStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'));}
async function listOrders(company,staff){return projectPurchaseOrders({company,workspace:await readFulfilmentContext(company,staff),records:await fulfilmentStore.all('PurchaseOrders')});}
const report=createStockExceptionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const resolve=createStockResolutionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getStockExceptions=webMethod(Permissions.SiteMember,async company=>{const staff=await staffContext(),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});return projectStockWorkspace(context,orders,staff);});
export const saveStockException=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 const staff=await staffContext();
 try{return await(input?.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});}
 catch(error){const message=String(error?.message||''),safe=/^(Stock |Select |Enter |Cannot |Resolved |Purchase |Super Admin|Supplier|This stock|Confirm |Record supplier|Admin |Physical |A different|Finance|Warehouse |Verify |Allocate |CN |Refund |Received refunds|A save is still processing)/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Stock save could not be confirmed. Retry the same save. / 库存保存尚未确认，请重试同一次保存。'};}
});

async function messageStaffContext(){
 const member=await currentMember.getMember({fieldsets:['FULL']}),records=await fulfilmentStore.all('StaffMasterAccess');
 return requireMessageStaff(member,records,{PURCHASE:requirePurchaseStaff,ACCOUNT:requireAccountStaff,WAREHOUSE:requireWarehouseStaff});
}
const saveMessage=createDepartmentMessageOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getDepartmentMessages=webMethod(Permissions.SiteMember,async(company,department)=>{
 const staff=await messageStaffContext(),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});
 return projectDepartmentMessages({company,department,staff,orders,activity:context.activity});
});
export const saveDepartmentMessage=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 await messageStaffContext();
 return {ok:false,requestId,retryable:false,error:'Message service changed. Refresh and check conversation history before sending again. 留言服务已更新，请刷新并核对历史记录后再发送。'};
});


export const getStockSaveStatus=webMethod(Permissions.SiteMember,async(company,requestId,caseId)=>{
 const names=PURCHASE_COLLECTIONS[company];
 if(!names||!/^[a-f0-9-]{36}$/i.test(requestId||'')||typeof caseId!=='string'||caseId.length>160)throw Error('Invalid stock receipt identity.');
 const staff=await staffContext();
 if(!staff?.memberId||!staff.staffId)throw Error('Verified employee is required.');
 const actualCase=caseId||operationId(company,requestId,staff.memberId,'STOCK_EXCEPTION');
 const key=operationId(company+'/PURCHASE',requestId,staff.memberId);
 const row=await fulfilmentStore.read(names.activity,operationId(key,'RESULT')),result=row?.details?.outcome;
 if(row?.action!=='PURCHASE_OPERATION_RESULT'||row.details?.actorMemberId!==staff.memberId||row.details?.actorStaffId!==staff.staffId||
    row.details?.requestId!==requestId||result?.ok!==true||result.company!==company||result.requestId!==requestId||result.caseId!==actualCase)return {ok:false,pending:true,company,requestId};
 return {ok:true,company,requestId};
});