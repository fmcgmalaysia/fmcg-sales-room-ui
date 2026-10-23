const test=require('node:test'),assert=require('node:assert/strict');
const {prepareArrangement,readArrangements,arrangementLimit}=require('../prototypes/stock-current-state/purchase-arrangement.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(){const staff={memberId:'M',staffId:'P',staffName:'Purchaser'},task={id:'A',customerId:'C',orderId:'O',stockAllocatedCumulative:80,
 stockAllocationFacts:{usable:80,held:0,dispatched:0,availableToArrange:80,review:false}};
 return {company:'NCT',staff,requestId:'11111111-1111-4111-8111-111111111111',input:{taskId:'A',batchId:'',quantity:80,expectedRevision:'',reason:'Arrange existing stock first'},
 workspace:{company:'NCT',stockAllocationView:'CURRENT_V2',staff,tasks:[task]},before:null,at:'2026-10-24T02:00:00.000Z'};}
test('arrange80creates only instruction+immutable audit; no PO, receipt, stock, demand, packing or dispatch writes',()=>{
 const f=fixture(),before=copy(f),plan=prepareArrangement(f);assert.deepEqual(f,before);
 assert.equal(plan.writes.length,2);assert.ok(plan.writes.every(w=>w.collection==='NCTActivity'&&w.before===null));
 assert.equal(plan.writes[0].after.action,'PURCHASE_ARRANGEMENT_CURRENT');assert.equal(plan.writes[0].after.details.quantity,80);
 const rows=readArrangements('NCT',[plan.writes[0].after]);assert.equal(rows[0].status,'PENDING_SUPPORT');assert.equal(rows[0].quantity,80);
 assert.equal(readArrangements('NCT',[plan.writes[1].after]).length,0);
});
test('stock already held, shipped, unknown or larger than currently available cannot be requested',()=>{
 for(const patch of [{usable:80,held:20,dispatched:0,availableToArrange:60,review:false},
 {usable:0,held:0,dispatched:80,availableToArrange:0,review:false},null,{usable:80,held:0,dispatched:0,availableToArrange:80,review:true}]){
 const f=fixture();f.workspace.tasks[0].stockAllocationFacts=patch;assert.throws(()=>prepareArrangement(f),/arrangement|Arrangement/);}
 const f=fixture();f.input.quantity=81;assert.throws(()=>prepareArrangement(f),/quantity/);
});
test('confirmed batch is bounded conservatively by all existing task holds and dispatch, never root total repeated',()=>{
 const f=fixture(),t=f.workspace.tasks[0];t.stockAllocatedBatches=[{id:'PLAN|1',demand:50,allocated:50},{id:'PLAN|2',demand:50,allocated:30}];
 assert.equal(arrangementLimit(t,'PLAN|2'),30);t.stockAllocationFacts.held=10;t.stockAllocationFacts.availableToArrange=70;
 assert.equal(arrangementLimit(t,'PLAN|2'),20);f.input.batchId='PLAN|2';f.input.quantity=21;assert.throws(()=>prepareArrangement(f),/quantity/);
 assert.throws(()=>arrangementLimit(t,'MOVED-UNKNOWN'),/batch/);
});
test('replacement needs exact prior revision and conditional before; other company or forged prior identity refused',()=>{
 const f=fixture(),first=prepareArrangement(f).writes[0].after;f.before={...first,_version:'V1'};
 assert.throws(()=>prepareArrangement(f),/changed/);f.input.expectedRevision=first.details.revision;
 f.requestId='22222222-2222-4222-8222-222222222222';const second=prepareArrangement(f);assert.deepEqual(second.writes[0].before,f.before);
 assert.equal(second.writes[1].after.details.beforeRevision,first.details.revision);
 f.before.company='GHR';assert.throws(()=>prepareArrangement(f),/changed/);
 assert.throws(()=>readArrangements('GHR',[first]),/review/);assert.throws(()=>readArrangements('NCT',[first,first]),/review/);
});
test('actor, reason, extra client fields and archived demand never grant packing rights',()=>{
 for(const kind of ['actor','reason','extra','archived']){const f=fixture();if(kind==='actor')f.workspace.staff={...f.staff,staffId:'OTHER'};
 if(kind==='reason')f.input.reason='';if(kind==='extra')f.input.department='SUPPORT';if(kind==='archived')f.workspace.tasks[0].archived=true;
 assert.throws(()=>prepareArrangement(f));}
});
test('private arrangement service uses original Purchase authorization and common current admission; no direct writes or Support impersonation',async()=>{
 const {createCurrentPurchaseArrangementSave}=require('../prototypes/stock-current-state/current-purchase-arrangement-save.cjs');
 const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs'),f=fixture();let authenticated=0,prepared=null,revoked=false;
 const control={company:'NCT',mode:'ACTIVE',schemaVersion:1,generation:9,_version:'V9',writerBuild:'BUILD',pending:null};
 const protocol={planFormat:'SEGMENTED_V2',readSnapshot:async fn=>({rows:await fn(control),generation:9}),
  commit:async op=>{op.authorize({control});prepared=await op.prepare();return {ok:true,generation:10};}};
 const coverage=Object.fromEntries(WRITERS.map(w=>[w,{verified:true,build:'BUILD'}]));
 const deps={company:'NCT',store:{read:async()=>null},protocol,coverage,authorityDependencies:{
  readMember:async()=>({ _id:'M',status:revoked?'BLOCKED':'APPROVED',loginEmail:'test@example.invalid'}),readStaffRecords:async()=>[],
  requirePurchaseStaff:member=>{authenticated++;if(member.status!=='APPROVED')throw Error('Original role revoked');return f.staff;},
  readMarginContext:async()=>({workspace:f.workspace}),now:()=>new Date(f.at)}};
 const save=createCurrentPurchaseArrangementSave(deps),request={requestId:f.requestId,input:f.input,stockProtocol:1,stockBuild:'BUILD',stockGeneration:9};
 const result=await save(request);assert.equal(result.stockGeneration,10);assert.equal(prepared.writes.length,2);assert.equal(authenticated,1);
 assert.equal(prepared.writes[0].after.initiatedByStaffId,'P');
 revoked=true;await assert.rejects(save(request),/revoked/);revoked=false;
 const closed=createCurrentPurchaseArrangementSave({...deps,coverage:{}});await assert.rejects(closed(request),/coverage/);
});
