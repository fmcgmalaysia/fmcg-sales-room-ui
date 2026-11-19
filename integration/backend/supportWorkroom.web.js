import { PROCUREMENT_SAVE_PENDING } from 'backend/purchasePlan.js';
import { createSupportDeskOperations, readSupportDesks, readSupportDeskLocks, currentSupportDeskState, supportDeskBatchId } from 'backend/supportDesk.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { requestSupportCustomers, readSupportCustomerPaymentTerm } from 'backend/supportCustomerClient.js';
import { webMethod, Permissions } from 'wix-web-module';
import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';
import { fulfilmentStore, readFulfilmentContext, saveCustomerFulfilment } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { readSupportBookings, createSupportBookingOperations } from 'backend/supportShipmentBooking.js';
import { readSupportInvoiceState, createSupportInvoiceOperations, createSupportInvoiceCancellation } from 'backend/supportInvoice.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { readSupportDocuments, supportDocumentVersion, pendingSupportDocumentUploads, createSupportDocumentOperations, supportCustomerFiles, createSupportCustomerDeliveryOperations } from 'backend/supportDocuments.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { readPackingWorkroom } from 'backend/packingListService.js';
async function supportAccess(company){
 const access=await readManagedWorkroomAccess('SUPPORT',company);
 return {...access,staff:{...access.staff,packingDepartment:'SUPPORT'}};
}
async function supportStaff(company,customerId){const access=await supportAccess(company);access.require('EDIT',customerId);return access.staff;}
const visible=(access,rows)=>rows.filter(row=>access.can('VIEW',row.customerId));
function scopedPacking(access,view){
 const tasks=visible(access,view.tasks),ids=new Set(tasks.map(row=>row.taskId));
 return {...view,tasks,lists:visible(access,view.lists),portions:visible(access,view.portions),deskSummaries:view.deskSummaries.filter(row=>ids.has(row.taskId)),pendingResolutions:visible(access,view.pendingResolutions),pendingAuthorizations:view.pendingAuthorizations.filter(row=>access.can('VIEW',row.input?.customerId))};
}
const saveDesk=createSupportDeskOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const save=createSupportBookingOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
function projectSupportBookings(company,staff,activity,access){
  const deskLocks=visible(access,readSupportDeskLocks({company,activity}));
  const preparedInvoices=activity.filter(row=>row.action==='SUPPORT_INVOICE_PREPARED'&&row.details?.desk&&access.can('VIEW',row.image))
    .map(row=>({row,readyId:operationId(row._id,'SUPPORT_INVOICE_INPUT_SAVED')}));
  const invoiceInputs=new Map(preparedInvoices.map(({readyId})=>[readyId,null]));
  if(invoiceInputs.size){
    for(const row of activity){
      const title=row.title;
      if(invoiceInputs.get(title)===null) invoiceInputs.set(title,row);
    }
  }
  const invoiceDesks=preparedInvoices.flatMap(({row,readyId})=>{const ready=invoiceInputs.get(readyId);return ready?[{invoiceId:ready.description,desk:{...row.details.desk,batchId:row.details.desk.batchId||supportDeskBatchId({company,customerId:row.image},row.details.desk.number)}}]:[];});return {company,bookings:visible(access,readSupportBookings(activity,company)),desks:visible(access,readSupportDesks(activity,company)).map(state=>{const current=currentSupportDeskState({company,activity},state,deskLocks);return {...current,batches:[1,2,3].map(desk=>({desk,id:supportDeskBatchId(current,desk),initialId:supportDeskBatchId({company,customerId:current.customerId},desk)}))};}),deskLocks,pendingDeskInvoices:deskLocks.filter(row=>row.status==='PENDING'&&row.memberId===staff.memberId&&row.input).map(row=>({customerId:row.customerId,desk:row.desk,requestId:row.requestId,input:row.input})),deskMetadataVersion:2,invoiceDesks};
}
export const getSupportBookings=webMethod(Permissions.SiteMember,async company=>{
  const access=await supportAccess(company),staff=access.staff;
  if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
  return projectSupportBookings(company,staff,await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),access);
});
export const getSupportDeskRefresh=webMethod(Permissions.SiteMember,async company=>{
  const access=await supportAccess(company),staff=access.staff;
  if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
  const activityRead=fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity);
  const [packing,bookings]=await Promise.allSettled([
    readPackingWorkroom(company,staff,{activityRead}).then(view=>scopedPacking(access,view)),
    activityRead.then(activity=>projectSupportBookings(company,staff,activity,access))
  ]);
  const response=outcome=>outcome.status==='fulfilled'?{ok:true,value:outcome.value}:{ok:false};
  return {packing:response(packing),bookings:response(bookings)};
});
export const saveSupportBooking=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const staff=await supportStaff(company,input?.customerId);try{return await (['DESK_ASSIGN','DESK_SPLIT','DESK_SHIPMENT','DESK_REFERENCES','DESK_ARCHIVE','DESK_ORDER'].includes(input?.action)?saveDesk:save)({company,staff,requestId,input});}catch(error){if(error?.message===PROCUREMENT_SAVE_PENDING)return {ok:false,requestId,retryable:true,error:PROCUREMENT_SAVE_PENDING};throw error;}});

const invoiceDependencies={store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,saveFulfilment:saveCustomerFulfilment,readRates:readCurrentAdminFx,readPaymentTerm:readSupportCustomerPaymentTerm};
const saveInvoice=createSupportInvoiceOperations(invoiceDependencies),cancelInvoice=createSupportInvoiceCancellation(invoiceDependencies);
export const getSupportInvoiceState=webMethod(Permissions.SiteMember,async company=>{const access=await supportAccess(company),context=await readFulfilmentContext(company,access.staff),state=await readSupportInvoiceState(context,readCurrentAdminFx),allowed=new Set(context.tasks.filter(row=>access.can('VIEW',row.customerId)).map(row=>row.id));return {...state,lines:state.lines.filter(row=>allowed.has(row.taskId)),deskLines:state.deskLines.filter(row=>allowed.has(row.taskId))};});
export const issueSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{try{return await saveInvoice({company,staff:await supportStaff(company,input?.customerId),requestId,input});}catch(error){if(error?.message===PROCUREMENT_SAVE_PENDING)return {ok:false,requestId,retryable:true,error:PROCUREMENT_SAVE_PENDING};throw error;}});
export const withdrawSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 const access=await supportAccess(company);
 if(!/^[a-f0-9-]{36}$/i.test(input?.invoiceRequestId||''))throw Error('Select the original invoice request.');
 const intent=await fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,input.invoiceRequestId,access.staff.memberId,'SUPPORT_INVOICE_PREPARED'));
 if(!intent||intent.details?.memberId!==access.staff.memberId)throw Error('This pending invoice is unavailable.');
 access.require('EDIT',intent.image);
 return cancelInvoice({company,staff:access.staff,requestId,input});
});

const saveDocument=createSupportDocumentOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,readCustomers:requestSupportCustomers,documentService:requestPurchaseDocument});
const deliverDocument=createSupportCustomerDeliveryOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,documentService:requestPurchaseDocument});
export const getSupportDocuments=webMethod(Permissions.SiteMember,async company=>{const access=await supportAccess(company),staff=access.staff;const activity=await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),posted=activity.filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED').map(row=>row.details?.document),uploadRequests=new Map(activity.filter(row=>row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.plan?.event?.details?.document).map(row=>[JSON.stringify([row.details.plan.event._id,row.details.plan.event.details.document.sha256]),row.details.requestId])),withFinance=d=>({...d,uploadRequestId:uploadRequests.get(JSON.stringify([d.id,d.sha256]))||'',financeRecorded:posted.some(p=>p&&(p.sourceDocumentId===d.id||p.fileId===d.fileId||p.sha256===d.sha256))});return {company,pendingUploads:pendingSupportDocumentUploads(activity,company,staff).filter(row=>access.can('VIEW',row.context?.customerId)),documents:visible(access,readSupportDocuments(activity,company)).map(withFinance),customerFiles:visible(access,supportCustomerFiles({company,activity})).map(withFinance),version:supportDocumentVersion({company,activity})};});
export const uploadSupportDocument=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 try{return await (input?.action==='DELIVER'?deliverDocument:saveDocument)({company,staff:await supportStaff(company,input?.customerId),requestId,input});}
 catch(error){console.error('SUPPORT_DOCUMENT_FAILURE',error?.name||'Error',error?.message||'Unknown error',error?.stack||'');throw error;}
});

export const getSupportCustomers=webMethod(Permissions.SiteMember,async company=>{const access=await supportAccess(company),result=await requestSupportCustomers({company,staff:access.staff});return {...result,customers:result.customers.filter(row=>access.can('VIEW',row.id))};});
export const saveSupportCustomer=webMethod(Permissions.SiteMember,async(company,requestId,input)=>requestSupportCustomers({company,staff:await supportStaff(company,input?.customerId),requestId,input}));


export const getSupportDeskStatus=webMethod(Permissions.SiteMember,async(company,_lookupId,input)=>{
 const {saveRequestId:requestId,customerId,revision,action}=input||{},names=PURCHASE_COLLECTIONS[company];
 const memberChange=['DESK_ASSIGN','DESK_SPLIT'].includes(action);
 if(!names||!/^[a-f0-9-]{36}$/i.test(requestId||'')||typeof customerId!=='string'||!customerId||customerId.length>160||
    typeof revision!=='string'||revision.length>100||!['DESK_ASSIGN','DESK_SPLIT','DESK_SHIPMENT','DESK_REFERENCES','DESK_ARCHIVE','DESK_ORDER'].includes(action))throw Error('Invalid Desk save identity.');
 const access=await supportAccess(company),staff=access.staff;access.require('VIEW',customerId);
 if(!staff.memberId||!staff.staffId)throw Error('Verified Support employee is required.');
 const missing={ok:false,pending:true,company,requestId};
 if(memberChange){
  const key=operationId(company+'/PURCHASE',requestId,staff.memberId);
  const row=await fulfilmentStore.read(names.activity,operationId(key,'RESULT')),receipt=row?.details?.outcome;
  if(row?.action!=='PURCHASE_OPERATION_RESULT'||row.details?.actorMemberId!==staff.memberId||row.details.actorStaffId!==staff.staffId||
     row.details.requestId!==requestId||receipt?.ok!==true||receipt.company!==company||receipt.requestId!==requestId||receipt.deskState?.customerId!==customerId||receipt.deskState?.company!==company)return missing;
 }else{
  const desk=operationId(company,customerId,'SUPPORT_DESK');
  const row=await fulfilmentStore.read(names.activity,operationId(desk,revision,'NEXT'));
  if(row?.action!=='SUPPORT_DESK_SAVED'||row.result!=='SAVED'||row.image!==customerId||row.description!==desk||row.initiatedByStaffId!==staff.staffId||
     row.details?.memberId!==staff.memberId||row.details.requestId!==requestId||row.details.beforeRevision!==revision||
     row.details.state?.company!==company||row.details.state?.customerId!==customerId)return missing;
 }
 return {ok:true,company,requestId,customerId};
});
