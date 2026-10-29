import { changePackingList, packingAvailability } from 'backend/packingListModel.js';
import { readSupportDesks, supportDeskForTask, readSupportDeskLocks } from 'backend/supportDesk.js';
import { readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { operationId } from 'backend/purchaseOperationJournal.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
const issues=['DAMAGED','INSUFFICIENT','OTHER'];
const labels={DAMAGED:'Damaged goods',INSUFFICIENT:'Not enough stock',OTHER:'Other'};
export function planDeskDelivery({context,input,actor,id,revision,at}){
 if(actor!=='SUPPORT'||!context.physicalContext||!Number.isSafeInteger(input.desk)||input.desk<1||input.desk>3)throw Error('Desk delivery requires Support and Desk 1, 2 or 3.');
 const physical=context.physicalContext,state=readSupportDesks(physical.activity,physical.company).find(row=>row.customerId===input.customerId);
 if(!state||state.revision!==input.deskRevision)throw Error('Desk classification changed. Refresh before sending to Warehouse.');
 if(readSupportDeskLocks(physical).some(row=>row.customerId===input.customerId&&row.desk===input.desk))throw Error('This Desk is locked by its Sales Invoice.');
 if(context.lists.some(list=>list.customerId===input.customerId&&list.desk?.number===input.desk&&['SENT','PROCESSING'].includes(list.status)))throw Error('This Desk already has an active Warehouse task.');
 const available=packingAvailability(context),tasks=physical.tasks.filter(task=>task.customerId===input.customerId&&!task.archived&&!task.procurementSource&&!task.specialPurchase&&supportDeskForTask(state,task.id)===input.desk);
 const totals=new Map();for(const flow of readPhysicalOutflows(physical.activity))totals.set(flow.taskId,(totals.get(flow.taskId)||0)+flow.quantity);
 const selected=tasks.map(task=>({task,quantity:Math.max(0,(task.inc||0)-(totals.get(task.id)||0))})).filter(row=>row.quantity>0);
 if(!selected.length)throw Error('Desk has no remaining allocated cartons to send.');
 if(!Array.isArray(input.lines)||input.lines.length!==selected.length||new Set(input.lines.map(row=>row.taskId)).size!==selected.length||selected.some(row=>!input.lines.some(line=>line.taskId===row.task.id&&line.quantity===row.quantity)))throw Error('Desk allocation changed. Refresh before sending to Warehouse.');
 if(selected.some(row=>!qty(row.quantity)||(available.find(task=>task.taskId===row.task.id)?.readyToArrange||0)<row.quantity))throw Error('Desk allocated stock is unavailable or already authorized. Ask Purchase to review it.');
 const currencies=[...new Set(selected.map(row=>row.task.transactionCurrency))];if(currencies.length!==1||!currencies[0])throw Error('Desk tasks must use one confirmed customer currency.');
 const draft=changePackingList({input:{action:'CREATE',company:physical.company,customerId:input.customerId,currency:currencies[0],lines:selected.map(row=>({taskId:row.task.id,quantity:row.quantity}))},context,actor,id,revision,at});
 const next=changePackingList({list:draft,input:{action:'SEND',revision},context,actor,id,revision,at});
 next.desk={number:input.desk,revision:state.revision,references:copy((state.references||[]).find(row=>row.desk===input.desk)||null),shipment:copy(state.shipments.find(row=>row.desk===input.desk)||null)};
 next.lines=next.lines.map(line=>{const task=selected.find(row=>row.task.id===line.taskId).task;return {...line,orderId:task.orderId,orderQty:task.requested??task.ord,authorizedTotal:task.inc,pricePc:task.sellingPricePc??null,priceCtn:Number.isFinite(task.sellingPricePc)?task.sellingPricePc*task.ea:null,cbm:task.cbmPerCtn??null};});
 return next;
}
export function changeDeskDelivery({context,list,input,actor,id,revision,at}){
 if(!list?.desk||list.company!==context.company||!Number.isSafeInteger(list.desk.number))throw Error('Desk-authorized delivery task is required.');
 if(input.revision!==list.revision)throw Error('Desk delivery task changed. Refresh before confirming.');
 if(input.action==='DESK_RECALL'){
  if(actor!=='SUPPORT'||list.status==='CANCELLED'||list.lines.some(line=>line.loaded>0)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw Error('Desk recall requires Support, zero Loaded cartons and a reason.');
  return {...copy(list),status:'CANCELLED',revision,cancelledAt:at,cancelReason:input.reason.trim()};
 }
 if(actor!=='WAREHOUSE'||input.action!=='DESK_LOAD'||!qty(input.loaded))throw Error('Desk loading requires Warehouse and valid cumulative cartons.');
 const current=list.lines.find(line=>line.taskId===input.taskId),codes=input.reasonCodes||[],note=typeof input.note==='string'?input.note.trim():'';
 if(!current||input.loaded>current.quantity||input.loaded<current.loaded)throw Error('Desk Loaded must stay within authorized cartons and cannot reduce a confirmed outflow.');
 if(!Array.isArray(codes)||codes.length>3||new Set(codes).size!==codes.length||codes.some(code=>!issues.includes(code))||note.length>1000||codes.includes('OTHER')&&!note)throw Error('Desk select valid reasons and explain Other.');
 if(input.loaded!==current.quantity&&!codes.length)throw Error('Desk select a reason for the undelivered cartons.');
 const reason=[...codes.map(code=>labels[code]),note].filter(Boolean).join(' · ');let next=copy(list);
 if(next.status==='SENT')next=changePackingList({list:next,input:{action:'START',revision:next.revision},context,actor,id,revision,at});
 if(next.status==='COMPLETED')next=changePackingList({list:next,input:{action:'REOPEN',revision:next.revision,reason:'Confirm additional authorized loading'},context,actor,id,revision,at});
 next=changePackingList({list:next,input:{action:'PROGRESS',revision:next.revision,lines:next.lines.map(line=>({taskId:line.taskId,packed:line.taskId===input.taskId?input.loaded:line.packed,loaded:line.taskId===input.taskId?input.loaded:line.loaded,reason:line.taskId===input.taskId?reason:line.reason}))},context,actor,id,revision,at});
 next.lines=next.lines.map(line=>line.taskId===input.taskId?{...line,loadedConfirmedAt:at,reasonCodes:[...codes],note}:line);
 if(next.lines.every(line=>line.loadedConfirmedAt))next=changePackingList({list:next,input:{action:'COMPLETE',revision:next.revision},context,actor,id,revision,at});
 return next;
}
export function projectDeskDeliverySummaries(activity){
 const groups=new Map();
 for(const row of activity){const list=row.action==='SUPPORT_PACKING_LIST_CURRENT'?row.details?.list:null;if(!list?.desk||list.status==='CANCELLED')continue;
  for(const line of list.lines){if(!qty(line.authorizedTotal))throw Error('Desk authorized quantity requires review.');const previous=groups.get(line.taskId),latest=!previous||(list.sentAt||'')>=previous.sentAt;groups.set(line.taskId,{taskId:line.taskId,desk:latest?list.desk.number:previous.desk,authorizedQty:latest?line.authorizedTotal:previous.authorizedQty,sentAt:latest?list.sentAt||'':previous.sentAt,confirmed:Boolean(line.loadedConfirmedAt||previous?.confirmed)});}
 }
 if(!groups.size)return [];
 const totals=new Map();for(const flow of readPhysicalOutflows(activity))totals.set(flow.taskId,(totals.get(flow.taskId)||0)+flow.quantity);
 return [...groups.values()].map(({sentAt,...row})=>{const loadedQty=totals.get(row.taskId)||0;return {...row,loadedQty,difference:Math.max(0,row.authorizedQty-loadedQty),issue:row.confirmed&&row.authorizedQty!==loadedQty};});
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
