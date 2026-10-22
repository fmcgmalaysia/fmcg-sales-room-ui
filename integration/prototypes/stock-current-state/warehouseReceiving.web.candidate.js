import { createCurrentWarehouseReceiptRouter, createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';
import { saveWarehouseReceiptCurrent, getWarehouseOrdersCurrent } from 'backend/stockCurrentWarehouse.web';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } from 'backend/warehouseReceiving.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { readCustomerShortNames } from 'backend/customerNamesClient.js';
import { projectWarehouseCustomerReadiness } from 'backend/warehouseCustomerReadiness.js';
import { projectPreparation, createPreparationOperations } from 'backend/warehousePreparation.js';
import { warehouseCbm, createWarehouseCbmCapture } from 'backend/warehouseCbm.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
const options={suppressAuth:true,consistentRead:true};
const store={
  async all(collection){let page=await wixData.query(collection).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
  async read(collection,id){const page=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(page.items.length>1)throw Error('Duplicate record.');return page.items[0]||null;},
  insert:(collection,row)=>wixData.insert(collection,row,{suppressAuth:true}),
  remove:(collection,id)=>wixData.remove(collection,id,{suppressAuth:true})
};
async function staffContext(){return requireWarehouseStaff(await currentMember.getMember({fieldsets:['FULL']}),await store.all('StaffMasterAccess'));}
async function readWarehouseData(company,staff){
  const names=PURCHASE_COLLECTIONS[company];if(!names)throw Error('Select NCT or GHR.');
  const [orders,tasks,activity,suppliers,records]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers'),store.all('PurchaseOrders')]);
  const workspace=projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff});
  return {orders:projectWarehouseOrders({company,purchaseOrders:projectPurchaseOrders({company,workspace,records}),tasks:workspace.tasks,activity}),customerLines:projectWarehouseCustomerReadiness(workspace),deliveryTasks:projectPreparation({...workspace,activity}).map(item=>{const task=workspace.tasks.find(t=>t.id===item.taskId);return {...item,sourceLineId:task?.sourceLineId,cbmPerCtn:task?warehouseCbm(company,task,activity):null};})};
}
async function readOrders(company,staff){return (await readWarehouseData(company,staff)).orders;}
const operations=createWarehouseOperations({store,names:PURCHASE_COLLECTIONS,readOrders});
export const getWarehouseOrders=webMethod(Permissions.SiteMember,async company=>{
  const staff=await staffContext();
  return createCurrentWarehouseOrdersRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),readCurrent:getWarehouseOrdersCurrent,readLegacy:async()=>{
  const {orders,customerLines,deliveryTasks}=await readWarehouseData(company,staff);let names=[];
  try{names=await readCustomerShortNames([...new Set([...orders.flatMap(row=>row.customerIds||[row.customerId]),...customerLines.map(row=>row.customerId)])]);}catch(_){}
  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName},deliveryTasks,customerLines:customerLines.map(row=>({...row,fullCustomerName:row.customerName,customerName:names.find(item=>item.customerId===row.customerId)?.shortName||row.customerName})),orders:orders.map(row=>({...row,fullCustomerName:row.customerName,customerName:(row.customers||[{id:row.customerId,name:row.customerName}]).map(customer=>names.find(item=>item.customerId===customer.id)?.shortName||customer.name).join(' / ')})),readAt:new Date().toISOString()};
  }})();
});
export const saveWarehouseReceipt=webMethod(Permissions.SiteMember,async(company,requestId,input,stockCurrent)=>{
  const staff=await staffContext();
  try{return await createCurrentWarehouseReceiptRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:saveWarehouseReceiptCurrent,saveLegacy:()=>operations.save({company,staff,requestId,input})})({requestId,input,stockCurrent});}
  catch(error){const message=String(error?.message||'');const safe=/^(Select a |Purchase order or receipts changed|A receipt line|Enter whole cartons|Accepted cartons|Enter a reason|Confirm that|Rejected carton|A save is still processing|Warehouse )/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Receipt save could not be confirmed. Retry the same save. 收货保存尚未确认，请重试同一次保存。'};}
});


const savePreparation=createPreparationOperations({store,names:PURCHASE_COLLECTIONS,readContext:async(company,staff)=>{
 const names=PURCHASE_COLLECTIONS[company];if(!names)throw Error('Select NCT or GHR.');
 const [orders,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]);
 return {...projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff}),activity};
},documentService:requestPurchaseDocument});
export const saveWarehousePreparation=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 const staff=await staffContext();
 try{return await savePreparation({company,staff:{...staff,canPrepareWarehouse:true},requestId,input});}
 catch(error){const message=String(error?.message||''),safe=message.startsWith('Warehouse ');return {ok:false,requestId,retryable:!safe||/unconfirmed|processing/.test(message),error:safe?message:'Warehouse save is unconfirmed. Retry the same save.'};}
});

const captureCbm=createWarehouseCbmCapture({store,names:PURCHASE_COLLECTIONS,readData:readWarehouseData,captureCosts:capturePointbaseCosts});
export const captureWarehouseCbm=webMethod(Permissions.SiteMember,async(company,requestId,taskId)=>captureCbm({company,requestId,taskId,staff:await staffContext()}));
