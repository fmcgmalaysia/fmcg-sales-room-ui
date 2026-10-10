// Supplier plans are immutable activity revisions, not warehouse stock receipts.
export function readPurchasePlan(task, activity) {
  const pending=activity.filter(event=>event.action==='PURCHASE_PLAN_SAVED'&&event.result==='SAVED'&&event.imageAltText===task.title);
  let revision='',totalCtn=null,last=null;
  while(pending.length){
    const next=pending.filter(event=>event.details?.beforeRevision===revision);
    if(next.length!==1)throw Error('Procurement plan history requires review.');
    const event=next[0],details=event.details;
    if(event.description!==task.description||event.image!==task.imageAltText||!event.title||!Number.isSafeInteger(details.totalCtn)||details.totalCtn<1||details.totalCtn>9999)throw Error('Procurement plan identity or quantity requires review.');
    revision=event.title;totalCtn=details.totalCtn;last=event;pending.splice(pending.indexOf(event),1);
  }
  return {revision,totalCtn,extraKind:last?.details?.extraKind||'',supplierId:last?.details?.supplierId||'',updatedAt:last?.activityTime||null,updatedBy:last?.initiatedByStaffName||''};
}
