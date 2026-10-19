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
import { queryAccountReadModel } from 'backend/accountReadQuery.js';
import { ACCOUNT_READ_INDEX_COLLECTION, createAccountReadIndexOperations } from 'backend/accountReadIndex.js';
const options={suppressAuth:true,consistentRead:true};
const store={
  async all(collection){let page=await wixData.query(collection).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
  async read(collection,id){const page=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(page.items.length>1)throw Error('Duplicate purchase order record.');return page.items[0]||null;},
  async listGeneration(collection,company,generation){let page=await wixData.query(collection).eq('company',company).eq('generation',generation).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
  insertBatch:(collection,rows)=>wixData.bulkInsert(collection,rows,{suppressAuth:true}),
  upsert:(collection,row)=>wixData.save(collection,row,{suppressAuth:true}),
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
const accountIndex=staff=>createAccountReadIndexOperations({store,readRows:company=>orders.list(company,staff)});
export const saveAccountSettlement=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
  const staff=await accountStaff();
  try{return input?.action==='APPLY_CREDIT'?await applySupplierCredit({company,staff,requestId,input}):await settlements.save({company,staff,requestId,input});}
  catch(error){const message=String(error?.message||'');const safe=/^(Resolve bank payment processing|Procurement handoff |Confirm paper documents|Supplier PI|Shortage |Confirm the actual shortage|Assign supplier CN|Assign received refund|CN amount is|CN allocations must|Refund amount is|Received refunds must|Reconcile each supplier|Duplicate shortage|Credit must stay|Supplier credit or purchase order changed|Credit cannot exceed|Verified CN|Supplier credit amount changed|Refund cannot exceed|Supplier CN required|Resolve supplier shortage liability|Only the uploader or SUPER ADMIN|Unsupported financial action\.|Purchase order changed\.|Purchase order changed while saving\.|Enter |Select |Review the existing CN|Financial check has not changed|This payment (reference|proof)|This DO|CN total|Final Invoice required|Confirm INV|Supplier DO required|Confirm CN|Complete warehouse receiving|Resolve overpayment|Payment records require review)/.test(message);const processing=/^A save is still processing\./.test(message);return {ok:false,requestId,retryable:!safe,error:safe||processing?message:'Financial save could not be confirmed. Retry the same save.'};}
});
export const getAccountPurchaseOrders=webMethod(Permissions.SiteMember,async company=>{
  const staff=await accountStaff(),rows=await orders.list(company,staff),suppliers=await store.all('SharedSuppliers');let names=[],customerNamesError='';
  try{names=await readCustomerShortNames([...new Set(rows.flatMap(row=>row.customerIds||[row.customerId]))]);if(names.some(row=>!row.shortName))customerNamesError='部分客户 Short Name 尚未填写。';}
  catch(_){customerNamesError='客户 Short Name 暂时无法读取，保留已保存名称。';}
  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName,role:staff.role},orders:rows.map(row=>({...row,supplierBank:(()=>{const s=suppliers.find(s=>s.title===row.supplierId);return s?.bankName&&s?.bankAccountNo?{bankName:s.bankName,bankAccountNo:s.bankAccountNo}:null;})(),canDeletePaymentFiles:(row.finance?.payments||[]).flatMap(p=>(p.proofs||[p.proof]).filter(f=>f&&(f.uploadedByStaffId===staff.staffId||staff.role==='SUPER ADMIN')).map(f=>f.fileId)),customerName:(row.customers||[{id:row.customerId,name:row.customerName}]).map(customer=>names.find(item=>item.customerId===customer.id)?.shortName||customer.name).join(' / ')})),customerNamesError,paymentConnected:true,warehouseConnected:true,invoiceReviewConnected:true,readAt:new Date().toISOString()};
});
export const queryAccountPurchaseOrders=webMethod(Permissions.SiteMember,async(company,input)=>{
  const staff=await accountStaff(),rows=await orders.list(company,staff),suppliers=await store.all('SharedSuppliers');let names=[];
  try{names=await readCustomerShortNames([...new Set(rows.flatMap(row=>row.customerIds||[row.customerId]))]);}catch(_){}
  const decorated=rows.map(row=>({...row,supplierBank:(()=>{const supplier=suppliers.find(item=>item.title===row.supplierId);return supplier?.bankName&&supplier?.bankAccountNo?{bankName:supplier.bankName,bankAccountNo:supplier.bankAccountNo}:null;})(),canDeletePaymentFiles:(row.finance?.payments||[]).flatMap(payment=>(payment.proofs||[payment.proof]).filter(file=>file&&(file.uploadedByStaffId===staff.staffId||staff.role==='SUPER ADMIN')).map(file=>file.fileId)),customerName:(row.customers||[{id:row.customerId,name:row.customerName}]).map(customer=>names.find(item=>item.customerId===customer.id)?.shortName||customer.name).join(' / ')}));
  const result=queryAccountReadModel(decorated,input),pageRows=result.view==='TRANSACTIONS'?result.items.map(item=>item.row):result.view.startsWith('SUPPLIER_')?result.items:[];
  const pageSuppliers=new Set(pageRows.map(row=>row.supplierId));
  const creditSources=decorated.filter(row=>pageSuppliers.has(row.supplierId)&&row.invoiceChecked&&row.finance?.supplierCreditCents>0&&!pageRows.some(item=>item.id===row.id));
  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName,role:staff.role},...result,creditSources,readAt:new Date().toISOString()};
});
export const planAccountReadIndex=webMethod(Permissions.SiteMember,async company=>{
  const staff=await accountStaff(),plan=await accountIndex(staff).plan(company);
  return {...plan,collection:ACCOUNT_READ_INDEX_COLLECTION,readAt:new Date().toISOString()};
});
export const maintainAccountReadIndex=webMethod(Permissions.SiteMember,async(company,action,generation='')=>{
  const staff=await accountStaff();
  if(staff.role!=='SUPER ADMIN')throw Error('Only SUPER ADMIN can maintain the Account read index.');
  if(action==='STAGE')return accountIndex(staff).stage(company);
  if(action==='ACTIVATE')return accountIndex(staff).activate(company,generation);
  throw Error('Select an Account read index maintenance action.');
});
export const saveAccountInvoiceCheck=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
  const staff=await accountStaff();
  try{return await reviews.save({company,staff,requestId,input});}
  catch(error){const message=String(error?.message||'');const safe=/^(Warehouse receipts and financial reconciliation are not connected\.|Unsupported Account action\.|Purchase order changed\.|Purchase order changed while saving\.|Invoice check has not changed\.|Final supplier Invoice is required before checking\.|Purchase amount is incomplete\.|Please enter a reason to cancel the invoice check\.|A save is still processing\.)/.test(message);return {ok:false,requestId,error:safe?message:'Invoice check save could not be confirmed. Retry the same save.'};}
});
