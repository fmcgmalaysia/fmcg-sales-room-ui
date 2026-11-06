'use strict';
const {createCurrentStockSave}=require('./current-stock-save.cjs'),{requireOriginalSalesDelegation}=require('./sales-delegation.cjs');
const {captureOriginalCustomerDocumentPlan,assertCustomerDocumentPlan}=require('./customer-document-plan.cjs'),{hash}=require('./commit-proof.cjs');
// PRIVATE ORIGINAL Source bearer composition only. Existing document posting rules
// unchanged; this appends its existing immutable event under the common fence.
function createCurrentSalesDocumentSave({company,store,coverage,authenticateOriginalDelegation,readContext,createCustomerAccountOperations,
 createDocumentProtocol,allocateDocumentSlot,now=()=>new Date()}){
 if(!['NCT','GHR'].includes(company)||typeof store?.read!=='function'||[authenticateOriginalDelegation,readContext,createCustomerAccountOperations,createDocumentProtocol,allocateDocumentSlot,now].some(fn=>typeof fn!=='function'))throw Error('Private original document save dependencies required');
 return async request=>{
  let staff;
  const authenticate=async()=>{const current=await authenticateOriginalDelegation(company,request);requireOriginalSalesDelegation(current,request?.input?.customerId);
   if(current.canUploadCustomerDocument!==true||request?.input?.action!=='DOCUMENT'||request.stockIdentity?.staffId!==current.staffId||request.stockIdentity?.memberId!==current.memberId
    ||staff&&(staff.staffId!==current.staffId||staff.memberId!==current.memberId))throw Error('Original source document identity/permission required');staff=current;return{memberId:staff.memberId,staffId:staff.staffId};};
  await authenticate();const protocol=createDocumentProtocol({request,staff});
  if(protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.commit!=='function'||typeof protocol.readSnapshot!=='function')throw Error('Paired original document protocol required');
  const result=await createCurrentStockSave({company,writer:'SHIPMENT',protocol,coverage,authenticate,prepare:async command=>{
   if(command.memberId!==staff.memberId)throw Error('Original document employee changed');
   const snapshot=await protocol.readSnapshot(async()=>{
    const context=await readContext(company,staff),at=now().toISOString(),args={company,staff,requestId:command.requestId,input:command.input,context,createCustomerAccountOperations,now:()=>new Date(at)};
    // Validate with an unused placeholder before any real ID allocation; capture
    // again against the same frozen original context/time using server-only slot.
    await captureOriginalCustomerDocumentPlan({...args,slot:'DOCUMENT_VALIDATION_SLOT'});
    const slot=await allocateDocumentSlot(company),prepared=await captureOriginalCustomerDocumentPlan({...args,slot});
    return{writes:[{collection:company==='NCT'?'NCTActivity':'NCTActivity1',before:null,after:{...prepared.event,company}}]};
   });return{memberId:staff.memberId,generation:snapshot.generation,plan:snapshot.rows};
  }})(request);
  if(result.ok!==true)return result;
  const documentId=hash(company,request.requestId,staff.memberId,'CUSTOMER_DOCUMENT'),snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'NCTActivity':'NCTActivity1',documentId)),row=snapshot.rows;
  if(!row?._version||row.company!==company)throw Error('Original committed document unconfirmed');
  const event={...row};delete event._version;delete event.company;const doc=event.details?.document;
  assertCustomerDocumentPlan({company,staff:{...staff,staffName:event.initiatedByStaffName},requestId:request.requestId,input:request.input,plan:{expectedVersion:request.input.version,event,
   upload:{action:'UPLOAD',company,department:'SALES',type:doc?.type,poId:documentId,fileId:doc?.fileId,name:doc?.name,sha256:doc?.sha256}}});
  return{...result,company,documentId};
 };
}
module.exports={createCurrentSalesDocumentSave};
