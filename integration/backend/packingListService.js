import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { createPackingListOperations, projectPackingWorkroom } from 'backend/packingListOperations.js';
import { projectPackingContext } from 'backend/packingListContext.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { projectDeskDeliverySummaries, pendingDeskAuthorizations } from 'backend/deskDelivery.js';
import { readSupportDesks } from 'backend/supportDesk.js';
const readContext=async(company,staff)=>projectPackingContext(await readFulfilmentContext(company,staff));
const saveDeskOperation=createPackingListOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext,documentService:requestPurchaseDocument});
export async function savePackingOperation(request){if(!['DESK_SEND','DESK_LOAD','DESK_RECALL'].includes(request.input?.action))throw Error('Desk delivery must be authorized from Support ENTRY. The standalone Packing List is retired.');return saveDeskOperation(request);}
export async function readPackingWorkroom(company,staff){const context=await readContext(company,staff),view=projectPackingWorkroom(context,staff.packingDepartment),desks=readSupportDesks(context.physicalContext.activity,company);return {...view,lists:view.lists.filter(list=>list.desk).map(list=>{const state=desks.find(row=>row.customerId===list.customerId);return {...list,currentAuthorization:Boolean(state?.deliveryHolds?.some(hold=>hold.listId===list.id)),currentDesk:{references:state?.references?.find(row=>row.desk===list.desk.number)||null,shipment:state?.shipments.find(row=>row.desk===list.desk.number)||null}};}),deskDeliveryVersion:1,deskSummaries:projectDeskDeliverySummaries(context.physicalContext.activity),pendingAuthorizations:staff.packingDepartment==='SUPPORT'?pendingDeskAuthorizations(context.physicalContext.activity,company,staff.memberId):[],staff:{staffName:staff.staffName},department:staff.packingDepartment};}
