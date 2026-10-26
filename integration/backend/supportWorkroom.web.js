import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { requirePackingStaff } from 'backend/packingListContext.js';
import { readSupportBookings, createSupportBookingOperations } from 'backend/supportShipmentBooking.js';
async function supportStaff(){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),'SUPPORT');}
const save=createSupportBookingOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext:readFulfilmentContext});
export const getSupportBookings=webMethod(Permissions.SiteMember,async company=>{await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');return {company,bookings:readSupportBookings(await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),company)};});
export const saveSupportBooking=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{const staff=await supportStaff();return save({company,staff,requestId,input});});
