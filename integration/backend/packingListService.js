import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { createPackingListOperations, projectPackingWorkroom } from 'backend/packingListOperations.js';
import { projectPackingContext } from 'backend/packingListContext.js';
const readContext=async(company,staff)=>projectPackingContext(await readFulfilmentContext(company,staff));
export const savePackingOperation=createPackingListOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext});
export async function readPackingWorkroom(company,staff){const context=await readContext(company,staff);return {...projectPackingWorkroom(context,staff.packingDepartment),staff:{staffName:staff.staffName},department:staff.packingDepartment};}
