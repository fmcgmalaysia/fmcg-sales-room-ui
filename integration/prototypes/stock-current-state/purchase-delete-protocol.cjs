'use strict';
const {hash}=require('./commit-proof.cjs'),{copy,same,createSegmentedPlanCodec}=require('./segmented-plan.cjs');
const {createSegmentedFencedProof}=require('./segmented-fenced-proof.cjs'),{captureOriginalOrderFilePlan}=require('./original-order-file-plan.cjs');
const {pendingImage,finalImage,deletionPlan,classifyPurchaseDeletionImage}=require('./purchase-delete-images.cjs');
async function prepareOriginalPurchaseDeletionWrite(args){
 if(args.department!=='PURCHASE'||args.input?.action!=='DELETE_DOCUMENT')throw Error('Original Purchase deletion required');
 const captured=await captureOriginalOrderFilePlan({...args,slots:[]});
 return{writes:[{collection:'PurchaseOrders',before:captured.before,after:pendingImage(captured.before,captured.prepared,args.requestId),
  purchaseDeletion:{requestId:args.requestId,prepared:captured.prepared}}]};
}
// Existing segmented coordinator, same company lock/manifest/admission. Its private
// final validation hook completes ORIGINAL unlink→trash→final audit under FINALIZE.
// No duplicate plan identity, second authority/collection or inverse rollback.
function createPurchaseDeleteProtocol({company,staff,request,store,documentService,now=()=>new Date(),codecPolicy={},stepsPerInvocation=20,coordination='EXCLUSIVE_LOCK'}){
 if(!['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'].includes(coordination))throw Error('Explicit server deletion coordination required');
 const exclusive=coordination==='EXCLUSIVE_LOCK';
 if(!['NCT','GHR'].includes(company)||!staff?.staffId||!staff.memberId||!staff.staffName||request?.input?.action!=='DELETE_DOCUMENT'
  ||request.stockProtocol!==1||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId
  ||typeof request.stockBuild!=='string'||!request.stockBuild||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
  ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||typeof documentService!=='function'||typeof now!=='function')throw Error('Private original Purchase staged deletion required');
 const base=createSegmentedFencedProof({company,store,domainWrites:true,codecPolicy,stepsPerInvocation,coordination}),codec=createSegmentedPlanCodec({...codecPolicy,company,domainWrites:true});
 const {journal,lockId,controlId}=base.ids,key=hash(company+'/PURCHASE',request.requestId,staff.memberId),digest=hash({company,writer:'PURCHASE_ORDER_RECORD',input:request.input,
  stockProtocol:request.stockProtocol,stockBuild:request.stockBuild,stockGeneration:request.stockGeneration,stockIdentity:request.stockIdentity});
 async function complete(originalPlan){
  const control=await store.read(journal,controlId),lock=exclusive?await store.read(journal,lockId):null,manifest=await store.read(journal,key);
  if(!control?._version||control.company!==company||control.mode!=='ACTIVE'||control.writerBuild!==request.stockBuild||control.generation!==request.stockGeneration
   ||control.pending?.key!==key||control.pending.digest!==digest||control.pending.phase!=='FINALIZE'||control.pending.cursor!==1||control.pending.count!==1
   ||manifest?.digest!==digest||manifest.baseGeneration!==request.stockGeneration||manifest.planHash!==control.pending.planHash||exclusive&&(lock?.company!==company||lock.owner!==key||!lock.attempt))throw Error('Original Purchase deletion FINALIZE fence required');
  if(!Array.isArray(manifest.fragments)||!manifest.fragments.length||manifest.fragments.length>32)throw Error('Bounded original deletion manifest required');
  const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
  const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId});
  if(plan.writes.length!==1||!same(plan,originalPlan))throw Error('Exact original deletion manifest required');
  const change=plan.writes[0],prepared=deletionPlan(change,key),current=await store.read(change.collection,change.after._id);
  if(change.after.company!==company||change.after._id!==request.input.id||change.purchaseDeletion.requestId!==request.requestId
   ||prepared.expectedVersion!==request.input.version||prepared.document.fileId!==request.input.fileId||prepared.event.actorStaffId!==staff.staffId
   ||prepared.event.id!==hash(company,request.requestId,staff.memberId,'PO_DELETE_AUDIT'))throw Error('Original deletion request/audit identity conflict');
  const fence=async()=>{if(!same(await store.read(journal,controlId),control)||exclusive&&!same(await store.read(journal,lockId),lock))throw Error('Original Purchase deletion callback fence changed; retain request');};
  const image=classifyPurchaseDeletionImage(change,current,key);
  if(image==='FILE_DELETE_COMPLETED'){await fence();return;}
  if(image!=='PENDING_UNLINK')throw Error('Original pending or completed deletion image conflict');
  await fence();const receipt=await documentService(copy(prepared.trash));
  if(receipt?.ok!==true||receipt.trashed!==true||['fileId','company','poId','sha256','name'].some(field=>receipt[field]!==prepared.trash[field]))throw Error('Original Purchase trash unconfirmed; retain request');
  await fence();if(!same(await store.read(change.collection,change.after._id),change.after))throw Error('Original pending deletion changed during callback');
  // Completion time is chosen AFTER the real trash receipt, as in original apply.
  // Once this exact final row is durable, retry adopts it without recomputing time.
  const completed=finalImage(change.after,prepared,now().toISOString());
  try{await store.compareAndSet(change.collection,completed._id,change.after._version,completed);}catch(error){if(!same(await store.read(change.collection,completed._id),completed))throw error;}
  if(!same(await store.read(change.collection,completed._id),completed))throw Error('Original deletion completion unconfirmed');await fence();
 }
 return{...base,originalPurchaseDeletion:true,commit:options=>{
  if(options.requestId!==request.requestId||options.memberId!==staff.memberId||hash(options.input)!==digest)throw Error('Original deletion protocol request changed');
  return base.commit({...options,authorize:async operation=>{
   await options.authorize?.(operation);
   const prior=await store.read(journal,hash(key,'RESULT'));
   // A corrupt/early RESULT must not clear the barrier while the physical-file
   // completion is still missing. Later generations use retained original audit.
   if(prior&&(operation.control.pending||operation.control.generation<=request.stockGeneration+1)){
    const manifest=await store.read(journal,key);if(!Array.isArray(manifest?.fragments)||!manifest.fragments.length||manifest.fragments.length>32)throw Error('Original deletion result plan requires review');
    const fragments=[];for(const ref of manifest.fragments)fragments.push(await store.read(journal,ref.id));
    const plan=codec.decode({manifest,fragments,key,digest,memberId:staff.memberId,requestId:request.requestId});
    if(plan.writes.length!==1||classifyPurchaseDeletionImage(plan.writes[0],await store.read('PurchaseOrders',request.input.id),key)!=='FILE_DELETE_COMPLETED')throw Error('Original deletion result lacks completed file image');
   }
  },validate:async plan=>{if(options.validate)await options.validate(copy(plan));await complete(plan);}});
 }};
}
module.exports={prepareOriginalPurchaseDeletionWrite,createPurchaseDeleteProtocol,classifyPurchaseDeletionImage};
