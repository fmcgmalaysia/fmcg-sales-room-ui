import { createOperationJournal, operationId } from 'backend/purchaseOperationJournal.js';
import { packingVersion } from 'backend/packingListOperations.js';
import { readSupportDesks, readSupportDeskLocks } from 'backend/supportDesk.js';
import { readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { customerAllocationContext } from 'backend/customerAllocationContext.js';
import { readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { SHORTLOAD_ACTION, shortloadStatus, readShortloadResolutions } from 'backend/shortloadResolutionModel.js';
const copy=value=>JSON.parse(JSON.stringify(value));
const quantity=value=>Number.isSafeInteger(value)&&value>0&&value<=9999;
// Adapt the authenticated Sales instruction to the very same disposition writer.
// Use the retained snapshot so a retry can recover after the demand already changed.
export function createSalesDeskCancellation(resolve){
 return async request=>{
  const input=request.input,d=input?.deskResolution,n=input?.quantity;
  if(input?.action!=='ADJUST'||input.mode!=='REDUCE'||!d||!quantity(n)||!quantity(d.remaining)||n>d.remaining||d.taskId!==input.taskId||request.staff?.customerId!==input.customerId)throw Error('Select the remaining Desk cartons to cancel.');
  return resolve({...request,input:{action:'DESK_RESOLVE',id:d.id,revision:d.revision,taskId:input.taskId,orderId:input.orderId,version:d.version,deskRevision:d.deskRevision,resolutionRevision:d.resolutionRevision||'',parts:[{mode:'CANCEL',quantity:n},...(n<d.remaining?[{mode:'CONTINUE',quantity:d.remaining-n}]:[])]}});
 };
}

function cancelOwnership(context,task,amount){
 const view=customerAllocationContext(context,context.activity,context.allocations||[],''),sources=copy(view.sources),loans=view.loans.filter(row=>row.borrowerTaskId===task.id&&row.outstanding>0),loanChanges=[];let remaining=amount;
 function cut(target,count){target.quantity-=count;let left=count;for(const batch of [...target.batches].reverse()){const take=Math.min(left,batch.quantity);batch.quantity-=take;left-=take;}if(left)throw Error('Desk stock batch ownership requires review.');}
 // Return unshipped borrowed cartons to their lender before releasing own stock.
 for(const loan of loans){let returned=0;
  for(const borrowed of loan.sources){const source=sources.find(row=>row.id===borrowed.sourceTaskId),own=source?.targets.find(row=>row.taskId===task.id),lender=view.tasks.find(row=>row.id===loan.lenderTaskId),batch=lender?.batches.find(row=>row.id===borrowed.lenderBatchId);
   if(!own||!lender||!batch)continue;
   const occupied=sources.flatMap(row=>row.targets.filter(target=>target.taskId===lender.id)).flatMap(target=>target.batches||[]).filter(row=>row.id===batch.id).reduce((n,row)=>n+row.quantity,0);
   const take=Math.min(remaining,loan.outstanding-returned,borrowed.quantity,Math.max(0,own.quantity-own.protectedQuantity),Math.max(0,batch.quantity-occupied),source.availablePhysical);
   if(!take)continue;cut(own,take);let target=source.targets.find(row=>row.taskId===lender.id);if(!target){target={taskId:lender.id,quantity:0,batches:lender.batches.map(row=>({id:row.id,quantity:0}))};source.targets.push(target);}target.quantity+=take;target.batches.find(row=>row.id===batch.id).quantity+=take;returned+=take;remaining-=take;
  }
  if(returned){const {revision,...state}=loan;loanChanges.push({id:loan.id,beforeRevision:revision,state:{...state,outstanding:state.outstanding-returned}});}
 }
 for(const source of sources){const own=source.targets.find(row=>row.taskId===task.id);if(!own)continue;
  // A still-open borrowing responsibility must never become somebody else's free stock.
  const protectedBorrow=loans.filter(loan=>loan.sources.some(row=>row.sourceTaskId===source.id)).reduce((n,loan)=>n+Math.max(0,(loanChanges.find(row=>row.id===loan.id)?.state.outstanding??loan.outstanding)-readPhysicalOutflows(context.activity).filter(flow=>flow.taskId===task.id).flatMap(flow=>flow.sources).filter(row=>row.sourceTaskId===source.id).reduce((sum,row)=>sum+row.quantity,0)),0);
  const take=Math.min(remaining,Math.max(0,own.quantity-own.protectedQuantity-protectedBorrow));if(take){cut(own,take);remaining-=take;}
 }
 if(remaining)throw Error('Desk cancellation needs Purchase to reconcile the remaining borrowed or reserved stock first.');
 const allocations=sources.filter(source=>operationId(source.targets)!==operationId(view.sources.find(row=>row.id===source.id).targets)).map(source=>({sourceTaskId:source.id,receivedTotalAtSave:source.receivedTotal,beforeRevision:context.allocations.find(row=>row.sourceTaskId===source.id)?.revision||'',targets:source.targets.map(({protectedQuantity,...target})=>{const owner=context.tasks.find(row=>row.id===target.taskId);return {...target,customerId:owner.customerId,orderId:owner.orderId,sourceLineId:owner.sourceLineId};})}));
 return {allocations,loanChanges,sources};
}

function cancellationPlan(context,task,amount,sources){
 const prior=readShipmentPlans(context.activity).find(plan=>plan.customerId===task.customerId&&plan.orderId===task.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===task.id)));
 if(!prior)return {};
 const plan=copy(prior);delete plan.revision;let remaining=amount;
 for(const batch of [...plan.batches].reverse())for(const line of batch.lines.filter(line=>line.taskId===task.id)){
  const bindings=sources.flatMap(source=>source.targets.filter(target=>target.taskId===task.id).flatMap(target=>(target.batches||[]).filter(row=>row.id===plan.id+'|'+batch.sequence).map(row=>({id:source.id,quantity:row.quantity}))));
  const allocated=bindings.reduce((n,row)=>n+row.quantity,0),take=Math.min(remaining,Math.max(0,line.quantity-allocated));line.quantity-=take;remaining-=take;
  if(line.coverage)for(const key of Object.keys(line.coverage))line.coverage[key]=Math.min(line.quantity,line.coverage[key]);
  line.stockCoverage=bindings.filter(row=>row.quantity>0);let limit=line.quantity;line.sourceCoverage=(line.sourceCoverage||[]).map(row=>{const quantity=Math.min(limit,row.quantity);limit-=quantity;return {...row,quantity};}).filter(row=>row.quantity>0);
 }
 if(remaining)throw Error('Desk cancellation does not match the saved shipment batch ownership.');
 for(const batch of plan.batches)batch.lines=batch.lines.filter(line=>line.quantity>0);
 return {plan,beforePlanRevision:prior.revision};
}

export function createShortloadResolutionOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  const support=staff?.packingDepartment==='SUPPORT',sales=staff?.canSelectShipment===true&&Boolean(staff.customerId)&&String(staff.memberId||'').startsWith('SOURCE_SALES/')&&!staff.packingDepartment;
  if(!names[company]||!support&&!sales||input?.action!=='DESK_RESOLVE')throw Error('Desk short-load decisions require Support or authorized Sales cancellation.');
  const legacyCancel=support&&input.parts?.some(part=>part.mode==='CANCEL');
  if(legacyCancel){
   const prepared=await store.read(names[company].activity,operationId(company+'/PURCHASE',requestId,staff.memberId));
   if(prepared?.action!=='PURCHASE_OPERATION_PREPARED'||prepared.details?.actorMemberId!==staff.memberId||prepared.details?.digest!==operationId({shortload:input})||prepared.details?.plan?.event?.action!==SHORTLOAD_ACTION||prepared.details.plan.event.details?.company!==company||prepared.details.plan.event.details?.memberId!==staff.memberId||prepared.details.plan.event.details?.requestId!==requestId||operationId(prepared.details.plan.resolutionInput)!==operationId(input))throw Error('Customer cancellation requires Sales confirmation. Support may continue or transfer the remainder.');
  }
  if(sales&&(!input.parts?.some(part=>part.mode==='CANCEL')||input.parts.some(part=>!['CANCEL','CONTINUE'].includes(part.mode))))throw Error('Sales may confirm customer cancellation only. Support controls shipment batches.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{shortload:input},prepare:async()=>{
   const context=await readContext(company,staff),physical=context.physicalContext,list=context.lists.find(row=>row.id===input.id),line=list?.lines.find(row=>row.taskId===input.taskId),state=physical&&readSupportDesks(physical.activity,company).find(row=>row.customerId===list?.customerId);
   if(context.company!==company||sales&&staff.customerId!==list?.customerId||packingVersion(context)!==input.version||!list?.desk||!['PROCESSING','COMPLETED'].includes(list.status)||!line?.loadedConfirmedAt||!state||state.revision!==input.deskRevision||list.revision!==input.revision)throw Error('Desk loading or assignment changed. Refresh before deciding the remainder.');
   const status=shortloadStatus(physical.activity,list,line),task=physical.tasks.find(row=>row.id===line.taskId&&row.customerId===list.customerId&&!row.archived&&!row.procurementSource&&!row.specialPurchase),locks=readSupportDeskLocks(physical).filter(row=>row.customerId===list.customerId);
   if(!task||input.orderId&&input.orderId!==task.orderId||!status.issue&&!status.pending||status.revision!==(input.resolutionRevision||''))throw Error('Desk has no unresolved short-load quantity.');
   if(locks.some(row=>row.desk===list.desk.number)||state.shipments.find(row=>row.desk===list.desk.number)?.departureDate)throw Error('Desk already invoiced or departed; its loading cannot be changed.');
   if(!Array.isArray(input.parts)||!input.parts.length||input.parts.length>4||input.parts.some(part=>!quantity(part.quantity)||!['CONTINUE','TRANSFER','CANCEL'].includes(part.mode))||input.parts.reduce((n,part)=>n+part.quantity,0)!==status.remaining)throw Error('Desk decisions must cover exactly the remaining cartons.');
   const parts=input.parts.map(part=>({mode:part.mode,quantity:part.quantity,...(part.mode==='TRANSFER'?{desk:part.desk}:{})}));
   const previous=readShortloadResolutions(physical.activity).filter(row=>row.listId===list.id&&row.taskId===task.id).at(-1);
   if(previous&&previous.loaded===line.loaded&&operationId(previous.parts)===operationId(parts))throw Error('Desk remainder decision has not changed.');
   for(const part of parts.filter(part=>part.mode==='TRANSFER'))if(!Number.isSafeInteger(part.desk)||part.desk<0||part.desk>3||part.desk===list.desk.number||locks.some(row=>row.desk===part.desk)||state.shipments.find(row=>row.desk===part.desk)?.departureDate||context.lists.some(row=>row.customerId===list.customerId&&row.desk?.number===part.desk&&['SENT','PROCESSING'].includes(row.status)))throw Error('Desk destination must be another available, unlocked Desk or awaiting arrangement.');
   const cancelled=parts.filter(part=>part.mode==='CANCEL').reduce((n,part)=>n+part.quantity,0),loaded=readPhysicalOutflows(physical.activity).filter(flow=>flow.taskId===task.id).reduce((n,flow)=>n+flow.quantity,0);
   const otherHeld=context.lists.filter(row=>row.id!==list.id&&['SENT','PROCESSING'].includes(row.status)).flatMap(row=>row.lines.filter(line=>line.taskId===task.id)).reduce((n,line)=>n+Math.max(0,(line.resolution?.maximum??line.quantity)-line.loaded),0);
   const release=Math.min(cancelled,Math.max(0,(task.inc||0)-loaded-otherHeld));
   const changes=cancelled?cancelOwnership(physical,task,release):{allocations:[],loanChanges:[]};
   const demand=cancelled?{beforeDemandRevision:task.salesDemandRevision||'',beforeRequested:task.requested??task.ord,requested:(task.requested??task.ord)-cancelled}:null;
   if(demand&&demand.requested<readPhysicalOutflows(physical.activity).filter(flow=>flow.taskId===task.id).reduce((n,flow)=>n+flow.quantity,0))throw Error('Desk cannot cancel loaded customer demand.');
   const plan=cancelled?cancellationPlan(physical,task,cancelled,changes.sources):{},at=now().toISOString(),id=operationId(operationId(company,list.customerId,'SUPPORT_DESK'),state.revision,'NEXT'),savedState=copy(state);delete savedState.revision;
   const event={_id:id,title:id,description:list.id,image:list.customerId,imageAltText:task.id,action:SHORTLOAD_ACTION,result:'SAVED',actorType:'STAFF',activityTime:at,initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Support resolved undelivered Desk cartons',details:{company,listId:list.id,taskId:task.id,customerId:list.customerId,desk:list.desk.number,quantity:line.quantity,loaded:line.loaded,loadedConfirmedAt:line.loadedConfirmedAt,remaining:status.remaining,parts,beforeResolution:status.revision,allocations:changes.allocations,loanChanges:changes.loanChanges,...(demand?{demand}:{}),...plan,deskBeforeRevision:state.revision,state:savedState,memberId:staff.memberId,requestId,digest:operationId(input)}};
   readShortloadResolutions(physical.activity.concat(event));
   return {expectedVersion:input.version,resolutionInput:copy(input),event};
  },apply:async plan=>{
   const collection=names[company].activity,existing=await store.read(collection,plan.event._id),conflict=()=>({ok:false,company,requestId,retryable:false,error:'Desk changed while resolving the remainder. Refresh and choose a new decision.'});
   if(existing){if(operationId(existing.details)!==operationId(plan.event.details))return conflict();}
   else if(legacyCancel)return {ok:false,company,requestId,retryable:false,error:'This unsaved cancellation now requires Sales confirmation. No customer demand was cancelled.'};
   else{const context=await readContext(company,staff);if(packingVersion(context)!==plan.expectedVersion)return conflict();try{await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}catch(error){const saved=await store.read(collection,plan.event._id);if(saved&&operationId(saved.details)!==operationId(plan.event.details))return conflict();throw error;}}
   return {ok:true,company,requestId,resolutionId:plan.event.title,id:plan.event.description,taskId:plan.event.imageAltText,parts:plan.event.details.parts};
  }});
 };
}
export function pendingShortloadResolutions(activity,company,memberId){
 return activity.filter(row=>row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.actorMemberId===memberId&&row.details.plan?.event?.action===SHORTLOAD_ACTION&&!activity.some(event=>event._id===operationId(row._id,'RESULT'))).map(row=>{const input=row.details.plan.resolutionInput,event=row.details.plan.event;if(event.details.company!==company||input?.action!=='DESK_RESOLVE'||row.details.digest!==operationId({shortload:input}))throw Error('Desk remainder recovery requires review.');return {requestId:row.details.requestId,customerId:event.image,desk:event.details.desk,input};});
}
