import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } from 'backend/warehouseReceiving.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { readCustomerShortNames } from 'backend/customerNamesClient.js';
const options={suppressAuth:true,consistentRead:true};
const store={
  async all(collection){let page=await wixData.query(collection).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
  async read(collection,id){const page=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(page.items.length>1)throw Error('Duplicate record.');return page.items[0]||null;},
  insert:(collection,row)=>wixData.insert(collection,row,{suppressAuth:true}),
  remove:(collection,id)=>wixData.remove(collection,id,{suppressAuth:true})
};
async function staffContext(){return requireWarehouseStaff(await currentMember.getMember({fieldsets:['FULL']}),await store.all('StaffMasterAccess'));}
async function readOrders(company,staff){
  const names=PURCHASE_COLLECTIONS[company];if(!names)throw Error('Select NCT or GHR.');
  const [orders,tasks,activity,suppliers,records]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers'),store.all('PurchaseOrders')]);
  const workspace=projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff});
  return projectWarehouseOrders({company,purchaseOrders:projectPurchaseOrders({company,workspace,records}),tasks:workspace.tasks,activity});
}
const operations=createWarehouseOperations({store,names:PURCHASE_COLLECTIONS,readOrders});
export const getWarehouseOrders=webMethod(Permissions.SiteMember,async company=>{
  const staff=await staffContext(),orders=await readOrders(company,staff);let names=[];
  try{names=await readCustomerShortNames([...new Set(orders.map(row=>row.customerId))]);}catch(_){}
  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName},orders:orders.map(row=>({...row,customerName:names.find(item=>item.customerId===row.customerId)?.shortName||row.customerName})),readAt:new Date().toISOString()};
});
export const saveWarehouseReceipt=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
  const staff=await staffContext();
  try{return await operations.save({company,staff,requestId,input});}
  catch(error){const message=String(error?.message||'');const safe=/^(Select a |Purchase order or receipts changed|A receipt line|Enter whole cartons|Accepted cartons|Enter a reason|Confirm that|Rejected carton|A save is still processing|Warehouse receipt)/.test(message);return {ok:false,requestId,retryable:!safe||message.startsWith('A save is still processing'),error:safe?message:'Receipt save could not be confirmed. Retry the same save. / 收货保存尚未确认，请重试同一次保存。'};}
});
