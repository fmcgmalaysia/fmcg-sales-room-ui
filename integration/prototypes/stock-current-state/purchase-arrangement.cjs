'use strict';
const {hash}=require('./commit-proof.cjs');
const whole=n=>Number.isSafeInteger(n)&&n>=0;
const copy=v=>JSON.parse(JSON.stringify(v));
const action='PURCHASE_ARRANGEMENT_CURRENT';
const identity=(company,taskId,batchId)=>hash(company,taskId,batchId||'WHOLE',action);
// An instruction for Support, not a stock hold, shipment or change of Sales demand.
function arrangementLimit(task,batchId=''){
 const f=task?.stockAllocationFacts;
 if(task?.archived||!f||f.review!==false||!['usable','held','dispatched','availableToArrange'].every(k=>whole(f[k]))
   ||f.usable+f.dispatched!==task.stockAllocatedCumulative||f.availableToArrange!==Math.max(0,f.usable-f.held))throw Error('Current arrangement stock requires review');
 if(!batchId)return f.availableToArrange;
 const batch=task.stockAllocatedBatches?.find(b=>b.id===batchId);
 if(!batch||!whole(batch.allocated)||!whole(batch.demand)||batch.allocated>batch.demand)throw Error('Confirmed arrangement batch required');
 // Until per-batch physical holds are explicit, subtract ALL task holds/shipped
 // amounts. This can restrict availability, but cannot reuse another batch's stock.
 return Math.min(f.availableToArrange,Math.max(0,batch.allocated-f.held-f.dispatched));
}
function prepareArrangement({company,staff,requestId,input,workspace,before,at}){
 if(!['NCT','GHR'].includes(company)||workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'
   ||!staff?.memberId||!staff.staffId||!staff.staffName||workspace.staff?.memberId!==staff.memberId||workspace.staff.staffId!==staff.staffId
   ||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||Object.keys(input).some(k=>!['taskId','batchId','quantity','expectedRevision','reason'].includes(k)))throw Error('Original Purchase arrangement authority required');
 const task=workspace.tasks.find(t=>t.id===input.taskId&&!t.procurementSource&&!t.specialPurchase),batchId=input.batchId||'';
 if(!task||typeof batchId!=='string'||batchId.length>200||!whole(input.quantity)||input.quantity<1||input.quantity>9999
   ||input.quantity>arrangementLimit(task,batchId)||typeof input.expectedRevision!=='string')throw Error('Available arrangement quantity changed');
 const reason=String(input.reason||'').trim();if(!reason||reason.length>1000||typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('Arrangement reason and time required');
 const id=identity(company,task.id,batchId);
 if(before&&(before._id!==id||before.company!==company||before.action!==action||before.details?.taskId!==task.id||before.details.batchId!==batchId||!before._version)
   ||(before?.details?.revision||'')!==input.expectedRevision)throw Error('Arrangement instruction changed');
 const revision=hash(company,requestId,staff.memberId,'ARRANGEMENT');
 const details={taskId:task.id,batchId,customerId:task.customerId,orderId:task.orderId,quantity:input.quantity,
   revision,status:'PENDING_SUPPORT',reason,availableAtApproval:arrangementLimit(task,batchId)};
 const after={_id:id,title:id,company,description:task.orderId,imageAltText:task.id,action,result:'SAVED',actorType:'STAFF',
   initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,details};
 const audit={...copy(after),_id:revision,title:revision,action:'PURCHASE_ARRANGEMENT_REQUESTED',details:{...details,beforeRevision:input.expectedRevision}};
 return {writes:[{collection:company==='NCT'?'NCTActivity':'NCTActivity1',before:copy(before||null),after},
   {collection:company==='NCT'?'NCTActivity':'NCTActivity1',before:null,after:audit}]};
}
function readArrangements(company,activity){
 if(!['NCT','GHR'].includes(company)||!Array.isArray(activity))throw Error('Arrangement company activity required');
 const seen=new Set();
 return activity.filter(r=>r.action===action).map(r=>{
  const d=r.details;
  if(r.company!==company||r.title!==r._id||r.result!=='SAVED'||!d?.taskId||typeof d.batchId!=='string'||r._id!==identity(company,d.taskId,d.batchId)||seen.has(r._id)
    ||r.description!==d.orderId||!d.customerId||!d.revision||d.status!=='PENDING_SUPPORT'||!whole(d.quantity)||d.quantity<1||d.quantity>9999||!d.reason||!r.initiatedByStaffId
    ||typeof r.activityTime!=='string'||!Number.isFinite(Date.parse(r.activityTime)))throw Error('Arrangement instruction requires review');
  seen.add(r._id);return {...copy(d),by:r.initiatedByStaffName,at:r.activityTime};
 });
}
module.exports={arrangementLimit,prepareArrangement,readArrangements,identity};
