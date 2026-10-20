// Display identity only. Never creates a demand, supplier source, PO or receipt.
import { operationId } from 'backend/purchaseOperationJournal.js';
export const purchaseRowKey=(taskId,batchId='')=>JSON.stringify([taskId,batchId]);
export function purchaseDisplayEntries(tasks,plans,customerId){
 return tasks.filter(task=>!task.archived&&!task.procurementSource&&task.customerId===customerId).flatMap(task=>{
  const plan=plans.find(plan=>plan.customerId===customerId&&plan.orderId===task.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===task.id)));
  const batches=(plan?.batches||[]).flatMap(batch=>{const line=batch.lines.find(line=>line.taskId===task.id);return line?[{key:purchaseRowKey(task.id,plan.id+'|'+batch.sequence),taskId:task.id,quantity:line.quantity,revision:plan.revision||''}]:[];});
  return batches.length>1?batches:[{key:purchaseRowKey(task.id),taskId:task.id,quantity:task.ord,revision:plan?.revision||''}];
 });
}
export function reconcilePurchaseDisplayRows(entries,saved=[]){
 const allowed=new Set(entries.map(row=>row.key)),rows=saved.filter(key=>allowed.has(key));
 for(const entry of entries)if(!rows.includes(entry.key)){const siblings=entries.filter(row=>row.taskId===entry.taskId).map(row=>rows.indexOf(row.key)).filter(index=>index>=0);if(siblings.length)rows.splice(Math.max(...siblings)+1,0,entry.key);else rows.push(entry.key);}
 return rows;
}
export function projectPurchaseDisplayOrder(company,tasks,plans,activity){
 const completed=new Map(activity.filter(row=>row.action==='PURCHASE_OPERATION_RESULT'&&row.result==='SAVED').map(row=>[row.title,row]));
 const saved=activity.filter(row=>{const plan=row.details?.plan,done=completed.get(operationId(row.title,'RESULT'));return row.action==='PURCHASE_OPERATION_PREPARED'&&plan?.displayOrder&&done?.details?.outcome?.ok===true&&done.details.outcome.company===company&&done.details.outcome.requestId===row.details.requestId;});
 const result={};
 for(const customerId of new Set(tasks.filter(row=>!row.archived&&!row.procurementSource).map(row=>row.customerId))){
  const pending=saved.filter(row=>row.details.plan.displayOrder.customerId===customerId);let revision='',order=[];
  while(pending.length){const next=pending.filter(row=>row.details.plan.displayOrder.beforeRevision===revision);if(next.length!==1)throw Error('Purchase row order history requires review.');const event=next[0];revision=event.title;order=event.details.plan.displayOrder.rows;pending.splice(pending.indexOf(event),1);}
  const entries=purchaseDisplayEntries(tasks,plans,customerId),version=operationId(revision,[...entries].sort((a,b)=>a.key.localeCompare(b.key)));
  result[customerId]={revision,version,rows:reconcilePurchaseDisplayRows(entries,order)};
 }
 return result;
}
export function preparePurchaseDisplayOrder(workspace,input){
 const current=workspace.purchaseDisplayOrder[input.customerId],entries=purchaseDisplayEntries(workspace.tasks,workspace.shipmentPlans||[],input.customerId);
 if(!current||input.displayOrderVersion!==current.version)throw Error('Shipment row order changed. Refresh before saving; your draft is retained.');
 const rows=input.displayRows;
 if(!Array.isArray(rows)||rows.length!==entries.length||new Set(rows).size!==rows.length||entries.some(entry=>!rows.includes(entry.key)))throw Error('Row order must include every current shipment row for this customer.');
 return {customerId:input.customerId,beforeRevision:current.revision,beforeVersion:current.version,rows:[...rows]};
}
