const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createPurchaseMarginCommit,readPurchaseMarginCache,purchaseMarginBasis}=load('purchaseMarginRefresh.js');
const {operationId}=load('purchaseOperationJournal.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const names={orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'},rows=new Map(),calls={read:0,insert:0,update:0,remove:0,rates:0};
 const order={_id:'O',title:'ORDER',sourceLineId:'L',transactionCurrency:'USD',sellingPricePc:10,orderId:10,customerId:'C',salesInvoiceNumber:'',gp:null};
 const task={_id:'T',title:'T',description:'ORDER',imageAltText:'L',purchaseQtyInCtn:100,supplierId:'S',ourPoNumber:'NCT-PO-1',lpCtn:240,lpPc:24,disc1:0,disc2:0,disc3:0};
 rows.set(names.orders+'/O',clone(order));rows.set(names.tasks+'/T',clone(task));
 const workspace={company:'NCT',tasks:[{id:'T',orderId:'ORDER',sourceLineId:'L',customerId:'C',ord:100,po:'NCT-PO-1',procurement:{revision:'P',totalCtn:100,customerCtn:100,expectedExtra:0}}]};
 const store={read:async(c,id)=>{calls.read++;return clone(rows.get(c+'/'+id)||null);},insert:async(c,row)=>{calls.insert++;if(rows.has(c+'/'+row._id))throw Error('Duplicate');rows.set(c+'/'+row._id,clone(row));},update:async(c,row)=>{calls.update++;rows.set(c+'/'+row._id,clone(row));},remove:async(c,id)=>{calls.remove++;rows.delete(c+'/'+id);}};
 let rate=3.2;
 const context=()=>({company:'NCT',names,orders:[clone(rows.get(names.orders+'/O'))],tasks:[...rows].filter(([key])=>key.startsWith(names.tasks+'/')).map(([,row])=>clone(row)),workspace:clone(workspace),activity:[...rows].filter(([key])=>key.startsWith(names.activity+'/')).map(([,row])=>clone(row))});
 const commit=createPurchaseMarginCommit({store,readRates:async()=>{calls.rates++;return[{currency:'USD',rateToMyr:rate}];}}),result={ok:true,company:'NCT',requestId:'SAVE-1',taskIds:['T']};
 const save=(requestId='SAVE-1',extra={})=>commit({company:'NCT',staff:{memberId:'M',staffId:'P'},requestId,result:{...result,requestId},taskIds:['T'],context:context(),...extra});
 return{names,rows,calls,store,workspace,context,save,setRate:value=>rate=value,events:()=>[...rows.values()].filter(row=>row.action==='GP_RECALCULATED')};
}
test('pre-PO plans expose no GP and create no FX/cache writes',async()=>{
 const f=fixture();f.workspace.tasks[0].po='';f.rows.get('NCTTasks/T').ourPoNumber='';
 assert.equal(readPurchaseMarginCache(f.context()).get('T'),null);const before=clone(f.calls);assert.equal((await f.save()).ok,true);assert.equal(f.calls.rates,0);assert.equal(f.calls.insert,before.insert);assert.equal(f.calls.update,0);
});
test('first PO commits one cache; fifty reads and same-save replay have no GP writes or FX calls',async()=>{
 const f=fixture();assert.equal((await f.save()).ok,true);assert.equal(f.events().length,1);assert.equal(f.calls.rates,1);const before=clone(f.calls);
 for(let n=0;n<50;n++){const value=readPurchaseMarginCache(f.context());assert.equal(value.get('T'),.25);assert.equal(value.get('SOURCE:T'),.25);}
 assert.deepEqual(f.calls,before);await f.save();assert.equal(f.calls.rates,1);assert.equal(f.events().length,1);assert.equal(f.calls.update,1);
});
test('daily FX and nonfinancial metadata do not invalidate cached margins',async()=>{
 const f=fixture();await f.save();const basis=purchaseMarginBasis(f.context(),'T');f.setRate(4);
 f.workspace.tasks[0].po='NCT-PO-RENAMED';f.workspace.tasks[0].estimatedShipmentDate='2027-01-02';f.workspace.tasks[0].rowPosition=9;f.workspace.tasks[0].warehouse={accepted:80};
 assert.equal(purchaseMarginBasis(f.context(),'T'),basis);assert.equal(readPurchaseMarginCache(f.context()).get('T'),.25);await f.save('SAVE-DATE');assert.equal(f.calls.rates,1);assert.equal(f.events().length,1);
});
test('a real discount invalidates the old GP then updates through the same calculator',async()=>{
 const f=fixture();await f.save();f.rows.get('NCTTasks/T').disc1=.1;assert.equal(readPurchaseMarginCache(f.context()).get('T'),null);
 await f.save('SAVE-DISCOUNT');assert.equal(readPurchaseMarginCache(f.context()).get('T'),.325);assert.equal(f.events().length,2);assert.equal(f.calls.rates,2);
});
test('FOC costing changes use confirmed total amount per carton and preserve actual quantities',async()=>{
 const f=fixture();await f.save();f.workspace.tasks[0].procurement={revision:'P2',totalCtn:110,customerCtn:100,expectedExtra:10,costing:{schema:1,totalCtn:110,amountCents:2400000}};
 assert.equal(readPurchaseMarginCache(f.context()).get('T'),null);await f.save('FOC-10');const expected=(320-24000/110)/320;
 assert.equal(readPurchaseMarginCache(f.context()).get('T'),expected);assert.equal(f.rows.get('NCTTasks/T').purchaseQtyInCtn,100);
});
test('cache write failure preserves a confirmed business result and same-request repair reuses its GP evidence',async()=>{
 const f=fixture(),update=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail){fail=false;throw Error('Cache unavailable');}return update(...args);};
 const pending=await f.save();assert.equal(pending.ok,true);assert.equal(pending.requestId,'SAVE-1');assert.equal(pending.gpPending,true);assert.equal(readPurchaseMarginCache(f.context()).get('T'),null);
 const repaired=await f.save();assert.equal(repaired.ok,true);assert(!repaired.gpPending);assert.equal(f.events().length,1);assert.equal(readPurchaseMarginCache(f.context()).get('T'),.25);
});
test('current COST or GP locks hide cached values without touching the store',async()=>{
 for(const kind of['COST_LOCK','GP_LOCK']){const f=fixture();await f.save();const id=operationId('NCT','T',kind);f.rows.set('NCTActivity/'+id,{_id:id,details:{requestId:'OTHER'}});const before=clone(f.calls);assert.equal(readPurchaseMarginCache(f.context()).get('T'),null);assert.deepEqual(f.calls,before);}
});
test('concurrent identical business confirmations retain one GP cache event',async()=>{
 const f=fixture();await Promise.all([f.save(),f.save()]);await f.save();assert.equal(f.events().length,1);assert.equal(readPurchaseMarginCache(f.context()).get('T'),.25);
});
test('an unsuccessful business operation cannot invoke the GP store',async()=>{
 const f=fixture(),before=clone(f.calls),failed={ok:false,requestId:'FAILED'};assert.deepEqual(await f.save('FAILED',{result:failed}),failed);assert.deepEqual(f.calls,before);
});
test('a partial PO preserves a real supplier GP while the uncovered customer aggregate stays unknown',async()=>{
 const f=fixture();f.workspace.tasks[0].procurement={revision:'P',totalCtn:60,customerCtn:60};
 f.workspace.tasks.push({...clone(f.workspace.tasks[0]),id:'T2',customerDemandTaskId:'T',procurementSource:true,po:'',ord:40,procurement:{revision:'P2',totalCtn:40,customerCtn:40}});
 f.rows.set('NCTTasks/T2',{...clone(f.rows.get('NCTTasks/T')),_id:'T2',title:'T2',ourPoNumber:'',purchaseQtyInCtn:40});
 const saved=await f.save(),cache=readPurchaseMarginCache(f.context());assert(!saved.gpPending);assert.equal(cache.get('T'),null);assert.equal(cache.get('SOURCE:T'),.25);assert.equal(cache.get('SOURCE:T2'),null);
});
function initialization(f){
 f.store.all=async collection=>[...f.rows].filter(([key])=>key.startsWith(collection+'/')).map(([,value])=>clone(value));
 const projection={PURCHASE_COLLECTIONS:{NCT:f.names},projectPurchaseWorkspace:()=>clone(f.workspace)};
 const {createPurchaseMarginInitialization}=load('purchaseMarginRefresh.js',{'purchaseProjection.js':projection});
 const initialize=createPurchaseMarginInitialization({store:f.store}),request={company:'NCT',administrator:true,requestId:'00000000-0000-4000-8000-000000000001'};
 return input=>initialize({...request,...(input?.administrator===false?{administrator:false}:{}),input});
}
test('initialization preview is read-only; application adds only the derived cache and is repeatable',async()=>{
 const f=fixture();Object.assign(f.rows.get('NCTOrders/O'),{gp:.25,adminFxSource:3.2});const before=clone(f.rows.get('NCTOrders/O')),task=clone(f.rows.get('NCTTasks/T')),initialize=initialization(f);
 const preview=await initialize({});assert.equal(preview.plans[0].status,'READY');assert.equal(f.calls.insert,0);assert.equal(f.calls.update,0);assert.deepEqual(f.rows.get('NCTOrders/O'),before);
 const input={confirm:true,version:preview.version,taskIds:['T']},applied=await initialize(input);assert.equal(applied.plans[0].status,'INITIALIZED');const after=clone(f.rows.get('NCTOrders/O'));delete after.gpSnapshot;assert.deepEqual(after,before);assert.deepEqual(f.rows.get('NCTTasks/T'),task);
 assert.equal([...f.rows.values()].filter(row=>row.action==='GP_CACHE_INITIALIZED').length,1);assert.equal(f.events().length,0);const writes=f.calls.update;assert.equal((await initialize(input)).alreadyComplete,true);assert.equal(f.calls.update,writes);
});
test('initialization rejects changed evidence and leaves mismatching confirmed GP untouched',async()=>{
 const f=fixture();Object.assign(f.rows.get('NCTOrders/O'),{gp:.25,adminFxSource:3.2});const initialize=initialization(f),preview=await initialize({});f.rows.get('NCTTasks/T').disc1=.1;
 await assert.rejects(()=>initialize({confirm:true,version:preview.version,taskIds:['T']}),/evidence changed/);assert.equal(f.calls.update,0);assert.equal(f.calls.insert,0);
 const mismatch=await initialize({});assert.equal(mismatch.plans[0].status,'MISMATCH');assert.equal(f.rows.get('NCTOrders/O').gp,.25);
});
test('initialization needs server administrator authority, rejects spoofed input and limits five tasks',async()=>{
 const f=fixture(),initialize=initialization(f),before=clone(f.calls);
 await assert.rejects(()=>initialize({administrator:false,staff:{role:'SUPER ADMIN'},input:{administrator:true}}),/Authorized Wix administrator/);assert.deepEqual(f.calls,before);
 await assert.rejects(()=>initialize({taskIds:['1','2','3','4','5','6']}),/at most five/);
});
test('a twelve-PO save fetches FX once, limits independent cache writers and leaves the other company unchanged',async()=>{
 const f=fixture(),count=12,other={_id:'OTHER',gp:.9,paid:1234};f.rows.set('NCTOrders1/OTHER',clone(other));
 for(let n=1;n<count;n++){const id='T'+n,order='O'+n;f.workspace.tasks.push({...clone(f.workspace.tasks[0]),id,orderId:'ORDER'+n});f.rows.set('NCTOrders/'+order,{...clone(f.rows.get('NCTOrders/O')),_id:order,title:'ORDER'+n});f.rows.set('NCTTasks/'+id,{...clone(f.rows.get('NCTTasks/T')),_id:id,title:id,description:'ORDER'+n});}
 const held=new Set();let maxHeld=0,rateCalls=0;const insert=f.store.insert,remove=f.store.remove;
 f.store.insert=async(c,row)=>{await insert(c,row);if(row.details?.actorMemberId==='SYSTEM_GP'){held.add(row._id);maxHeld=Math.max(maxHeld,held.size);}};f.store.remove=async(c,id)=>{await remove(c,id);held.delete(id);};
 const commit=createPurchaseMarginCommit({store:f.store,readRates:async()=>{rateCalls++;return[{currency:'USD',rateToMyr:3.2}];}}),context={...f.context(),orders:[...f.rows].filter(([key])=>key.startsWith('NCTOrders/')).map(([,row])=>clone(row))};
 const result=await commit({company:'NCT',staff:{memberId:'M',staffId:'P'},requestId:'BATCH',result:{ok:true},taskIds:f.workspace.tasks.map(row=>row.id),context});
 assert(!result.gpPending);assert.equal(rateCalls,1);assert.equal(f.events().length,count);assert(maxHeld>1&&maxHeld<=4);assert.equal(held.size,0);assert.deepEqual(f.rows.get('NCTOrders1/OTHER'),other);
 const cache=readPurchaseMarginCache({...context,orders:[...f.rows].filter(([key])=>key.startsWith('NCTOrders/')).map(([,row])=>clone(row))});for(const task of f.workspace.tasks)assert.equal(cache.get(task.id),.25);
});

test('the actual Purchase save endpoint journals PO and price once; replay and PO renumbering do not recalculate',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),f=require('../prototypes/master-cms-baseline-20261031/measure.cjs').fixture('purchase-operations.test.cjs');
 for(const [key,row]of f.rows)if(key.startsWith('NCTOrders/'))row.transactionCurrency='USD';
 let rateCalls=0;const commit=createPurchaseMarginCommit({store:f.store,readRates:async()=>{rateCalls++;return[{currency:'USD',rateToMyr:3.2}];}});
 const source=fs.readFileSync(require('node:path').join(__dirname,'../backend/purchaseOperations.web.js'),'utf8'),callback=source.slice(source.indexOf('export const savePurchaseOperation='),source.indexOf('export const getSupplierProfile=')).replace('export const savePurchaseOperation=','this.save=');
 const bindings={webMethod:(_,fn)=>fn,Permissions:{SiteMember:1},getPurchaseStaffContext:async()=>f.base.staff,operate:f.operate,commitMargins:commit,console:{info(){},warn(){}}};vm.runInNewContext(callback,bindings);
 const po={taskIds:[f.id],versions:f.versions(),poNumber:'NCT-PO-1'},save=(id,operation,input)=>bindings.save('NCT',id,operation,input);
 const first=await save(f.base.requestId,'PO',po);assert.equal(first.ok,true);assert.equal(rateCalls,1);const order=f.rows.get('NCTOrders/O0'),gp=order.gp;assert.equal(typeof gp,'number');assert.equal(readPurchaseMarginCache({company:'NCT',orders:[...f.rows.values()].filter(row=>row._id==='O0'||row._id==='O1'),tasks:await f.store.all('NCTTasks'),activity:await f.store.all('NCTActivity'),workspace:f.workspace()}).get(f.id),gp);
 await save(f.base.requestId,'PO',po);assert.equal(rateCalls,1);assert.equal([...f.rows.values()].filter(row=>row.action==='GP_RECALCULATED').length,1);
 await save('22222222-2222-4222-8222-222222222222','PO',{taskIds:[f.id],versions:f.versions(),poNumber:'NCT-PO-2'});assert.equal(rateCalls,1);assert.equal(f.rows.get('NCTOrders/O0').gp,gp);
 await save('33333333-3333-4333-8333-333333333333','EDIT',{edits:[{taskId:f.id,version:load('purchaseTaskIdentity.js').taskEditVersion(f.task()),changes:{lpCtn:20}}]});assert.equal(rateCalls,2);assert.notEqual(f.rows.get('NCTOrders/O0').gp,gp);assert.equal(f.rows.get('NCTOrders/O1').gp,undefined);
});

test('all batch workers settle before a cache read failure returns the original confirmed receipt',async()=>{
 const f=fixture();for(let n=1;n<6;n++){const id='T'+n;f.workspace.tasks.push({...clone(f.workspace.tasks[0]),id,orderId:'ORDER'+n});f.rows.set('NCTOrders/O'+n,{...clone(f.rows.get('NCTOrders/O')),_id:'O'+n,title:'ORDER'+n});f.rows.set('NCTTasks/'+id,{...clone(f.rows.get('NCTTasks/T')),_id:id,title:id,description:'ORDER'+n});}
 const read=f.store.read;let active=0;f.store.read=async(c,id)=>{active++;await new Promise(setImmediate);try{if(c==='NCTOrders'&&id==='O1')throw Error('One cache unavailable');return await read(c,id);}finally{active--;}};
 const context={...f.context(),orders:await Promise.resolve([...f.rows].filter(([key])=>key.startsWith('NCTOrders/')).map(([,row])=>clone(row)))},commit=createPurchaseMarginCommit({store:f.store,readRates:async()=>[{currency:'USD',rateToMyr:3.2}]});
 const result=await commit({company:'NCT',staff:{memberId:'M',staffId:'P'},requestId:'BATCH-FAIL',result:{ok:true,requestId:'ORIGINAL'},taskIds:f.workspace.tasks.map(row=>row.id),context});assert.equal(result.ok,true);assert.equal(result.requestId,'ORIGINAL');assert.equal(result.gpPending,true);assert.equal(active,0);assert.equal([...f.rows.values()].filter(row=>row.details?.actorMemberId==='SYSTEM_GP').length,0);
});

test('legacy confirmed numbers are not recalculated or implicitly initialized by reads',()=>{
 const f=fixture();Object.assign(f.rows.get('NCTOrders/O'),{gp:.25,adminFxSource:3.2});const before=clone([...f.rows]),calls=clone(f.calls);
 for(let n=0;n<10;n++){assert.equal(readPurchaseMarginCache(f.context()).get('T'),null);assert.equal(readPurchaseMarginCache(f.context()).get('SOURCE:T'),null);}
 assert.deepEqual(clone([...f.rows]),before);assert.deepEqual(f.calls,calls);
});

test('cost reference refresh metadata cannot recalculate a confirmed price',async()=>{
 const f=fixture();f.workspace.tasks[0].procurement.costing={totalCtn:100,amountCents:2400000,paidCtn:100,freeCtn:0,prices:{lpCtn:240},reference:{at:'2026-11-01'}};await f.save();const basis=purchaseMarginBasis(f.context(),'T');f.workspace.tasks[0].procurement.costing.reference.at='2026-11-02';f.workspace.tasks[0].procurement.costing.manualFields=['lpCtn'];
 assert.equal(purchaseMarginBasis(f.context(),'T'),basis);await f.save('REFERENCE-ONLY');assert.equal(f.calls.rates,1);assert.equal(f.events().length,1);
});

test('only the new maintenance export uses Wix Admin; regular purchase saves retain staff authentication',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../backend/purchaseOperations.web.js'),'utf8'),exports=source.slice(source.indexOf('// Explicit maintenance only:')).replace('export const initializePurchaseMargins','this.initializePurchaseMargins');let args,allowed=false;
 const bindings={createPurchaseMarginInitialization:()=>async request=>{args=request;return{ok:true};},store:{},Permissions:{Admin:'ADMIN'},webMethod:(permission,fn)=>{assert.equal(permission,'ADMIN');return async(...input)=>{if(!allowed)throw Error('Admin required');return fn(...input);};}};vm.runInNewContext(exports,bindings);
 await assert.rejects(()=>bindings.initializePurchaseMargins('NCT','ID',{administrator:true}),/Admin required/);assert.equal(args,undefined);allowed=true;assert.equal((await bindings.initializePurchaseMargins('NCT','ID',{})).ok,true);assert.equal(args.administrator,true);assert.equal(args.staff,undefined);assert.match(source,/const staff=await getPurchaseStaffContext\(\)/);
});
