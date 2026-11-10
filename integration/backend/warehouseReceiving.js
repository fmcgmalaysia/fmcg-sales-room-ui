import { requireConfirmedProcurement } from 'backend/purchasePlan.js';
import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { allocatedTo, readAllocations } from 'backend/plannerAllocation.js';
import { stockPosition } from 'backend/inventoryExceptions.js';
import { validatePackingPhotos } from 'backend/packingListPhotos.js';

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
      if(!entry.taskId||!entry.orderId||!entry.sourceLineId||!quantity(entry.accepted)||!quantity(entry.rejected)||((entry.accepted<prior.accepted||entry.rejected<prior.rejected)&&!(entry.kind==='CORRECTION'&&text(entry.reason)))||entry.beforeAccepted!==prior.accepted||entry.beforeRejected!==prior.rejected)throw Error('Warehouse receipt quantities require review.');
      if(prior.orderId&&(entry.orderId!==prior.orderId||entry.sourceLineId!==prior.sourceLineId))throw Error('Warehouse receipt source changed.');
      lines.set(entry.taskId,{...entry,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName});
    }
    revision=event.title;history.push(event);pending.splice(pending.indexOf(event),1);
  }
  return {revision,lines:[...lines.values()],history};
}

export function readWarehouseTask(task,activity,allocations){
  const allocation=allocatedTo(task.title,activity,allocations);
  const ids=[...new Set(activity.filter(event=>event.action===RECEIPT_ACTION&&event.result==='SAVED'&&event.details?.lines?.some(line=>line.taskId===task.title)).map(event=>event.description))];
  if(!ids.length)return allocation.sources.length?{hasPhysicalReceipt:false,accepted:0,rejected:0,issue:false,customerReceived:allocation.quantity,extraReceived:0,at:allocation.at}:null;
  if(ids.length!==1)throw Error('Warehouse task belongs to multiple purchase orders.');
  const receipt=readWarehouseReceipts(ids[0],activity),line=receipt.lines.find(line=>line.taskId===task.title);
  if(!line||line.orderId!==task.description||line.sourceLineId!==task.imageAltText)throw Error('Warehouse task identity mismatch.');
  const stock=stockPosition(task.title,line.accepted,activity);
  return {...line,stock,hasPhysicalReceipt:true,customerReceived:allocation.quantity,allocationAt:allocation.at,extraReceived:Math.max(0,stock.usableReceived-task.purchaseQtyInCtn)};
}

export function projectWarehouseOrders({company,purchaseOrders,tasks,activity}){
  const images=new Map(tasks.filter(task=>task.productImageUrl).map(task=>[task.id,task.productImageUrl]));
  return purchaseOrders.map(po=>{
    if(po.company!==company)throw Error('Warehouse purchase company mismatch.');
    const receipt=readWarehouseReceipts(po.id,activity);
    const receivingCases=(po.quantityCases||[]).filter(item=>item.kind==='RECEIPT');
    const stopped=line=>receivingCases.find(item=>item.taskId===line.taskId&&item.decision?.supplierDeliveryDecision==='STOP'&&['CN_PROMISED','FUTURE_DEDUCTION','SUPPLIER_REFUSED'].includes(item.decision.supplierDecision)&&Number.isFinite(Date.parse(item.decision.at)));
    const lines=po.taskIds.map(id=>{
      const matches=tasks.filter(task=>task.id===id);if(matches.length!==1)throw Error('Warehouse purchase task is missing.');
      const task=matches[0],saved=receipt.lines.find(line=>line.taskId===id),planned=task.procurement?.totalCtn;
      if(!saved&&!task.warehouse&&Number.isFinite(task.inc)&&task.inc>0)throw Error('Existing warehouse quantity needs its receipt history before another delivery can be entered.');
      if(!quantity(planned)||planned===0||!quantity(task.ord))throw Error('Confirm supplier purchase quantities before receiving.');
      if(saved&&(saved.orderId!==task.orderId||saved.sourceLineId!==task.sourceLineId))throw Error('Warehouse purchase identity changed.');
      const accepted=saved?.accepted||0,rejected=saved?.rejected||0;
      if(accepted>planned)throw Error('Received quantity exceeds the supplier purchase plan.');
      const fixedCustomer=task.procurement?.customerCtn;
      return {taskId:id,customerId:task.customerId,customerName:po.customers?.find(customer=>customer.id===task.customerId)?.name||task.customerId||'',receivingStoppedWaiting:Boolean(stopped({taskId:id})),stopDecisionRevision:stopped({taskId:id})?.decision.revision||null,orderId:task.orderId,sourceLineId:task.sourceLineId,barcode:task.barcode,name:task.name,packing:task.packing,estimatedShipmentDate:task.estimatedShipmentDate,planned,shortage:task.shortage||null,committed:task.ord,accepted,rejected,remaining:planned-accepted,customerReceived:allocatedTo(id,activity).quantity,extraReceived:Number.isSafeInteger(fixedCustomer)?Math.max(0,(task.warehouse?.stock?.usableReceived??accepted)-fixedCustomer):task.procurementSource?0:Math.max(0,accepted-task.ord),expectedExtra:Number.isSafeInteger(fixedCustomer)?planned-fixedCustomer:task.procurementSource?0:Math.max(0,planned-task.ord),costing:task.procurement?.costing||null,issue:saved?.issue===true,reason:saved?.reason||'',updatedAt:saved?.at||null,updatedBy:saved?.by||''};
    });
    if(receipt.lines.some(line=>!po.taskIds.includes(line.taskId)))throw Error('Received task no longer belongs to this purchase order.');
    const issue=lines.some(line=>line.issue),complete=lines.length>0&&lines.every(line=>line.remaining===0)&&!issue;
    const receivingTaskComplete=lines.length>0&&lines.every(line=>line.remaining===0&&!line.issue||stopped(line));
    const completionTimes=receivingTaskComplete?lines.map(line=>stopped(line)?.decision.at||receipt.lines.find(saved=>saved.taskId===line.taskId)?.at).filter(Boolean).sort():[];
    return {id:po.id,company,number:po.number,...(po.procurementSavePending?{procurementSavePending:true}:{}),correctionAllowed:!po.invoiceChecked&&!po.supplierAccount?.closed,selfCollect:po.selfCollect===true,shortageIssues:po.shortageIssues||[],shipmentDates:po.shipmentDates,supplierId:po.supplierId,supplierName:po.supplierName,supplierShortName:po.supplierShortName,customerName:po.customerName,customerId:po.customerId,customerIds:po.customerIds,customers:po.customers,createdAt:po.createdAt,createdBy:po.createdBy,
      version:operationId(po.id,po.contentVersion||po.version,po.supplierId,po.selfCollect===true,po.invoiceChecked===true,po.supplierAccount?.closed===true,receipt.revision,lines),revision:receipt.revision,lines:lines.map(line=>images.has(line.taskId)?{...line,productImageUrl:images.get(line.taskId)}:line),history:receipt.history.map(event=>({id:event.title,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName,lines:event.details.lines})),
      status:issue?'ISSUE':complete?'COMPLETE':receipt.revision?'PARTIAL':'WAITING',itemCount:new Set(lines.map(line=>JSON.stringify([line.barcode,line.packing]))).size,pendingItems:new Set(lines.filter(line=>line.remaining>0||line.issue).map(line=>JSON.stringify([line.barcode,line.packing]))).size,
      completedAt:complete?receipt.history.at(-1)?.activityTime||null:null,workroomCompletedAt:completionTimes.at(-1)||null,receivingStoppedWaiting:receivingTaskComplete&&lines.some(line=>Boolean(stopped(line))),workroomStatus:po.invoiceChecked&&po.finance?.receiptResolved||receivingTaskComplete?'COMPLETE':issue?'ISSUE':complete?'COMPLETE':receipt.revision?'PARTIAL':'WAITING',approvedReceiptTarget:po.invoiceChecked&&po.finance?.receiptResolved?lines.reduce((n,line)=>n+line.accepted,0):null,documents:po.documents,documentState:po.documentStates?.DO?.state,stockCases:po.stockCases||[]};
  });
}

export function createWarehouseOperations({store,names,readOrders,documentService,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return {save:async({company,staff,requestId,input})=>{
    if(!names[company]||!['RECEIVE','CORRECT'].includes(input?.action)||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>300)throw Error('Select a purchase order and enter this delivery.');
    const photoLines=input.lines.filter(line=>line?.photo!==undefined);
    const verified=photoLines.length?validatePackingPhotos(photoLines.map(line=>line.photo)):[];
    if(verified.length&&(input.action!=='RECEIVE'||typeof documentService!=='function'))throw Error('Warehouse photos are only available for new receipts.');
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{warehouse:input},prepare:async()=>{
      const po=(await readOrders(company,staff)).find(row=>row.id===input.id);
      requireConfirmedProcurement(po);
      if(!po||po.version!==input.version)throw Error('Purchase order or receipts changed. Refresh before saving; your input is retained.');
      const correcting=input.action==='CORRECT',activity=correcting?await store.all(names[company].activity):[];
      if(correcting&&(!po.revision||po.correctionAllowed===false))throw Error('Warehouse receipt is financially locked or has no saved delivery. Ask Finance to review before correction.');
      if(new Set(input.lines.map(line=>line.taskId)).size!==input.lines.length)throw Error('A receipt line was repeated.');
      const changes=input.lines.map(entry=>{
        const line=po.lines.find(line=>line.taskId===entry.taskId),reason=text(entry.reason),kind=entry.kind;
        if(line?.receivingStoppedWaiting)throw Error('Warehouse stopped waiting for this line. Further receipts and corrections are locked.');
        if(correcting){
          if(!line||!quantity(entry.accepted)||!quantity(entry.rejected)||entry.accepted>line.planned||!reason||reason.length>1000)throw Error('Warehouse enter corrected cumulative cartons and a correction reason.');
          const position=stockPosition(line.taskId,entry.accepted,activity),allocated=readAllocations(activity).find(row=>row.sourceTaskId===line.taskId)?.targets.reduce((n,row)=>n+row.quantity,0)||0;
          if(allocated>position.usableReceived)throw Error('Warehouse correction is below allocated stock. Ask Purchase to correct allocation first.');
          return {taskId:line.taskId,orderId:line.orderId,sourceLineId:line.sourceLineId,planned:line.planned,beforeAccepted:line.accepted,beforeRejected:line.rejected,accepted:entry.accepted,rejected:entry.rejected,kind:'CORRECTION',issue:line.issue||entry.accepted<line.planned||entry.rejected>0,reason};
        }
        if(!line||!quantity(entry.accepted)||!quantity(entry.rejected)||(entry.accepted+entry.rejected===0&&!['SHORT','DAMAGED','WRONG','OTHER'].includes(kind)))throw Error('Enter whole cartons received or rejected for each changed line.');
        if(entry.accepted>line.remaining)throw Error('Accepted cartons exceed the approved purchase quantity. Ask Purchase to confirm the extra quantity first.');
        if(!['DELIVERY','PARTIAL','SHORT','DAMAGED','WRONG','OTHER'].includes(kind))throw Error('Select a delivery result.');
        const issue=['SHORT','DAMAGED','WRONG','OTHER'].includes(kind)||entry.rejected>0;
        if((line.remaining>entry.accepted||issue||line.issue)&&(!reason||reason.length>1000))throw Error('Enter a reason for partial delivery, shortage, rejection or issue resolution.');
        if(line.remaining>entry.accepted&&kind==='DELIVERY')throw Error('Select partial delivery or a shortage reason.');
        if(line.issue&&!issue&&entry.resolveIssue!==true)throw Error('Confirm that the previous receiving issue is resolved.');
        if(line.rejected+entry.rejected>9999)throw Error('Rejected carton total is too large.');
        return {taskId:line.taskId,orderId:line.orderId,sourceLineId:line.sourceLineId,planned:line.planned,beforeAccepted:line.accepted,beforeRejected:line.rejected,accepted:line.accepted+entry.accepted,rejected:line.rejected+entry.rejected,kind,issue,reason};
      });
      const id=operationId(company,requestId,staff.memberId,'WAREHOUSE_RECEIPT'),at=now().toISOString();
      const uploads=[];
      for(let index=0;index<verified.length;index++){
        const {sha256,mimeType,size}=verified[index],taskId=photoLines[index].taskId;
        const allocated=await documentService({action:'ALLOCATE',company});
        if(!/^[A-Za-z0-9_-]{10,200}$/.test(allocated?.fileId||''))throw Error('Warehouse photo allocation is unconfirmed. Retry the same save.');
        const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mimeType],name=`${company}-${id}-RECEIVING-${index+1}.${extension}`;
        uploads.push({action:'PHOTO_UPLOAD',type:'RECEIVING',department:'WAREHOUSE',company,poId:operationId(company,po.id,taskId,'RECEIVING_PHOTO'),fileId:allocated.fileId,name,sha256,mimeType,size});
        changes.find(line=>line.taskId===taskId).photo={fileId:allocated.fileId,name,sha256,mimeType,size};
      }
      return {expectedVersion:po.version,...(uploads.length?{uploads}:{}),event:{_id:id,title:id,description:po.id,image:po.customerId,action:RECEIPT_ACTION,result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:'Warehouse delivery received',details:{company,beforeRevision:po.revision,lines:changes}}};
    },apply:async plan=>{
      const existing=await store.read(names[company].activity,plan.event._id);
      if(existing&&operationId(existing.details)!==operationId(plan.event.details))throw Error('Warehouse receipt identity conflict.');
      if(!existing){
        const assertCurrent=async()=>{
          const current=(await readOrders(company,staff)).find(row=>row.id===plan.event.description);
          requireConfirmedProcurement(current);
          if(current?.version!==plan.expectedVersion)throw Error('Purchase order or receipts changed. Refresh before saving; your input is retained.');
        };
        await assertCurrent();
        for(const [index,upload] of (plan.uploads||[]).entries()){
          const receipt=await documentService({...upload,base64:verified[index].base64});
          if(receipt?.ok!==true||['fileId','company','poId','name','sha256','mimeType','size'].some(key=>receipt[key]!==upload[key]))throw Error('Warehouse photo upload is unconfirmed. Retry the same save.');
        }
        if(plan.uploads?.length)await assertCurrent();
        await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});
      }
      return {ok:true,company,requestId,poId:plan.event.description,receiptId:plan.event.title,savedAt:plan.event.activityTime};
    }});
  }};
}
