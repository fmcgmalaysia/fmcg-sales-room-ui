'use strict';
const {createCurrentStockSave}=require('./current-stock-save.cjs');
const {evaluateStockAdmission,WRITERS}=require('./stock-admission.cjs');
const {hash}=require('./commit-proof.cjs');
const {copy}=require('./segmented-plan.cjs');
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
// Capture the ORIGINAL CBM-only insert, not a second POINTBASE validator or its
// real write. Original already-known result remains a read, without a CMS row.
async function captureOriginalWarehouseCbm({company,staff,requestId,taskId,data,createWarehouseCbmCapture,captureCosts,now}){
 if(!['NCT','GHR'].includes(company)||data?.company!==company||!Array.isArray(data.deliveryTasks)
  ||[createWarehouseCbmCapture,captureCosts,now].some(fn=>typeof fn!=='function'))throw Error('Original private CBM capture scope required');
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1',id=hash(company,taskId,'WAREHOUSE_CBM_CAPTURED'),boundary=Error('Private CBM insert boundary');let event;
 const capture=createWarehouseCbmCapture({names:{[company]:{activity:journal}},now,captureCosts,
  readData:async(c,actor)=>{if(c!==company||actor.memberId!==staff.memberId||actor.staffId!==staff.staffId)throw Error('Original CBM actor changed');return copy(data);},
  store:{read:async(c,key)=>{if(c!==journal||key!==id)throw Error('Original CBM read scope');return null;},
   insert:async(c,row)=>{if(c!==journal||row._id!==id||row.action!=='WAREHOUSE_CBM_CAPTURED'||event)throw Error('Only original CBM insertion may be captured');event=copy(row);throw boundary;}}});
 try{const outcome=await capture({company,staff,requestId,taskId});
  if(event||outcome?.ok!==true||outcome.retained!==true||outcome.requestId!==requestId||outcome.taskId!==taskId||!valid(outcome.cbmPerCtn))throw Error('Original retained CBM receipt required');
  return{outcome};
 }catch(error){if(error!==boundary)throw error;}
 if(!event||event.title!==id||event.result!=='SAVED'||event.imageAltText!==taskId||event.details?.company!==company
  ||event.initiatedByStaffId!==staff.staffId||!valid(event.details.cbmPerCtn)||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Original CBM event identity conflict');
 return{plan:{writes:[{collection:journal,before:null,after:{...event,company}}]}};
}
// COST_REFERENCE coverage includes BOTH original Purchase costs and this original
// Warehouse reference co-writer; it grants Warehouse no Purchase/financial right.
function createCurrentWarehouseCbmSave({company,store,protocol,coverage,authenticateOriginalWarehouse,readCurrentOrders,createWarehouseCbmCapture,captureCosts,now}){
 if(!['NCT','GHR'].includes(company)||protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.readSnapshot!=='function'||typeof protocol.commit!=='function'||typeof store?.read!=='function'
  ||[authenticateOriginalWarehouse,readCurrentOrders,createWarehouseCbmCapture,captureCosts,now].some(fn=>typeof fn!=='function'))throw Error('Private current Warehouse CBM dependencies required');
 return async request=>{
  if(!/^[a-f0-9-]{36}$/i.test(request?.requestId||'')||!/^[a-f0-9]{32}$/i.test(request.input?.taskId||'')
   ||Object.keys(request.input).length!==1||request.stockProtocol!==1||typeof request.stockBuild!=='string'||!request.stockBuild
   ||!Number.isSafeInteger(request.stockGeneration)||request.stockGeneration<0
   ||!request.stockIdentity||typeof request.stockIdentity!=='object'||Array.isArray(request.stockIdentity)
   ||Object.keys(request.stockIdentity).length!==2||['staffId','memberId'].some(key=>typeof request.stockIdentity[key]!=='string'||!request.stockIdentity[key]||request.stockIdentity[key].length>200))throw Error('Exact original current CBM request required');
  let staff;
  const authorize=async()=>{const actor=await authenticateOriginalWarehouse(company);
   if(!actor?.staffId||!actor.memberId||!actor.staffName||actor.customerId||request.stockIdentity?.staffId!==actor.staffId||request.stockIdentity?.memberId!==actor.memberId)throw Error('Original Warehouse CBM identity required');
   if(staff&&(actor.staffId!==staff.staffId||actor.memberId!==staff.memberId))throw Error('Original CBM actor changed');staff=actor;return actor;};
  await authorize();
  const journal=company==='NCT'?'NCTActivity':'NCTActivity1',key=hash(company+'/PURCHASE',request.requestId,staff.memberId);
  let prepared;
  if(!await store.read(journal,key)){
   prepared=await protocol.readSnapshot(async control=>{
    if(control.company!==company||!control._version||!Number.isSafeInteger(control.generation)||control.generation<0
     ||control.mode!=='ACTIVE'||control.schemaVersion!==1||control.writerBuild!==request.stockBuild||request.stockGeneration>control.generation)throw Error('Current CBM read checkpoint required');
    if(WRITERS.some(writer=>coverage?.[writer]?.verified!==true||coverage[writer].build!==control.writerBuild))throw Error('Inventory writer coverage incomplete; activation blocked');
    const data=await readCurrentOrders(company);
    if(data.stockCurrent?.schema!=='CURRENT_WAREHOUSE_V2'||data.stockCurrent.stockGeneration!==control.generation
     ||data.stockCurrent.stockBuild!==control.writerBuild||data.staff?.staffId!==staff.staffId||data.staff?.memberId!==staff.memberId)throw Error('Same-generation original Warehouse CBM data required');
    const captured=await captureOriginalWarehouseCbm({company,staff,requestId:request.requestId,taskId:request.input.taskId,data,createWarehouseCbmCapture,captureCosts,now});
    if(captured.plan&&evaluateStockAdmission({company,writer:'COST_REFERENCE',control,coverage,request}).route!=='FENCED_CURRENT')throw Error('Current CBM save admission required');
    return captured;
   });
   // Already-known immutable reference is a fresh ORIGINAL read, not a committed
   // quantity action. A stale form may read that value; no generation is rewritten
   // in its request and no CMS manifest/receipt is created. Existing manifests must
   // always take the coordinator replay below, even if their event is now visible.
   if(prepared.rows.outcome)return{...prepared.rows.outcome,company,stockGeneration:prepared.generation};
  }
  const result=await createCurrentStockSave({company,writer:'COST_REFERENCE',store,protocol,coverage,authenticate:authorize,
   prepare:async()=>{if(!prepared?.rows.plan)throw Error('Original CBM plan missing');return{plan:prepared.rows.plan,generation:prepared.generation,memberId:staff.memberId};}})(request);
  if(result.ok!==true)return result;
  const snapshot=await protocol.readSnapshot(()=>store.read(journal,hash(company,request.input.taskId,'WAREHOUSE_CBM_CAPTURED'))),event=snapshot.rows;
  if(!event?._version||event.company!==company||event.action!=='WAREHOUSE_CBM_CAPTURED'||event.result!=='SAVED'
   ||event._id!==event.title||event.imageAltText!==request.input.taskId||event.details?.company!==company||event.initiatedByStaffId!==staff.staffId
   ||!valid(event.details.cbmPerCtn))throw Error('Committed original CBM receipt unconfirmed');
  return{...result,company,taskId:request.input.taskId,cbmPerCtn:event.details.cbmPerCtn};
 };
}
module.exports={captureOriginalWarehouseCbm,createCurrentWarehouseCbmSave};
