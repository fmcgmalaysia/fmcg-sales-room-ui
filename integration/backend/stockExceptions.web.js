import { webMethod, Permissions } from 'wix-web-module';
import { readManagedCompanyAccess, readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { createStockExceptionOperations } from 'backend/inventoryExceptions.js';
import { createStockResolutionOperations } from 'backend/stockExceptionResolution.js';
import { projectStockWorkspace } from 'backend/stockExceptionWorkspace.js';
import { projectDepartmentMessages } from 'backend/departmentMessages.js';
async function staffContext(company){
 const access=await readManagedCompanyAccess(company);
 if(!['PURCHASE','ACCOUNT','WAREHOUSE'].some(department=>access.enter(department,'VIEW')))throw Error('Stock workspace access is not authorized.');
 return {...access.staff,readStockFinancial:access.enter('ACCOUNT','VIEW'),canReportStockException:access.enter('WAREHOUSE','EDIT'),canPlanStockResolution:access.enter('PURCHASE','EDIT'),canApproveStockLoss:access.staff.role==='SUPER ADMIN',canCloseStockException:access.enter('ACCOUNT','EDIT')};
}
async function listOrders(company,staff){return projectPurchaseOrders({company,workspace:await readFulfilmentContext(company,staff),records:await fulfilmentStore.all('PurchaseOrders')});}
const report=createStockExceptionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const resolve=createStockResolutionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getStockExceptions=webMethod(Permissions.SiteMember,async company=>{const staff=await staffContext(company),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});return projectStockWorkspace(context,orders,staff);});
export const saveStockException=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 const staff=await staffContext(company);
 try{return await(input?.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});}
 catch(error){const message=String(error?.message||''),safe=/^(Stock |Select |Enter |Cannot |Resolved |Purchase |Super Admin|Supplier|This stock|Confirm |Record supplier|Admin |Physical |A different|Finance|Warehouse |Verify |Allocate |CN |Refund |Received refunds|A save is still processing)/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Stock save could not be confirmed. Retry the same save. / 库存保存尚未确认，请重试同一次保存。'};}
});

async function messageStaffContext(company,department){
 if(!['PURCHASE','ACCOUNT','WAREHOUSE'].includes(department))throw Error('Message department access is not authorized.');
 const access=await readManagedWorkroomAccess(department,company);return {...access.staff,departments:[department]};
}
export const getDepartmentMessages=webMethod(Permissions.SiteMember,async(company,department)=>{
 const staff=await messageStaffContext(company,department),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});
 return projectDepartmentMessages({company,department,staff,orders,activity:context.activity});
});
export const saveDepartmentMessage=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 await messageStaffContext(company,department);
 return {ok:false,requestId,retryable:false,error:'Message service changed. Refresh and check conversation history before sending again. 留言服务已更新，请刷新并核对历史记录后再发送。'};
});
