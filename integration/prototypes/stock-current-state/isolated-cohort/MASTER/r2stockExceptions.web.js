import { createCurrentStockExceptions } from 'backend/r2stockCurrentExceptions.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/r2customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS, requirePurchaseStaff } from 'backend/r2purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { createStockExceptionOperations } from 'backend/r2inventoryExceptions.js';
import { createStockResolutionOperations } from 'backend/r2stockExceptionResolution.js';
import { requireStockStaff, projectStockWorkspace } from 'backend/r2stockExceptionWorkspace.js';
import { createDepartmentMessageOperations, projectDepartmentMessages, requireMessageStaff } from 'backend/r2departmentMessages.js';
import { requireAccountStaff } from 'backend/r2accountPurchaseReview.js';
import { requireWarehouseStaff } from 'backend/r2warehouseReceiving.js';
async function staffContext(){return requireStockStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'));}
async function listOrders(company,staff){return projectPurchaseOrders({company,workspace:await readFulfilmentContext(company,staff),records:await fulfilmentStore.all('R2PurchaseOrders')});}
const report=createStockExceptionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const resolve=createStockResolutionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getStockExceptions=webMethod(Permissions.SiteMember,async(company,readOptions)=>{const staff=await staffContext();
 if(readOptions!==undefined){if(!['NCT','GHR'].includes(company)||!readOptions||typeof readOptions!=='object'||Array.isArray(readOptions)||Object.keys(readOptions).length!==1||readOptions.contextOnly!==true)throw Error('Original stock context request required');return{ok:true,schema:'STOCK_EXCEPTION_ORIGINAL_CONTEXT_V1',company,staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName}};}
 const current=await createCurrentStockExceptions(company);if(current?.mode==='ACTIVE')return current.read(staff);if(current?.mode!=='LEGACY')throw Error('Current stock workspace unavailable');
 const context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('R2PurchaseOrders')});return projectStockWorkspace(context,orders,staff);});
export const saveStockException=webMethod(Permissions.SiteMember,async(company,requestId,input,stockCurrent)=>{
 const staff=await staffContext();
 try{const current=await createCurrentStockExceptions(company);
 if(current?.mode==='LEGACY'&&stockCurrent===undefined)return await(input?.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});
 if(current?.mode!=='ACTIVE'||!stockCurrent||typeof stockCurrent!=='object'||Array.isArray(stockCurrent)||Object.keys(stockCurrent).some(key=>!['stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))||JSON.stringify({input,stockCurrent}).length>200000)throw Error('Current stock save unconfirmed');
 return await current.save({requestId,input,...stockCurrent});}
 catch(error){const message=String(error?.message||''),safe=/^(Stock |Select |Enter |Cannot |Resolved |Purchase |Super Admin|Supplier|This stock|Confirm |Record supplier|Admin |Physical |A different|Finance|Warehouse |Verify |Allocate |CN |Refund |Received refunds|A save is still processing)/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Stock save could not be confirmed. Retry the same save. / 库存保存尚未确认，请重试同一次保存。'};}
});

async function messageStaffContext(){
 const member=await currentMember.getMember({fieldsets:['FULL']}),records=await fulfilmentStore.all('StaffMasterAccess');
 return requireMessageStaff(member,records,{PURCHASE:requirePurchaseStaff,ACCOUNT:requireAccountStaff,WAREHOUSE:requireWarehouseStaff});
}
const saveMessage=createDepartmentMessageOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getDepartmentMessages=webMethod(Permissions.SiteMember,async(company,department)=>{
 const staff=await messageStaffContext(),current=await createCurrentStockExceptions(company);if(current?.mode==='ACTIVE')return current.messages(staff,department);if(current?.mode!=='LEGACY')throw Error('Current stock messages unavailable');
 const context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('R2PurchaseOrders')});
 return projectDepartmentMessages({company,department,staff,orders,activity:context.activity});
});
export const saveDepartmentMessage=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 await messageStaffContext();
 return {ok:false,requestId,retryable:false,error:'Message service changed. Refresh and check conversation history before sending again. 留言服务已更新，请刷新并核对历史记录后再发送。'};
});
