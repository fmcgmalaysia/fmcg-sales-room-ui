import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash } from 'crypto';
import { createSdkConditionalStore, createSegmentedFencedProof, createCurrentOrderIntakeOperations } from 'backend/r2stockCurrentCommands.js';
import { createNctIntake, createNctReceiptReader } from 'backend/r2nctIntake.js';
const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Dedicated retained fixture, never a business authority or activation verifier.
async function verifyR2IntakeCapacity({items,createSdkConditionalStore,createSegmentedFencedProof,createCurrentOrderIntakeOperations,
 createNctIntake,createNctReceiptReader,hash,copy,same,input,enabled=false,now=()=>Date.now()}){
 if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='step'||!['SEED','ADVANCE','FAULT','INSPECT','REPLAY'].includes(input.step))throw Error('Fixed intake capacity step required');
 const prefix='SPT-R2INTAKE300-20261024-4f8c:',collection='StockProtocolTest',company='NCT',journal='R2NCTActivity',started=now();
 const counts={queries:0,inserts:0,patches:0,deletes:0};let stage='PREFLIGHT',mutationAttempted=false;
 const report=(ok,extra={})=>({ok,schema:'R2_REAL_INTAKE_CAPACITY_V1',step:input.step,stage,elapsedMs:now()-started,operationsAttempted:{...counts},mutationAttempted,
  fixedLineCount:300,distinctProducts:300,coordination:'CONTROL_CAS_CANDIDATE',stepsPerInvocation:20,
  originalBusinessCollectionsAccepted:false,staffAuthorizationAccepted:false,activationReady:false,...extra});
 if(!enabled)return report(false,{stage:'CLOSED',blocked:true});
 const allowed=new Set([journal,'R2NCTOrders','R2NCTTasks','R2StockProducts','R2NCTActivity1']);
 const address=(name,id)=>{if(!allowed.has(name)||typeof id!=='string'||!id)throw Error('Fixed intake logical scope');return prefix+name+':'+id;};
 const bounded={query:name=>{if(name!==collection||++counts.queries>200)throw Error('Intake query scope/budget');return items.query(name);},
  insert:async(name,row)=>{if(name!==collection||!row?._id?.startsWith(prefix)||++counts.inserts>40)throw Error('Intake insert scope/budget');mutationAttempted=true;return items.insert(name,row);},
  patch:(name,id)=>{if(name!==collection||!id?.startsWith(prefix)||++counts.patches>26)throw Error('Intake patch scope/budget');mutationAttempted=true;return items.patch(name,id);},
  remove:()=>{throw Error('NO_DELETE_CAPABILITY');}};
 const raw=createSdkConditionalStore({items:bounded,company,collections:[collection]});
 const pack=(name,row)=>({_id:address(name,row._id),company,_version:row._version||hash('TEST_INSERT_ONLY',row),details:copy(row)});
 const unpack=(name,id,row)=>{if(!row)return null;if(row._id!==address(name,id)||row.details?._id!==id||row.details.company!==company)throw Error('Exact retained intake image required');
  if(row.details._version&&row.details._version!==row._version)throw Error('Retained intake version mismatch');return copy(row.details);};
 const store={read:async(name,id)=>unpack(name,id,await raw.read(collection,address(name,id))),
  readMany:async(name,ids)=>(await raw.readMany(collection,ids.map(id=>address(name,id)))).map((row,index)=>unpack(name,ids[index],row)),
  insert:async(name,row)=>unpack(name,row._id,await raw.insert(collection,pack(name,row))),
  compareAndSet:async(name,id,version,row)=>{if(row?._id!==id)throw Error('Exact intake conditional image required');return unpack(name,id,await raw.compareAndSet(collection,address(name,id),version,pack(name,row)));},
  compareAndRemove:()=>{throw Error('NO_LOCK_REMOVAL_CAPABILITY');}};
 const policy={company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,stepsPerInvocation:20};
 const protocol=createSegmentedFencedProof(policy),controlId=protocol.ids.controlId;
 const body={sourceSiteId:'5292b63a-30e5-4c0e-8762-a1b127bbc651',destination:company,orderId:'CAPACITY-4F8C-300',
  customerId:'CAPACITY-CUSTOMER',customerCompanyName:'Capacity test fixture',submissionId:'CAPACITY-SUBMISSION-4F8C',submittedByStaffId:'CAPACITY-SALES',submittedByStaffName:'Capacity fixture',
  submittedAt:'2026-10-24T03:00:00Z',transactionCurrency:'USD',fxRate:4.3,estimatedShipmentDate:'2026-11-12',
  lines:Array.from({length:300},(_,i)=>({sourceLineId:'L'+i,unitBarcode:String(i).padStart(6,'0'),itemName:'Capacity item '+i,packingSize:'12x1',eaPerCtn:12,qtyCtn:100,sellingPricePc:2}))};
 const writers=['RECEIPT','ALLOCATION','BORROWING','SALES_DEMAND','PURCHASE_SOURCE','PURCHASE_PLAN','PURCHASE_TASK','STOCK_EXCEPTION','STOCK_RESOLUTION','PACKING','WAREHOUSE_PREPARATION','SHIPMENT','ORDER_INTAKE','ORDER_UPDATE','COST_REFERENCE','MARGIN_REFERENCE','SHIPMENT_PLAN','QUANTITY_CASE','PURCHASE_ORDER_RECORD','ACCOUNT_PURCHASE_RECORD'];
 // Test-only admission inside the physically restricted adapter. Never exported
 // as business writer coverage or native authorization/installation evidence.
 const coverage=Object.fromEntries(writers.map(name=>[name,{verified:true,build:'CAPACITY-FIXTURE-ONLY'}]));
 let captures=0,writes=0,injected=false;
 const executionStore=input.step==='FAULT'?{...store,insert:async(name,row)=>{if(!row.stockOperationProtocol&&name!==journal){if(writes===3){injected=true;throw Error('KNOWN_INTAKE_INTERRUPTION');}writes++;}return store.insert(name,row);}}:store;
 const operations=createCurrentOrderIntakeOperations({company,store:executionStore,protocol:createSegmentedFencedProof({...policy,store:executionStore}),coverage,
  createNctIntake,createNctReceiptReader,readOppositePreparation:(name,id)=>store.read(name,id),now:()=>new Date('2026-10-24T03:00:01Z'),
  captureCosts:async barcodes=>{captures++;return Object.fromEntries(barcodes.map(unitBarcode=>[unitBarcode,{unitBarcode,capturedAt:'2026-10-24T03:00:01Z',costCurrency:'MYR',costStatus:'CAPTURED',costIssues:[],lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0,netCostCtn:12,cbmPerCtn:0.1}]));}});
 try{
  if(await store.read(journal,protocol.ids.lockId))throw Error('Unexpected test lock; retain without removal');
  if(input.step==='SEED'){
   stage='FRESH_CONTROL_ONLY';const page=await bounded.query(collection).startsWith('_id',prefix).limit(1).find({consistentRead:true,returnTotalCount:true});
   if(!Array.isArray(page?.items)||page.items.length||page.totalCount!==0)throw Error('Occupied dedicated fixture; no reset or adoption');
   await store.insert(journal,{_id:controlId,company,generation:0,pending:null,_version:'INTAKE-GENESIS',mode:'ACTIVE',schemaVersion:1,writerBuild:'CAPACITY-FIXTURE-ONLY'});
   const seeded=await protocol.readControl();if(seeded._version!=='INTAKE-GENESIS'||seeded.generation!==0||seeded.pending!==null)throw Error('Seed unconfirmed');
   stage='SEEDED';return report(true,{generation:0,seededControls:1});
  }
  const control=await protocol.readControl();if(control.writerBuild!=='CAPACITY-FIXTURE-ONLY'||control.generation>1)throw Error('Fixed diagnostic control required');
  if(input.step==='INSPECT'){
   stage='READ_ONLY_INSPECTION';
   if(control.pending){let blocked=false;try{await operations.readReceipt(body);}catch(error){blocked=/pending/.test(error.message);}if(!blocked)throw Error('Intake read barrier missing');
    return report(true,{generation:control.generation,pending:copy(control.pending),mixedReadBlocked:true});}
   if(control.generation!==1)throw Error('No completed test result');
   const receipt=await operations.readReceipt(body);if(receipt.ok!==true||receipt.taskIds?.length!==300)throw Error('Complete original intake receipt required');
   const tasks=await store.readMany('R2NCTTasks',receipt.taskIds),orders=await store.readMany('R2NCTOrders',body.lines.map(line=>hash(body.sourceSiteId,body.orderId,line.sourceLineId,'ORDER')));
   const products=await bounded.query(collection).startsWith('_id',prefix+'R2StockProducts:').limit(301).find({consistentRead:true,returnTotalCount:true});
   if(tasks.some(row=>!row||row.receivedQtyInCtn!==null||row.ourPoNumber!==''||row.supplierId!==''||row.stockCounterSchema!==2||row.stockDispatchedCumulative!==0)
    ||orders.some(row=>!row||row.orderQtyInCtn!==100||row.estimatedShipmentDate!==body.estimatedShipmentDate)
    ||products.totalCount!==300||products.items?.length!==300||products.items.some(row=>row.company!==company||row.details?.onHand!==0||row.details.available!==0||row.details.reservedUsable!==0)
    ||!same(await protocol.readControl(),control))throw Error('Complete original intake after-images required');
   stage='FINAL_RECEIPT_VERIFIED';return report(true,{generation:1,pending:null,orderId:receipt.orderId,taskCount:receipt.taskIds.length,orderCount:orders.length,productCount:products.totalCount,verifiedDomainImages:1202,costErrorTaskCount:receipt.costErrorTaskCount});
  }
  if(input.step==='REPLAY'?control.generation!==1||control.pending:control.generation!==0)throw Error('Exact intake operation phase required');
  if(input.step==='FAULT'&&(!control.pending||!['BEFORE','APPLY'].includes(control.pending.phase)||control.pending.phase==='BEFORE'&&control.pending.count-control.pending.cursor>=20||control.pending.phase==='APPLY'&&control.pending.cursor!==0))throw Error('Exact first APPLY boundary required');
  stage='EXECUTING';let outcome;
  try{outcome=await operations.receive(body);}catch(error){if(!injected||error.message!=='KNOWN_INTAKE_INTERRUPTION')throw error;
   const after=await protocol.readControl();if(after.generation!==0||after.pending?.phase!=='APPLY'||after.pending.cursor!==0||writes!==3)throw Error('Known interruption checkpoint changed');
   stage='KNOWN_INTERRUPTION_CONFIRMED';return report(true,{pending:copy(after.pending),partialBusinessInserts:3,captures,noLockCreated:true});}
  const after=await protocol.readControl();if(await store.read(journal,protocol.ids.lockId))throw Error('Unexpected test lock created');
  stage=input.step==='REPLAY'?'COMPLETED_REPLAY':'CHECKPOINT_CONFIRMED';
  return report(true,{outcome,control:{generation:after.generation,pending:copy(after.pending)},captures,noLockCreated:true});
 }catch(error){return report(false,{error:error.message,retainRequest:true,noAutomaticRetryResetOrCleanup:true});}
}

const R2_INTAKE_CAPACITY_ENABLED=false;
export const verifyR2Intake=webMethod(Permissions.Admin,async input=>{const result=await verifyR2IntakeCapacity({items,createSdkConditionalStore,createSegmentedFencedProof,createCurrentOrderIntakeOperations,createNctIntake,createNctReceiptReader,hash,copy,same,input,enabled:R2_INTAKE_CAPACITY_ENABLED});console.info('R2INTAKE_RECEIPT '+JSON.stringify(result));return result;});
