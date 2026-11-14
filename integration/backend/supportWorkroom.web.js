import { PROCUREMENT_SAVE_PENDING } from 'backend/purchasePlan.js';
import { createSupportDeskOperations, readSupportDesks, readSupportDeskLocks, currentSupportDeskState, supportDeskBatchId } from 'backend/supportDesk.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { requestSupportCustomers } from 'backend/supportCustomerClient.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext, saveCustomerFulfilment } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { readSupportBookings, createSupportBookingOperations } from 'backend/supportShipmentBooking.js';
import { readSupportInvoiceState, createSupportInvoiceOperations, createSupportInvoiceCancellation } from 'backend/supportInvoice.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { readSupportDocuments, supportDocumentVersion, pendingSupportDocumentUploads, createSupportDocumentOperations, supportCustomerFiles, createSupportCustomerDeliveryOperations } from 'backend/supportDocuments.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
async function supportStaff(){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),'SUPPORT');}
const saveDesk=createSupportDeskOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
const save=createSupportBookingOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
export const getSupportBookings=webMethod(Permissions.SiteMember,async company=>{const staff=await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');const activity=await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),deskLocks=readSupportDeskLocks({company,activity}),invoiceDesks=activity.filter(row=>row.action==='SUPPORT_INVOICE_PREPARED'&&row.details?.desk).flatMap(row=>{const ready=activity.find(item=>item.title===operationId(row._id,'SUPPORT_INVOICE_INPUT_SAVED'));return ready?[{invoiceId:ready.description,desk:{...row.details.desk,batchId:row.details.desk.batchId||supportDeskBatchId({company,customerId:row.image},row.details.desk.number)}}]:[];});return {company,bookings:readSupportBookings(activity,company),desks:readSupportDesks(activity,company).map(state=>{const current=currentSupportDeskState({company,activity},state,deskLocks);return {...current,batches:[1,2,3].map(desk=>({desk,id:supportDeskBatchId(current,desk),initialId:supportDeskBatchId({company,customerId:current.customerId},desk)}))};}),deskLocks,pendingDeskInvoices:deskLocks.filter(row=>row.status==='PENDING'&&row.memberId===staff.memberId&&row.input).map(row=>({customerId:row.customerId,desk:row.desk,requestId:row.requestId,input:row.input})),deskMetadataVersion:2,invoiceDesks};});
export const saveSupportBooking=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const staff=await supportStaff();try{return await (['DESK_ASSIGN','DESK_SPLIT','DESK_SHIPMENT','DESK_REFERENCES','DESK_ARCHIVE'].includes(input?.action)?saveDesk:save)({company,staff,requestId,input});}catch(error){if(error?.message===PROCUREMENT_SAVE_PENDING)return {ok:false,requestId,retryable:true,error:PROCUREMENT_SAVE_PENDING};throw error;}});

const invoiceDependencies={store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,saveFulfilment:saveCustomerFulfilment,readRates:readCurrentAdminFx};
const saveInvoice=createSupportInvoiceOperations(invoiceDependencies),cancelInvoice=createSupportInvoiceCancellation(invoiceDependencies);
export const getSupportInvoiceState=webMethod(Permissions.SiteMember,async company=>{const staff=await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');return readSupportInvoiceState(await readFulfilmentContext(company,staff),readCurrentAdminFx);});
export const issueSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{try{return await saveInvoice({company,staff:await supportStaff(),requestId,input});}catch(error){if(error?.message===PROCUREMENT_SAVE_PENDING)return {ok:false,requestId,retryable:true,error:PROCUREMENT_SAVE_PENDING};throw error;}});
export const withdrawSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>cancelInvoice({company,staff:await supportStaff(),requestId,input}));

const saveDocument=createSupportDocumentOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,readCustomers:requestSupportCustomers,documentService:requestPurchaseDocument});
const deliverDocument=createSupportCustomerDeliveryOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,documentService:requestPurchaseDocument});
export const getSupportDocuments=webMethod(Permissions.SiteMember,async company=>{const staff=await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');const activity=await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),posted=activity.filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'&&row.result==='SAVED').map(row=>row.details?.document),uploadRequests=new Map(activity.filter(row=>row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.plan?.event?.details?.document).map(row=>[JSON.stringify([row.details.plan.event._id,row.details.plan.event.details.document.sha256]),row.details.requestId])),withFinance=d=>({...d,uploadRequestId:uploadRequests.get(JSON.stringify([d.id,d.sha256]))||'',financeRecorded:posted.some(p=>p&&(p.sourceDocumentId===d.id||p.fileId===d.fileId||p.sha256===d.sha256))});return {company,pendingUploads:pendingSupportDocumentUploads(activity,company,staff),documents:readSupportDocuments(activity,company).map(withFinance),customerFiles:supportCustomerFiles({company,activity}).map(withFinance),version:supportDocumentVersion({company,activity})};});
export const uploadSupportDocument=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 try{return await (input?.action==='DELIVER'?deliverDocument:saveDocument)({company,staff:await supportStaff(),requestId,input});}
 catch(error){console.error('SUPPORT_DOCUMENT_FAILURE',error?.name||'Error',error?.message||'Unknown error',error?.stack||'');throw error;}
});

export const getSupportCustomers=webMethod(Permissions.SiteMember,async company=>requestSupportCustomers({company,staff:await supportStaff()}));
export const saveSupportCustomer=webMethod(Permissions.SiteMember,async(company,requestId,input)=>requestSupportCustomers({company,staff:await supportStaff(),requestId,input}));
