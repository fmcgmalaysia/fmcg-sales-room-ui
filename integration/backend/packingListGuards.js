import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
export function packingGuardVersion(context,version){const lists=readPackingLists(context.activity||[],context.company);return lists.length?operationId(version,lists.map(list=>[list.id,list.revision]).sort((a,b)=>a[0].localeCompare(b[0]))):version;}
export function packingTaskHeld(context,taskId){return readPackingLists(context.activity,context.company).reduce((sum,list)=>sum+packingHeld(list,taskId),0);}
export function requirePackingReleased(context,taskIds){
 if(taskIds.some(taskId=>packingTaskHeld(context,taskId)>0))throw Error('Support packing list holds this product. Resolve its packing arrangement before changing this workflow.');
}
export function requirePackingAllocationRetained(context,before,after){
 for(const target of before||[])if((after.find(row=>row.taskId===target.taskId)?.quantity||0)<target.quantity&&packingTaskHeld(context,target.taskId)>0)throw Error('Support packing list holds this allocation. Release or revise the packing list before reallocating.');
}
