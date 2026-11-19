'use strict';
const assert=require('node:assert/strict');
function patchDashboard(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'unique receipt review hunk: '+before.slice(0,90));source=source.replace(before,()=>after);};
 replace('  function model(data,orders=[],category=',`  // Presentation only: a historical shortage is retained for Finance, not a new physical issue.
  function receiptReviewEntry(entry,task,po){
    if(!entry.action.startsWith('quantity-case:'))return entry;
    const item=task?.quantityCases?.find(item=>item.id===entry.action.slice(14));
    const planned=item?.planned??task?.procurement?.totalCtn,accepted=item?.accepted??task?.warehouse?.accepted;
    const full=item?.kind==='RECEIPT'&&item.financeRequired&&item.owner==='ACCOUNT'&&item.quantity===0&&Number.isSafeInteger(planned)&&planned>0&&Number.isSafeInteger(accepted)&&accepted>=planned&&task?.warehouse?.hasPhysicalReceipt===true&&!task.warehouse.issue&&!(task.warehouse.stock?.cases||[]).some(item=>item.status!=='RESOLVED');
    if(!full)return entry;
    const risk=po?.reviewRequired===true||po?.paymentHandoff?.reviewStale===true||po?.paymentHandoff?.paymentDue===true||(po?.documentIssues||[]).some(item=>item.status!=='RESOLVED')||Number.isSafeInteger(po?.finance?.balanceCents)&&po.finance.balanceCents<0||(po?.finance?.payments||[]).some(item=>item.confirmed!==true);
    return {...entry,category:risk?'urgent':'blocked',reason:risk?'Receipt complete; financial issue open / 收货已完成，款项风险待处理':'Receipt complete; Finance review pending / 收货已完成，待财务核对'};
  }
  function model(data,orders=[],category=`);
 replace('    signals.entries.forEach((entry,index)=>{',`    signals.entries.forEach((original,index)=>{
      const task=data.tasks.find(row=>row.id===original.id),po=orders.find(row=>row.taskIds?.includes(original.id));
      const entry=receiptReviewEntry(original,task,po);`);
 return source;
}
module.exports={patchDashboard};
