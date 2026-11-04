const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectSupplyAllocation}=load('customerAllocationContext.js');
const task=(id,demand,total,accepted=0)=>({id,ord:demand,requested:demand,po:'PO-'+id,supplierId:'S',procurement:{totalCtn:total,customerCtn:Math.min(demand,total),expectedExtra:Math.max(0,total-demand)},warehouse:accepted?{accepted,issue:false}:null});
function fixture(rows,claims=[]){return {workspace:{company:'NCT',tasks:rows},physical:{company:'NCT',sources:claims.map(([id,owner,quantity])=>({id,targets:[{taskId:owner,quantity}]}))}};}
const run=f=>JSON.parse(JSON.stringify(projectSupplyAllocation(f.workspace,f.physical)));
test('formal PO plans200 without manufacturing a physical target or receipt',()=>{const f=fixture([task('A',200,200)]),before=JSON.stringify(f);assert.deepEqual(run(f),[{taskId:'A',planned:200,received:0,waiting:200,gap:0,unplaced:0}]);assert.equal(JSON.stringify(f),before);});
test('draft and document-only PO do not commit supply; formal assignment supersedes draft flag',()=>{const draft=task('A',200,200);draft.procurement.draftPlan=true;draft.po='';draft.documentPo='uploaded.pdf';assert.equal(run(fixture([draft]))[0].planned,0);draft.po='FORMAL-PO';assert.equal(run(fixture([draft]))[0].planned,200);});
test('Extra10 does not enter customer allocation100',()=>{assert.equal(run(fixture([task('A',100,110)]))[0].planned,100);});
test('partial170 then30 releases physical supply while plan remains200',()=>{let f=fixture([task('A',200,200,170)],[['A','A',170]]);assert.deepEqual(run(f)[0],{taskId:'A',planned:200,received:170,waiting:30,gap:0,unplaced:0});f.workspace.tasks[0].warehouse.accepted=200;f.physical.sources[0].targets[0].quantity=200;assert.equal(run(f)[0].waiting,0);});
test('confirmed shortage190 is gap10; free replacement closes gap without making210',()=>{const a=task('A',200,200,190);a.warehouse.issue=true;const f=fixture([a],[['A','A',190]]);assert.equal(run(f)[0].gap,10);f.physical.sources.push({id:'FREE',targets:[{taskId:'A',quantity:10}]});assert.deepEqual(run(f)[0],{taskId:'A',planned:200,received:200,waiting:0,gap:0,unplaced:0});});
test('own200 plus free20 plans220 against demand250',()=>{assert.equal(run(fixture([task('A',250,200,200)],[['A','A',200],['FREE','A',20]]))[0].planned,220);});
test('replacement PO10 does not increase customer demand or allocation beyond200',()=>{const a=task('A',200,200,190);a.warehouse.issue=true;const replacement={...task('R',0,10),procurementSource:true,customerDemandTaskId:'A',procurement:{totalCtn:10,customerCtn:10}};assert.equal(run(fixture([a,replacement],[['A','A',190]]))[0].planned,200);});
test('borrowed donor keeps its target and exposes physical gap instead of shrinking commitment',()=>{const rows=[task('A',250,200,200),task('B',280,280,280)];const f=fixture(rows,[['A','A',200],['FREE','A',20],['B','A',30],['B','B',250]]);assert.equal(run(f)[0].planned,250);assert.equal(run(f)[1].planned,280);assert.equal(run(f)[1].gap,30);});
test('isolation10 from receipt480 against demand500 leaves170 usable after300 already loaded',()=>{const a=task('A',500,500,480);const f=fixture([a],[['A','A',470]]),r=run(f)[0];assert.deepEqual(r,{taskId:'A',planned:500,received:470,waiting:20,gap:10,unplaced:0});assert.equal(r.received-300,170);});
test('read-only repeated projection writes no state and company mismatch rejects',()=>{const f=fixture([task('A',200,120)]),first=run(f);assert.deepEqual(run(f),first);assert.equal(first[0].unplaced,80);f.physical.company='GHR';assert.throws(()=>run(f),/company/);});

function actualProjection(accepted=null,issue=false){
 const at='2026-11-01T08:00:00Z',rawTask={_id:'T',title:'T',description:'O',imageAltText:'L',purchaseQtyInCtn:200,receivedQtyInCtn:0,supplierId:'S',ourPoNumber:'PO-1',purchaseStage:'WAITING_FOR_GOODS',lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0};
 const order={title:'O',sourceLineId:'L',submissionId:'SUB',customerId:'C',customerCompanyName:'Customer',description:'SKU',image:'Product',imageAltText:'12 x 1',orderId:12,orderQtyInCtn:200,transactionCurrency:'USD',masterReceivedTime:at};
 const activity=[{title:'INTAKE',description:'O',action:'ORDER_RECEIVED',result:'ACCEPTED',activityTime:at,details:{submissionId:'SUB',taskIds:['T']}},{title:'PLAN',description:'O',image:'L',imageAltText:'T',action:'PURCHASE_PLAN_SAVED',result:'SAVED',activityTime:at,details:{beforeRevision:'',totalCtn:200,transportMode:'SUPPLIER_DELIVER',draftPlan:true}}];
 if(accepted!==null)activity.push({title:'RECEIPT',description:'P',action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:at,details:{beforeRevision:'',lines:[{taskId:'T',orderId:'O',sourceLineId:'L',planned:200,beforeAccepted:0,beforeRejected:0,accepted,rejected:0,kind:issue?'SHORT':'PARTIAL',issue,reason:'Test receipt'}]}});
 const inputs={company:'NCT',tasks:[rawTask],orders:[order],activity,suppliers:[{title:'S',companyName:'Supplier'}],staff:{staffId:'P',staffName:'Purchase'}};
 return {inputs,workspace:load('purchaseProjection.js').projectPurchaseWorkspace(inputs)};
}
test('real Purchase projection assigns received170 automatically without a PLANNER save or CMS write',()=>{
 const f=actualProjection(170),before=JSON.stringify(f.inputs),row=f.workspace.tasks[0];assert.equal(row.inc,170);assert.equal(row.supplyAllocation.planned,200);assert.equal(row.supplyAllocation.waiting,30);assert.equal(f.workspace.allocations[0].targets[0].quantity,170);assert.equal(f.workspace.allocations[0].automatic,true);assert.equal(f.inputs.activity.some(x=>x.action==='PLANNER_ALLOCATION_SAVED'),false);assert.equal(JSON.stringify(f.inputs),before);
});
test('real PO remains planned200 before arrival, and confirmed short receipt exposes gap10',()=>{
 let f=actualProjection();assert.equal(f.workspace.tasks[0].inc,0);assert.equal(f.workspace.tasks[0].supplyAllocation.planned,200);assert.equal(f.workspace.allocations.length,0);
 f=actualProjection(190,true);assert.equal(f.workspace.tasks[0].inc,190);assert.equal(f.workspace.tasks[0].supplyAllocation.gap,10);
});

test('Desk may authorize incoming100 but actual packing is limited to received50',async()=>{
 const f=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs').fixture();f.tasks[0].inc=50;f.tasks[0].supplyAllocation={planned:100};
 const claim=f.records.get('N/ALLOCATION-B');claim.details.targets=[{taskId:'B',quantity:100}];
 const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{packingVersion}=load('packingListOperations.js');
 const deskSave=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context});
 await deskSave({company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'},requestId:f.nextId(),input:{action:'DESK_ASSIGN',customerId:'CUSTOMER-A',desk:1,taskId:'A',revision:''}});
 const state=readSupportDesks((await f.context()).activity,'NCT')[0];
 const sent=await f.packingSave({company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'},requestId:f.nextId(),input:{action:'DESK_SEND',customerId:'CUSTOMER-A',desk:1,deskRevision:state.revision,version:packingVersion(await f.packingContext('NCT')),lines:[{taskId:'A',quantity:100}]}});
 assert.equal(sent.list.lines[0].quantity,100);assert.equal((await f.stock()).onHand,150);
 const request=loaded=>({company:'NCT',staff:{...f.staff,packingDepartment:'WAREHOUSE'},requestId:f.nextId(),input:{action:'DESK_LOAD',id:sent.id,revision:sent.revision,taskId:'A',loaded,reasonCodes:['INSUFFICIENT']}});
 let bad=request(100);bad.input.version=packingVersion(await f.packingContext('NCT'));await assert.rejects(f.packingSave(bad),/actually received/);assert.equal((await f.stock()).onHand,150);
 let good=request(50);good.input.version=packingVersion(await f.packingContext('NCT'));const result=await f.packingSave(good);assert.equal(result.list.lines[0].loaded,50);assert.equal((await f.stock()).onHand,100);
});

test('Support splits200 into120+80 with demand preserved and cannot discard another batch by whole-row movement',async()=>{
 const f=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs').fixture(),{createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{deskTaskPortions}=load('shortloadResolutionModel.js');
 const save=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context}),base={company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'}};
 const input={action:'DESK_SPLIT',customerId:'CUSTOMER-A',desk:1,taskId:'A',revision:'',parts:[{desk:1,quantity:60},{desk:2,quantity:40}]};
 const request={...base,requestId:f.nextId(),input};await save(request);await save(request);const c=await f.context(),state=readSupportDesks(c.activity,'NCT')[0],parts=deskTaskPortions(c.activity,state,c.tasks[0]);assert.deepEqual(Array.from(parts,x=>x.quantity).sort((a,b)=>a-b),[40,60]);assert.equal(f.tasks[0].requested,100);
 await assert.rejects(save({...base,requestId:f.nextId(),input:{...input,revision:state.revision,parts:[{desk:1,quantity:90}]}}),/whole customer demand/);
 await assert.rejects(save({...base,requestId:f.nextId(),input:{action:'DESK_ASSIGN',customerId:'CUSTOMER-A',desk:3,taskId:'A',revision:state.revision}}),/split form/);
 await assert.rejects(save({...base,staff:{...f.staff,packingDepartment:'WAREHOUSE'},requestId:f.nextId(),input}),/Support access/);
});
test('COMMITTED reads only confirmed Desk lists, excluding drafts, recalls and other companies',()=>{
 const {readDeskCommitments}=load('shortloadResolutionModel.js');const list=(id,company,status,quantity,loaded=0)=>({action:'SUPPORT_PACKING_LIST_CURRENT',details:{list:{id,company,status,desk:{number:1},sentAt:'2026-11-01T08:00:00Z',lines:[{taskId:'T',quantity,loaded}]}}});
 const activity=[list('ONE','NCT','SENT',200),list('DRAFT','NCT','DRAFT',100),list('RECALL','NCT','CANCELLED',200),list('GHR','GHR','SENT',700)];
 const r=readDeskCommitments(activity,'NCT','T');assert.equal(r.quantity,200);assert.equal(r.loaded,0);assert.equal(r.batches.length,1);assert.throws(()=>readDeskCommitments(activity.concat(activity[0]),'NCT','T'),/Duplicate/);
});
test('planned200, loaded190 and deferred10 conserve all four shipment metrics; missing weights remain unknown',()=>{
 const {shipmentQuantityMetrics}=load('shortloadResolutionModel.js'),spec={priceCtn:50,cbmPerCtn:.02,netKgPerCtn:8,grossKgPerCtn:10},plan=shipmentQuantityMetrics(200,spec),actual=shipmentQuantityMetrics(190,spec),rest=shipmentQuantityMetrics(10,spec);
 for(const key of ['amountCents','cbm','netKg','grossKg'])assert.ok(Math.abs(plan[key]-actual[key]-rest[key])<1e-8);
 assert.equal(actual.amountCents,950000);assert.equal(actual.netKg,1520);assert.equal(actual.grossKg,1900);assert.equal(shipmentQuantityMetrics(10,{priceCtn:0}).amountCents,0);assert.equal(shipmentQuantityMetrics(10,{priceCtn:50}).netKg,null);assert.equal(shipmentQuantityMetrics(10,{}).cbm,null);
});
test('real customer quantity contract retains ordered200 and receipt170 before any Desk commitment',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),f=actualProjection(170),{projectPurchaseQuantities}=load('purchaseQuantityProjection.js');
 const reply=projectPurchaseQuantities({customerId:'C',requests:[{orderId:'O',submissionId:'SUB'}],...f.inputs,workspace:f.workspace});
 const raw=reply.orders[0].lines[0];assert.equal(raw.quantityContract,2);assert.equal(raw.orderedQtyCtn,200);assert.equal(raw.committedQtyCtn,0);assert.equal(raw.uncommittedQtyCtn,200);assert.equal(raw.receivedQtyCtn,170);
 const code=fs.readFileSync(path.join(__dirname,'../../backend/masterQuantityProjection.js'),'utf8').replace('export function','function'),apply=vm.runInNewContext(code+';applyMasterQuantities');
 const original={orderId:'O',masterReceipt:{submissionId:'SUB'},lines:[{lineId:'L',barcode:'SKU',quantityCtn:200,lockedPriceCtn:50}]},line=apply('C',[original],reply)[0].lines[0];
 assert.equal(line.committedQtyCtn,0);assert.equal(line.effectiveRequestedQtyCtn,200);assert.equal(line.quantityCtn,200);assert.equal(line.receivedQtyCtn,170);assert.equal(line.lockedPriceCtn,50);assert.equal(original.lines[0].committedQtyCtn,undefined);
 reply.orders[0].lines[0].uncommittedQtyCtn=0;assert.throws(()=>apply('C',[original],reply),/Desk commitment/);
});
test('adding free and borrowed supply to an open Desk needs no recall; donor held stock remains protected',()=>{
 const {planCustomerAllocation}=load('customerAllocationPlan.js'),product={company:'NCT',barcode:'SKU',packing:'12 x1',ea:12},task=(id,demand,held=false)=>({...product,id,customerId:'C'+id,demand,held,batches:[{id:'WHOLE',quantity:demand}]}),source=(id,total,targets)=>({...product,id,usableReceived:total,availablePhysical:total,received:true,targets});
 const context={company:'NCT',version:'V',loans:[],tasks:[task('A',250,true),task('B',280)],sources:[source('OWN',200,[{taskId:'A',quantity:200}]),source('FREE',20,[]),source('DONOR',280,[{taskId:'B',quantity:280}])]},input={version:'V',taskId:'A',batchId:'WHOLE',borrow:true,donorTaskId:'B'},before=JSON.stringify(context);
 const result=planCustomerAllocation(context,input);assert.equal(result.assigned,250);assert.equal(result.loan.outstanding,30);assert.equal(result.physicalDelta,0);assert.equal(JSON.stringify(context),before);
 context.tasks[1].held=true;assert.throws(()=>planCustomerAllocation(context,input),/insufficient/);
});
test('planned Purchase batch quantities preserve saved source binding and exclude an unassigned supplier draft',()=>{
 const a=task('A',330,250),draft={...task('D',0,30),po:'',procurementSource:true,customerDemandTaskId:'A',procurement:{totalCtn:30,customerCtn:30}};
 a.batchEntitlements=[{id:'FIRST',quantity:200,sources:[{id:'A',quantity:150}]},{id:'NEXT',quantity:130,sources:[{id:'A',quantity:100},{id:'D',quantity:30}]}];const result=run(fixture([a,draft]))[0];assert.equal(result.planned,250);assert.deepEqual(result.batches.map(row=>row.planned),[150,100]);assert.equal(result.unplaced,80);
});
test('new170+30 receipts extend an observed allocation once, without another manual save or history row',()=>{
 const f=actualProjection(170),at='2026-11-01T08:01:00Z';f.inputs.activity.push({title:'ALLOC',imageAltText:'T',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:at,details:{beforeRevision:'',receivedTotalAtSave:170,targets:[{taskId:'T',quantity:170,batches:[{id:'WHOLE',quantity:170}]}]}});
 f.inputs.activity.push({title:'RECEIPT-2',description:'P',action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:'2026-11-01T08:02:00Z',details:{beforeRevision:'RECEIPT',lines:[{taskId:'T',orderId:'O',sourceLineId:'L',planned:200,beforeAccepted:170,beforeRejected:0,accepted:200,rejected:0,kind:'DELIVERY',issue:false,reason:''}]}});
 const project=load('purchaseProjection.js').projectPurchaseWorkspace,before=JSON.stringify(f.inputs);assert.equal(project(f.inputs).tasks[0].inc,200);assert.equal(project(f.inputs).allocations[0].targets[0].quantity,200);assert.equal(project(f.inputs).tasks[0].inc,200);assert.equal(JSON.stringify(f.inputs),before);
 delete f.inputs.activity.find(row=>row.title==='ALLOC').details.receivedTotalAtSave;assert.equal(project(f.inputs).tasks[0].inc,170); // Unknown legacy observation is never guessed.
});
test('new receipt preserves a later explicit200 batch and fills only the earlier unfilled batch',()=>{
 const {customerAllocationContext}=load('customerAllocationContext.js'),a={...task('A',300,300,230),customerId:'CA',orderId:'OA',barcode:'SKU',packing:'12 x1',ea:12,warehouse:{hasPhysicalReceipt:true,accepted:230}},workspace={company:'NCT',tasks:[a]},allocation={sourceTaskId:'A',revision:'R',receivedTotalAtSave:200,targets:[{taskId:'A',quantity:200,batches:[{id:'PLAN|1',quantity:0},{id:'PLAN|2',quantity:200}]}]};
 const plan={title:'SP',description:'PLAN',action:'CUSTOMER_SHIPMENT_PLAN_SAVED',result:'SAVED',initiatedByStaffId:'S',activityTime:'2026-11-01T08:00:00Z',details:{beforeRevision:'',plan:{id:'PLAN',company:'NCT',customerId:'CA',orderId:'OA',batches:[{sequence:1,label:'First',lines:[{taskId:'A',quantity:100}]},{sequence:2,label:'Next',lines:[{taskId:'A',quantity:200}]}]}}};
 const result=customerAllocationContext(workspace,[plan],[allocation],'V'),own=result.sources[0].targets[0];assert.equal(own.quantity,230);assert.equal(own.batches.find(row=>row.id==='PLAN|2').quantity,200);assert.equal(own.batches.find(row=>row.id==='PLAN|1').quantity,30);
});
test('incoming200 is kept out of repeat borrowing; only free20 plus deficit30 changes physical claims',()=>{
 const {planCustomerAllocation}=load('customerAllocationPlan.js'),product={company:'NCT',barcode:'SKU',packing:'12 x1',ea:12},context={company:'NCT',version:'V',loans:[],tasks:[{...product,id:'A',customerId:'CA',demand:250,batches:[{id:'WHOLE',quantity:250,waiting:200}]},{...product,id:'B',customerId:'CB',demand:280,batches:[{id:'WHOLE',quantity:280}]}],sources:[{...product,id:'FREE',received:true,usableReceived:20,availablePhysical:20,targets:[]},{...product,id:'B',received:true,usableReceived:280,availablePhysical:280,targets:[{taskId:'B',quantity:280}]}]};
 const result=planCustomerAllocation(context,{version:'V',taskId:'A',batchId:'WHOLE',borrow:true,donorTaskId:'B'});assert.equal(result.assigned,250);assert.equal(result.loan.quantity,30);assert.equal(result.changes.reduce((n,source)=>n+(source.targets.find(target=>target.taskId==='A')?.quantity||0),0),50);
});

test('two authorized Desks do not let an incoming later100 block the first received200',async()=>{
 const f=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs').fixture(),a=f.tasks[0];a.ord=a.requested=300;a.inc=200;a.warehouse.accepted=200;a.procurement={totalCtn:300,customerCtn:300};a.supplyAllocation={planned:300};f.records.get('N/ALLOCATION-A').details.targets=[{taskId:'A',quantity:200}];f.records.get('N/ALLOCATION-B').details.targets=[{taskId:'B',quantity:100}];
 const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{packingVersion}=load('packingListOperations.js'),save=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context}),staff={...f.staff,packingDepartment:'SUPPORT'},state=async()=>readSupportDesks((await f.context()).activity,'NCT')[0];
 await save({company:'NCT',staff,requestId:f.nextId(),input:{action:'DESK_SPLIT',customerId:'CUSTOMER-A',taskId:'A',desk:1,revision:'',parts:[{desk:1,quantity:200},{desk:2,quantity:100}]}});
 const send=async(desk,quantity)=>f.packingSave({company:'NCT',staff,requestId:f.nextId(),input:{action:'DESK_SEND',customerId:'CUSTOMER-A',desk,deskRevision:(await state()).revision,version:packingVersion(await f.packingContext('NCT')),lines:[{taskId:'A',quantity}]}});
 const first=await send(1,200);await send(2,100);
 const loaded=await f.packingSave({company:'NCT',staff:{...f.staff,packingDepartment:'WAREHOUSE'},requestId:f.nextId(),input:{action:'DESK_LOAD',id:first.id,revision:first.revision,taskId:'A',loaded:200,reasonCodes:[],version:packingVersion(await f.packingContext('NCT'))}});
 assert.equal(loaded.list.lines[0].loaded,200);assert.equal((await f.stock()).onHand,100);const commit=load('shortloadResolutionModel.js').readDeskCommitments((await f.context()).activity,'NCT','A');assert.equal(commit.quantity,300);assert.equal(commit.loaded,200);const ctx=await f.context(),ready=load('supportInvoice.js').supportInvoiceState(ctx);assert.equal(ready.deskLines.find(row=>row.taskId==='A'&&row.desk===1).maxInvoiceQty,200);assert.equal(ready.deskLines.find(row=>row.taskId==='A'&&row.desk===2).maxInvoiceQty,0);load('supportDesk.js').checkSupportDeskInvoice(ctx,ready,{customerId:'CUSTOMER-A',desk:{number:1,revision:(await state()).revision},lines:[{taskId:'A',quantity:200}]});
});

test('stock cards reserve the same automatic receipt ownership as Purchase with no duplicate free30',()=>{
 const f=actualProjection(200),card=load('stockCardProjection.js').projectStockCard({...f.workspace,activity:f.inputs.activity}).items[0];assert.equal(card.onHand,200);assert.equal(card.reservedUsable,200);assert.equal(card.available,0);
});

test('a Sales increase preserves the confirmed Desk and leaves new demand awaiting Support',()=>{
 const {deskTaskPortions}=load('shortloadResolutionModel.js'),a={id:'T',customerId:'C',requested:330,inc:200,supplyAllocation:{planned:300}},state={company:'NCT',assignments:[{taskId:'T',desk:1,parts:[{desk:1,quantity:200},{desk:2,quantity:100}]}]},activity=[{action:'SUPPORT_PACKING_LIST_CURRENT',details:{list:{id:'ONE',company:'NCT',status:'SENT',sentAt:'2026-11-01T08:00:00Z',desk:{number:1},lines:[{taskId:'T',quantity:200,loaded:0}]}}}];
 const parts=deskTaskPortions(activity,state,a);assert.equal(parts.find(row=>row.desk===1).quantity,200);assert.equal(parts.find(row=>row.desk===0).quantity,130);assert.equal(parts.reduce((n,row)=>n+row.quantity,0),330);
});

test('customer display scopes invoices to the real Desk and preserves unarranged demand without false commitments',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),window={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../master-shared/shipment-batches.js'),'utf8'),{window});
 const original={quantityContract:2,quantityCtn:330,committedQtyCtn:300,receivedQtyCtn:200,uncommittedQtyCtn:30,deskCommitments:[{id:'1',desk:1,quantity:200,loaded:0,at:'2026-11-01'},{id:'2',desk:2,quantity:100,loaded:100,at:'2026-11-02'}],deskPhysical:[{desk:1,receivedQtyCtn:100},{desk:2,receivedQtyCtn:100}],masterCompletedInvoices:[{desk:2,quantity:100,completedQty:100,dispatchedQty:100}]};
 const rows=window.customerShipmentBatches.lines(original);assert.equal(rows.length,3);assert.equal(rows[0].invoicedQtyCtn,0);assert.equal(rows[1].invoicedQtyCtn,100);assert.equal(rows[2].committedQtyCtn,0);assert.equal(rows[2].quantityCtn,30);assert.equal(rows.reduce((n,row)=>n+row.quantityCtn,0),330);assert.equal(original.quantityCtn,330);
});

test('isolated10 in one source remains a real gap while accepted480 is preserved',()=>{
 const a=task('A',500,500,480),f=fixture([a],[['A','A',480]]);f.physical.sources[0].usableReceived=470;assert.equal(run(f)[0].received,470);assert.equal(run(f)[0].gap,10);assert.equal(a.warehouse.accepted,480);
});

test('Purchase reconciles isolated unshipped10 under an open Desk without altering Loaded300 or its commitment',()=>{
 const {planCustomerReconciliation}=load('customerAllocationPlan.js'),product={company:'NCT',barcode:'SKU',packing:'12 x1',ea:12},context={company:'NCT',version:'V',loans:[],tasks:[{...product,id:'A',customerId:'C',demand:500,held:true,returnLocked:true,batches:[{id:'WHOLE',quantity:500}]}],sources:[{...product,id:'S',received:true,usableReceived:470,availablePhysical:170,excluded:10,targets:[{taskId:'A',quantity:480,protectedQuantity:300,batches:[{id:'WHOLE',quantity:480}]}]}]},before=JSON.stringify(context);
 const result=planCustomerReconciliation(context,{version:'V',sourceTaskId:'S',taskId:'A',batchId:'WHOLE',quantity:470,reason:'Isolated 10'});assert.equal(result.physicalDelta,0);assert.equal(result.changes[0].targets[0].quantity,470);assert.equal(JSON.stringify(context),before);
 assert.throws(()=>planCustomerReconciliation(context,{version:'V',sourceTaskId:'S',taskId:'A',batchId:'WHOLE',quantity:299,reason:'Invalid'}),/Loaded or invoiced/);
});

function replacementProjection(purpose='REPLACE_GAP',formal=true){
 const f=actualProjection(190,true),at='2026-11-01T08:03:00Z',id='REPLACEMENT';f.inputs.tasks.push({_id:id,title:id,description:'O',imageAltText:'L',procurementSource:true,customerDemandTaskId:'T',purchaseQtyInCtn:0,receivedQtyInCtn:null,supplierId:'S',ourPoNumber:formal?'PO-2':'',lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0});
 f.inputs.activity.push({title:'NEW-SOURCE',description:'O',image:'L',imageAltText:id,action:'PURCHASE_SOURCE_ADDED',result:'SAVED',activityTime:at,details:{parentTaskId:'T',submissionId:'SUB',quantity:10,supplyPurpose:purpose,replacementLimit:10}},{title:'NEW-PLAN',description:'O',image:'L',imageAltText:id,action:'PURCHASE_PLAN_SAVED',result:'SAVED',activityTime:at,details:{beforeRevision:'',totalCtn:10,extraCtn:10,transportMode:'SUPPLIER_DELIVER',draftPlan:true}});
 return {inputs:f.inputs,project:()=>load('purchaseProjection.js').projectPurchaseWorkspace(f.inputs)};
}

test('formal replacement PO10 plans the gap without making210 or rewriting original PO200',()=>{
 const f=replacementProjection(),view=f.project(),root=view.tasks.find(row=>row.id==='T'),source=view.tasks.find(row=>row.id==='REPLACEMENT');assert.equal(root.supplyAllocation.planned,200);assert.equal(root.supplyAllocation.received,190);assert.equal(root.supplyAllocation.waiting,10);assert.equal(root.supplyAllocation.gap,0);assert.equal(root.procurement.totalCtn,200);assert.equal(root.procurement.customerCtn,190);assert.equal(source.procurement.customerCtn,10);assert.equal(source.procurement.expectedExtra,0);assert.equal(root.warehouse.accepted,190);
 f.inputs.activity.push({title:'NEW-RECEIPT',description:'PO-2',action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:'2026-11-01T08:04:00Z',details:{beforeRevision:'',lines:[{taskId:'REPLACEMENT',orderId:'O',sourceLineId:'L',planned:10,beforeAccepted:0,beforeRejected:0,accepted:10,rejected:0,issue:false,kind:'DELIVERY',reason:''}]}});const after=f.project();assert.equal(after.tasks.find(row=>row.id==='T').inc,200);assert.equal(after.tasks.find(row=>row.id==='T').supplyAllocation.waiting,0);assert.equal(after.tasks.find(row=>row.id==='T').procurement.totalCtn,200);
});

test('a replacement draft does not activate supply and explicit additional stock does not silently replace a customer gap',()=>{
 const draft=replacementProjection('REPLACE_GAP',false).project().tasks.find(row=>row.id==='T');assert.equal(draft.supplyAllocation.planned,200);assert.equal(draft.supplyAllocation.waiting,0);assert.equal(draft.supplyAllocation.gap,10);
 const stock=replacementProjection('STOCK',true).project(),root=stock.tasks.find(row=>row.id==='T');assert.equal(root.supplyAllocation.gap,10);assert.equal(stock.tasks.find(row=>row.id==='REPLACEMENT').procurement.customerCtn,0);
});

test('waiting decisions and supply-purpose changes invalidate both allocation and new-source quotes',()=>{
 const {allocationVersion}=load('plannerAllocation.js'),{purchaseSourcesVersion}=load('purchaseSources.js'),f=actualProjection(190,true),w=f.workspace,a=allocationVersion(w,f.inputs.activity),p=purchaseSourcesVersion(w);w.tasks[0].supplyAllocation.waiting=10;w.tasks[0].supplyAllocation.gap=0;assert.notEqual(allocationVersion(w,f.inputs.activity),a);assert.notEqual(purchaseSourcesVersion(w),p);
});

test('replacement source save records an explicit purpose once and rejects a second draft for the same gap',async()=>{
 const f=actualProjection(190,true),{createPurchaseSourceOperations,purchaseSourcesVersion}=load('purchaseSources.js');let sequence=0;const rows={Tasks:f.inputs.tasks,Orders:f.inputs.orders,Activity:f.inputs.activity,SharedSuppliers:[{title:'S',companyName:'Supplier',supplierStatus:'ACTIVE'}]},clone=x=>JSON.parse(JSON.stringify(x));
 const store={all:async c=>clone(rows[c]||[]),read:async(c,id)=>clone((rows[c]||[]).find(row=>(row._id||row.title)===id)||null),one:async(c,criteria)=>clone((rows[c]||[]).find(row=>Object.entries(criteria).every(([k,v])=>row[k]===v))||null),insert:async(c,row)=>{if((rows[c]||[]).some(item=>(item._id||item.title)===row._id))throw Error('duplicate');(rows[c]||=[]).push(clone(row));return clone(row);},remove:async(c,id)=>{rows[c]=rows[c].filter(row=>(row._id||row.title)!==id);}};
 const workspace=()=>load('purchaseProjection.js').projectPurchaseWorkspace({...f.inputs,tasks:rows.Tasks,activity:rows.Activity}),save=createPurchaseSourceOperations({store,names:{NCT:{tasks:'Tasks',orders:'Orders',activity:'Activity'}},readWorkspace:async()=>workspace()}),request=()=>({company:'NCT',staff:{memberId:'P',staffId:'P',staffName:'Purchase',canAddPurchaseSource:true},requestId:String(++sequence).padStart(8,'0')+'-1111-4111-8111-111111111111',input:{action:'ADD_SOURCE',parentTaskId:'T',version:purchaseSourcesVersion(workspace()),supplierId:'S',poNumber:'',draftPlan:true,quantity:10,supplyPurpose:'REPLACE_GAP',transportMode:'SUPPLIER_DELIVER',reason:'Replace shortage',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:10,freeCtn:0,prices:{lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0}}}});
 const first=request(),result=await save(first);await save(first);assert.equal(rows.Activity.filter(row=>row.action==='PURCHASE_SOURCE_ADDED').length,1);assert.equal(rows.Tasks.find(row=>row.title===result.sourceTaskId).ourPoNumber,'');assert.equal(workspace().tasks.find(row=>row.id==='T').supplyAllocation.gap,10);
 await assert.rejects(save(request()),/Replacement exceeds/);rows.Tasks.find(row=>row.title===result.sourceTaskId).ourPoNumber='PO-2';assert.equal(workspace().tasks.find(row=>row.id==='T').supplyAllocation.waiting,10);assert.equal(workspace().tasks.find(row=>row.id==='T').supplyAllocation.gap,0);assert.equal(rows.Tasks.find(row=>row.title==='T').ourPoNumber,'PO-1');
});

test('invoicing confirmed200 freezes only that Desk shipment and leaves the draft100 available for a later Desk',async()=>{
 const f=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs').fixture(),a=f.tasks[0];a.ord=a.requested=300;a.inc=200;a.warehouse.accepted=200;a.procurement={totalCtn:200,customerCtn:200};a.supplyAllocation={planned:200};f.records.get('N/ALLOCATION-A').details.targets=[{taskId:'A',quantity:200}];f.records.get('N/ALLOCATION-B').details.targets=[{taskId:'B',quantity:100}];
 const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{packingVersion}=load('packingListOperations.js'),{supportInvoiceState,createSupportInvoiceOperations}=load('supportInvoice.js'),{deskTaskPortions}=load('shortloadResolutionModel.js'),{readPhysicalOutflows}=load('physicalOutflow.js'),staff={...f.staff,packingDepartment:'SUPPORT'},assign=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context}),state=async()=>readSupportDesks((await f.context()).activity,'NCT')[0];
 await assign({company:'NCT',staff,requestId:f.nextId(),input:{action:'DESK_SPLIT',customerId:'CUSTOMER-A',taskId:'A',desk:1,revision:'',parts:[{desk:1,quantity:300}]}});
 const sent=await f.packingSave({company:'NCT',staff,requestId:f.nextId(),input:{action:'DESK_SEND',customerId:'CUSTOMER-A',desk:1,deskRevision:(await state()).revision,version:packingVersion(await f.packingContext('NCT')),lines:[{taskId:'A',quantity:200}]}});
 await f.packingSave({company:'NCT',staff:{...f.staff,packingDepartment:'WAREHOUSE'},requestId:f.nextId(),input:{action:'DESK_LOAD',id:sent.id,revision:sent.revision,taskId:'A',loaded:200,reasonCodes:[],version:packingVersion(await f.packingContext('NCT'))}});
 const invoice=createSupportInvoiceOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context,saveFulfilment:f.fulfilSave,readRates:async()=>[{currency:'USD',rateToMyr:4}]}),request={company:'NCT',staff,requestId:f.nextId(),input:{version:supportInvoiceState(await f.context()).version,customerId:'CUSTOMER-A',orderId:'ORDER-A',number:'INV-CONFIRMED-200',desk:{number:1,revision:(await state()).revision},lines:[{taskId:'A',quantity:200}]}};
 const result=await invoice(request);assert.equal(result.ok,true);const ctx=await f.context(),parts=deskTaskPortions(ctx.activity,await state(),ctx.tasks[0],readPhysicalOutflows(ctx.activity));assert.equal(parts.find(row=>row.desk===1).quantity,200);assert.equal(parts.find(row=>row.desk===0).quantity,100);assert.equal((await f.stock()).onHand,100);
 await assign({company:'NCT',staff,requestId:f.nextId(),input:{action:'DESK_SPLIT',customerId:'CUSTOMER-A',taskId:'A',desk:1,revision:(await state()).revision,parts:[{desk:1,quantity:200},{desk:2,quantity:100}]}});
 const after=await f.context();assert.equal(deskTaskPortions(after.activity,await state(),after.tasks[0],readPhysicalOutflows(after.activity)).find(row=>row.desk===2).quantity,100);assert.equal(load('customerShipmentLedger.js').readCustomerShipments(after.activity)[0].invoice.number,'INV-CONFIRMED-200');assert.equal((await f.stock()).onHand,100);
});
