import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { createPackingListOperations, projectPackingWorkroom } from 'backend/packingListOperations.js';
import { projectPackingContext } from 'backend/packingListContext.js';
import { packingAvailability } from 'backend/packingListModel.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { projectDeskDeliverySummaries, pendingDeskAuthorizations } from 'backend/deskDelivery.js';
import { readSupportDesks, currentSupportDeskState, readSupportDeskLocks, supportDeskBatchId } from 'backend/supportDesk.js';
import { projectWarehouseDeliveryList, projectWarehouseDeliveryReceipt, currentDeskDeliveries } from 'backend/warehouseDeliveryView.js';
import { createShortloadResolutionOperations, pendingShortloadResolutions } from 'backend/shortloadResolution.js';
import { deskTaskPortions, readShortloadResolutions, readDeskCommitments } from 'backend/shortloadResolutionModel.js';
import { readPhysicalOutflows, deskLoadedInvoiceQuantity } from 'backend/physicalOutflow.js';
const readContext=async(company,staff)=>projectPackingContext(await readFulfilmentContext(company,staff));
const saveDeskOperation=createPackingListOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext,documentService:requestPurchaseDocument});
const resolveShortload=createShortloadResolutionOperations({store:fulfilmentStore,names:PURCHASE_COLLECTIONS,readContext});
export async function savePackingOperation(request){if(request.input?.action==='DESK_RESOLVE')return resolveShortload(request);if(!['DESK_SEND','DESK_LOAD','DESK_RECALL','DESK_PHOTOS','DESK_EXPIRY'].includes(request.input?.action))throw Error('Desk delivery must be authorized from Support ENTRY. The standalone Packing List is retired.');const result=await saveDeskOperation(request);return request.staff.packingDepartment==='WAREHOUSE'?projectWarehouseDeliveryReceipt(result):result;}
export async function readPackingWorkroom(company,staff){
 const context=await readContext(company,staff),view=projectPackingWorkroom(context,staff.packingDepartment),locks=readSupportDeskLocks(context.physicalContext),desks=readSupportDesks(context.physicalContext.activity,company).map(state=>currentSupportDeskState(context.physicalContext,state,locks)),issued=locks.filter(row=>row.status==='ISSUED'),lists=view.lists.filter(list=>list.desk).map(list=>{const state=desks.find(row=>row.customerId===list.customerId);const currentAuthorization=Boolean(state?.deliveryHolds?.some(hold=>hold.listId===list.id));return {...list,currentAuthorization,batchComplete:list.status!=='CANCELLED'&&!currentAuthorization&&issued.some(row=>row.customerId===list.customerId&&row.desk===list.desk.number&&(row.snapshot.batchId||supportDeskBatchId({company,customerId:list.customerId},list.desk.number))===(list.desk.batchId||supportDeskBatchId({company,customerId:list.customerId},list.desk.number))),currentDesk:currentAuthorization?{references:state?.references?.find(row=>row.desk===list.desk.number)||null,shipment:state?.shipments.find(row=>row.desk===list.desk.number)||null}:{references:list.desk.references||null,shipment:list.desk.shipment||null}};});
 const common={company,version:view.version,readAt:view.readAt,deskDeliveryVersion:2,staff:{staffName:staff.staffName},department:staff.packingDepartment};
 if(staff.packingDepartment==='WAREHOUSE'){
  const orderImages=new Map(context.physicalContext.tasks.filter(task=>task.productImageUrl).map(task=>[task.id,task]));
  const authorized=currentDeskDeliveries(lists,desks).map(list=>{
   const available=new Map(packingAvailability(context,list.id).map(row=>[row.taskId,row]));
   const lines=list.lines.map(line=>{
    const stock=available.get(line.taskId),orderTask=orderImages.get(line.taskId);
    const productImageUrl=line.productImageUrl||(orderTask&&orderTask.customerId===list.customerId?orderTask.productImageUrl:'');
    return {...line,...(productImageUrl?{productImageUrl}:{}),readyQuantity:stock&&!stock.review?Math.max(0,Math.min((line.resolution?.maximum??line.quantity)-line.loaded,stock.readyToArrange)):0};
   });
   return projectWarehouseDeliveryList({...list,lines});
  });
  return {...common,lists:authorized,completedLists:lists.filter(list=>list.batchComplete).map(projectWarehouseDeliveryList)};
 }
 const physical=context.physicalContext,resolved=new Set([...readShortloadResolutions(physical.activity).map(row=>row.taskId),...desks.flatMap(state=>state.assignments.filter(row=>row.parts).map(row=>row.taskId))]),flows=readPhysicalOutflows(physical.activity);
 const portions=physical.tasks.filter(task=>resolved.has(task.id)||(()=>{const commitment=readDeskCommitments(physical.activity,company,task.id);return commitment.quantity>0&&commitment.quantity<(task.requested??task.ord);})()).flatMap(task=>deskTaskPortions(physical.activity,desks.find(row=>row.customerId===task.customerId),task,flows).map(part=>({...part,taskId:task.id,customerId:task.customerId,invoiced:deskLoadedInvoiceQuantity(physical,task.id,part.desk).reserved})));
 return {...view,...common,lists,portions,deskSummaries:projectDeskDeliverySummaries(physical.activity),pendingResolutions:pendingShortloadResolutions(physical.activity,company,staff.memberId),pendingAuthorizations:pendingDeskAuthorizations(physical.activity,company,staff.memberId)};
}
