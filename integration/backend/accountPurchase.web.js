import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { requireAccountStaff, createAccountReviewOperations } from 'backend/accountPurchaseReview.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { createPurchaseOrderOperations } from 'backend/purchaseOrderWorkflow.js';
import { readCustomerShortNames } from 'backend/customerNamesClient.js';
import { createAccountSettlementOperations } from 'backend/accountSettlement.js';
import { createSupplierCreditOperations } from 'backend/supplierCredit.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
const options={suppressAuth:true,consistentRead:true};
const store={
  async all(collection){let page=await wixData.query(collection).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
  async read(collection,id){const page=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(page.items.length>1)throw Error('Duplicate purchase order record.');return page.items[0]||null;},
  insert:(collection,row)=>wixData.insert(collection,row,{suppressAuth:true}),
  update:(collection,row)=>wixData.update(collection,row,{suppressAuth:true}),
  remove:(collection,id)=>wixData.remove(collection,id,{suppressAuth:true})
};
async function accountStaff(){return requireAccountStaff(await currentMember.getMember({fieldsets:['FULL']}),await store.all('StaffMasterAccess'));}
const orders=createPurchaseOrderOperations({store,names:PURCHASE_COLLECTIONS,readWorkspace:async(company,staff)=>{
  const names=PURCHASE_COLLECTIONS[company];
  const [orderRows,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]);
  return projectPurchaseWorkspace({company,orders:orderRows,tasks,activity,suppliers,staff});
}});
const reviews=createAccountReviewOperations({store,names:PURCHASE_COLLECTIONS,listOrders:orders.list});
const settlements=createAccountSettlementOperations({store,names:PURCHASE_COLLECTIONS,listOrders:orders.list,documentService:requestPurchaseDocument});
const applySupplierCredit=createSupplierCreditOperations({store,names:PURCHASE_COLLECTIONS,listOrders:orders.list});
export const saveAccountSettlement=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
  const staff=await accountStaff();
  try{return input?.action==='APPLY_CREDIT'?await applySupplierCredit({company,staff,requestId,input}):await settlements.save({company,staff,requestId,input});}
  catch(error){const message=String(error?.message||'');const safe=/^(Credit must stay|Supplier credit or purchase order changed|Credit cannot exceed|Verified CN|Supplier credit amount changed|Refund cannot exceed|Supplier CN required|Resolve supplier shortage liability|Unsupported financial action\.|Purchase order changed\.|Purchase order changed while saving\.|Enter |Select |Review the existing CN|Financial check has not changed|This payment (reference|proof)|This DO|CN total|Final Invoice required|Confirm INV|Supplier DO required|Confirm CN|Complete warehouse receiving|Resolve overpayment|Payment records require review)/.test(message);const processing=/^A save is still processing\./.test(message);return {ok:false,requestId,retryable:!safe,error:safe||processing?message:'Financial save could not be confirmed. Retry the same save.'};}
});
export const getAccountPurchaseOrders=webMethod(Permissions.SiteMember,async company=>{
  const staff=await accountStaff(),rows=await orders.list(company,staff);let names=[],customerNamesError='';
  try{names=await readCustomerShortNames([...new Set(rows.flatMap(row=>row.customerIds||[row.customerId]))]);if(names.some(row=>!row.shortName))customerNamesError='部分客户 Short Name 尚未填写。';}
  catch(_){customerNamesError='客户 Short Name 暂时无法读取，保留已保存名称。';}
  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName},orders:rows.map(row=>({...row,customerName:(row.customers||[{id:row.customerId,name:row.customerName}]).map(customer=>names.find(item=>item.customerId===customer.id)?.shortName||customer.name).join(' / ')})),customerNamesError,paymentConnected:true,warehouseConnected:true,invoiceReviewConnected:true,readAt:new Date().toISOString()};
});
export const saveAccountInvoiceCheck=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
  const staff=await accountStaff();
  try{return await reviews.save({company,staff,requestId,input});}
  catch(error){const message=String(error?.message||'');const safe=/^(Warehouse receipts and financial reconciliation are not connected\.|Unsupported Account action\.|Purchase order changed\.|Purchase order changed while saving\.|Invoice check has not changed\.|Final supplier Invoice is required before checking\.|Purchase amount is incomplete\.|Please enter a reason to cancel the invoice check\.|A save is still processing\.)/.test(message);return {ok:false,requestId,error:safe?message:'Invoice check save could not be confirmed. Retry the same save.'};}
});
