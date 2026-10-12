import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
export function readCreditTransfers(activity){
 const events=activity.filter(event=>event.action==='SUPPLIER_CREDIT_APPLIED'&&event.result==='SAVED');
 if(new Set(events.map(event=>event.title)).size!==events.length||events.some(event=>!event.title||!event.details?.sourceId||!event.details?.targetId||event.details.sourceId===event.details.targetId||!event.details.supplierId||!Number.isSafeInteger(event.details.cents)||event.details.cents<=0||!event.initiatedByStaffId))throw Error('Supplier credit ledger requires review.');
 return events.map(event=>({id:event.title,...event.details,at:event.activityTime,by:event.initiatedByStaffName}));
}
export function createSupplierCreditOperations({store,names,listOrders,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||input?.action!=='APPLY_CREDIT')throw Error('Select a supplier credit.');
  const collection=names[company].activity;
  return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{supplierCredit:input},prepare:async()=>{
   const rows=await listOrders(company,staff),source=rows.find(row=>row.id===input.sourceId),target=rows.find(row=>row.id===input.id),reason=String(input.reason||'').trim();
   if(!source||!target||source.company!==company||target.company!==company||source.id===target.id||!source.supplierId||source.supplierId!==target.supplierId)throw Error('Credit must stay with the same supplier and company.');
   if(source.version!==input.sourceVersion||target.version!==input.version)throw Error('Supplier credit or purchase order changed. Refresh before applying.');
   if(!source.invoiceChecked||!Number.isSafeInteger(input.cents)||input.cents<=0||input.cents>source.finance.supplierCreditCents)throw Error('Select an available finance-checked supplier credit.');
   if(!Number.isSafeInteger(target.finance.balanceCents)||input.cents>target.finance.balanceCents)throw Error('Credit cannot exceed the confirmed invoice balance.');
   if(!reason||reason.length>2000)throw Error('Enter a credit application reason.');
   const id=operationId(company,requestId,staff.memberId,'CREDIT'),at=now().toISOString();
   return {sourceVersion:source.version,targetVersion:target.version,event:{_id:id,title:id,description:target.id,action:'SUPPLIER_CREDIT_APPLIED',result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:reason,details:{sourceId:source.id,targetId:target.id,supplierId:source.supplierId,company,cents:input.cents,reason}}};
  },apply:async plan=>{
   const existing=await store.read(collection,plan.event._id);
   if(!existing){const rows=await listOrders(company,staff);if(rows.find(row=>row.id===plan.event.details.sourceId)?.version!==plan.sourceVersion||rows.find(row=>row.id===plan.event.details.targetId)?.version!==plan.targetVersion)throw Error('Supplier credit changed while saving.');await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Supplier credit receipt conflict.');
   return {ok:true,company,requestId,poId:plan.event.details.targetId,savedAt:plan.event.activityTime};
  }});
 };
}
