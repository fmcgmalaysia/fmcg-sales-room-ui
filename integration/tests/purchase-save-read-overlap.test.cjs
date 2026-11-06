const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('../prototypes/master-cms-baseline-20261031/measure.cjs');
const load=require('./load-master-module.cjs'),{taskEditVersion}=load('purchaseTaskIdentity.js'),{operationId}=load('purchaseOperationJournal.js');
const cp=x=>JSON.parse(JSON.stringify(x));
const request=(f,n=1,transportMode='SUPPLIER_DELIVER')=>{const row=f.workspace().tasks.find(x=>x.id===f.id);return {...f.base,requestId:String(n).padStart(8,'0')+'-1111-4111-8111-111111111111',operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:row.procurement.revision||'',totalCtn:100,transportMode,draftPlan:true,reason:'',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:100,freeCtn:0,prices:{lpPc:1,lpCtn:16,disc1:0,disc2:0,disc3:0}}}};};
async function setup(){const f=fixture('purchase-operations.test.cjs');await f.operate(request(f));return f;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turns=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};

test('same saved facts and receipts as diagnostic baseline, with two fewer event reads',async()=>{
 const vm=require('node:vm'),{execFileSync}=require('node:child_process'),path=require('node:path');
 let source=execFileSync('git',['show','7ddf3e55:integration/backend/purchaseOperations.js'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}),bindings={};
 source=source.replace(/^import \{([^}]+)\} from 'backend\/([^']+)';\r?$/gm,(_,names,file)=>{const exports=load(file);for(const part of names.split(',')){const [a,b]=part.trim().split(/\s+as\s+/);bindings[b||a]=exports[a];}return '';});
 const prior=vm.runInNewContext('(function(){'+source.replace(/^export /gm,'')+'\nreturn createPurchaseOperations;})()', {...bindings,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math});
 const seed=await setup(),snapshot=cp([...seed.rows]),r=request(seed,2,'SELF_COLLECT'),out=[];
 for(const factory of [prior,load('purchaseOperations.js').createPurchaseOperations]){
  const f=fixture('purchase-operations.test.cjs');f.rows.clear();for(const [k,v]of cp(snapshot))f.rows.set(k,v);
  const calls=[],store=Object.fromEntries(Object.keys(f.store).map(method=>[method,async(...args)=>{calls.push([method,...cp(args)]);return f.store[method](...args);}]));
  const operate=factory({store,now:()=>new Date('2026-11-06T00:00:00Z')});await operate(cp(r));out.push({rows:cp([...f.rows]),calls});
 }
 assert.deepEqual(out[1].rows,out[0].rows);assert.equal(out[1].calls.length,out[0].calls.length-2);
 for(const method of ['all','one','insert','update','remove'])assert.equal(out[1].calls.filter(c=>c[0]===method).length,out[0].calls.filter(c=>c[0]===method).length);
});

test('transport save reads each immutable request event once; replay writes nothing',async()=>{
 const f=await setup(),r=request(f,2,'SELF_COLLECT'),before=cp(f.task()),calls=[],read=f.store.read;
 f.store.read=async(...args)=>{calls.push(args);return read(...args);};
 await f.operate(r);
 for(const action of ['PURCHASE_PLAN_SAVED','PURCHASE_SOURCE_SHARES_SAVED']){const id=operationId('NCT',r.requestId,r.staff.memberId,f.id,action);assert.equal(calls.filter(([c,k])=>c==='NCTActivity'&&k===id).length,1);assert.equal([...f.rows.values()].filter(e=>e._id===id).length,1);}
 assert.deepEqual(cp(f.task()),before);const saved=cp([...f.rows]);await f.operate(r);assert.deepEqual(cp([...f.rows]),saved);
});

test('order/task reads overlap but an invoice still prevents all business writes',async()=>{
 const f=await setup(),r=request(f,2,'SELF_COLLECT'),gate=deferred(),one=f.store.one,read=f.store.read;let readingOrder=false,readingTask=false;
 f.store.one=async(c,q)=>{if(c==='NCTOrders'){readingOrder=true;await gate.promise;return {...await one(c,q),salesInvoiceNumber:'INV-LOCK'};}return one(c,q);};
 f.store.read=async(c,id)=>{if(c==='NCTTasks')readingTask=true;return read(c,id);};
 const before=cp(f.task()),events=[...f.rows.values()].filter(e=>e.action==='PURCHASE_PLAN_SAVED').length,p=f.operate(r);await turns();assert(readingOrder);assert(readingTask);gate.resolve();await assert.rejects(p,/invoice has locked/);assert.deepEqual(cp(f.task()),before);assert.equal([...f.rows.values()].filter(e=>e.action==='PURCHASE_PLAN_SAVED').length,events);
});

test('both revision reads finish before writes or cleanup, including a rejected guard',async()=>{
 const f=await setup(),r=request(f,2,'SELF_COLLECT'),gate=deferred(),all=f.store.all,remove=f.store.remove;let planStarted=false,sharesStarted=false,cleanup=false;
 f.store.all=async(c,q)=>{if(q?.action==='PURCHASE_PLAN_SAVED'){planStarted=true;throw Error('PLAN_READ_FAILED');}if(q?.action==='PURCHASE_SOURCE_SHARES_SAVED'){sharesStarted=true;await gate.promise;}return all(c,q);};
 f.store.remove=async(...args)=>{cleanup=true;return remove(...args);};
 const before=cp(f.task()),p=f.operate(r);await turns();assert(planStarted);assert(sharesStarted);assert.equal(cleanup,false);gate.resolve();await assert.rejects(p,/PLAN_READ_FAILED/);assert(cleanup);assert.deepEqual(cp(f.task()),before);
});

test('every lost business-write response retries the original plan without duplicate events',async()=>{
 for(let stop=1;stop<=3;stop++){
  const f=await setup(),r=request(f,2,'SELF_COLLECT'),insert=f.store.insert;let count=0,failed=false;
  f.store.insert=async(c,row)=>{const out=await insert(c,row);if(['PURCHASE_SOURCE_SHARES_SAVED','PURCHASE_PLAN_SAVED','PURCHASE_OPERATION_RESULT'].includes(row.action)&&++count===stop){failed=true;throw Error('LOST_RESPONSE');}return out;};
  await assert.rejects(f.operate(r),/LOST_RESPONSE/);assert(failed);f.store.insert=insert;await f.operate(r);const saved=cp([...f.rows]);await f.operate(r);assert.deepEqual(cp([...f.rows]),saved);
  for(const action of ['PURCHASE_SOURCE_SHARES_SAVED','PURCHASE_PLAN_SAVED','PURCHASE_OPERATION_RESULT'])assert.equal([...f.rows.values()].filter(e=>e.action===action&&e.details?.requestId===r.requestId).length,1);
  assert.equal(f.workspace().tasks.find(x=>x.id===f.id).procurement.transportMode,'SELF_COLLECT');
 }
});

test('fresh first-payment and physical-receipt locks remain authoritative',async()=>{
 for(const kind of ['PAYMENT','RECEIPT']){
  const f=await setup(),r=request(f,2,'SELF_COLLECT'),all=f.store.all;let financeReads=0;
  if(kind==='RECEIPT'){r.input.totalCtn=90;r.input.costing.paidCtn=90;}
  f.store.all=async(c,q)=>{
   if(c==='PurchaseOrders'&&++financeReads===2){if(kind==='PAYMENT')f.rows.set('PurchaseOrders/P',{_id:'P',company:'NCT',details:{taskIds:[f.id],finance:{payments:[{confirmed:true,cents:1,proof:{fileId:'SLIP'}}]}}});else f.rows.set('PurchaseOrders/P',{_id:'P',company:'NCT',details:{taskIds:[f.id]}});}
   if(q?.action==='WAREHOUSE_RECEIPT_SAVED')return [{action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',details:{lines:[{taskId:f.id,accepted:1,rejected:0}]}}];
   return all(c,q);
  };
  const before=cp(f.task());await assert.rejects(f.operate(r),kind==='PAYMENT'?/first confirmed payment/:/first physical receipt|Receipt/);assert.deepEqual(cp(f.task()),before);assert(financeReads>=2);
 }
});
