import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';

const text=value=>String(value??'').trim();
const quantity=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
export const RECEIPT_ACTION='WAREHOUSE_RECEIPT_SAVED';
export function requireWarehouseStaff(member,records){
  const email=text(member?.loginEmail).toLowerCase();
  if(!member?._id||!email||member.status!=='APPROVED')throw Error('Please sign in with your approved Master staff account.');
  const matches=records.filter(row=>text(row.staffEmail).toLowerCase()===email);
  if(matches.length!==1)throw Error('Master staff access is not configured.');
  const row=matches[0],role=text(row.role).toUpperCase(),departments=Array.isArray(row.departments)?row.departments.map(value=>text(value).toUpperCase()):[];
  if(!text(row.title)||text(row.description)!==member._id||!text(row.staffName)||text(row.staffStatus).toUpperCase()!=='ACTIVE'||!(departments.includes('WAREHOUSE')||role==='SUPER ADMIN'||role==='TOP MANAGEMENT'))throw Error('Warehouse access is not authorized.');
  return {staffId:text(row.title),staffName:text(row.staffName),memberId:member._id,role};
}

// Immutable batches are the receipt authority. Customer allocations never include extra stock.
export function readWarehouseReceipts(poId,activity){
  const pending=activity.filter(event=>event.action===RECEIPT_ACTION&&event.result==='SAVED'&&event.description===poId),lines=new Map(),history=[];
  let revision='';
  while(pending.length){
    const next=pending.filter(event=>event.details?.beforeRevision===revision);
    if(next.length!==1)throw Error('Warehouse receipt history requires review.');
    const event=next[0],detail=event.details;
    if(!event.title||!Array.isArray(detail.lines)||!detail.lines.length||new Set(detail.lines.map(line=>line.taskId)).size!==detail.lines.length||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Warehouse receipt identity requires review.');
    for(const entry of detail.lines){
      const prior=lines.get(entry.taskId)||{accepted:0,rejected:0};
      if(!entry.taskId||!entry.orderId||!entry.sourceLineId||!quantity(entry.accepted)||!quantity(entry.rejected)||entry.accepted<prior.accepted||entry.rejected<prior.rejected||entry.beforeAccepted!==prior.accepted||entry.beforeRejected!==prior.rejected)throw Error('Warehouse receipt quantities require review.');
      if(prior.orderId&&(entry.orderId!==prior.orderId||entry.sourceLineId!==prior.sourceLineId))throw Error('Warehouse receipt source changed.');
      lines.set(entry.taskId,{...entry,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName});
    }
    revision=event.title;history.push(event);pending.splice(pending.indexOf(event),1);
  }
  return {revision,lines:[...lines.values()],history};
}

export function readWarehouseTask(task,activity){
  const ids=[...new Set(activity.filter(event=>event.action===RECEIPT_ACTION&&event.result==='SAVED'&&event.details?.lines?.some(line=>line.taskId===task.title)).map(event=>event.description))];
  if(!ids.length)return null;
  if(ids.length!==1)throw Error('Warehouse task belongs to multiple purchase orders.');
  const receipt=readWarehouseReceipts(ids[0],activity),line=receipt.lines.find(line=>line.taskId===task.title);
  if(!line||line.orderId!==task.description||line.sourceLineId!==task.imageAltText)throw Error('Warehouse task identity mismatch.');
  return {...line,customerReceived:Math.min(line.accepted,task.purchaseQtyInCtn),extraReceived:Math.max(0,line.accepted-task.purchaseQtyInCtn)};
}

export function projectWarehouseOrders({company,purchaseOrders,tasks,activity}){
  return purchaseOrders.map(po=>{
    if(po.company!==company)throw Error('Warehouse purchase company mismatch.');
    const receipt=readWarehouseReceipts(po.id,activity);
    const lines=po.taskIds.map(id=>{
      const matches=tasks.filter(task=>task.id===id);if(matches.length!==1)throw Error('Warehouse purchase task is missing.');
      const task=matches[0],saved=receipt.lines.find(line=>line.taskId===id),planned=task.procurement?.totalCtn;
      if(!saved&&Number.isFinite(task.inc)&&task.inc>0)throw Error('Existing warehouse quantity needs its receipt history before another delivery can be entered.');
      if(!quantity(planned)||planned===0||!quantity(task.ord)||task.ord>planned)throw Error('Confirm supplier purchase quantities before receiving.');
      if(saved&&(saved.orderId!==task.orderId||saved.sourceLineId!==task.sourceLineId))throw Error('Warehouse purchase identity changed.');
      const accepted=saved?.accepted||0,rejected=saved?.rejected||0;
      if(accepted>planned)throw Error('Received quantity exceeds the supplier purchase plan.');
      return {taskId:id,orderId:task.orderId,sourceLineId:task.sourceLineId,barcode:task.barcode,name:task.name,packing:task.packing,planned,committed:task.ord,accepted,rejected,remaining:planned-accepted,customerReceived:Math.min(accepted,task.ord),extraReceived:Math.max(0,accepted-task.ord),expectedExtra:planned-task.ord,issue:saved?.issue===true,reason:saved?.reason||'',updatedAt:saved?.at||null,updatedBy:saved?.by||''};
    });
    if(receipt.lines.some(line=>!po.taskIds.includes(line.taskId)))throw Error('Received task no longer belongs to this purchase order.');
    const issue=lines.some(line=>line.issue),complete=lines.length>0&&lines.every(line=>line.remaining===0)&&!issue;
    return {id:po.id,company,number:po.number,supplierId:po.supplierId,supplierName:po.supplierName,supplierShortName:po.supplierShortName,customerName:po.customerName,customerId:po.customerId,createdAt:po.createdAt,createdBy:po.createdBy,
      version:operationId(po.version,receipt.revision,lines),revision:receipt.revision,lines,history:receipt.history.map(event=>({id:event.title,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName,lines:event.details.lines})),
      status:issue?'ISSUE':complete?'COMPLETE':receipt.revision?'PARTIAL':'WAITING',itemCount:new Set(lines.map(line=>JSON.stringify([line.barcode,line.packing]))).size,pendingItems:new Set(lines.filter(line=>line.remaining>0||line.issue).map(line=>JSON.stringify([line.barcode,line.packing]))).size,
      completedAt:complete?receipt.history.at(-1)?.activityTime||null:null,documents:po.documents};
  });
}

export function createWarehouseOperations({store,names,readOrders,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return {save:async({company,staff,requestId,input})=>{
    if(!names[company]||input?.action!=='RECEIVE'||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>300)throw Error('Select a purchase order and enter this delivery.');
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{warehouse:input},prepare:async()=>{
      const po=(await readOrders(company,staff)).find(row=>row.id===input.id);
      if(!po||po.version!==input.version)throw Error('Purchase order or receipts changed. Refresh before saving; your input is retained.');
      if(new Set(input.lines.map(line=>line.taskId)).size!==input.lines.length)throw Error('A receipt line was repeated.');
      const changes=input.lines.map(entry=>{
        const line=po.lines.find(line=>line.taskId===entry.taskId),reason=text(entry.reason),kind=entry.kind;
        if(!line||!quantity(entry.accepted)||!quantity(entry.rejected)||(entry.accepted+entry.rejected===0&&!['SHORT','DAMAGED','WRONG','OTHER'].includes(kind)))throw Error('Enter whole cartons received or rejected for each changed line.');
        if(entry.accepted>line.remaining)throw Error('Accepted cartons exceed the approved purchase quantity. Ask Purchase to confirm the extra quantity first.');
        if(!['DELIVERY','PARTIAL','SHORT','DAMAGED','WRONG','OTHER'].includes(kind))throw Error('Select a delivery result.');
        const issue=['SHORT','DAMAGED','WRONG','OTHER'].includes(kind)||entry.rejected>0;
        if((line.remaining>entry.accepted||issue||line.issue)&&(!reason||reason.length>1000))throw Error('Enter a reason for partial delivery, shortage, rejection or issue resolution.');
        if(line.remaining>entry.accepted&&kind==='DELIVERY')throw Error('Select partial delivery or a shortage reason.');
        if(line.issue&&!issue&&entry.resolveIssue!==true)throw Error('Confirm that the previous receiving issue is resolved.');
        if(line.rejected+entry.rejected>9999)throw Error('Rejected carton total is too large.');
        return {taskId:line.taskId,orderId:line.orderId,sourceLineId:line.sourceLineId,beforeAccepted:line.accepted,beforeRejected:line.rejected,accepted:line.accepted+entry.accepted,rejected:line.rejected+entry.rejected,kind,issue,reason};
      });
      const id=operationId(company,requestId,staff.memberId,'WAREHOUSE_RECEIPT'),at=now().toISOString();
      return {expectedVersion:po.version,event:{_id:id,title:id,description:po.id,image:po.customerId,action:RECEIPT_ACTION,result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:'Warehouse delivery received',details:{company,beforeRevision:po.revision,lines:changes}}};
    },apply:async plan=>{
      const existing=await store.read(names[company].activity,plan.event._id);
      if(existing&&operationId(existing.details)!==operationId(plan.event.details))throw Error('Warehouse receipt identity conflict.');
      if(!existing){
        const current=(await readOrders(company,staff)).find(row=>row.id===plan.event.description);
        if(current?.version!==plan.expectedVersion)throw Error('Purchase order or receipts changed. Refresh before saving; your input is retained.');
        await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});
      }
      return {ok:true,company,requestId,poId:plan.event.description,receiptId:plan.event.title,savedAt:plan.event.activityTime};
    }});
  }};
}
