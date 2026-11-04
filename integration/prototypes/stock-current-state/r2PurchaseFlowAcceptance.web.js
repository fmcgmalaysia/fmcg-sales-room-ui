import { items as sdkItems } from '@wix/data';
import { auth } from '@wix/essentials';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { createHash } from 'crypto';
import { planCollections, createSdkConditionalStore, createSegmentedFencedProof, createCurrentOrderIntakeOperations, createCurrentPurchaseSave } from 'backend/r2stockCurrentCommands.js';
import { createNctIntake, createNctReceiptReader } from 'backend/r2nctIntake.js';
import { requirePurchaseStaff, projectPurchaseWorkspace } from 'backend/r2purchaseProjection.js';
import { createPurchaseOperations } from 'backend/r2purchaseOperations.js';
import { createPurchaseSourceOperations } from 'backend/r2purchaseSources.js';
import { taskEditVersion } from 'backend/r2purchaseTaskIdentity.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { readAllocations } from 'backend/r2plannerAllocation.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readPackingLists } from 'backend/r2packingListOperations.js';
import { packingHeld } from 'backend/r2packingListModel.js';
const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const stable=value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const copy=value=>JSON.parse(JSON.stringify(value));
const runtime={planCollections,createSdkConditionalStore,createSegmentedFencedProof,createCurrentOrderIntakeOperations,createCurrentPurchaseSave};
const original={createNctIntake,createNctReceiptReader,requirePurchaseStaff,projectPurchaseWorkspace,createPurchaseOperations,createPurchaseSourceOperations,taskEditVersion,operationId,projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld};
async function verifyR2PurchaseFlow({ input, enabled = false, items, runtime, original, authenticate, hash, stable, copy }) {
  const steps = ['SEED','INTAKE','PLAN','PO','INSPECT'];
  if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'step' || !steps.includes(input.step)) throw Error('Fixed Purchase workflow step required');
  const base = { schema:'R2_PURCHASE_WORKFLOW_ACCEPTANCE_V1',fixture:'PURCHASEFLOW-20261025-a479',step:input.step,activationAllowed:false,
    writerCoverageAccepted:false,pairedSourceTransportAccepted:false,originalBusinessCollectionsAccepted:false,
    realInvoiceEnabled:false,physicalDispatchEnabled:false };
  if (!enabled && input.step !== 'INSPECT') return {...base,ok:false,stage:'CLOSED',mutationAttempted:false};
  const identity = await authenticate();
  const staff = original.requirePurchaseStaff(identity.member,identity.staffRows);
  if (!identity.member?._id || staff.memberId && staff.memberId !== identity.member._id
    || !staff.staffId || staff.staffId !== identity.staffId) throw Error('Original Purchase identity required');
  const owner = hash(identity.member._id,staff.staffId), company = 'NCT', physical = 'StockProtocolTest';
  const prefix = 'SPT-R2PURCHASEFLOW-20261025-a479:', build = 'PURCHASE-FLOW-FIXTURE-ONLY';
  const journal = 'R2NCTActivity', tasks = 'R2NCTTasks', orders = 'R2NCTOrders', opposite = 'R2NCTActivity1';
  const allowed = new Set([...runtime.planCollections(company,true),opposite,'FLOW_COMMAND']);
  const counts = {queries:0,inserts:0,bulkInserts:0,patches:0}; let mutationAttempted = false;
  const bounded = {
    query: name => {if(name !== physical || ++counts.queries > 160)throw Error('Fixed Purchase workflow query budget');return items.query(name);},
    insert: async (name,row) => {if(name !== physical || !row?._id?.startsWith(prefix) || ++counts.inserts > 36)throw Error('Fixed Purchase workflow insert budget');mutationAttempted=true;return items.insert(name,row);},
    bulkInsert: async (name,rows) => {if(name !== physical || !Array.isArray(rows) || !rows.length || rows.length>32
      || rows.some(row=>!row?._id?.startsWith(prefix)) || ++counts.bulkInserts > 6)throw Error('Fixed Purchase workflow bulk budget');mutationAttempted=true;return items.bulkInsert(name,rows);},
    patch: (name,id) => {if(name !== physical || !id?.startsWith(prefix) || ++counts.patches > 8)throw Error('Fixed Purchase workflow patch budget');mutationAttempted=true;return items.patch(name,id);},
    remove: () => {throw Error('NO_DELETE_CAPABILITY');}
  };
  const raw = runtime.createSdkConditionalStore({company,items:bounded,collections:[physical]});
  function address(name,id) {if(!allowed.has(name)||typeof id!=='string'||!id)throw Error('Fixed Purchase workflow logical scope');return prefix+name+':'+id;}
  const pack = (name,row) => ({_id:address(name,row._id),company,_version:row._version||hash('FIXTURE_INSERT',stable(row)),details:copy(row)});
  const unpack = (name,id,row) => {
    if(!row)return null;
    if(row._id!==address(name,id)||row.details?._id!==id||row.details.company!==company
      ||row.details._version&&row.details._version!==row._version)throw Error('Exact retained Purchase workflow image required');
    return copy(row.details);
  };
  const store = {
    normalizeListedRow: (name,row) => {address(name,row?._id);if(row.company!==company||!row._version)throw Error('Owned Purchase workflow image required');return copy(row);},
    read: async (name,id) => unpack(name,id,await raw.read(physical,address(name,id))),
    readMany: async (name,ids) => (await raw.readMany(physical,ids.map(id=>address(name,id)))).map((row,index)=>unpack(name,ids[index],row)),
    insert: async (name,row) => {if(name===opposite)throw Error('Opposite company read-only');return unpack(name,row._id,await raw.insert(physical,pack(name,row)));},
    insertMany: async (name,rows) => {if(name===opposite)throw Error('Opposite company read-only');return raw.insertMany(physical,rows.map(row=>pack(name,row)));},
    compareAndSet: async (name,id,version,row) => {if(name===opposite||row?._id!==id)throw Error('Exact own-company conditional image required');return unpack(name,id,await raw.compareAndSet(physical,address(name,id),version,pack(name,row)));},
    compareAndRemove: () => {throw Error('NO_LOCK_REMOVAL_CAPABILITY');}
  };
  async function list(name) {
    address(name,'SCOPE');
    const page=await bounded.query(physical).startsWith('_id',prefix+name+':').limit(201).find({consistentRead:true,returnTotalCount:true});
    if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount>200||page.items.length!==page.totalCount)throw Error('Complete bounded workflow table required');
    return page.items.map(row=>unpack(name,row.details?._id,raw.normalizeListedRow(physical,row)));
  }
  const logicalItems={query:name=>{
    address(name,'QUERY');const filters=[];let limit=50;
    const q={eq:(field,value)=>{filters.push(row=>Array.isArray(row[field])?row[field].includes(value):row[field]===value);return q;},
      gt:(field,value)=>{filters.push(row=>row[field]>value);return q;},hasSome:(field,values)=>{filters.push(row=>values.includes(row[field]));return q;},
      ascending:()=>q,limit:value=>{limit=value;return q;},find:async()=>{const found=(await list(name)).filter(row=>filters.every(fn=>fn(row))).sort((a,b)=>a._id.localeCompare(b._id));return{items:found.slice(0,limit),totalCount:found.length};}};return q;
  }};
  const protocol=runtime.createSegmentedFencedProof({company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,batchNewInserts:true,stepsPerInvocation:4});
  const coverage=Object.fromEntries(['RECEIPT','ALLOCATION','BORROWING','SALES_DEMAND','PURCHASE_SOURCE','PURCHASE_PLAN','PURCHASE_TASK','STOCK_EXCEPTION','STOCK_RESOLUTION','PACKING','WAREHOUSE_PREPARATION','SHIPMENT','ORDER_INTAKE','ORDER_UPDATE','COST_REFERENCE','MARGIN_REFERENCE','SHIPMENT_PLAN','QUANTITY_CASE','PURCHASE_ORDER_RECORD','ACCOUNT_PURCHASE_RECORD'].map(name=>[name,{verified:true,build}]));
  const submission={sourceSiteId:'5292b63a-30e5-4c0e-8762-a1b127bbc651',destination:company,orderId:'R2-PURCHASE-FLOW-A479',customerId:'R2-FIXTURE-A479',
    customerCompanyName:'Isolated workflow fixture',submissionId:'R2-FIXTURE-A479-SUBMISSION',submittedByStaffId:'FIXTURE-SOURCE',submittedByStaffName:'Fixed source fixture',
    submittedAt:'2026-10-25T12:00:00Z',transactionCurrency:'USD',fxRate:4.3,estimatedShipmentDate:'2026-11-12',
    lines:[{sourceLineId:'FIXTURE-L1',unitBarcode:'R2-NATIVE-FIXTURE-A479',itemName:'Isolated fixture item',packingSize:'12x1',eaPerCtn:12,qtyCtn:100,sellingPricePc:2}]};
  const taskId=hash(submission.sourceSiteId,submission.orderId,submission.lines[0].sourceLineId,'TASK');
  async function sameActor() {
    const next=await authenticate(),verified=original.requirePurchaseStaff(next.member,next.staffRows);
    if(hash(next.member._id,verified.staffId)!==owner)throw Error('Same original workflow employee required');return next;
  }
  const intake=runtime.createCurrentOrderIntakeOperations({company,store,protocol,coverage,createNctIntake:original.createNctIntake,createNctReceiptReader:original.createNctReceiptReader,
    readOppositePreparation:(name,id)=>store.read(name,id),now:()=>new Date('2026-10-25T12:00:01Z'),captureCosts:async barcodes=>Object.fromEntries(barcodes.map(unitBarcode=>[unitBarcode,
      {unitBarcode,capturedAt:'2026-10-25T12:00:01Z',costCurrency:'MYR',costStatus:'CAPTURED',costIssues:[],lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0,netCostCtn:12,cbmPerCtn:0.1}]))});
  const deps={...original,company,store,protocol,items:logicalItems,now:()=>new Date('2026-10-25T12:00:02Z'),
    readMember:async()=>(await sameActor()).member,readStaffRecords:async()=>(await sameActor()).staffRows,
    readCurrentTaskRows:async(selected,ids)=>{if(selected!==company)throw Error('Fixed workflow company');return store.readMany(tasks,ids);},
    readTables:async selected=>{if(selected!==company)throw Error('Fixed workflow tables');return Object.fromEntries(await Promise.all([orders,tasks,journal,'R2PurchaseOrders'].map(async name=>[name,await list(name)]))
      .then(rows=>[...rows,['SharedSuppliers',[{_id:'FIXTURE-SUP',title:'FIXTURE-SUP',supplierName:'Isolated supplier',supplierStatus:'ACTIVE'}]]]));}};
  const save=runtime.createCurrentPurchaseSave({company,store,protocol,items:logicalItems,coverage,authorityDependencies:deps});
  const report=extra=>({...base,...extra,operationsAttempted:{...counts},mutationAttempted});
  if(await store.read(journal,protocol.ids.lockId))throw Error('Unexpected fixture lock; retain without removal');
  if(input.step==='SEED') {
    const page=await bounded.query(physical).startsWith('_id',prefix).limit(1).find({consistentRead:true,returnTotalCount:true});
    if(!Array.isArray(page?.items)||page.totalCount!==0||page.items.length)throw Error('Occupied workflow fixture; no reset/adoption');
    await store.insert(journal,{_id:protocol.ids.controlId,company,generation:0,pending:null,_version:'WORKFLOW-GENESIS',mode:'ACTIVE',schemaVersion:1,transferIndexVersion:2,writerBuild:build,fixtureOwner:owner});
    await sameActor();return report({ok:true,stage:'SEEDED',generation:0});
  }
  const present=await store.read(journal,protocol.ids.controlId);
  if(!present&&input.step==='INSPECT') {
    const page=await bounded.query(physical).startsWith('_id',prefix).limit(1).find({consistentRead:true,returnTotalCount:true});
    if(!Array.isArray(page?.items)||page.totalCount!==0||page.items.length)throw Error('Unknown occupied workflow without a control; inspect only');
    return report({ok:true,stage:'EMPTY_FIXED_WORKFLOW',retainedRecords:0,nextStep:'SEED'});
  }
  const control=await protocol.readControl();
  if(control.writerBuild!==build||control.fixtureOwner!==owner||control.generation>3)throw Error('Owned fixed workflow control required');
  if(input.step==='INSPECT') {
    const table=await list(tasks),sourceOrders=await list(orders),events=await list(journal),products=await list('R2StockProducts');
    const positions=await list('R2StockPositions'),claims=await list('R2StockClaims');
    const workspace=original.projectPurchaseWorkspace({company,staff,orders:sourceOrders,tasks:table,activity:events,
      suppliers:[{_id:'FIXTURE-SUP',title:'FIXTURE-SUP',supplierName:'Isolated supplier',supplierStatus:'ACTIVE'}]});
    const projected=workspace.tasks.find(row=>row.id===taskId);
    const complete=control.generation===3&&control.pending===null&&table.length===1&&sourceOrders.length===1
      &&table[0]._id===taskId&&table[0].purchaseQtyInCtn===100&&projected?.procurement?.totalCtn===90
      &&table[0].ourPoNumber==='R2-FIXTURE-PO-A479'&&table[0].receivedQtyInCtn===null
      &&sourceOrders[0].orderQtyInCtn===100&&sourceOrders[0].estimatedShipmentDate==='2026-11-12'
      &&products.length===1&&products[0].onHand===0&&products[0].reservedUsable===0&&positions.length===0&&claims.length===0
      &&['ORDER_RECEIVED','PURCHASE_PLAN_SAVED','PURCHASE_PO_ASSIGNED'].every(action=>events.filter(row=>row.action===action).length===1);
    const after=await protocol.readControl();if(stable(after)!==stable(control))throw Error('Workflow changed during inspection');
    return report({ok:true,stage:complete?'PURCHASE_WORKFLOW_VERIFIED':'READ_ONLY_INSPECTION',generation:control.generation,pending:copy(control.pending),
      nextStep:complete?null:['INTAKE','PLAN','PO'][control.generation]||null,
      complete,taskCount:table.length,orderCount:sourceOrders.length,physicalStock:products.reduce((n,row)=>n+row.onHand,0),
      customerDemand:sourceOrders[0]?.orderQtyInCtn??null,purchaseQuantity:projected?.procurement?.totalCtn??null,
      originalPurchaseActorVerified:true,observationsHash:hash(stable({control,table,sourceOrders,events,products,positions,claims}))});
  }
  await sameActor();
  if(input.step==='INTAKE')return report({ok:true,stage:'INTAKE_CONTINUATION',result:await intake.receive(submission)});
  const expectedGeneration=input.step==='PLAN'?1:2,requestId=input.step==='PLAN'?'a4790001-2026-4250-8250-000000000001':'a4790002-2026-4250-8250-000000000002';
  const commandId=input.step,prior=await store.read('FLOW_COMMAND',commandId);let request;
  if(prior) {
    if(prior.owner!==owner||prior.step!==input.step||prior._version!==hash('FIXED_WORKFLOW_REQUEST',prior.requestJson)||typeof prior.requestJson!=='string')throw Error('Retained workflow request identity conflict');
    request=JSON.parse(prior.requestJson);
  } else {
    if(control.pending||control.generation!==expectedGeneration)throw Error('Exact workflow stage required; inspect without retry');
    const task=await store.read(tasks,taskId);if(!task)throw Error('Original intake task required');
    request={requestId,operation:input.step,stockProtocol:1,stockBuild:build,stockGeneration:expectedGeneration,
      input:input.step==='PLAN'?{taskId,version:original.taskEditVersion(task),planRevision:'',supplierId:'FIXTURE-SUP',totalCtn:90,transportMode:'SUPPLIER_DELIVER',reason:'Fixed ninety carton procurement',
        costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:90,freeCtn:0,prices:{lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0}}}
        :{taskIds:[taskId],versions:{[taskId]:original.taskEditVersion(task)},poNumber:'R2-FIXTURE-PO-A479'}};
    const requestJson=JSON.stringify(request);
    await store.insert('FLOW_COMMAND',{_id:commandId,company,_version:hash('FIXED_WORKFLOW_REQUEST',requestJson),owner,step:input.step,requestJson});
  }
  const result=await save(request);await sameActor();
  return report({ok:true,stage:'PURCHASE_CONTINUATION',operation:input.step,result});
}
async function authenticate(){const member=await currentMember.getMember({fieldsets:['FULL']});if(!member?._id||!member.loginEmail||member.status!=='APPROVED')throw Error('Actual approved Purchase employee required');let page=await wixData.query('StaffMasterAccess').limit(1000).find({suppressAuth:true,consistentRead:true});const staffRows=[...page.items];while(page.hasNext()){page=await page.next();staffRows.push(...page.items);}const staff=requirePurchaseStaff(member,staffRows);return{member,staffRows,staffId:staff.staffId};}
const R2_PURCHASE_FLOW_ENABLED=false;
const acceptanceBuild="b1d3dcf828d848b6c25d0eaab90a7b50666a12a5";
export const verifyPurchaseWorkflow=webMethod(Permissions.SiteMember,async input=>{if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='step'||!['SEED','INTAKE','PLAN','PO','INSPECT'].includes(input.step))throw Error('Fixed Purchase workflow step required');if(!R2_PURCHASE_FLOW_ENABLED&&input.step!=='INSPECT'){const result={...(await verifyR2PurchaseFlow({input,enabled:false})),acceptanceBuild};console.info('R2_PURCHASE_WORKFLOW_RECEIPT '+JSON.stringify(result));return result;}const actor=await authenticate();const items={query:auth.elevate(sdkItems.query),insert:auth.elevate(sdkItems.insert),bulkInsert:auth.elevate(sdkItems.bulkInsert),patch:auth.elevate(sdkItems.patch),remove:()=>{throw Error('NO_DELETE_CAPABILITY');}};const originalAuthenticate=async()=>{const next=await authenticate();if(next.member._id!==actor.member._id||next.staffId!==actor.staffId)throw Error('Same original Purchase employee required');return next;};const result={...(await verifyR2PurchaseFlow({input,enabled:R2_PURCHASE_FLOW_ENABLED,items,runtime,original,authenticate:originalAuthenticate,hash,stable,copy})),acceptanceBuild};console.info('R2_PURCHASE_WORKFLOW_RECEIPT '+JSON.stringify(result));return result;});
