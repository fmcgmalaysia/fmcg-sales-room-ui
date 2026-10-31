// One disposition receipt drives all departments. It never creates a physical outflow.
export const SHORTLOAD_ACTION='DESK_SHORTLOAD_RESOLVED';
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const desk=value=>Number.isSafeInteger(value)&&value>=1&&value<=3;
export function readShortloadResolutions(activity){
 const pending=activity.filter(row=>row.action===SHORTLOAD_ACTION&&row.result==='SAVED'),states=new Map(),result=[];
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description+'|'+row.imageAltText)||'')===row.details?.beforeResolution);
  if(!next.length||new Set(next.map(row=>row.description+'|'+row.imageAltText)).size!==next.length)throw Error('Desk short-load history requires review.');
  for(const event of next){const d=event.details;
   if(!event.title||event.title!==event._id||!event.description||!event.imageAltText||!event.image||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime))||!d||!['NCT','GHR'].includes(d.company)||d.listId!==event.description||d.taskId!==event.imageAltText||d.customerId!==event.image||!desk(d.desk)||!qty(d.loaded)||!qty(d.quantity)||d.quantity<=d.loaded||!d.loadedConfirmedAt||!Array.isArray(d.parts)||!d.parts.length||d.parts.length>4||d.parts.some(part=>!qty(part.quantity)||!part.quantity||!['CONTINUE','TRANSFER','CANCEL'].includes(part.mode)||part.mode==='TRANSFER'&&(!desk(part.desk)||part.desk===d.desk))||new Set(d.parts.map(part=>part.mode+'|'+(part.desk||''))).size!==d.parts.length||d.parts.reduce((n,part)=>n+part.quantity,0)!==d.remaining)throw Error('Desk short-load receipt requires review.');
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
 const assigned=state?.assignments.find(row=>row.taskId===task.id)?.desk||0;
 const records=readShortloadResolutions(activity).filter(row=>row.taskId===task.id&&row.customerId===task.customerId);
 const cancelled=records.flatMap(row=>row.parts).filter(part=>part.mode==='CANCEL').reduce((n,part)=>n+part.quantity,0);
 const quantities=new Map([[assigned,(task.requested??task.ord??0)+cancelled]]);
 for(const record of records)for(const part of record.parts){if(part.mode==='CONTINUE')continue;quantities.set(record.desk,(quantities.get(record.desk)||0)-part.quantity);if(part.mode==='TRANSFER')quantities.set(part.desk,(quantities.get(part.desk)||0)+part.quantity);}
 const rows=[...quantities].map(([desk,quantity])=>({desk,quantity,loaded:flows.filter(flow=>flow.taskId===task.id&&(flow.desk??assigned)===desk).reduce((n,flow)=>n+flow.quantity,0)})).sort((a,b)=>(a.desk===assigned?-1:b.desk===assigned?1:a.desk-b.desk));
 if(rows.some(row=>!qty(row.quantity)||row.loaded>row.quantity))throw Error('Desk quantities require reconciliation.');
 let available=(task.inc||0)-rows.reduce((n,row)=>n+row.loaded,0);
 if(available<0)throw Error('Desk allocation is below confirmed loading.');
 return rows.map(row=>{const add=Math.min(available,row.quantity-row.loaded);available-=add;return {...row,allocated:row.loaded+add};}).filter(row=>row.quantity>0);
}
