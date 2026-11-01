import { operationId } from 'backend/purchaseOperationJournal.js';
const fields=['supplierId','lpPc','lpCtn','disc1','disc2','disc3','ourPoNumber','rowPosition','purchaseStage','purchaseQtyInCtn','specialPurchase','specialPurchaseReason','risk','riskReason','manualCostField'];
export const taskEditVersion = row => operationId(fields.map(key=>[key,row[key]??null]));
export function acceptedSpecialTask(task,order,receipt,event,parent) {
  return task.specialPurchase===true && event?.action==='SPECIAL_PURCHASE_ADDED' && event.result==='SAVED' &&
    event.imageAltText===task.title && event.description===task.description && event.image===task.imageAltText &&
    event.details?.submissionId===order?.submissionId && receipt?.submissionId===order?.submissionId &&
    receipt.ids.has(event.details?.parentTaskId) && parent?.title===event.details.parentTaskId &&
    parent.description===task.description && parent.imageAltText===task.imageAltText;
}
