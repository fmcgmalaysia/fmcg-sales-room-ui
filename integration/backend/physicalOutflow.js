import { operationId } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';

const quantity=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const copy=value=>JSON.parse(JSON.stringify(value));
export const loadingOutflowId=(company,kind,id,taskId='')=>operationId(company,kind,id,taskId,'LOADED_OUTFLOW');
function sourcesFor(sources,loaded){
 if(!Array.isArray(sources)||new Set(sources.map(row=>row.sourceTaskId)).size!==sources.length||sources.some(row=>!row.sourceTaskId||!quantity(row.quantity)||!row.quantity)||sources.reduce((sum,row)=>sum+row.quantity,0)!==loaded)throw Error('Loaded stock sources require reconciliation.');
 return copy(sources);
}
// The one physical-consumption projection. New Dispatch writes never create a
// movement. Old completed dispatch receipts are immutable historical facts in
// this same projection, not a second balance or a fallback for a new save.
export function readPhysicalOutflows(activity){
 const shipments=readCustomerShipments(activity),flows=[],unmapped=new Map();
 for(const shipment of shipments.filter(row=>row.status==='DISPATCHED'))for(const line of shipment.lines){
  if(line.physicalOutflowRefs!==undefined)continue;
  flows.push({id:loadingOutflowId(shipment.company,'HISTORICAL_DISPATCH',shipment.id,line.taskId),kind:'HISTORICAL',company:shipment.company,customerId:shipment.customerId,taskId:line.taskId,quantity:line.quantity,sources:sourcesFor(line.sources,line.quantity),invoiceReady:false,historicalInvoiceId:shipment.id});
 }
 const states=new Map(),pending=activity.filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED'&&row.result==='SAVED');
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Warehouse preparation history requires review.');
  for(const row of next){const state=row.details?.state;
   if(!state||state.id!==row.description||!row.title||!state.taskId||!state.customerId||!['NCT','GHR'].includes(state.company)||!quantity(state.loaded))throw Error('Loaded identity requires review.');
   states.set(state.id,{...state,revision:row.title});pending.splice(pending.indexOf(row),1);
  }
 }
 function append(kind,loadingId,state,line){
  if(!quantity(line.loaded))throw Error('Loaded quantity requires review.');
  if(!line.loaded)return;
  if(line.physicalSources===undefined){const key=state.company+'|'+line.taskId;unmapped.set(key,(unmapped.get(key)||[]).concat({kind,loadingId,company:state.company,customerId:state.customerId,taskId:line.taskId,loaded:line.loaded}));return;}
  flows.push({id:loadingOutflowId(state.company,kind,loadingId,line.taskId),kind,loadingId,company:state.company,customerId:state.customerId,taskId:line.taskId,quantity:line.loaded,sources:sourcesFor(line.physicalSources,line.loaded),invoiceReady:kind==='WAREHOUSE'||state.status==='COMPLETED'&&!state.change});
 }
 for(const state of states.values())append('WAREHOUSE',state.id,state,state);
 const lists=new Set();
 for(const row of activity.filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT')){const list=row.details?.list;
  if(!list||!['NCT','GHR'].includes(list.company)||row._id!==operationId(list.company,list.id,'PACKING_CURRENT')||lists.has(list.id)||!list.customerId||!Array.isArray(list.lines))throw Error('Packing loading identity requires review.');
  lists.add(list.id);for(const line of list.lines)append('PACKING',list.id,list,line);
 }
 // Historical preparation without source attribution can only be absorbed by
 // already completed historical dispatch evidence. Never guess an unposted source.
 for(const [key,rows] of unmapped){const row=rows[0],history=flows.filter(flow=>flow.kind==='HISTORICAL'&&flow.company+'|'+flow.taskId===key);if(rows.length!==1||row.kind!=='WAREHOUSE'||row.loadingId!==operationId(row.company,row.taskId,'WHOLE')||history.some(flow=>flow.customerId!==row.customerId)||row.loaded!==history.reduce((sum,flow)=>sum+flow.quantity,0))throw Error('Existing Loaded stock requires source reconciliation before continuing.');}
 if(new Set(flows.map(row=>row.id)).size!==flows.length)throw Error('Duplicate physical outflow identity.');
 return flows;
}
export function physicalOutflowQuantity(activity,{sourceTaskId,taskId}={}){
 return readPhysicalOutflows(activity).filter(row=>!taskId||row.taskId===taskId).reduce((sum,row)=>sum+(sourceTaskId?row.sources.filter(source=>source.sourceTaskId===sourceTaskId).reduce((n,source)=>n+source.quantity,0):row.quantity),0);
}
export function physicalOutflowVersion(activity){return operationId(readPhysicalOutflows(activity));}
export function assertLoadedOutflows(context,movements){
 if(new Set(movements.map(row=>row.id)).size!==movements.length)throw Error('Duplicate Loaded movement.');
 const replaced=new Set(movements.map(row=>row.id)),flows=readPhysicalOutflows(context.activity).filter(row=>!replaced.has(row.id)).concat(movements);
 const totals=new Map();
 for(const flow of flows)for(const source of sourcesFor(flow.sources,flow.quantity))totals.set(source.sourceTaskId,(totals.get(source.sourceTaskId)||0)+source.quantity);
 for(const [sourceId,total] of totals){const source=context.tasks.find(row=>row.id===sourceId);if(!source?.warehouse?.hasPhysicalReceipt||!Number.isSafeInteger(source.warehouse.stock?.usableReceived)||total>source.warehouse.stock.usableReceived)throw Error('Loaded batch exceeds usable physical receipts.');}
}

// Freeze the original explicit planner sources at the actual Loaded save.
// The original company journal serializes both loading entry points.
export function planLoadedSources(context,{id,taskId,loaded,previous=[],sourceLimits}){
 if(!quantity(loaded))throw Error('Enter valid Loaded cartons.');
 const prior=sourcesFor(previous,previous.reduce((sum,row)=>sum+row.quantity,0)),before=prior.reduce((sum,row)=>sum+row.quantity,0);
 if(loaded<before)throw Error('Loaded cartons have left stock. Use the supervised correction process.');
 if(loaded===before)return prior;
 const task=context.tasks.find(row=>row.id===taskId),flows=readPhysicalOutflows(context.activity);
 if(readCustomerShipments(context.activity).some(row=>row.status!=='CANCELLED'&&row.status!=='DISPATCHED'&&row.lines.some(line=>line.taskId===taskId&&line.physicalOutflowRefs===undefined)))throw Error('An existing shipment requires Loaded source reconciliation before loading again.');
 if(!task||task.procurementSource||task.specialPurchase||task.archived)throw Error('Loaded customer task requires review.');
 const sources=copy(prior);let remaining=loaded-before;
 const allocations=(context.allocations||[]).filter(row=>row.targets.some(target=>target.taskId===taskId)).sort((a,b)=>a.sourceTaskId.localeCompare(b.sourceTaskId));
 for(const allocation of allocations){
  const source=context.tasks.find(row=>row.id===allocation.sourceTaskId),claim=sourceLimits?(sourceLimits.find(row=>row.id===allocation.sourceTaskId)?.quantity||0):allocation.targets.find(row=>row.taskId===taskId).quantity;
  if(!claim)continue;
  if(!source?.warehouse?.hasPhysicalReceipt||source.barcode!==task.barcode||source.packing!==task.packing||source.ea!==task.ea)throw Error('Loaded requires matching, physically received planner sources.');
  const available=source.warehouse.stock?.availablePhysical;
  if(!quantity(available))throw Error('Loaded physical stock requires review.');
  const other=sourceLimits?0:flows.filter(row=>row.id!==id&&row.taskId===taskId).flatMap(row=>row.sources).filter(row=>row.sourceTaskId===source.id).reduce((sum,row)=>sum+row.quantity,0);
  const kept=sources.find(row=>row.sourceTaskId===source.id),take=Math.min(remaining,Math.max(0,claim-other-(kept?.quantity||0)),available);
  if(take){if(kept)kept.quantity+=take;else sources.push({sourceTaskId:source.id,quantity:take});remaining-=take;}
  if(!remaining)break;
 }
 if(remaining)throw Error('Loaded exceeds confirmed physical customer allocation. Ask Purchase to review allocation.');
 return sourcesFor(sources,loaded);
}

export function selectLoadedForInvoice(context,taskId,amount){
 if(!quantity(amount)||!amount)throw Error('Select a positive loaded invoice quantity.');
 const shipments=readCustomerShipments(context.activity).filter(row=>row.status!=='CANCELLED'),refs=[];let remaining=amount;
 for(const flow of readPhysicalOutflows(context.activity).filter(row=>row.company===context.company&&row.taskId===taskId&&row.invoiceReady)){
  const used=shipments.flatMap(row=>row.lines).flatMap(row=>row.physicalOutflowRefs||[]).filter(row=>row.id===flow.id).flatMap(row=>row.sources);
  const sources=[];
  for(const source of flow.sources){const taken=used.filter(row=>row.sourceTaskId===source.sourceTaskId).reduce((sum,row)=>sum+row.quantity,0),take=Math.min(remaining,source.quantity-taken);if(take<0)throw Error('Loaded invoice allocation requires review.');if(take){sources.push({sourceTaskId:source.sourceTaskId,quantity:take});remaining-=take;}}
  if(sources.length)refs.push({id:flow.id,kind:flow.kind,loadingId:flow.loadingId,quantity:sources.reduce((sum,row)=>sum+row.quantity,0),sources});
  if(!remaining)break;
 }
 if(remaining)throw Error('Invoice exceeds confirmed, uninvoiced Loaded cartons.');
 const combined=new Map();for(const ref of refs)for(const source of ref.sources)combined.set(source.sourceTaskId,(combined.get(source.sourceTaskId)||0)+source.quantity);
 return {physicalOutflowRefs:refs,sources:[...combined].map(([sourceTaskId,quantity])=>({sourceTaskId,quantity}))};
}
export function validateInvoiceOutflows(context,shipment){
 const flows=readPhysicalOutflows(context.activity),used=new Map();
 for(const line of shipment.lines){
  if(!Array.isArray(line.physicalOutflowRefs)||!line.physicalOutflowRefs.length)throw Error('This shipment requires confirmed Loaded source reconciliation.');
  const combined=new Map();let total=0;
  for(const ref of line.physicalOutflowRefs){const flow=flows.find(row=>row.id===ref.id);
   if(!flow||flow.company!==context.company||flow.customerId!==shipment.customerId||flow.taskId!==line.taskId||!flow.invoiceReady||!quantity(ref.quantity)||!ref.quantity)throw Error('Shipment Loaded identity requires review.');
   for(const source of sourcesFor(ref.sources,ref.quantity)){const key=ref.id+'|'+source.sourceTaskId,count=(used.get(key)||0)+source.quantity;used.set(key,count);if(count>(flow.sources.find(row=>row.sourceTaskId===source.sourceTaskId)?.quantity||0))throw Error('Shipment exceeds its Loaded sources.');combined.set(source.sourceTaskId,(combined.get(source.sourceTaskId)||0)+source.quantity);}
   total+=ref.quantity;
  }
  if(total!==line.quantity||operationId([...combined].sort())!==operationId(line.sources.map(row=>[row.sourceTaskId,row.quantity]).sort()))throw Error('Shipment source snapshot differs from confirmed Loaded.');
 }
 const active=readCustomerShipments(context.activity).filter(row=>row.status!=='CANCELLED'&&row.id!==shipment.id).concat(shipment),allUsed=new Map();
 for(const row of active)for(const line of row.lines)for(const ref of line.physicalOutflowRefs||[])for(const source of ref.sources){const key=ref.id+'|'+source.sourceTaskId,total=(allUsed.get(key)||0)+source.quantity;allUsed.set(key,total);if(total>(flows.find(flow=>flow.id===ref.id)?.sources.find(item=>item.sourceTaskId===source.sourceTaskId)?.quantity||0))throw Error('Loaded cartons have already been reserved by another invoice.');}
 // Only the exact completed lists referenced by this invoice may transfer their
 // hold to it. Every other list remains protected by the original guard.
 const lists=new Set(shipment.lines.flatMap(line=>line.physicalOutflowRefs).filter(ref=>ref.kind==='PACKING').map(ref=>ref.loadingId));
 // An earlier completed list transfers its hold only after every loaded source
 // is already covered by an active invoice. It must not block the next container.
 for(const row of context.activity.filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT')){const list=row.details?.list;if(list?.company!==context.company||list.customerId!==shipment.customerId||list.status!=='COMPLETED'||list.change)continue;
  if(list.lines.every(line=>!line.loaded||flows.filter(flow=>flow.kind==='PACKING'&&flow.loadingId===list.id&&flow.taskId===line.taskId).some(flow=>flow.quantity===line.loaded&&flow.sources.every(source=>(allUsed.get(flow.id+'|'+source.sourceTaskId)||0)===source.quantity))))lists.add(list.id);
 }
 return {...context,activity:context.activity.filter(row=>!(row.action==='SUPPORT_PACKING_LIST_CURRENT'&&lists.has(row.details?.list?.id)&&row.details.list.status==='COMPLETED'&&!row.details.list.change))};
}
