'use strict';
const {createCurrentStockSave}=require('./current-stock-save.cjs'),{prepareOriginalOrderFileWrite,captureOriginalOrderFilePlan}=require('./original-order-file-plan.cjs');
const {hash}=require('./commit-proof.cjs');
// Original gateway role checks and same company protocol supplied privately. No
// web endpoint, real file action, bank instruction, or stock activation here.
function createCurrentOrderFileSave({company,department,store,coverage,authenticateOriginal,readOriginalContext,createFileProtocol,allocateDocumentSlot,
 createPurchaseOrderOperations,createAccountSettlementOperations,now=()=>new Date()}){
 const purchase=department==='PURCHASE';
 if(!['NCT','GHR'].includes(company)||!['PURCHASE','ACCOUNT'].includes(department)||typeof store?.read!=='function'
  ||[authenticateOriginal,readOriginalContext,createFileProtocol,allocateDocumentSlot,now,purchase?createPurchaseOrderOperations:createAccountSettlementOperations].some(fn=>typeof fn!=='function'))throw Error('Private original order file save dependencies required');
 return async request=>{
  let staff;
  const authenticate=async()=>{const current=await authenticateOriginal(company);
   if(!current?.staffId||!current.memberId||!current.staffName||request?.stockIdentity?.staffId!==current.staffId||request.stockIdentity.memberId!==current.memberId
    ||staff&&(staff.staffId!==current.staffId||staff.memberId!==current.memberId))throw Error('Original order file actor required');staff=current;return{staffId:staff.staffId,memberId:staff.memberId};};
  await authenticate();
  if(!(purchase?request.input?.action==='DOCUMENT':['DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE'].includes(request.input?.action)))throw Error('Original staged Purchase deletion not connected');
  const protocol=createFileProtocol({request,staff});
  if(protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.readSnapshot!=='function')throw Error('Original paired order file protocol required');
  const result=await createCurrentStockSave({company,writer:purchase?'PURCHASE_ORDER_RECORD':'ACCOUNT_PURCHASE_RECORD',protocol,coverage,authenticate,prepare:async command=>{
   const snapshot=await protocol.readSnapshot(async()=>{
    const context=await readOriginalContext(company,staff),at=now().toISOString(),upload=command.input.action!=='PAYMENT_FILE_DELETE',count=upload?1+(!purchase&&Array.isArray(command.input.attachments)?command.input.attachments.length:0):0;
    const args={...context,company,department,staff,requestId:command.requestId,input:command.input,now:()=>new Date(at),createPurchaseOrderOperations,createAccountSettlementOperations};
    const placeholders=Array.from({length:Math.min(count,7)},(_,index)=>'ORIGINAL_VALIDATION_SLOT_'+index);
    await captureOriginalOrderFilePlan({...args,slots:placeholders});
    const slots=[];for(let index=0;index<count;index++)slots.push(await allocateDocumentSlot(company));
    return prepareOriginalOrderFileWrite({...args,slots});
   });return{memberId:staff.memberId,generation:snapshot.generation,plan:snapshot.rows};
  }})(request);
  if(result.ok!==true)return result;
  const snapshot=await protocol.readSnapshot(()=>store.read('PurchaseOrders',request.input.id)),row=snapshot.rows;
  const auditId=hash(company,request.requestId,staff.memberId,purchase?'PO_AUDIT':'FINANCE'),matches=(row?.details?.audit||[]).filter(event=>event.id===auditId),audit=matches[0];
  if(!row?._version||row.company!==company||row._id!==request.input.id||row.title!==row._id||matches.length!==1||audit.actorStaffId!==staff.staffId
   ||audit.action!==(purchase?'SUPPLIER_DOCUMENT_UPLOADED':'ACCOUNT_'+request.input.action)||audit.result!=='SAVED'||!Number.isFinite(Date.parse(audit.time)))throw Error('Original committed order file receipt requires review');
  return{...result,company,poId:row._id,savedAt:audit.time};
 };
}
module.exports={createCurrentOrderFileSave};
