import { warehouseCbm } from 'backend/warehouseCbm.js';
import { changePackingList, packingAvailability } from 'backend/packingListModel.js';
import { readSupportDesks, supportDeskForTask, currentSupportDeskLocks, currentSupportDeskState, supportDeskBatchId } from 'backend/supportDesk.js';
import { readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { shortloadStatus, deskTaskPortions, readDeskCommitments, deskMembershipHold, hasDeskMembership, adjustableDeliveryLine } from 'backend/shortloadResolutionModel.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const issues=['DAMAGED','INSUFFICIENT','OTHER'];
const labels={DAMAGED:'Damaged goods',INSUFFICIENT:'Not enough stock',OTHER:'Other'};
export function planDeskDelivery({context,input,actor,id,revision,at}){
 if(actor!=='SUPPORT'||!context.physicalContext||!Number.isSafeInteger(input.desk)||input.desk<1||input.desk>3)throw Error('Desk delivery requires Support and Desk 1, 2 or 3.');
 const physical=context.physicalContext,storedState=readSupportDesks(physical.activity,physical.company).find(row=>row.customerId===input.customerId),state=storedState&&currentSupportDeskState(physical,storedState);
 if(!state||state.revision!==input.deskRevision)throw Error('Desk classification changed. Refresh before sending to Warehouse.');
 if(currentSupportDeskLocks(physical).some(row=>row.customerId===input.customerId&&row.desk===input.desk))throw Error('This Desk is locked by its Sales Invoice.');
 if(context.lists.some(list=>list.customerId===input.customerId&&list.desk?.number===input.desk&&['SENT','PROCESSING'].includes(list.status)))throw Error('This Desk already has an active Warehouse task.');
 const available=packingAvailability(context),tasks=physical.tasks.filter(task=>task.customerId===input.customerId&&!task.archived&&!task.procurementSource&&!task.specialPurchase);
 const totals=new Map();for(const flow of readPhysicalOutflows(physical.activity))totals.set(flow.taskId,(totals.get(flow.taskId)||0)+flow.quantity);
 const flows=readPhysicalOutflows(physical.activity);
 const selected=tasks.map(task=>{const portion=deskTaskPortions(physical.activity,state,task,flows).find(row=>row.desk===input.desk);return {task,quantity:portion?portion.quantity-portion.loaded:0,allocated:portion?portion.planned-portion.loaded:0};}).filter(row=>row.quantity>0);
 if(selected.some(row=>context.lists.some(list=>list.customerId===input.customerId&&list.desk?.number===input.desk&&list.status!=='CANCELLED'&&list.lines.some(line=>line.taskId===row.task.id&&shortloadStatus(physical.activity,list,line).remaining>0))))throw Error('Desk remainder must be resolved or completed in its existing delivery task.');
 if(!selected.length)throw Error('Desk has no remaining task quantities to send.');
 if(!Array.isArray(input.lines)||input.lines.length!==selected.length||new Set(input.lines.map(row=>row.taskId)).size!==selected.length||selected.some(row=>!input.lines.some(line=>line.taskId===row.task.id&&line.quantity===row.quantity)))throw Error('Desk allocation changed. Refresh before sending to Warehouse.');
 if(selected.some(row=>!qty(row.quantity)||(available.find(task=>task.taskId===row.task.id)?.unarranged||0)<row.quantity))throw Error('Desk supply is unavailable or already authorized. Ask Purchase to review it.');
 const currencies=[...new Set(selected.map(row=>row.task.transactionCurrency))];if(currencies.length!==1||!currencies[0])throw Error('Desk tasks must use one confirmed customer currency.');
 const draft=changePackingList({input:{action:'CREATE',company:physical.company,customerId:input.customerId,currency:currencies[0],lines:selected.map(row=>({taskId:row.task.id,quantity:row.quantity}))},context,actor,id,revision,at});
 draft.desk={number:input.desk,taskScope:'ALL'};
 draft.lines=draft.lines.map(line=>({...line,requestedQuantity:line.quantity,quantity:selected.find(row=>row.task.id===line.taskId).allocated}));
 const next=changePackingList({list:draft,input:{action:'SEND',revision},context,actor,id,revision,at});
 next.desk={number:input.desk,taskScope:'ALL',revision:state.revision,batchId:supportDeskBatchId(state,input.desk),references:copy((state.references||[]).find(row=>row.desk===input.desk)||null),shipment:copy(state.shipments.find(row=>row.desk===input.desk)||null)};
 next.lines=next.lines.map(line=>{const task=selected.find(row=>row.task.id===line.taskId).task;return {...line,...(task.productImageUrl?{productImageUrl:task.productImageUrl}:{}),orderId:task.orderId,orderQty:task.requested??task.ord,authorizedTotal:task.supplyAllocation?.planned??task.inc,pricePc:task.sellingPricePc??null,priceCtn:Number.isFinite(task.sellingPricePc)?task.sellingPricePc*task.ea:null,cbm:warehouseCbm(physical.company,task,physical.activity)};});
 return next;
}
// The existing Desk instruction owns visibility. Allocation is derived from the
// same current procurement state and is never posted by this read projection.
export function projectOpenDeskDelivery(context,list){
 if(list.desk?.taskScope!=='ALL'||list.status==='CANCELLED')return list;
 const physical=context.physicalContext,saved=readSupportDesks(physical.activity,physical.company).find(row=>row.customerId===list.customerId),state=saved&&currentSupportDeskState(physical,saved);
 if(!state?.deliveryHolds?.some(hold=>hold.listId===list.id))return list;
 if(currentSupportDeskLocks(physical).some(lock=>lock.status==='ISSUED'&&lock.customerId===list.customerId&&lock.desk===list.desk.number))return list;
 const flows=readPhysicalOutflows(physical.activity);
 const membership=deskMembershipHold(state,list),membershipIds=new Set(Object.keys(membership?.membershipChanges||{}));
 const existing=new Set(list.lines.map(line=>line.taskId));
 const added=physical.tasks.filter(task=>hasDeskMembership(state,list,task.id)&&!existing.has(task.id)&&!task.archived&&!task.procurementSource&&!task.specialPurchase&&task.customerId===list.customerId&&task.transactionCurrency===list.currency).map(task=>({
  taskId:task.id,barcode:task.barcode||'',name:task.name||'',packing:task.packing||'',productImageUrl:task.productImageUrl||'',
  quantity:0,requestedQuantity:0,packed:0,loaded:0,reason:'',photos:[],orderId:task.orderId,orderQty:task.requested??task.ord,
  pricePc:task.sellingPricePc??null,priceCtn:Number.isFinite(task.sellingPricePc)?task.sellingPricePc*task.ea:null,
  cbm:warehouseCbm(physical.company,task,physical.activity)
 }));
 const retiredLines=[...(list.retiredLines||[])],lines=list.lines.concat(added).flatMap(line=>{
  const task=physical.tasks.find(row=>row.id===line.taskId);
  if(!task)return line;
  const parts=deskTaskPortions(physical.activity,state,task,flows),part=parts.find(row=>row.desk===list.desk.number);
  const disposition=shortloadStatus(physical.activity,list,line);
  const allocated=disposition.revision?line.quantity:readDeskCommitments(physical.activity,physical.company,task.id,task,state,flows).batches.find(row=>row.id===list.id)?.quantity||line.loaded;
  const prior=readDeskCommitments(physical.activity,physical.company,task.id).batches.filter(row=>row.id!==list.id&&row.desk===list.desk.number).reduce((sum,row)=>sum+row.quantity,0);
  const modified=(!existing.has(line.taskId)||membershipIds.has(line.taskId))&&adjustableDeliveryLine(physical.activity,list,line);
  const target=Math.max(0,(part?.quantity||0)-prior),requestedQuantity=disposition.revision?line.requestedQuantity:Math.max(line.loaded,modified?target:Math.min(line.requestedQuantity,target));
  if(modified&&!requestedQuantity&&!line.loaded&&!line.packed){
   if(existing.has(line.taskId)&&(line.expiryDate||line.photos?.length||line.loadedConfirmedAt))retiredLines.push({...line,retiredAt:list.sentAt});
   return [];
  }
  const next={...line,quantity:allocated,requestedQuantity,authorizedTotal:task.supplyAllocation?.planned??task.inc,
   ...(!existing.has(line.taskId)||membershipIds.has(line.taskId)?{membershipVersion:operationId(list.id,line.taskId,membership.membershipChanges?.[line.taskId]||'',requestedQuantity,allocated)}:{})};
  if(allocated>line.quantity&&line.loadedConfirmedAt&&line.loaded===line.quantity){next.lastLoadedAt=line.loadedConfirmedAt;delete next.loadedConfirmedAt;}
  next.resolution=shortloadStatus(physical.activity,{...list,lines:[next]},next);
  return next;
 });
 if(!membership)return {...list,lines};
 if(!lines.length)return {...list,lines,retiredLines};
 const reopened=list.status==='COMPLETED'&&lines.some(line=>line.requestedQuantity>line.loaded&&!line.loadedConfirmedAt);
 return {...list,lines,retiredLines,...(reopened?{status:'PROCESSING',completedAt:null}:{})};
}
export function changeDeskDelivery({context,list,input,actor,id,revision,at}){
 if(!list?.desk||list.company!==context.company||!Number.isSafeInteger(list.desk.number))throw Error('Desk-authorized delivery task is required.');
 if(input.revision!==list.revision)throw Error('Desk delivery task changed. Refresh before confirming.');
 if(currentSupportDeskLocks(context.physicalContext).some(lock=>lock.status==='ISSUED'&&lock.customerId===list.customerId&&lock.desk===list.desk.number))throw Error('This Desk is locked by its Sales Invoice.');
 if(input.action==='DESK_RECALL'){
  if(actor!=='SUPPORT'||list.status==='CANCELLED'||list.lines.some(line=>line.loaded>0)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw Error('Desk recall requires Support, zero Loaded cartons and a reason.');
  return {...copy(list),status:'CANCELLED',revision,cancelledAt:at,cancelReason:input.reason.trim()};
 }
 if(actor!=='WAREHOUSE'||!['DESK_LOAD','DESK_EXPIRY','DESK_PHOTOS'].includes(input.action))throw Error('Desk loading requires Warehouse and valid cumulative cartons.');
 if(!readSupportDesks(context.physicalContext.activity,context.company).map(state=>currentSupportDeskState(context.physicalContext,state)).some(state=>state.customerId===list.customerId&&state.deliveryHolds?.some(hold=>hold.desk===list.desk.number&&hold.listId===list.id)))throw Error('Desk delivery is no longer open to Warehouse. Refresh before confirming.');
 if(!list.lines.length)throw Error('Authorized task changed. Refresh and confirm again.');
 if(input.action==='DESK_PHOTOS'){
  if(!Array.isArray(input.attachments)||!input.attachments.length||input.attachments.length>3||(list.photos?.length||0)+input.attachments.length>30)throw Error('Desk accepts at most thirty container photos.');
  return {...copy(list),photos:[...(list.photos||[]),...copy(input.attachments)],revision,updatedAt:at};
 }
 const current=list.lines.find(line=>line.taskId===input.taskId),codes=input.reasonCodes||[],note=typeof input.note==='string'?input.note.trim():'';
 if(!current||(current.membershipVersion||'')!==(input.membershipVersion||''))throw Error('Authorized task changed. Refresh and confirm again.');
 if(input.action==='DESK_EXPIRY'){
  const date=input.expiryDate;
  if(!current||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1900-01-01'||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Desk enter a valid expiry date.');
  return {...copy(list),lines:list.lines.map(line=>line===current?{...line,expiryDate:date}:line),revision,updatedAt:at};
 }
 if(!qty(input.loaded)||current?.quantity===0)throw Error('Desk wait for stock allocation before loading.');
 const disposition=current&&shortloadStatus(context.physicalContext.activity,list,current);
 if(disposition?.revision&&((input.resolutionRevision||'')!==disposition.revision||input.loaded>disposition.maximum))throw Error('Desk remainder was resolved by Support. Refresh the authorized quantity before loading.');
 if(!current||input.loaded>current.quantity||input.loaded<current.loaded)throw Error('Desk Loaded must stay within authorized cartons and cannot reduce a confirmed outflow.');
 if(!Array.isArray(codes)||codes.length>3||new Set(codes).size!==codes.length||codes.some(code=>!issues.includes(code))||note.length>1000)throw Error('Desk select valid reasons.');
 if(input.loaded!==(disposition?.maximum??current.quantity)&&!codes.length)throw Error('Desk select a reason for the undelivered cartons.');
 const reason=[...codes.map(code=>labels[code]),note].filter(Boolean).join(' · ');let next=copy(list);
 // Validate the remaining authorization through the existing packing rules,
 // then retain the original authorized quantity as historical evidence.
 next.lines=next.lines.map(line=>({...line,quantity:shortloadStatus(context.physicalContext.activity,list,line).maximum}));
 if(next.status==='SENT')next=changePackingList({list:next,input:{action:'START',revision:next.revision},context,actor,id,revision,at});
 if(next.status==='COMPLETED')next=changePackingList({list:next,input:{action:'REOPEN',revision:next.revision,reason:'Confirm additional authorized loading'},context,actor,id,revision,at});
 next=changePackingList({list:next,input:{action:'PROGRESS',revision:next.revision,lines:next.lines.map(line=>({taskId:line.taskId,packed:line.taskId===input.taskId?input.loaded:line.packed,loaded:line.taskId===input.taskId?input.loaded:line.loaded,reason:line.taskId===input.taskId?reason:line.reason}))},context,actor,id,revision,at});
 next.lines=next.lines.map(line=>line.taskId===input.taskId?{...line,loadedConfirmedAt:at,reasonCodes:[...codes],note}:line);
 if(next.lines.every(line=>line.loadedConfirmedAt||line.requestedQuantity===0))next=changePackingList({list:next,input:{action:'COMPLETE',revision:next.revision},context,actor,id,revision,at});
 next.lines=next.lines.map(line=>({...line,quantity:list.lines.find(row=>row.taskId===line.taskId).quantity}));
 return next;
}
export function projectDeskDeliverySummaries(activity){
 const groups=new Map();
 for(const row of activity){const list=row.action==='SUPPORT_PACKING_LIST_CURRENT'?row.details?.list:null;if(!list?.desk||list.status==='CANCELLED')continue;
  for(const line of list.lines){if(!qty(line.authorizedTotal))throw Error('Desk authorized quantity requires review.');const previous=groups.get(line.taskId),latest=!previous||(list.sentAt||'')>=previous.sentAt;groups.set(line.taskId,{taskId:line.taskId,desk:latest?list.desk.number:previous.desk,authorizedQty:latest?line.authorizedTotal:previous.authorizedQty,sentAt:latest?list.sentAt||'':previous.sentAt,confirmed:Boolean(line.loadedConfirmedAt||previous?.confirmed)});}
 }
 if(!groups.size)return [];
 const totals=new Map();for(const flow of readPhysicalOutflows(activity))totals.set(flow.taskId,(totals.get(flow.taskId)||0)+flow.quantity);
 return [...groups.values()].map(({sentAt,...row})=>{const loadedQty=totals.get(row.taskId)||0,states=activity.filter(event=>event.action==='SUPPORT_PACKING_LIST_CURRENT'&&event.details?.list?.desk&&event.details.list.status!=='CANCELLED').flatMap(event=>event.details.list.lines.filter(line=>line.taskId===row.taskId).map(line=>shortloadStatus(activity,event.details.list,line)));return {...row,loadedQty,difference:Math.max(0,row.authorizedQty-loadedQty),issue:states.some(state=>state.issue),pending:states.some(state=>state.pending),resolved:states.some(state=>state.resolved)};});
}
// Restore only this employee's prepared authorization after a lost window/session.
// The original request digest must match; no new identity or guessed payload.
export function pendingDeskAuthorizations(activity,company,memberId){
 return activity.filter(row=>row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.actorMemberId===memberId&&row.details.plan?.deskReservation&&!activity.some(event=>event._id===operationId(row._id,'RESULT'))).map(row=>{
  const list=row.details.plan.record.details.list,input=row.details.plan.authorizationInput;
  if(list.company!==company||input?.action!=='DESK_SEND'||row.details.digest!==operationId({packing:input}))throw Error('Desk authorization recovery requires review.');
  return {requestId:row.details.requestId,input};
 });
}
