import { webMethod, Permissions } from 'wix-web-module';
import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { createStockExceptionOperations } from 'backend/inventoryExceptions.js';
import { createStockResolutionOperations } from 'backend/stockExceptionResolution.js';
import { projectStockWorkspace } from 'backend/stockExceptionWorkspace.js';
import { projectWarehouseStockWorkspace } from 'backend/warehouseDeliveryView.js';
async function staffContext(company,action='VIEW'){const access=await readManagedWorkroomAccess('WAREHOUSE',company);access.require(action);return {...access.staff,canReportStockException:access.can('EDIT'),canPlanStockResolution:false,canApproveStockLoss:false,canCloseStockException:false};}
async function listOrders(company,staff){return projectPurchaseOrders({company,workspace:await readFulfilmentContext(company,staff),records:await fulfilmentStore.all('PurchaseOrders')});}
const report=createStockExceptionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext}),resolve=createStockResolutionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,listOrders});
export const getWarehouseStockIssues=webMethod(Permissions.SiteMember,async company=>{const staff=await staffContext(company),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});return projectWarehouseStockWorkspace(projectStockWorkspace(context,orders,staff));});
export const saveWarehouseStockIssue=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const staff=await staffContext(company,'EDIT');if(!['QUARANTINE','RETURN','REPLACEMENT','DISPOSE'].includes(input?.action))return {ok:false,requestId,retryable:false,error:'Warehouse financial stock actions are not authorized.'};try{return await(input.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});}catch(error){const message=String(error?.message||''),safe=/^(Stock |Select |Enter |Cannot |Warehouse |Physical |A save is still processing)/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Stock save is unconfirmed. Retry this same request.'};}});
