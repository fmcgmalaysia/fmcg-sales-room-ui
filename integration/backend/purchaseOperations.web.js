import { createPurchaseSourceOperations } from 'backend/purchaseSources.js';
import { createQuantityCaseOperations } from 'backend/purchaseQuantityCases.js';
import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { createPlannerAllocationOperations } from 'backend/plannerAllocation.js';
import { createShortageOperations } from 'backend/purchaseShortage.js';
import { createPurchaseOperations } from 'backend/purchaseOperations.js';
import { createSharedSupplierOperations } from 'backend/sharedSupplierOperations.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { getPointbaseBrands } from 'backend/pointbaseBrandClient.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
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
const readPlannerWorkspace=async(company,staff)=>{
 const names=PURCHASE_COLLECTIONS[company];const [orders,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]);
 return projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff});
};
const addSource=createPurchaseSourceOperations({store,names:PURCHASE_COLLECTIONS,readWorkspace:readPlannerWorkspace});
const decideQuantityCase=createQuantityCaseOperations({store,names:PURCHASE_COLLECTIONS,readWorkspace:readPlannerWorkspace});
const allocate=createPlannerAllocationOperations({store,names:PURCHASE_COLLECTIONS,readWorkspace:readPlannerWorkspace});
const decideShortage=createShortageOperations({store,names:PURCHASE_COLLECTIONS,readWorkspace:readPlannerWorkspace});
export const savePurchaseOperation=webMethod(Permissions.SiteMember,async(company,requestId,operation,input)=>{
 try { const staff=await getPurchaseStaffContext();return operation==='QUANTITY_CASE'?await decideQuantityCase({company,requestId,input,staff:{...staff,canDecideQuantityCase:true}}):operation==='ADD_SOURCE'?await addSource({company,requestId,input:{...input,action:'ADD_SOURCE'},staff:{...staff,canAddPurchaseSource:true}}):operation==='SHORTAGE'?await decideShortage({company,requestId,input,staff}):operation==='ALLOCATE'?await allocate({company,requestId,input,staff}):await operate({company,requestId,operation,input,staff}); }
 catch(error) { if(error?.code==='WDE0118'||/\bWDE0118\b/.test(String(error?.message||''))){console.warn('Purchase save result unconfirmed',{errorCode:'WDE0118',company,operation,requestId});return {ok:false,pending:true,requestId,errorCode:'WDE0118',error:'Master CMS connection is not confirmed (WDE0118). Input retained; refresh Master, then retry the same save / CMS连接未确认，输入保留；刷新Master后重试同一次保存。'};} if(['Procurement handoff has locked this purchase order. Withdraw or request Finance return before editing.','Check cost and discount values.','EA is unavailable.','Row order changed. Refresh before saving.','Row order must include every active task for this customer.','Check supplier costs and discounts.','Supplier quantity must be between 1 and 9999 cartons.','A procurement reason is required.','Confirm extra cartons and whether they are free goods or paid procurement.','Procurement plan changed. Refresh before saving; your input is retained.','Select an active supplier before saving the purchase plan.','Supplier is locked to the confirmed procurement source.','Supplier total cannot be below the warehouse received quantity.','Procurement quantity and supplier cost have not changed.','Confirm the supplier has agreed to this P.O. quantity.','Quantity case changed. Refresh before saving.','Quantity case changed while saving.','Enter an internal reason and a customer-safe update.','Select the supplier shortage resolution.',"Purchase sources changed. Refresh before saving.","Select an existing customer demand with a confirmed first supplier purchase.","Enter whole cartons and the additional purchase reason.","Additional supplier quantities exceed customer demand.","Select an active supplier.","Enter a new distinct supplier P.O. number.","Confirm the supplier prices and discounts.","Source order is unavailable or invoice locked.","Purchase sources changed while saving.",'Only Super Admin may change customer demand / 只有最高权限 Admin 可修改客户需求。','Net cost cannot be negative.','Enter the P.O. number after the company prefix.','This P.O. has saved records. Select all its tasks when changing its number.','Two purchase orders with saved records cannot be merged.','Stock or allocations changed. Refresh before allocating.','Warehouse receipt and source P.O. are required.','Enter an allocation reason.','Select distinct customer task allocations.','Allocate only matching products to active customer tasks.','Allocated cartons exceed customer demand.','Invoiced allocation must be corrected through Support.','Invoiced allocation cannot be removed.','Allocate no more than the actual accepted cartons.','Allocation has not changed.','An active supplier P.O. is required.','Quantity or shortage decision changed. Refresh before saving.','This task has no outstanding quantity or receiving issue.','Enter an internal reason and customer-facing update.','Select customer waiting and supplier resolution separately.','Enter the expected replenishment date.'].includes(error?.message))return {ok:false,requestId,error:error.message}; throw error; }
});
export const getSupplierProfile=webMethod(Permissions.SiteMember,async supplierId=>{
 await getPurchaseStaffContext();if(typeof supplierId!=='string'||supplierId.length>100)throw Error('Invalid supplier.');return suppliers.profile(supplierId);
});
// Reference-only: no retry journal, CMS updates, P.O. creation or supplier-price confirmation.
export const getPurchaseReferenceCost=webMethod(Permissions.SiteMember,async(company,taskId)=>{
 const staff=await getPurchaseStaffContext();
 if(!PURCHASE_COLLECTIONS[company]||!/^[a-f0-9]{32}$/i.test(taskId||''))throw Error('Invalid reference task.');
 const workspace=await readPlannerWorkspace(company,staff),task=workspace.tasks.find(row=>row.id===taskId);
 if(!task||task.archived)throw Error('Accepted purchase task is unavailable.');
 const costs=await capturePointbaseCosts([task.barcode]),cost=costs?.[task.barcode];
 if(!cost||cost.unitBarcode!==task.barcode||cost.costCurrency!=='MYR'||cost.costStatus!=='CAPTURED'||!Number.isFinite(Date.parse(cost.capturedAt)))throw Error('POINTBASE reference is unavailable; current inputs are retained.');
 const prices=Object.fromEntries(['lpPc','lpCtn','disc1','disc2','disc3'].map(key=>[key,typeof cost[key]==='number'&&Number.isFinite(cost[key])?cost[key]:null]));
 return {company,taskId,barcode:task.barcode,capturedAt:cost.capturedAt,prices};
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
