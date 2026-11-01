import { canonical } from 'backend/purchaseOperationJournal.js';
export function readStockResolutions(activity){
 const pending=activity.filter(event=>event.action==='STOCK_EXCEPTION_RESOLUTION_SAVED'&&event.result==='SAVED'),states=new Map();
 while(pending.length){
  const next=pending.filter(event=>(states.get(event.description)?.revision||'')===event.details?.beforeRevision);
  if(!next.length||new Set(next.map(event=>event.description)).size!==next.length)throw Error('Stock resolution history requires review.');
  for(const event of next){
   const previous=states.get(event.description);
   if(previous?.financeApproval){
    const {revision,...before}=previous,{disposal,...after}=event.details.state||{},approval=previous.financeApproval;
    if(event.details.action!=='DISPOSE'||previous.disposal||approval.outcome!=='LOSS'||approval.stockTakeConfirmed!==true||approval.goodsStatus!=='PRESENT'||disposal?.quantity!==approval.quantity||!disposal.reference||!disposal.byStaffId||!Number.isFinite(Date.parse(disposal.at))||canonical(before)!==canonical(after))throw Error('Closed stock history cannot be rewritten.');
   }
   if(!event.title||!event.description||event.details.state?.caseId!==event.description||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Stock resolution identity requires review.');
   states.set(event.description,{...event.details.state,revision:event.title});pending.splice(pending.indexOf(event),1);
  }
 }
 return states;
}
