export function readStockResolutions(activity){
 const pending=activity.filter(event=>event.action==='STOCK_EXCEPTION_RESOLUTION_SAVED'&&event.result==='SAVED'),states=new Map();
 while(pending.length){
  const next=pending.filter(event=>(states.get(event.description)?.revision||'')===event.details?.beforeRevision);
  if(!next.length||new Set(next.map(event=>event.description)).size!==next.length)throw Error('Stock resolution history requires review.');
  for(const event of next){
   if(!event.title||!event.description||event.details.state?.caseId!==event.description||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime))||states.get(event.description)?.financeApproval)throw Error('Stock resolution identity requires review.');
   states.set(event.description,{...event.details.state,revision:event.title});pending.splice(pending.indexOf(event),1);
  }
 }
 return states;
}
