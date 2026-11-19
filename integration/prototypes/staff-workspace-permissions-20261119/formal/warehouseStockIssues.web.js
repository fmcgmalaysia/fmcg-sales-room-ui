import { operationId } from 'backend/purchaseOperationJournal.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { requireWarehouseStaff } from 'backend/warehouseReceiving.js';
import { createStockExceptionOperations } from 'backend/inventoryExceptions.js';
import { createStockResolutionOperations } from 'backend/stockExceptionResolution.js';
import { projectStockWorkspace } from 'backend/stockExceptionWorkspace.js';
import { projectWarehouseStockWorkspace } from 'backend/warehouseDeliveryView.js';
async function staffContext(){return {...requireWarehouseStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess')),canReportStockException:true,canPlanStockResolution:false,canApproveStockLoss:false,canCloseStockException:false};}
async function listOrders(company,staff){return projectPurchaseOrders({company,workspace:await readFulfilmentContext(company,staff),records:await fulfilmentStore.all('PurchaseOrders')});}
const report=createStockExceptionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext}),resolve=createStockResolutionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getWarehouseStockIssues=webMethod(Permissions.SiteMember,async company=>{const staff=await staffContext(),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});return projectWarehouseStockWorkspace(projectStockWorkspace(context,orders,staff));});
export const saveWarehouseStockIssue=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const staff=await staffContext();if(!['QUARANTINE','RETURN','REPLACEMENT','DISPOSE'].includes(input?.action))return {ok:false,requestId,retryable:false,error:'Warehouse financial stock actions are not authorized.'};try{return await(input.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});}catch(error){const message=String(error?.message||''),safe=/^(Stock |Select |Enter |Cannot |Warehouse |Physical |A save is still processing)/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Stock save is unconfirmed. Retry this same request.'};}});

export const getWarehouseStockSaveStatus=webMethod(Permissions.SiteMember,async(company,requestId,caseId)=>{
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
