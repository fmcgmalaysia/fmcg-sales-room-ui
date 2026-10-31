const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('../prototypes/master-cms-baseline-20261031/measure.cjs');
const load=require('./load-master-module.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const {createPurchaseMarginRefresh}=load('purchaseMarginRefresh.js');
const {purchaseOrderList,purchaseOrderReadResult}=load('purchaseOrderWorkflow.js');
const stage=require('../prototypes/purchase-read-efficiency-20261101/stage.cjs');
function sources(count=9){
 const f=fixture('purchase-margin-refresh.test.cjs'),base=f.input(),input={...base,tasks:[],workspace:{tasks:[]}};
 for(let i=0;i<count;i++){const id='S'+i,raw={...base.tasks[0],_id:id,title:id};f.rows.set('NCTTasks/'+id,copy(raw));input.tasks.push(raw);input.workspace.tasks.push({...base.workspace.tasks[0],id,procurementSource:true});}
 return {...f,input};
}
test('independent GP source checks overlap with a bound of four; every fresh task, order and cost lock is still read',async()=>{
 const f=sources(),read=f.store.read,log=[];let active=0,peak=0;
 f.store.read=async(c,id)=>{active++;peak=Math.max(peak,active);log.push(c+'/'+id);await new Promise(setImmediate);try{return await read(c,id);}finally{active--;}};
 const refresh=createPurchaseMarginRefresh({store:f.store,readRates:async()=>[{currency:'SGD',rateToMyr:3.2}]}),before=copy([...f.rows]);
 const result=await refresh(f.input);
 assert.equal(peak,4);assert.equal(log.length,27);assert.equal(result.size,9);for(const value of result.values())assert.equal(value,.25);
 for(const id of f.input.tasks.map(r=>r._id))assert.equal(log.filter(x=>x==='NCTTasks/'+id).length,1);
 assert.equal(log.filter(x=>x==='NCTOrders/O').length,9);assert.equal(log.filter(x=>x.startsWith('NCTActivity/')).length,9);
 assert.deepEqual(copy([...f.rows]),before);assert.equal(f.events().length,0);
});
test('source validation failure or a fresh cost lock hides only the affected GP; no stale fallback or write',async()=>{
 for(const kind of ['read failure','task changed','order changed','cost lock']){
  const f=sources(5),read=f.store.read;let failed=false;
  const {operationId}=load('purchaseOperationJournal.js');
  f.store.read=async(c,id)=>{await new Promise(setImmediate);if(c==='NCTTasks'&&id==='S0'){
   if(kind==='read failure')throw Error('Offline');if(kind==='task changed')return {...await read(c,id),lpCtn:999};
  }if(kind==='order changed'&&c==='NCTOrders'&&!failed){failed=true;return {...await read(c,id),sellingPricePc:999};}
  if(kind==='cost lock'&&c==='NCTActivity'&&id===operationId('NCT','S0','COST_LOCK'))return {details:{requestId:'OTHER'}};
  return read(c,id);};
  const result=await createPurchaseMarginRefresh({store:f.store,readRates:async()=>[{currency:'SGD',rateToMyr:3.2}]})(f.input);
  assert.equal([...result.values()].filter(x=>x===null).length,1,kind);assert.equal(f.events().length,0);
 }
});
test('concurrent requests retain separate company, FX, result and lock checks',async()=>{
 const a=sources(6),b=sources(6);b.input.company='GHR';b.input.names={orders:'GHROrders',tasks:'GHRTasks',activity:'GHRActivity'};
 b.store.read=async(c,id)=>{assert(c.startsWith('GHR'));await new Promise(setImmediate);return copy(b.rows.get(c.replace(/^GHR/,'NCT')+'/'+id)||null);};
 const run=(f,rate)=>createPurchaseMarginRefresh({store:f.store,readRates:async()=>[{currency:'SGD',rateToMyr:rate}]})(f.input);
 const [ar,br]=await Promise.all([run(a,3.2),run(b,4)]);assert([...ar.values()].every(x=>x===.25));assert([...br.values()].every(x=>x===.4));
});
test('parent GP cache writes and their lock lifecycle remain serial before source checks',async()=>{
 const f=fixture('purchase-margin-refresh.test.cjs'),base=f.input(),input={...base,orders:[],tasks:[],workspace:{tasks:[]}};
 for(let i=0;i<6;i++){const id='T'+i,order={...base.orders[0],_id:'O'+i,title:'ORDER'+i},task={...base.tasks[0],_id:id,title:id,description:order.title};input.orders.push(order);input.tasks.push(task);input.workspace.tasks.push({...base.workspace.tasks[0],id,orderId:order.title});f.rows.set('NCTOrders/'+order._id,copy(order));f.rows.set('NCTTasks/'+id,copy(task));}
 let active=0,peak=0,writes=0;for(const method of ['insert','update','remove']){const original=f.store[method];f.store[method]=async(...args)=>{active++;peak=Math.max(peak,active);await new Promise(setImmediate);try{writes++;return await original(...args);}finally{active--;}};}
 const result=await createPurchaseMarginRefresh({store:f.store,readRates:async()=>[{currency:'SGD',rateToMyr:3.2}]})(input);
 assert.equal(peak,1);assert.equal(writes,24);assert.equal(f.events().length,6);assert([...result.values()].every(x=>x===.25));assert.equal([...f.rows.values()].filter(x=>x.details?.actorMemberId==='SYSTEM_GP').length,0);
});
test('bundled PO projection preserves uploader restrictions, Finance lock, values and exact customer names',async()=>{
 const f=fixture('purchase-order-workflow.test.cjs'),old=(await f.operations.list('NCT',f.staff))[0];
 const doc={fileId:'PDF',name:'PO.pdf',sha256:'a'.repeat(64),linked:true,type:'PO',uploadedByStaffId:f.staff.staffId};
 const record={_id:old.id,company:'NCT',details:{taskIds:old.taskIds,documents:[doc],finance:{payments:[{id:'PAY',confirmed:true,cents:500,proof:{fileId:'SLIP'}}]}}};
 for(const staff of [f.staff,{...f.staff,staffId:'OTHER'}]){
  const rows=purchaseOrderList({company:'NCT',workspace:f.workspace,records:[record],staff});
  assert.equal(rows[0].amount,1105);assert.equal(rows[0].procurementContentLocked,true);assert.equal(rows[0].documents[0].deleteAllowed,false);assert(rows[0].documents[0].deleteBlocker);
  const result=purchaseOrderReadResult({company:'NCT',rows,names:[{customerId:'C',shortName:'SHORT'}],customerNamesError:''});
  assert.equal(result.orders[0].customerName,'SHORT');assert.equal(result.orders[0].procurementContentLocked,true);assert.equal(result.paymentRequestsConnected,true);
 }
 assert.throws(()=>purchaseOrderList({company:'GHR',workspace:f.workspace,records:[record],staff:f.staff}),/Select NCT or GHR/);
});
function ui(){
 const fixtureSource=fs.readFileSync(path.join(__dirname,'purchase-live-ui.test.cjs'),'utf8');
 const helpers=fixtureSource.slice(fixtureSource.indexOf('function harness('),fixtureSource.indexOf("test('Follow Up search"));
 const source=stage.plan().assets.get('purchase-live/app.js').toString().replace(/\}\)\(\);\s*$/,'window.readEfficiency={request,po:()=>poData,workspace:()=>data};\n})();');
 const context={fs,path,vm,source,__dirname,Buffer};
 vm.runInNewContext(helpers.replace('return { node,messages,timers,intervals,reply,','return { node,messages,timers,intervals,reply,api:window.readEfficiency,')+'\nthis.helpers={harness,workspace};',context);
 return {...context.helpers,h:context.helpers.harness(undefined,[],{mount(){}})};
}
test('initial and quiet refresh consume one workspace bundle without a second PO request',()=>{
 const {h,workspace}=ui(),w={...workspace(),purchaseOrders:{company:'NCT',orders:[]}};h.reply(w);
 assert.equal(h.messages.filter(x=>x.type==='PURCHASE_ORDERS_REQUEST').length,0);assert.equal(h.api.po(),w.purchaseOrders);
 h.api.request(true);h.reply({...w,purchaseOrders:{company:'NCT',orders:[]}});
 assert.equal(h.messages.filter(x=>x.type==='PURCHASE_ORDERS_REQUEST').length,0);assert.equal(h.messages.filter(x=>x.type.includes('SAVE')).length,0);
});
test('an older standalone PO response cannot overwrite a newer workspace bundle',async()=>{
 const {h,workspace}=ui();h.reply(workspace());const old=h.messages.find(x=>x.type==='PURCHASE_ORDERS_REQUEST');assert(old);
 h.api.request(true);const current={...workspace(),purchaseOrders:{company:'NCT',orders:[]}};h.reply(current);
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:old.requestId,ok:true,result:{company:'NCT',orders:[{id:'STALE'}]}});await new Promise(setImmediate);
 assert.equal(h.api.po(),current.purchaseOrders);
});
test('malformed or foreign-company bundle fails closed, preserving current data and Finance state',()=>{
 const {h,workspace}=ui(),w={...workspace(),purchaseOrders:{company:'NCT',orders:[]}};h.reply(w);
 for(const invalid of [{company:'GHR',orders:[]},{company:'NCT',orders:null}]){h.api.request(true);h.reply({...w,purchaseOrders:invalid});assert.equal(h.api.workspace(),w);assert.equal(h.api.po(),w.purchaseOrders);}
});
test('release changes only two Purchase resources and retains confirmed-save editing protection',()=>{
 const release=stage.plan();assert.equal(release.assets.size,99);assert.equal(release.changed.length,2);
 const app=release.assets.get('purchase-live/app.js').toString();assert.match(app,/if\(!preserveEditing\)render\(\)/);
 for(const file of ['integration/backend/purchaseOperationJournal.js','integration/backend/paymentHandoff.js'])assert.equal(release.assets.has(file),false);
});
test('workspace reads each collection once and returns the same PO lock and document projection without a second query set',async()=>{
 const f=fixture('purchase-order-workflow.test.cjs'),queries=[],names={orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'};
 const projected=(await f.operations.list('NCT',f.staff))[0],record={_id:projected.id,company:'NCT',details:{taskIds:projected.taskIds,finance:{payments:[{confirmed:true,cents:500,proof:{fileId:'PROOF'}}]}}};
 let namesCalls=0,marginCalls=0,allowed=true;
 const rows={NCTOrders:[],NCTTasks:[],NCTActivity:[],SharedSuppliers:[],PurchaseOrders:[record]},bindings={
  webMethod:(_,fn)=>fn,Permissions:{SiteMember:1},wixData:{query:c=>({limit(){return this;},async find(options){assert.equal(options.consistentRead,true);queries.push(c);return {items:rows[c],hasNext:()=>false};}})},
  PURCHASE_COLLECTIONS:{NCT:names},getPurchaseStaffContext:async()=>{if(!allowed)throw Error('Denied');return f.staff;},
  projectPurchaseWorkspace:()=>copy(f.workspace),purchaseOrderList,purchaseOrderReadResult,
  readCustomerShortNames:async ids=>{namesCalls++;assert.deepEqual(Array.from(ids),['C']);return [{customerId:'C',shortName:'SHORT'}];},
  createPurchaseMarginRefresh:()=>async input=>{marginCalls++;assert.equal(input.names,names);return new Map();},readCurrentAdminFx:()=>{},
  applyPurchaseProgress(){},purchaseReceiptInfo:()=>new Map(),Map,Date,Promise,Error
 };
 const src=fs.readFileSync(path.join(__dirname,'../backend/purchaseWorkspace.web.js'),'utf8').replace(/^import[^\n]+\r?\n/gm,'').replace('export const getPurchaseWorkspace','this.getPurchaseWorkspace');
 vm.runInNewContext(src,bindings);const result=await bindings.getPurchaseWorkspace('NCT');
 assert.equal(queries.length,5);assert.equal(new Set(queries).size,5);assert.equal(namesCalls,1);assert.equal(marginCalls,1);
 assert.equal(result.purchaseOrders.orders[0].procurementContentLocked,true);assert.equal(result.purchaseOrders.orders[0].customerName,'SHORT');assert.equal(result.purchaseOrders.orders[0].amount,1105);
 allowed=false;await assert.rejects(bindings.getPurchaseWorkspace('NCT'),/Denied/);assert.equal(queries.length,5);
 await assert.rejects(bindings.getPurchaseWorkspace('GHR'),/Select NCT or GHR/);assert.equal(queries.length,5);
});
