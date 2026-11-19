const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const testFile=path.resolve(__dirname,'purchase-operations.test.cjs'),req=createRequire(testFile),load=req('./load-master-module.cjs');
const fixture=vm.runInNewContext(fs.readFileSync(testFile,'utf8')+'\nfixture;',{require:n=>n==='node:test'?()=>{}:req(n),Map,Buffer});
const {confirmedPurchaseState:confirmedPlanView,requireConfirmedProcurement}=load('purchasePlan.js');
const {projectPurchaseWorkspace}=load('purchaseProjection.js'),{projectPurchaseOrders}=load('purchaseOrderWorkflow.js'),{taskEditVersion}=load('purchaseTaskIdentity.js');
const rid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111',copy=x=>JSON.parse(JSON.stringify(x));
function request(f,n,price=16,qty=200,id=f.id){const r=f.workspace().tasks.find(t=>t.id===id);return {...f.base,requestId:rid(n),operation:'PLAN',input:{taskId:id,version:r.editVersion,planRevision:r.procurement.revision||'',totalCtn:qty,transportMode:'SUPPLIER_DELIVER',draftPlan:true,reason:'Offline candidate',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:qty,freeCtn:0,prices:{lpPc:price/16,lpCtn:price,disc1:0,disc2:0,disc3:0}}}};}
async function context(f){return {company:'NCT',staff:f.base.staff,orders:await f.store.all('NCTOrders'),tasks:await f.store.all('NCTTasks'),activity:await f.store.all('NCTActivity'),suppliers:await f.store.all('SharedSuppliers')};}
async function seed(withPo=true){const f=fixture();if(withPo){await f.operate(request(f,1));await f.operate({...f.base,requestId:rid(2),operation:'PO',input:{taskIds:[f.id],versions:f.versions(),poNumber:'OFFLINE-PROBE'}});}return f;}
async function interrupt(f,r,boundary){
 const update=f.store.update,insert=f.store.insert;let hit=false;
 const action={PRICE:'PURCHASE_PRICE_SAVED',SHARES:'PURCHASE_SOURCE_SHARES_SAVED',PLAN:'PURCHASE_PLAN_SAVED',RESULT:'PURCHASE_OPERATION_RESULT'}[boundary];
 f.store.update=async(c,row)=>{const out=await update(c,row);if(boundary==='TASK'&&!hit&&c==='NCTTasks'){hit=true;throw Error('SIMULATED');}return out;};
 f.store.insert=async(c,row)=>{if(action&&!hit&&row.action===action){hit=true;throw Error('SIMULATED');}return insert(c,row);};
 await assert.rejects(f.operate(r),/SIMULATED/);assert.ok(hit);f.store.update=update;f.store.insert=insert;
}
for(const withPo of [false,true])for(const qty of [200,220])for(const boundary of ['TASK','PRICE','SHARES','PLAN','RESULT'])test(`${withPo?'existing PO':'first PLAN'} ${qty} interrupted at ${boundary}: coherent read, no writes, original retry`,async()=>{
 const f=await seed(withPo),before=await context(f),old=projectPurchaseWorkspace(before),r=request(f,3,32,qty);
 await interrupt(f,r,boundary);const raw=await context(f),stored=copy([...f.rows]),view=confirmedPlanView(raw),workspace=projectPurchaseWorkspace({...raw,confirmedState:view});
 const changed=workspace.tasks.find(row=>row.id===f.id),other=workspace.tasks.find(row=>row.id===f.second),oldChanged=old.tasks.find(row=>row.id===f.id);
 assert.deepEqual(copy(other),copy(old.tasks.find(row=>row.id===f.second)));
 if(boundary==='RESULT'){assert.equal(view.pending.length,0);assert.equal(changed.lpCtn,32);assert.equal(changed.procurement.totalCtn,qty);}
 else {assert.equal(view.pending.length,1);assert.equal(view.pending[0].taskId,f.id);assert.equal(changed.lpCtn,oldChanged.lpCtn);assert.deepEqual(copy(changed.procurement),copy(oldChanged.procurement));assert.equal(changed.editVersion,oldChanged.editVersion);}
 if(withPo){const po=projectPurchaseOrders({company:'NCT',workspace,records:[]})[0];assert.equal(po.amount,boundary==='RESULT'?qty*32:3200);}
 assert.deepEqual(copy([...f.rows]),stored);await f.operate(r);const recovered=confirmedPlanView(await context(f));assert.equal(recovered.pending.length,0);assert.equal(f.workspace().tasks.find(row=>row.id===f.id).procurement.totalCtn,qty);
 const count=f.rows.size;await f.operate(r);assert.equal(f.rows.size,count);
});
test('missing RESULT on a completed old plan does not roll back a later confirmed revision',async()=>{
 const f=await seed(),r=request(f,3,32,220);await interrupt(f,r,'RESULT');await f.operate(request(f,4,40,230));const raw=await context(f),view=confirmedPlanView(raw);assert.equal(view.pending.length,0);assert.equal(projectPurchaseWorkspace({...raw,confirmedState:view}).tasks.find(row=>row.id===f.id).lpCtn,40);
});
test('unrelated PLAN remains possible while affected original request remains recoverable',async()=>{
 const f=await seed(),r=request(f,3,32,200);await interrupt(f,r,'PRICE');const other=request(f,4,24,180,f.second);await f.operate(other);
 const raw=await context(f),view=confirmedPlanView(raw),w=projectPurchaseWorkspace({...raw,confirmedState:view});assert.equal(view.pending.length,1);assert.equal(w.tasks.find(row=>row.id===f.second).lpCtn,24);await f.operate(r);assert.equal(confirmedPlanView(await context(f)).pending.length,0);
});
test('inconsistent identity, altered event, missing prior revision or concurrent task edit is not guessed',async()=>{
 for(const damage of ['task','event','prepared','prior','duplicate']){
  const f=await seed(),r=request(f,3,32,220);await interrupt(f,r,'PLAN');const raw=await context(f);
  if(damage==='task')raw.tasks.find(t=>t.title===f.id).supplierId='OTHER';
  if(damage==='event')raw.activity.find(e=>e.details?.requestId===r.requestId&&e.action==='PURCHASE_PRICE_SAVED').details.after.lpCtn=99;
  if(damage==='prepared')raw.activity.find(e=>e.details?.requestId===r.requestId&&e.action==='PURCHASE_OPERATION_PREPARED').details.actorMemberId='OTHER';
  if(damage==='prior')raw.activity=raw.activity.filter(e=>!(e.action==='PURCHASE_PLAN_SAVED'&&e.details?.requestId===rid(1)));
  if(damage==='duplicate')raw.activity.push(copy(raw.activity.find(row=>row.action==='PURCHASE_OPERATION_PREPARED'&&row.details.requestId===r.requestId)));
  assert.throws(()=>confirmedPlanView(raw),/requires review/);
 }
});
test('completed RESULT paired with missing business event is inconsistent, not a safe rollback',async()=>{
 const f=await seed();await f.operate(request(f,3,32,220));const raw=await context(f);raw.activity=raw.activity.filter(e=>!(e.action==='PURCHASE_PRICE_SAVED'&&e.details.requestId===rid(3)));assert.throws(()=>confirmedPlanView(raw),/requires review/);
});
test('prepare exists but task write not yet started: preserve the prior fields',async()=>{
 const f=await seed(),r=request(f,3,32,220),update=f.store.update;f.store.update=async(c,row)=>{if(c==='NCTTasks')throw Error('SIMULATED');return update(c,row);};await assert.rejects(f.operate(r),/SIMULATED/);f.store.update=update;
 const raw=await context(f),view=confirmedPlanView(raw);assert.equal(view.pending.length,1);assert.equal(taskEditVersion(view.tasks.find(t=>t.title===f.id)),taskEditVersion(raw.tasks.find(t=>t.title===f.id)));await f.operate(r);
});
test('transport-only pending plan needs no invented price rollback',async()=>{
 const f=await seed(),r=request(f,3);r.input.transportMode='SELF_COLLECT';await interrupt(f,r,'PLAN');const raw=await context(f),view=confirmedPlanView(raw),w=projectPurchaseWorkspace({...raw,confirmedState:view});assert.equal(view.pending.length,1);assert.equal(w.tasks.find(t=>t.id===f.id).procurement.transportMode,'SUPPLIER_DELIVER');await f.operate(r);assert.equal(f.workspace().tasks.find(t=>t.id===f.id).procurement.transportMode,'SELF_COLLECT');
});

test('latest complete events with stale task prices are rejected instead of mixing query snapshots',async()=>{
 const f=await seed(),before=await context(f);await f.operate(request(f,3,32,220));const raw=await context(f);raw.tasks=before.tasks;assert.throws(()=>confirmedPlanView(raw),/requires review/);
});
test('unrelated duplicate non-journal titles do not stop valid reads',async()=>{
 const f=await seed(),raw=await context(f);raw.activity.push({title:'NOTE',action:'NOTE'},{title:'NOTE',action:'NOTE'});assert.equal(confirmedPlanView(raw).pending.length,0);
});
test('pending flags propagate through PO to Warehouse, block receipt, preserve unrelated task and original recovery',async()=>{
 const f=await seed(),r=request(f,3,32,220);await interrupt(f,r,'PLAN');
 const {projectWarehouseOrders,createWarehouseOperations}=load('warehouseReceiving.js');
 const readOrders=async()=>{const raw=await context(f),workspace=projectPurchaseWorkspace(raw);return projectWarehouseOrders({company:'NCT',purchaseOrders:projectPurchaseOrders({company:'NCT',workspace,records:[]}),tasks:workspace.tasks,activity:raw.activity});};
 const po=(await readOrders())[0];assert.equal(po.procurementSavePending,true);
 const receive=createWarehouseOperations({store:f.store,names:{NCT:{activity:'NCTActivity'}},readOrders});
 await assert.rejects(receive.save({...f.base,requestId:rid(5),input:{id:po.id,version:po.version,action:'RECEIVE',lines:[{taskId:f.id,accepted:200,rejected:0,kind:'DELIVERY',reason:''}]}}),/Procurement save pending/);
 assert.ok(![...f.rows.values()].some(row=>row.action==='WAREHOUSE_RECEIPT_SAVED'));
 const w=f.workspace();assert.equal(w.tasks.find(t=>t.id===f.id).procurementSavePending,true);assert.equal(w.tasks.find(t=>t.id===f.second).procurementSavePending,undefined);
 await assert.rejects(f.operate(request(f,6,40,230)),/Procurement save pending/);await f.operate(request(f,7,24,180,f.second));await f.operate(r);assert.equal((await readOrders())[0].procurementSavePending,undefined);
});
