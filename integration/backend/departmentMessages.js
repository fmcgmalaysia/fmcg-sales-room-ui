import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';

const departments=['PURCHASE','ACCOUNT','WAREHOUSE'];
const text=value=>String(value??'').trim();
const actions=['MESSAGE_SEND','MESSAGE_READ','MESSAGE_ACK'];
export function messageDepartments(staff){
  return departments.filter(d=>Array.isArray(staff?.departments)&&staff.departments.includes(d));
}
export function requireMessageStaff(member,records,guards){
  const allowed=[];let identity=null;
  for(const department of departments){
    let staff;try{staff=guards[department](member,records);}catch(_){continue;}
    if(identity&&identity.staffId!==staff.staffId)throw Error('Message employee identity requires review.');
    identity=staff;allowed.push(department);
  }
  if(!identity||!allowed.length)throw Error('Message department access is not authorized.');
  return {...identity,memberId:member._id,departments:allowed};
}
function visible(message,department){return message.from===department||message.to.includes(department);}
function sentMessages(company,activity){
  return activity.filter(e=>e.action==='DEPARTMENT_MESSAGE_SENT'&&e.result==='SAVED'&&e.details?.company===company).map(e=>({id:e.title,poId:e.description,from:e.details.from,to:e.details.to,body:e.message,requiresAck:e.details.requiresAck===true,at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName,byStaffId:e.initiatedByStaffId}));
}
function receipts(company,activity,messageId){
  return activity.filter(e=>['DEPARTMENT_MESSAGE_READ','DEPARTMENT_MESSAGE_ACK'].includes(e.action)&&e.result==='SAVED'&&e.details?.company===company&&e.details.messageId===messageId).map(e=>({kind:e.action==='DEPARTMENT_MESSAGE_ACK'?'ACK':'READ',department:e.details.department,by:e.initiatedByStaffName,byStaffId:e.initiatedByStaffId,at:new Date(e.activityTime).toISOString()}));
}
export function projectDepartmentMessages({company,department,staff,orders,activity}){
  if(!messageDepartments(staff).includes(department))throw Error('Message department access is not authorized.');
  const sent=sentMessages(company,activity);
  return {company,department,staff:{staffId:staff.staffId,staffName:staff.staffName},threads:orders.filter(po=>po.company===company).map(po=>{
    const messages=sent.filter(m=>m.poId===po.id&&visible(m,department)).map(m=>({...m,receipts:receipts(company,activity,m.id).filter(r=>m.to.includes(r.department))}));
    // Existing business facts are projected, never copied into a second issue workflow.
    const issues=[...(po.documentIssues||[]).filter(i=>i.status!=='RESOLVED'&&department!=='WAREHOUSE').map(i=>({id:i.id,kind:'DOCUMENT',title:i.type+' document issue',reason:i.reason,owner:i.status==='AWAITING_REVIEW'?'ACCOUNT':'PURCHASE',status:i.status})),...(po.shortageIssues||[]).map(i=>({id:i.taskId,kind:'RECEIVING',title:'Receiving issue',reason:i.barcode+' · '+(i.name||''),owner:'PURCHASE',status:'OPEN'})),...(po.stockIssues||[]).map(i=>({id:i.id,kind:'STOCK',title:'Stock issue',reason:i.reason,owner:i.owner,status:i.status}))];
    const updates=(po.history||[]).filter(e=>e.result==='SAVED'&&['SUPPLIER_DOCUMENT_UPLOADED','PAYMENT_CHASE_CHANGED','ACCOUNT_PLAN','ACCOUNT_DOCUMENT_UPLOAD','ACCOUNT_CLOSE_ACCOUNT','ACCOUNT_REOPEN_ACCOUNT'].includes(e.action)&&(department!=='WAREHOUSE'||e.action==='SUPPLIER_DOCUMENT_UPLOADED')).map(e=>({id:e.id,kind:'SYSTEM',at:e.time,by:e.actor,body:({SUPPLIER_DOCUMENT_UPLOADED:'Supplier document uploaded',PAYMENT_CHASE_CHANGED:'Payment reminder updated',ACCOUNT_PLAN:'Payment plan updated',ACCOUNT_DOCUMENT_UPLOAD:'Payment or document recorded',ACCOUNT_CLOSE_ACCOUNT:'Supplier account closed',ACCOUNT_REOPEN_ACCOUNT:'Supplier account reopened'})[e.action]}));
    const receiveUpdates=activity.filter(e=>e.action==='WAREHOUSE_RECEIPT_SAVED'&&e.result==='SAVED'&&e.description===po.id).map(e=>({id:e.title,kind:'SYSTEM',at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName,body:'Receiving updated',lines:(e.details?.lines||[]).map(l=>({barcode:po.taskIds.includes(l.taskId)?l.taskId:'',accepted:l.accepted,rejected:l.rejected,reason:l.reason}))}));
    const supplierResponses={CN_PROMISED:['Supplier will issue a CN.','供应商承诺提供 CN。'],FUTURE_DEDUCTION:['The amount will be deducted from the next payment.','供应商同意下次扣账。'],SUPPLIER_REFUSED:['Supplier declined responsibility.','供应商不愿意负责。']};
    const supplierUpdates=['PURCHASE','WAREHOUSE','ACCOUNT'].includes(department)?activity.filter(e=>e.action==='PURCHASE_QUANTITY_CASE_DECIDED'&&e.result==='SAVED'&&e.details?.company===company&&e.details.kind==='RECEIPT'&&e.details.supplierDeliveryDecision==='STOP'&&supplierResponses[e.details.supplierDecision]&&po.taskIds.includes(e.imageAltText)).map(e=>({id:e.title,kind:'SYSTEM',presentation:'MESSAGE',at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName,from:'PURCHASE',notify:department!=='PURCHASE',body:'Stop Waiting',bodyZh:'停止等货'})):[];
    const preparationUpdates=activity.filter(e=>e.action==='WAREHOUSE_PREPARATION_SAVED'&&e.result==='SAVED'&&e.details?.state?.company===company&&(e.details.state.sourceTaskIds||[e.imageAltText]).some(id=>po.taskIds.includes(id))).map(e=>({id:e.title,kind:'SYSTEM',at:new Date(e.activityTime).toISOString(),by:e.initiatedByStaffName,body:({PACK:'Packing confirmed',LOAD:'Loading recorded',UNPACK:'Packing reversed',PHOTOS:'Warehouse photos added'})[e.details.action],note:e.details.state.note||''}));
    return {id:po.id,number:po.number,supplierName:po.supplierName,closed:po.supplierAccount?.closed===true,messages,issues,updates:[...updates,...receiveUpdates,...supplierUpdates,...preparationUpdates].sort((a,b)=>String(a.at).localeCompare(String(b.at))),unread:messages.filter(m=>m.to.includes(department)&&m.byStaffId!==staff.staffId&&!m.receipts.some(r=>r.byStaffId===staff.staffId&&r.department===department)).length};
  }),readAt:new Date().toISOString()};
}

export function createDepartmentMessageOperations({store,names,readContext,listOrders,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return async({company,department,staff,requestId,input})=>{
    if(!names[company]||!messageDepartments(staff).includes(department)||!actions.includes(input?.action))throw Error('Message action or department is not authorized.');
    return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{department,message:input},prepare:async()=>{
      const [context,orders]=await Promise.all([readContext(company,staff),listOrders(company,staff)]);
      const po=orders.find(p=>p.company===company&&p.id===input.poId);
      if(!po)throw Error('Message purchase order is not available in this company.');
      const at=now().toISOString(),id=operationId(company,requestId,staff.memberId,'DEPARTMENT_MESSAGE');
      let detail={company,department},body='';
      if(input.action==='MESSAGE_SEND'){
        const to=input.to;
        body=text(input.body);
        if(!body||body.length>2000)throw Error('Message must contain between 1 and 2000 characters.');
        if(!Array.isArray(to)||!to.length||to.length>2||new Set(to).size!==to.length||to.some(d=>!departments.includes(d)||d===department))throw Error('Message select the receiving department.');
        if(typeof input.requiresAck!=='boolean')throw Error('Message confirmation choice is required.');
        detail={...detail,from:department,to:[...to],requiresAck:input.requiresAck};
        if(input.replyTo){const original=sentMessages(company,context.activity).find(m=>m.id===input.replyTo&&m.poId===po.id&&visible(m,department));if(!original||to.some(d=>d!==original.from&&!original.to.includes(d)))throw Error('Message reply must stay with its original recipients.');detail.replyTo=original.id;}
      }else{
        const message=sentMessages(company,context.activity).find(m=>m.id===input.messageId&&m.poId===po.id&&m.to.includes(department));
        if(!message)throw Error('Message is not addressed to this department.');
        if(input.action==='MESSAGE_ACK'&&!message.requiresAck)throw Error('Message does not require confirmation.');
        detail.messageId=message.id;
        const kind=input.action==='MESSAGE_ACK'?'ACK':'READ';
        if(receipts(company,context.activity,message.id).some(r=>r.kind===kind&&r.department===department&&r.byStaffId===staff.staffId))return {duplicate:true,poId:po.id,at};
      }
      return {event:{_id:id,title:id,description:po.id,action:input.action==='MESSAGE_SEND'?'DEPARTMENT_MESSAGE_SENT':input.action==='MESSAGE_ACK'?'DEPARTMENT_MESSAGE_ACK':'DEPARTMENT_MESSAGE_READ',result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:body,details:detail}};
    },apply:async plan=>{
      if(plan.duplicate)return {ok:true,company,requestId,poId:plan.poId,unchanged:true};
      const event=plan.event,existing=await store.read(names[company].activity,event._id);
      if(existing&&operationId({...existing,activityTime:new Date(existing.activityTime).toISOString()})!==operationId(event))throw Error('Message saved identity conflict.');
      if(!existing)await store.insert(names[company].activity,{...event,activityTime:new Date(event.activityTime)});
      return {ok:true,company,requestId,poId:event.description,messageId:event.details.messageId||event.title,savedAt:event.activityTime};
    }});
  };
}
