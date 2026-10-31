// Read-only provenance for Purchase Info. Never used for stock, availability or save validation.
export function allocationOriginInfo(activity){
 const snapshots=new Map(),steps=[],usedReturns=new Map(),states=new Map();
 for(const event of activity){
  if(event.result!=='SAVED')continue;
  if(['PLANNER_ALLOCATION_SAVED','SALES_ORDER_ADJUSTMENT_SAVED','DESK_SHORTLOAD_RESOLVED'].includes(event.action)){
   const grouped=Array.isArray(event.details?.allocations),changes=grouped?event.details.allocations:event.action==='PLANNER_ALLOCATION_SAVED'?[{...event.details,sourceTaskId:event.imageAltText}]:[];
   for(const change of changes)snapshots.set(grouped?event.title+'|'+change.sourceTaskId:event.title,change);
  }
  if(['PLANNER_ALLOCATION_SAVED','DESK_SHORTLOAD_RESOLVED'].includes(event.action))for(const change of event.details?.loanChanges||[])steps.push({event,change});
 }
 while(steps.length){
  const next=steps.filter(({change})=>(states.get(change.id)?.revision||'')===change.beforeRevision);
  if(!next.length||new Set(next.map(({change})=>change.id)).size!==next.length)return {known:false,loans:[]};
  for(const step of next){
   const {event,change}=step,loan=change.state,old=states.get(change.id);
   if(!loan||!Array.isArray(loan.sources))return {known:false,loans:[]};
   const row=old?{...old,sources:old.sources.map(source=>({...source}))}:{loanId:change.id,borrowerTaskId:loan.borrowerTaskId,borrowerBatchId:loan.borrowerBatchId||'WHOLE',known:true,batchKnown:true,sources:loan.sources.map(source=>({sourceTaskId:source.sourceTaskId,quantity:source.quantity}))};
   if(old&&loan.outstanding<old.outstanding&&event.details.mode!=='REPAY'){
    let left=old.outstanding-loan.outstanding;
    if(event.details.mode!=='RETURN'&&event.action!=='DESK_SHORTLOAD_RESOLVED')row.known=false;
    else for(const source of row.sources){
     const changeSource=event.details.allocations?.find(item=>item.sourceTaskId===source.sourceTaskId);if(!changeSource)continue;
     const before=snapshots.get(changeSource.beforeRevision),beforeTarget=before?.targets?.find(item=>item.taskId===loan.borrowerTaskId),afterTarget=changeSource.targets?.find(item=>item.taskId===loan.borrowerTaskId);
     if(!before){row.known=false;continue;}
     const key=JSON.stringify([event.title,source.sourceTaskId,loan.borrowerTaskId]),used=usedReturns.get(key)||0;
     const decrease=(beforeTarget?.quantity||0)-(afterTarget?.quantity||0),take=Math.min(left,source.quantity,Math.max(0,decrease-used));
     if(take>0){
      if(row.borrowerBatchId!=='WHOLE'||beforeTarget?.batches){const beforeBatch=beforeTarget?.batches?.find(item=>item.id===row.borrowerBatchId)?.quantity||0,afterBatch=afterTarget?.batches?.find(item=>item.id===row.borrowerBatchId)?.quantity||0;if(beforeBatch-afterBatch<take)row.batchKnown=false;}
      source.quantity-=take;left-=take;usedReturns.set(key,used+take);
     }
     if(!left)break;
    }
    if(left)row.known=false;
   }
   row.revision=event.title;row.outstanding=loan.outstanding;states.set(change.id,row);steps.splice(steps.indexOf(step),1);
  }
 }
 return {known:true,loans:[...states.values()].map(({revision,outstanding,...row})=>({...row,repaid:outstanding===0}))};
}
