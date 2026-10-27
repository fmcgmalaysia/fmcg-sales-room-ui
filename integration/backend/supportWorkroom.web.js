import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext, saveCustomerFulfilment } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { readSupportBookings, createSupportBookingOperations } from 'backend/supportShipmentBooking.js';
import { readSupportInvoiceState, createSupportInvoiceOperations, createSupportInvoiceCancellation } from 'backend/supportInvoice.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { readSupportDocuments, supportDocumentVersion, createSupportDocumentOperations } from 'backend/supportDocuments.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
async function supportStaff(){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),'SUPPORT');}
const save=createSupportBookingOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
export const getSupportBookings=webMethod(Permissions.SiteMember,async company=>{await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');return {company,bookings:readSupportBookings(await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),company)};});
export const saveSupportBooking=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const staff=await supportStaff();return save({company,staff,requestId,input});});

const invoiceDependencies={store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,saveFulfilment:saveCustomerFulfilment,readRates:readCurrentAdminFx};
const saveInvoice=createSupportInvoiceOperations(invoiceDependencies),cancelInvoice=createSupportInvoiceCancellation(invoiceDependencies);
export const getSupportInvoiceState=webMethod(Permissions.SiteMember,async company=>{const staff=await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');return readSupportInvoiceState(await readFulfilmentContext(company,staff),readCurrentAdminFx);});
export const issueSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>saveInvoice({company,staff:await supportStaff(),requestId,input}));
export const withdrawSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>cancelInvoice({company,staff:await supportStaff(),requestId,input}));

const saveDocument=createSupportDocumentOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext,documentService:requestPurchaseDocument});
export const getSupportDocuments=webMethod(Permissions.SiteMember,async company=>{await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');const activity=await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity);return {company,documents:readSupportDocuments(activity,company),version:supportDocumentVersion({company,activity})};});
export const uploadSupportDocument=webMethod(Permissions.SiteMember,async(company,requestId,input)=>saveDocument({company,staff:await supportStaff(),requestId,input}));
