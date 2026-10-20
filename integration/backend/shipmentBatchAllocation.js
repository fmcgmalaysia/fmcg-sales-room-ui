// Customer batch entitlements. Supplier purchases and physical receipts are never copied.
import { operationId } from 'backend/purchaseOperationJournal.js';
const whole=value=>Number.isSafeInteger(value)&&value>=0;
export function allocateBatchMetric(entries,total,key){
 if(!whole(total)||entries.some(row=>!whole(row.quantity)))throw Error('Batch quantities require review.');
 const values=entries.map(()=>0);let remaining=total;
 // Keep saved entitlements first. New demand must not borrow from a later shipment.
 for(let i=0;i<entries.length;i++){
  const held=entries[i].coverage?.[key]??0;
  if(!whole(held)||held>entries[i].quantity)throw Error('Batch entitlement requires review.');
  values[i]=Math.min(remaining,held);remaining-=values[i];
 }
 for(let i=0;i<entries.length&&remaining;i++){const added=Math.min(remaining,entries[i].quantity-values[i]);values[i]+=added;remaining-=added;}
 return values;
}
export function allocateBatchSources(entries,sources){
 const remaining=entries.map(row=>row.quantity),matrix=entries.map(()=>[]);
 if(sources.some(source=>!source.id||!whole(source.quantity))||new Set(sources.map(source=>source.id)).size!==sources.length)throw Error('Batch supplier quantities require review.');
 for(const source of sources){let available=source.quantity;
  for(let i=0;i<entries.length;i++){
   const held=entries[i].sourceCoverage?.find(row=>row.id===source.id)?.quantity??0;
   if(!whole(held))throw Error('Batch supplier entitlement requires review.');
   const quantity=Math.min(available,remaining[i],held);if(quantity)matrix[i].push({id:source.id,quantity});available-=quantity;remaining[i]-=quantity;
  }
  // A source's unused cartons can fill gaps, but not before other saved sources are preserved.
 }
 for(const source of sources){let available=source.quantity-matrix.reduce((sum,row)=>sum+(row.find(item=>item.id===source.id)?.quantity||0),0);
  const preferred=entries.findIndex(row=>row.id===source.batchId),order=entries.map((_,i)=>i);if(preferred>=0)order.unshift(...order.splice(preferred,1));
  for(const i of order){if(!available)break;const quantity=Math.min(available,remaining[i]);if(quantity){const prior=matrix[i].find(row=>row.id===source.id);if(prior)prior.quantity+=quantity;else matrix[i].push({id:source.id,quantity});}available-=quantity;remaining[i]-=quantity;}
 }
 return matrix;
}
export function batchEntries(plan,taskId){return plan.batches.flatMap(batch=>{const line=batch.lines.find(line=>line.taskId===taskId);return line?[{...line,id:plan.id+'|'+batch.sequence,sequence:batch.sequence,label:batch.label}]:[];});}
export function resolveBatchEntitlements(plan,taskId,totals,sources=[]){
 const entries=batchEntries(plan,taskId),metrics={};
 const matrix=allocateBatchSources(entries,sources);
 const anchored=entries.some(row=>row.coverage);
 metrics.committed=sources.some(source=>source.quantity>0)&&anchored?matrix.map(row=>row.reduce((sum,source)=>sum+source.quantity,0)):allocateBatchMetric(entries,totals.committed??0,'committed');
 for(const [key,total] of Object.entries(totals)){if(key==='committed')continue;const capped=entries.map((row,i)=>({...row,quantity:Math.min(row.quantity,metrics.committed[i]),coverage:{...row.coverage,[key]:Math.min(row.coverage?.[key]??0,metrics.committed[i])}}));metrics[key]=allocateBatchMetric(capped,total,key);}
 return entries.map((row,index)=>({...row,metrics:Object.fromEntries(Object.entries(metrics).map(([key,values])=>[key,values[index]])),sources:matrix[index]}));
}
export function preferredSourceBatch(sourceId,activity){return activity.filter(event=>event.imageAltText===sourceId&&event.result==='SAVED'&&['PURCHASE_PLAN_SAVED','PURCHASE_SOURCE_ADDED'].includes(event.action)&&typeof event.details?.shipmentBatchId==='string').sort((a,b)=>String(a.activityTime).localeCompare(String(b.activityTime))).at(-1)?.details.shipmentBatchId||'';}
export function purchaseBatchVersion(workspace,root){return operationId(root.salesDemandRevision||'',root.batchEntitlements,workspace.tasks.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id).map(row=>[row.id,row.procurement?.revision,row.procurement?.totalCtn]));}
export function checkPurchaseBatch(workspace,rootId,input,additional){
 if(!input.shipmentBatchId)return null;
 const root=workspace.tasks.find(row=>row.id===rootId&&!row.procurementSource&&!row.specialPurchase),batch=root?.batchEntitlements?.find(row=>row.id===input.shipmentBatchId);
 if(!batch||input.shipmentBatchVersion!==purchaseBatchVersion(workspace,root))throw Error('Shipment batch changed. Refresh before saving; inputs retained.');
 const sourced=(batch.sources||[]).reduce((sum,row)=>sum+row.quantity,0);
 if(!Number.isSafeInteger(additional)||additional<1||additional>batch.quantity-sourced)throw Error('Purchase quantity exceeds this shipment batch pending quantity.');
 return {shipmentBatchId:batch.id,shipmentBatchVersion:input.shipmentBatchVersion,shipmentDemandRevision:root.salesDemandRevision||''};
}
export function stockBatchEntries(plan,taskId){return batchEntries(plan,taskId).map(row=>{const held=new Map((row.sourceCoverage||[]).map(source=>[source.id,source.quantity]));for(const source of row.stockCoverage||[])held.set(source.id,Math.max(held.get(source.id)||0,source.quantity));return {...row,sourceCoverage:[...held].map(([id,quantity])=>({id,quantity}))};});}
export function resolveBatchStock(plan,taskId,sources){return allocateBatchSources(stockBatchEntries(plan,taskId),sources).map(row=>row.reduce((sum,source)=>sum+source.quantity,0));}
