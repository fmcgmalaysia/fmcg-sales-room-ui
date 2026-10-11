import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { createPurchaseOrderOperations } from 'backend/purchaseOrderWorkflow.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
const options={suppressAuth:true,consistentRead:true};
const store={
  async all(collection){let page=await wixData.query(collection).limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
  async read(collection,id){const page=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(page.items.length>1)throw Error('Duplicate purchase order record.');return page.items[0]||null;},
  insert:(collection,row)=>wixData.insert(collection,row,{suppressAuth:true}),
  update:(collection,row)=>wixData.update(collection,row,{suppressAuth:true}),
  remove:(collection,id)=>wixData.remove(collection,id,{suppressAuth:true})
};
const orders=createPurchaseOrderOperations({store,names:PURCHASE_COLLECTIONS,documentService:requestPurchaseDocument,readWorkspace:async(company,staff)=>{
  const names=PURCHASE_COLLECTIONS[company];
  const [orderRows,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]);
  return projectPurchaseWorkspace({company,orders:orderRows,tasks,activity,suppliers,staff});
}});
export const getPurchaseOrders=webMethod(Permissions.SiteMember,async company=>{
  const staff=await getPurchaseStaffContext();return {company,orders:await orders.list(company,staff),documentsConnected:true,paymentConnected:false,warehouseConnected:false};
});
export const savePurchaseOrder=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
  const staff=await getPurchaseStaffContext();
  try{return await orders.save({company,requestId,input,staff});}
  catch(error){
    const message=String(error?.message||'');
    const safe=/^(Unsupported purchase order action\.|Document upload is not connected\.|Select a (valid )?PDF up to 3 MiB\.|Purchase order changed\.|Purchase order changed while saving\.|Please enter a reason\.|Select a supplier before uploading documents\.|This document is already linked to the purchase order\.|Payment chase has not changed\.|Enter payment terms from 0 to 3650 days\.|Payment term has not changed\.|Enter the supplier document date\.|Select INV, CN, SO or PI\.|Supplier short name and document number are required\.|Purchase document service is not configured\.|Upload credentials do not match\.|Document service unavailable\.|Document upload could not be confirmed\.|A save is still processing\.)/.test(message);
    return {ok:false,requestId,error:safe?message:'Purchase order save could not be confirmed. Retry the same save.'};
  }
});
