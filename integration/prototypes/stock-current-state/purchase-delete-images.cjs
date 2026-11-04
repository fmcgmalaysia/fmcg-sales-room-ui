'use strict';
const {hash}=require('./commit-proof.cjs');
const {copy,same}=require('./segmented-plan.cjs');
// Pure original image checks only. Safe to bundle in READ-ONLY recovery without
// importing file services, mutation protocols or original business writers.
function pendingImage(before,prepared,requestId){
 const document=before?.details?.documents?.find(doc=>doc.fileId===prepared?.document?.fileId),event=prepared?.event;
 if(!before?._version||!document||!same(document,prepared.document)||!same(before.details.taskIds,prepared.taskIds)
  ||prepared.expected!==hash(before)||!event?.actorStaffId||!event.actor||event.action!=='SUPPLIER_DOCUMENT_DELETED'||event.result!=='SAVED'
  ||!event.message||!Number.isFinite(Date.parse(prepared.startedAt))||Object.hasOwn(event,'time')
  ||!same(prepared.trash,{action:'TRASH',company:before.company,poId:before._id,fileId:document.fileId,sha256:document.sha256,name:document.name,type:document.type}))throw Error('Original Purchase pending deletion contract required');
 const deletion={requestId,fileId:document.fileId,by:event.actor,byStaffId:event.actorStaffId,at:prepared.startedAt};
 return{...copy(before),details:{...copy(before.details),documentDeletion:deletion,documents:before.details.documents.map(doc=>doc.fileId===document.fileId?{...copy(doc),linked:false,deletion:{...deletion,state:'PENDING'}}:copy(doc))}};
}
function finalImage(pending,prepared,at){
 if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw Error('Original Purchase deletion completion time required');
 const event={...copy(prepared.event),time:at};
 return{...copy(pending),_version:hash(pending._version,'PURCHASE_FILE_DELETED',at),details:{...copy(pending.details),documentDeletion:null,updatedAt:at,
  documents:pending.details.documents.map(doc=>doc.fileId===prepared.document.fileId?{...copy(doc),linked:false,deletion:{...copy(doc.deletion),state:'DELETED',at}}:copy(doc)),
  audit:[...(copy(pending.details.audit||[])),event]}};
}
function deletionPlan(change,key){
 const metadata=change?.purchaseDeletion,prepared=metadata?.prepared,before=change?.before,after=change?.after;
 if(change?.collection!=='PurchaseOrders'||!metadata||!same(Object.keys(metadata).sort(),['prepared','requestId'])
  ||!/^[a-f0-9-]{36}$/i.test(metadata.requestId||'')||before?._id!==after?._id||before?.company!==after?.company)throw Error('Exact original Purchase unlink plan required');
 const expected=pendingImage(before,prepared,metadata.requestId);expected._version=hash(key,'PurchaseOrders',after._id);
 if(!same(expected,after))throw Error('Original Purchase unlink image changed');return prepared;
}
// Evidence classification never authorizes a callback, unlock or write.
function classifyPurchaseDeletionImage(change,current,key){
 try{const prepared=deletionPlan(change,key);if(same(current,change.after))return'PENDING_UNLINK';
  const matches=(current?.details?.audit||[]).filter(event=>event.id===prepared.event.id);
  return matches.length===1&&same(current,finalImage(change.after,prepared,matches[0].time))?'FILE_DELETE_COMPLETED':null;
 }catch(_){return null;}
}
module.exports = {pendingImage,finalImage,deletionPlan,classifyPurchaseDeletionImage};
