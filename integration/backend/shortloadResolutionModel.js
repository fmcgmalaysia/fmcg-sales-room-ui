// One disposition receipt drives all departments. It never creates a physical outflow.
export const SHORTLOAD_ACTION='DESK_SHORTLOAD_RESOLVED';
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const desk=value=>Number.isSafeInteger(value)&&value>=1&&value<=3;
// Customer commitment is the confirmed Desk instruction, not a procurement quote
// or an unconfirmed Desk draft. Transfer removals count once at their origin.
export function readDeskCommitments(activity,company,taskId,task=null,state=null,flows=[]){
 if(!['NCT','GHR'].includes(company)||!taskId)throw Error('Desk commitment identity requires review.');
 const lists=activity.filter(row=>row.action==='SUPPORT_PACKING_LIST_CURRENT').map(row=>row.details?.list).filter(list=>list?.company===company&&list.desk&&list.status!=='CANCELLED'&&list.status!=='DRAFT'&&list.lines?.some(line=>line.taskId===taskId));
 if(new Set(lists.map(list=>list.id)).size!==lists.length)throw Error('Duplicate Desk commitment requires review.');
 const portions=task&&state?deskTaskPortions(activity,state,task,flows):null;
 const batches=lists.map(list=>{
  const line=list.lines.find(line=>line.taskId===taskId),status=shortloadStatus(activity,list,line);
  if(!desk(list.desk.number)||!qty(status.maximum)||!qty(line.loaded)||line.loaded>status.maximum||!Number.isFinite(Date.parse(list.sentAt)))throw Error('Confirmed Desk quantity requires review.');
  let quantity=status.maximum;
  if(portions&&list.desk.taskScope==='ALL'&&state.deliveryHolds?.some(hold=>hold.listId===list.id)&&!status.revision&&!(line.loadedConfirmedAt&&line.loaded<status.maximum)){
   const planned=portions.find(part=>part.desk===list.desk.number)?.planned||0;
   const prior=lists.filter(other=>other.id!==list.id&&other.desk.number===list.desk.number).reduce((sum,other)=>sum+shortloadStatus(activity,other,other.lines.find(row=>row.taskId===taskId)).maximum,0);
   quantity=Math.max(line.loaded,Math.min(line.requestedQuantity,Math.max(0,planned-prior)));
  }
  return {id:list.id,desk:list.desk.number,quantity,loaded:line.loaded,remaining:quantity-line.loaded,at:list.sentAt};
 }).filter(row=>row.quantity>0);
 return {quantity:batches.reduce((n,row)=>n+row.quantity,0),loaded:batches.reduce((n,row)=>n+row.loaded,0),batches};
}
export function shipmentQuantityMetrics(quantity,spec){
 if(!qty(quantity))throw Error('Shipment metric quantity requires review.');
 const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 return {quantity,amountCents:valid(spec?.priceCtn)?Math.round(quantity*spec.priceCtn*100):null,cbm:valid(spec?.cbmPerCtn)?quantity*spec.cbmPerCtn:null,netKg:valid(spec?.netKgPerCtn)?quantity*spec.netKgPerCtn:null,grossKg:valid(spec?.grossKgPerCtn)?quantity*spec.grossKgPerCtn:null,weightBasis:'PRODUCT_SPECIFICATION'};
}
export function deskExpiryDates(activity,taskId){
 const dates=activity.filter(event=>event.action==='SUPPORT_PACKING_LIST_CURRENT'&&event.details?.list?.status!=='CANCELLED')
  .flatMap(event=>event.details.list.lines.filter(line=>line.taskId===taskId&&line.expiryDate).map(line=>line.expiryDate));
 return [...new Set(dates)].sort();
}
export function readShortloadResolutions(activity){
 const pending=activity.filter(row=>row.action===SHORTLOAD_ACTION&&row.result==='SAVED'),states=new Map(),result=[];
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description+'|'+row.imageAltText)||'')===row.details?.beforeResolution);
  if(!next.length||new Set(next.map(row=>row.description+'|'+row.imageAltText)).size!==next.length)throw Error('Desk short-load history requires review.');
  for(const event of next){const d=event.details;
   if(!event.title||event.title!==event._id||!event.description||!event.imageAltText||!event.image||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime))||!d||!['NCT','GHR'].includes(d.company)||d.listId!==event.description||d.taskId!==event.imageAltText||d.customerId!==event.image||!desk(d.desk)||!qty(d.loaded)||!qty(d.quantity)||d.quantity<=d.loaded||!d.loadedConfirmedAt||!Array.isArray(d.parts)||!d.parts.length||d.parts.length>4||d.parts.some(part=>!qty(part.quantity)||!part.quantity||!['CONTINUE','TRANSFER','CANCEL'].includes(part.mode)||part.mode==='TRANSFER'&&(!(part.desk===0||desk(part.desk))||part.desk===d.desk))||new Set(d.parts.map(part=>part.mode+'|'+(part.desk||''))).size!==d.parts.length||d.parts.reduce((n,part)=>n+part.quantity,0)!==d.remaining)throw Error('Desk short-load receipt requires review.');
   states.set(event.description+'|'+event.imageAltText,event.title);result.push({...d,revision:event.title,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName});pending.splice(pending.indexOf(event),1);
  }
 }
 return result;
}
export function shortloadStatus(activity,list,line){
 const records=readShortloadResolutions(activity).filter(row=>row.listId===list.id&&row.taskId===line.taskId),last=records.at(-1);
 const removed=records.flatMap(row=>row.parts).filter(part=>part.mode!=='CONTINUE').reduce((n,part)=>n+part.quantity,0),maximum=line.quantity-removed;
 if(maximum<line.loaded||maximum<0)throw Error('Desk disposition overlaps confirmed loading.');
 const remaining=maximum-line.loaded,continuing=Boolean(remaining&&last&&last.loaded===line.loaded&&last.loadedConfirmedAt===line.loadedConfirmedAt&&last.parts.some(part=>part.mode==='CONTINUE'));
 return {revision:last?.revision||'',maximum,remaining,removed,issue:Boolean(line.loadedConfirmedAt&&remaining&&!continuing),pending:continuing,resolved:Boolean(records.length&&!remaining),parts:records.flatMap(row=>row.parts),at:last?.at||null,by:last?.by||''};
}
// A task retains its original identity; only its quantities are scoped to Desks.
// The sum of portions always equals the existing customer demand/allocation.
export function deskTaskPortions(activity,state,task,flows=[]){
 const assignment=state?.assignments.find(row=>row.taskId===task.id),assigned=assignment?.desk||0;
 const history=readShortloadResolutions(activity).filter(row=>row.taskId===task.id&&row.customerId===task.customerId),anchor=assignment?.dispositionRevision;
 if(anchor&& !history.some(row=>row.revision===anchor))throw Error('Desk disposition snapshot requires review.');
 const records=anchor?history.slice(history.findIndex(row=>row.revision===anchor)+1):history;
 const cancelled=records.flatMap(row=>row.parts).filter(part=>part.mode==='CANCEL').reduce((n,part)=>n+part.quantity,0);
 const quantities=assignment?.parts?new Map(assignment.parts.map(part=>[part.desk,part.quantity])):new Map([[assigned,(task.requested??task.ord??0)+cancelled]]);
 const wholeDeskOpen=activity.some(event=>event.action==='SUPPORT_PACKING_LIST_CURRENT'&&event.details?.list?.desk?.taskScope==='ALL'&&event.details.list.status!=='CANCELLED'&&state?.deliveryHolds?.some(hold=>hold.listId===event.details.list.id)&&event.details.list.lines.some(line=>line.taskId===task.id));
 if(!assignment?.parts&&!records.length&&!wholeDeskOpen&&['NCT','GHR'].includes(state?.company||task.company)){const confirmed=readDeskCommitments(activity,state?.company||task.company,task.id);if(confirmed.quantity>0&&confirmed.quantity<(task.requested??task.ord??0)){quantities.clear();for(const batch of confirmed.batches)quantities.set(batch.desk,(quantities.get(batch.desk)||0)+batch.quantity);quantities.set(0,(task.requested??task.ord)-confirmed.quantity);}}
 for(const record of records)for(const part of record.parts){if(part.mode==='CONTINUE')continue;quantities.set(record.desk,(quantities.get(record.desk)||0)-part.quantity);if(part.mode==='TRANSFER')quantities.set(part.desk,(quantities.get(part.desk)||0)+part.quantity);}
 // A later Sales demand change never silently rewrites a confirmed Desk. Keep
 // its commitment and place the new unconfirmed balance back in awaiting arrangement.
 const demand=task.requested??task.ord??0;
 if(assignment?.parts&&[...quantities.values()].reduce((n,value)=>n+value,0)!==demand){
  const committed=readDeskCommitments(activity,state.company,task.id);quantities.clear();
  for(const batch of committed.batches)quantities.set(batch.desk,(quantities.get(batch.desk)||0)+batch.quantity);
  if(committed.quantity>demand)throw Error('Customer demand is below confirmed Desk quantities.');
  quantities.set(0,demand-committed.quantity);
 }
 // Closing a Desk freezes its confirmed shipment, not an unconfirmed draft
 // balance parked on that Desk. Keep that balance visible for the next shipment.
 for(const lock of (state?.locks||[]).filter(row=>row.taskIds.includes(task.id))){
  const committed=readDeskCommitments(activity,state.company,task.id).batches.filter(row=>row.desk===lock.desk).reduce((n,row)=>n+row.quantity,0),loaded=flows.filter(flow=>flow.taskId===task.id&&(flow.desk??assigned)===lock.desk).reduce((n,flow)=>n+flow.quantity,0),fixed=Math.max(committed,loaded,lock.input?.lines?.find(row=>row.taskId===task.id)?.quantity||0),current=quantities.get(lock.desk)||0;
  if(current<fixed)throw Error('Desk quantity is below its confirmed invoice or loading.');
  if(current>fixed){quantities.set(lock.desk,fixed);quantities.set(0,(quantities.get(0)||0)+current-fixed);}
 }
 const rows=[...quantities].map(([desk,quantity])=>({desk,quantity,loaded:flows.filter(flow=>flow.taskId===task.id&&(flow.desk??assigned)===desk).reduce((n,flow)=>n+flow.quantity,0)})).sort((a,b)=>(a.desk===assigned?-1:b.desk===assigned?1:a.desk-b.desk));
 if(rows.some(row=>!qty(row.quantity)||row.loaded>row.quantity))throw Error('Desk quantities require reconciliation.');
 let available=(task.inc||0)-rows.reduce((n,row)=>n+row.loaded,0),planned=(task.supplyAllocation?.planned??task.inc??0)-rows.reduce((n,row)=>n+row.loaded,0);
 if(available<0)throw Error('Desk allocation is below confirmed loading.');
 return rows.map(row=>{const add=Math.min(available,row.quantity-row.loaded),plan=Math.min(Math.max(0,planned),row.quantity-row.loaded);available-=add;planned-=plan;return {...row,allocated:row.loaded+add,planned:row.loaded+plan};}).filter(row=>row.quantity>0);
}
