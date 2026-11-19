import { webMethod, Permissions } from 'wix-web-module';
import { readManagedCompanyAccess } from 'backend/staffManagementAccess.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { fulfilmentStore, readCustomerFulfilment, saveCustomerFulfilment, confirmCustomerAccountDocument } from 'backend/customerFulfilmentService.js';
async function staffContext(company){
 const access=await readManagedCompanyAccess(company),support=access.enter('SUPPORT','VIEW'),account=access.enter('ACCOUNT','VIEW'),warehouse=access.enter('WAREHOUSE','VIEW');
 if(!support&&!account&&!warehouse)throw Error('Fulfilment access is not authorized.');
 return {...access,staff:{...access.staff,readFinancial:support||account,readSupportDetails:support,canSelectShipment:false,canInvoiceShipment:access.enter('SUPPORT','EDIT'),canDispatchShipment:access.enter('WAREHOUSE','EDIT'),canPostCustomerAccount:access.enter('ACCOUNT','EDIT')},
  visible:customerId=>account||warehouse||access.can('SUPPORT','VIEW',customerId),
  financial:customerId=>account||access.can('SUPPORT','VIEW',customerId)};
}
export const getCustomerFulfilment=webMethod(Permissions.SiteMember,async company=>{
 const access=await staffContext(company),staff=access.staff,result=await readCustomerFulfilment(company,staff);
 const financial=rows=>rows.filter(row=>access.financial(row.customerId));
 result.customers=result.customers.filter(row=>access.visible(row.id));
 result.lines=result.lines.filter(row=>access.visible(row.customerId)).map(row=>{if(access.financial(row.customerId))return row;const {sellingPriceCtn,sellingPricePc,...safe}=row;return safe;});
 result.shipments=result.shipments.filter(row=>access.visible(row.customerId)).map(row=>access.financial(row.customerId)?row:{...row,invoice:row.invoice?{number:row.invoice.number,date:row.invoice.date}:undefined,lines:row.lines.map(({sellingPriceCtn,...line})=>line)});
 result.plans=financial(result.plans);result.debtorInvoices=financial(result.debtorInvoices);
 if(staff.readFinancial){const account=result.customerAccount;result.customerAccount={entries:financial(account.entries),balances:financial(account.balances),pendingDocuments:financial(account.pendingDocuments),invoicePayments:{invoices:financial(account.invoicePayments.invoices),unapplied:financial(account.invoicePayments.unapplied)}};}
 else{delete result.customerAccount;delete result.accountVersion;}
 const allowed=new Set(result.lines.map(row=>row.taskId));result.deskRemainders=result.deskRemainders.filter(row=>allowed.has(row.taskId));
 return {...result,permissions:{invoice:staff.canInvoiceShipment,dispatch:staff.canDispatchShipment,customerAccountConfirm:staff.canPostCustomerAccount}};
});
export const saveCustomerShipment=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 const access=await staffContext(company),staff=access.staff;
 if(input?.action==='INVOICE'){
  if(typeof input.id!=='string'||!input.id||input.id.length>160)throw Error('Select the original shipment.');
  const shipment=readCustomerShipments(await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity)).find(row=>row.company===company&&row.id===input.id);
  if(!shipment)throw Error('Shipment is unavailable.');
  access.require('SUPPORT','EDIT',shipment.customerId);staff.customerId=shipment.customerId;
 }else if(input?.action==='DISPATCH')access.require('WAREHOUSE','EDIT');
 else throw Error('Arrange shipment quantities in Support Desk.');
 try{return await saveCustomerFulfilment({company,staff,requestId,input});}catch(error){return {ok:false,requestId,error:String(error?.message||'Shipment save could not be confirmed.')};}
});

export const confirmCustomerAccount=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const access=await staffContext(company),staff=access.staff;access.require('ACCOUNT','EDIT');if(!staff.canPostCustomerAccount)throw Error('Finance customer-account access is required.');try{return await confirmCustomerAccountDocument({company,staff,requestId,input});}catch(error){return {ok:false,company,requestId,rejected:error?.code==='CUSTOMER_ACCOUNT_REJECTED',error:String(error?.message||'Customer account confirmation could not be verified.')};}});
