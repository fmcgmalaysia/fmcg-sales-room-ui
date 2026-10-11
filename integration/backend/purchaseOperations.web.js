import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { createPurchaseOperations } from 'backend/purchaseOperations.js';
import { createSharedSupplierOperations } from 'backend/sharedSupplierOperations.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { getPointbaseBrands } from 'backend/pointbaseBrandClient.js';
const options={suppressAuth:true,consistentRead:true};
const store={
 async all(collection){let page=await wixData.query(collection).limit(1000).find(options),items=[...page.items];while(page.hasNext()){page=await page.next();items.push(...page.items);}return items;},
 async one(collection,criteria){let query=wixData.query(collection);for(const [key,value] of Object.entries(criteria))query=query.eq(key,value);const page=await query.limit(2).find(options);if(page.items.length>1)throw Error('Duplicate operational record.');return page.items[0]||null;},
 async read(collection,id){return this.one(collection,{_id:id});},
 insert:(collection,row)=>wixData.insert(collection,row,{suppressAuth:true}),
 update:(collection,row)=>wixData.update(collection,row,{suppressAuth:true}),
 remove:(collection,id)=>wixData.remove(collection,id,{suppressAuth:true})
};
const operate=createPurchaseOperations({store}),suppliers=createSharedSupplierOperations({store,brandOptions:getPointbaseBrands});
export const savePurchaseOperation=webMethod(Permissions.SiteMember,async(company,requestId,operation,input)=>{
 const staff=await getPurchaseStaffContext();
 try { return await operate({company,requestId,operation,input,staff}); }
 catch(error) { if(error?.message==='Net cost cannot be negative.')return {ok:false,requestId,error:'Net cost cannot be negative.'}; throw error; }
});
export const getSupplierProfile=webMethod(Permissions.SiteMember,async supplierId=>{
 await getPurchaseStaffContext();if(typeof supplierId!=='string'||supplierId.length>100)throw Error('Invalid supplier.');return suppliers.profile(supplierId);
});
export const getSupplierBrandOptions=webMethod(Permissions.SiteMember,async()=>{await getPurchaseStaffContext();return getPointbaseBrands();});
export const saveSupplierProfile=webMethod(Permissions.SiteMember,async(requestId,supplierId,expectedVersion,values)=>{
 const staff=await getPurchaseStaffContext();return suppliers.save({requestId,supplierId,expectedVersion,values,staff});
});
export const getPurchaseSaveResult=webMethod(Permissions.SiteMember,async(company,requestId,supplierId)=>{
 const staff=await getPurchaseStaffContext();if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!PURCHASE_COLLECTIONS[company])throw Error('Invalid save identity.');
 const isSupplier=supplierId!==null,identity=isSupplier?(supplierId||'SUP-'+operationId(requestId,staff.memberId).slice(0,16).toUpperCase()):null;
 const scope=isSupplier?'SUPPLIER/'+identity:company+'/PURCHASE',collection=isSupplier?'SharedSupplierActivity':PURCHASE_COLLECTIONS[company].activity;
 const record=await store.read(collection,operationId(operationId(scope,requestId,staff.memberId),'RESULT'));
 return record?.details?.outcome || {ok:false,pending:true,company,requestId};
});
