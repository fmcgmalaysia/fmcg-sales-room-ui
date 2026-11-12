import { PROCUREMENT_SAVE_PENDING } from 'backend/purchasePlan.js';
import { webMethod, Permissions } from 'wix-web-module';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { savePackingOperation, readPackingWorkroom } from 'backend/packingListService.js';
async function workroom(company,department){
 if(!['SUPPORT','WAREHOUSE'].includes(department))throw Error('Packing department is not authorized.');
 const access=await readManagedWorkroomAccess(department,company);
 return {...access,staff:{...access.staff,packingDepartment:department}};
}
export const getPackingLists=webMethod(Permissions.SiteMember,async(company,department)=>{
 const access=await workroom(company,department),view=await readPackingWorkroom(company,access.staff);
 if(department==='WAREHOUSE')return view;
 const tasks=view.tasks.filter(row=>access.can('VIEW',row.customerId)),ids=new Set(tasks.map(row=>row.taskId));
 return {...view,tasks,lists:view.lists.filter(row=>access.can('VIEW',row.customerId)),
  portions:view.portions.filter(row=>access.can('VIEW',row.customerId)),
  deskSummaries:view.deskSummaries.filter(row=>ids.has(row.taskId)),
  pendingResolutions:view.pendingResolutions.filter(row=>access.can('VIEW',row.customerId)),
  pendingAuthorizations:view.pendingAuthorizations.filter(row=>access.can('VIEW',row.input?.customerId))};
});
export const savePackingList=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 const access=await workroom(company,department),staff=access.staff;
 if(department==='WAREHOUSE'||input?.action==='DESK_SEND')access.require('EDIT',input?.customerId);
 else{
  if(typeof input?.id!=='string'||!input.id||input.id.length>160)throw Error('Select a valid Desk task.');
  const row=await fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,input.id,'PACKING_CURRENT'));
  const list=row&&readPackingLists([row],company)[0];
  if(!list||list.id!==input.id)throw Error('This Desk is unavailable.');
  access.require('EDIT',list.customerId);
 }
 try{return await savePackingOperation({company,staff,requestId,input});}
 catch(error){if(error?.message===PROCUREMENT_SAVE_PENDING)return {ok:false,requestId,retryable:true,error:PROCUREMENT_SAVE_PENDING};const message=String(error?.message||'');const validation=/^(Desk|This Desk|This task|Packing |Stock or packing |Choose |Quantity |Usable |Warehouse (must |choose |photo (format |content |task |identity |history )|confirm |evidence )|This action |Only |Resolve |Explain |Loaded must |Confirm every |Start Warehouse |A processing |A pending |Unknown packing |Verified packing |This list |Master staff |Select |A save is still processing|This save identity)/.test(message);return {ok:false,requestId,retryable:!validation||message.startsWith('A save is still processing'),error:validation?message:'Packing save is unconfirmed. Retry this same save.'};}
});
