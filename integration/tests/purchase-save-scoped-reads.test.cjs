const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('../prototypes/master-cms-baseline-20261031/measure.cjs');
const load=require('./load-master-module.cjs'),{taskEditVersion}=load('purchaseTaskIdentity.js');
const cp=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const f=fixture('purchase-operations.test.cjs'),queries=[];
 const source=fs.readFileSync(path.join(__dirname,'../backend/purchaseOperations.web.js'),'utf8');
 const adapter=vm.runInNewContext(source.slice(source.indexOf('const options='),source.indexOf('const operate='))+'\nstore;',{
  wixData:{query(collection){const filters=[];let size=1000;const q={eq(k,v){filters.push([k,v]);return q;},limit(n){size=n;return q;},async find(options){
   assert.equal(options.consistentRead,true);assert.equal(options.suppressAuth,true);
   const rows=[...f.rows].filter(([key,row])=>key.startsWith(collection+'/')&&filters.every(([k,v])=>row[k]===v)).map(([,row])=>cp(row));
   const page=offset=>{const items=rows.slice(offset,offset+size);queries.push({collection,filters:cp(filters),returned:items.length});return {items,hasNext:()=>offset+size<rows.length,next:async()=>page(offset+size)};};return page(0);
  }};return q;}}
 });
 f.store.all=adapter.all;
 return {...f,queries,adapter};
}
function request(f,n=1,price=16){const row=f.workspace().tasks.find(x=>x.id===f.id);return {...f.base,requestId:String(n).padStart(8,'0')+'-1111-4111-8111-111111111111',operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:row.procurement.revision||'',totalCtn:200,transportMode:'SUPPLIER_DELIVER',draftPlan:true,reason:'Scoped read test',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:200,freeCtn:0,prices:{lpPc:price/16,lpCtn:price,disc1:0,disc2:0,disc3:0}}}};}
function noise(f,n){for(let i=0;i<n;i++)f.rows.set('NCTActivity/H'+i,{_id:'H'+i,title:'H'+i,description:'UNRELATED',action:'DIAGNOSTIC_UNRELATED_HISTORY',result:'SAVED',activityTime:'2020-01-01T00:00:00Z',details:{}});}

test('10,000 unrelated rows are read once during prepare, never again by plan/share guards',async()=>{
 const f=setup();await f.operate(request(f));noise(f,10000);f.queries.length=0;const before=f.rows.size;
 await f.operate(request(f,2,32));
 const activity=f.queries.filter(q=>q.collection==='NCTActivity'),scoped=activity.filter(q=>q.filters.length);
 assert.equal(activity.filter(q=>!q.filters.length).reduce((n,q)=>n+q.returned,0),10007);
 assert.equal(scoped.length,2);assert.deepEqual(scoped.map(q=>q.returned),[1,1]);
 assert.deepEqual(scoped.map(q=>q.filters),[[['action','PURCHASE_PLAN_SAVED'],['result','SAVED'],['imageAltText',f.id]],[['action','PURCHASE_SOURCE_SHARES_SAVED'],['result','SAVED'],['imageAltText',f.id]]]);
 assert.equal(f.queries.reduce((n,q)=>n+q.returned,0),10014);assert.equal(f.rows.size-before,5);assert.equal(f.task().lpCtn,32);
 const saved=cp([...f.rows]);await f.operate(request(f,3,32)).then(()=>assert.fail('unchanged save accepted'),e=>assert.match(e.message,/have not changed/));assert.deepEqual(cp([...f.rows]),saved);
});

test('scoped adapter retains every matching page and old-month revision without a date cutoff',async()=>{
 const f=setup();for(let i=0;i<2005;i++)f.rows.set('NCTActivity/P'+i,{title:'P'+i,action:'PURCHASE_PLAN_SAVED',result:'SAVED',imageAltText:f.id,activityTime:'2020-01-01T00:00:00Z'});
 noise(f,1000);const rows=await f.store.all('NCTActivity',{action:'PURCHASE_PLAN_SAVED',result:'SAVED',imageAltText:f.id});assert.equal(rows.length,2005);assert.deepEqual(f.queries.map(q=>q.returned),[1000,1000,5]);
});

test('existing callers without criteria still receive the original complete collection',async()=>{const f=setup();noise(f,1005);const rows=await f.store.all('NCTActivity');assert.equal(rows.length,1006);assert(f.queries.every(q=>q.filters.length===0));});

test('company criteria are sent to CMS and preserve both fresh Finance lock checks',async()=>{
 const f=setup();f.rows.set('PurchaseOrders/FOREIGN',{company:'GHR',details:{taskIds:[f.id],finance:{payments:[{confirmed:true,cents:1,proof:{fileId:'X'}}]}}});await f.operate(request(f));
 const queries=f.queries.filter(q=>q.collection==='PurchaseOrders');assert.equal(queries.length,2);assert(queries.every(q=>JSON.stringify(q.filters)===JSON.stringify([['company','NCT']])));assert(queries.every(q=>q.returned===0));
});

test('payment confirmed between prepare and apply still stops the save',async()=>{
 const f=setup(),all=f.store.all;let reads=0;f.store.all=async(c,criteria)=>{if(c==='PurchaseOrders'&&++reads===2)f.rows.set('PurchaseOrders/P',{company:'NCT',details:{taskIds:[f.id],finance:{payments:[{confirmed:true,cents:1,proof:{fileId:'SLIP'}}]}}});return all(c,criteria);};
 const before=cp(f.task());await assert.rejects(f.operate(request(f)),/first confirmed payment/);assert.deepEqual(cp(f.task()),before);assert.equal(reads,2);
});

for(const action of ['PURCHASE_PLAN_SAVED','PURCHASE_SOURCE_SHARES_SAVED'])test('fresh '+action+' conflict after prepare remains rejected',async()=>{
 const f=setup();await f.operate(request(f));const r=request(f,2,32),before=cp(f.task()),all=f.store.all;
 f.store.all=async(c,criteria)=>{if(criteria?.action===action){const prior=[...f.rows.values()].find(x=>x.action===action);f.rows.set(c+'/CONFLICT',{...cp(prior),_id:'CONFLICT',title:'CONFLICT'});}return all(c,criteria);};
 await assert.rejects(f.operate(r),/history requires review|changed while/);assert.deepEqual(cp(f.task()),before);
});

test('failure after task update resumes original request once with scoped reads',async()=>{
 const f=setup();await f.operate(request(f));const r=request(f,2,32),update=f.store.update;let interrupted=false;
 f.store.update=async(c,row)=>{const result=await update(c,row);if(c==='NCTTasks'&&!interrupted){interrupted=true;throw Error('LOST_RESPONSE');}return result;};
 await assert.rejects(f.operate(r),/LOST_RESPONSE/);f.store.update=update;await f.operate(r);const before=cp([...f.rows]);await f.operate(r);assert.deepEqual(cp([...f.rows]),before);assert.equal(f.task().lpCtn,32);
});

test('a scoped query failure cannot fall back to prepare-time history or write task prices',async()=>{
 const f=setup();await f.operate(request(f));const r=request(f,2,32),before=cp(f.task()),all=f.store.all;
 f.store.all=async(c,criteria)=>{if(criteria?.action==='PURCHASE_SOURCE_SHARES_SAVED')throw Error('READ_UNAVAILABLE');return all(c,criteria);};
 await assert.rejects(f.operate(r),/READ_UNAVAILABLE/);assert.deepEqual(cp(f.task()),before);
});

test('foreign identity inside a matching plan still fails its original validation',async()=>{
 const f=setup();await f.operate(request(f));const r=request(f,2,32),before=cp(f.task()),all=f.store.all;
 f.store.all=async(c,criteria)=>{const rows=await all(c,criteria);return criteria?.action==='PURCHASE_PLAN_SAVED'?rows.map(row=>({...row,description:'OTHER_ORDER'})):rows;};
 await assert.rejects(f.operate(r),/identity or quantity requires review/);assert.deepEqual(cp(f.task()),before);
});
