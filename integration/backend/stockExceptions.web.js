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
 const staff=await messageStaffContext();
 try{return await saveMessage({company,department,staff,requestId,input});}
 catch(error){const message=String(error?.message||''),safe=message.startsWith('Message ');return {ok:false,requestId,retryable:!safe,error:safe?message:'Message save is unconfirmed. Retry the same save.'};}
});
