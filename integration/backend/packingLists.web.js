import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { savePackingOperation, readPackingWorkroom } from 'backend/packingListService.js';
async function staffContext(department){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),department);}
export const getPackingLists=webMethod(Permissions.SiteMember,async(company,department)=>readPackingWorkroom(company,await staffContext(department)));
export const savePackingList=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 const staff=await staffContext(department);
 try{return await savePackingOperation({company,staff,requestId,input});}
 catch(error){const message=String(error?.message||'');const validation=/^(Packing |Stock or packing |Choose |Quantity |Usable |Warehouse must |This action |Only |Resolve |Explain |Loaded must |Confirm every |Start Warehouse |A processing |A pending |Unknown packing |Verified packing |This list |Master staff |Select |A save is still processing|This save identity)/.test(message);return {ok:false,requestId,retryable:!validation||message.startsWith('A save is still processing'),error:validation?message:'Packing save is unconfirmed. Retry this same save.'};}
});
