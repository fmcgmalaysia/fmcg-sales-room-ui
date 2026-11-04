import { fulfilmentStore, readFulfilmentContext } from 'backend/r2customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/r2purchaseProjection.js';
import { createPackingListOperations, projectPackingWorkroom } from 'backend/r2packingListOperations.js';
import { projectPackingContext } from 'backend/r2packingListContext.js';
import { requestPurchaseDocument } from 'backend/r2purchaseDocumentClient.js';
const readContext=async(company,staff)=>projectPackingContext(await readFulfilmentContext(company,staff));
export const savePackingOperation=createPackingListOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext,documentService:requestPurchaseDocument});
export async function readPackingWorkroom(company,staff){const context=await readContext(company,staff);return {...projectPackingWorkroom(context,staff.packingDepartment),staff:{staffName:staff.staffName},department:staff.packingDepartment};}
