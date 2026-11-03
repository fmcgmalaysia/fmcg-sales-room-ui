'use strict';
// Diagnostics only: real current readers/writers, synthetic in-memory records.
// Never connect to Wix or use the retired R2/current-stock prototypes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),backend=path.join(root,'integration/backend');
const testFile=path.join(root,'integration/tests/purchase-operations.test.cjs'),localRequire=createRequire(testFile);
const factory=vm.runInNewContext(fs.readFileSync(testFile,'utf8')+'\nfixture;',{
 require:id=>id==='node:test'?()=>{}:localRequire(id),Map,Buffer
});
const load=localRequire('./load-master-module.cjs'),{taskEditVersion}=load('purchaseTaskIdentity.js');
const cp=x=>JSON.parse(JSON.stringify(x)),bytes=x=>Buffer.byteLength(JSON.stringify(x));
const report={schema:1,scope:'CURRENT_CODE_OFFLINE_READ_AND_WRITE_DIAGNOSTIC',productionWrites:0,
 baseline:'30a3544 / runtime 6c3cfb2',limits:['No new live Wix inspection','No measured Wix latency or index execution plan','Neutral history is not a realistic million-row business dataset','Findings are observations, not acceptance of a replacement reader'],checks:[],growth:[],writes:[]};
function request(f,serial,price=16,total=200,transportMode='SUPPLIER_DELIVER'){
 const row=f.workspace().tasks.find(row=>row.id===f.id);
 return {...f.base,requestId:String(serial).padStart(8,'0')+'-1111-4111-8111-111111111111',operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:row.procurement.revision||'',totalCtn:total,transportMode,draftPlan:true,reason:'Offline diagnostic',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:total,freeCtn:0,prices:{lpPc:price/16,lpCtn:price,disc1:0,disc2:0,disc3:0}}}};
}
function setup(){
 const f=factory(),queries=[],mutations=[];
 const rawQuery=collection=>{let predicates=[],limit=1000;const q={
  eq(k,v){predicates.push(row=>row[k]===v);return q;},ne(k,v){predicates.push(row=>row[k]!==v);return q;},
  isEmpty(k){predicates.push(row=>row[k]==null||row[k]==='');return q;},hasSome(k,values){predicates.push(row=>values.includes(row[k]));return q;},
  matches:row=>predicates.every(p=>p(row)),or(other){const previous=predicates;predicates=[row=>previous.every(p=>p(row))||other.matches(row)];return q;},
  limit(n){limit=n;return q;},async find(options){assert.equal(options.consistentRead,true);
   const selected=[...f.rows].filter(([key,row])=>key.startsWith(collection+'/')&&q.matches(row)).map(([,row])=>row);
   const page=offset=>{const items=selected.slice(offset,offset+limit).map(cp);queries.push({collection,rows:items.length,jsonBytes:bytes(items)});return {items,hasNext:()=>offset+limit<selected.length,next:async()=>page(offset+limit)};};return page(0);
  }};return q;};
 const operations=fs.readFileSync(path.join(backend,'purchaseOperations.web.js'),'utf8');
 f.store.all=vm.runInNewContext(operations.slice(operations.indexOf('const options='),operations.indexOf('const operate='))+'\nstore.all;',{wixData:{query:rawQuery}});
 for(const method of ['insert','update','remove']){const original=f.store[method];f.store[method]=async(...args)=>{const result=await original(...args);mutations.push({method,collection:args[0],action:args[1]?.action||null});return result;};}
 const source=fs.readFileSync(path.join(backend,'purchaseWorkspace.web.js'),'utf8').replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');
 const bindings=Object.assign({},...['purchaseProjection.js','purchaseProgress.js','purchaseOrderWorkflow.js','purchaseMarginRefresh.js','purchaseReceiptInfo.js','purchaseOperationJournal.js'].map(loadName=>load(loadName)));
 const read=vm.runInNewContext(source+'\ngetPurchaseWorkspace',{...bindings,webMethod:(_p,fn)=>fn,Permissions:{SiteMember:1},wixData:{query:rawQuery},getPurchaseStaffContext:async()=>f.base.staff,readCustomerShortNames:async ids=>ids.map(customerId=>({customerId,shortName:'TEST'}))});
 return Object.assign(f,{queries,mutations,read});
}
const currentShares=f=>load('purchasePlan.js').readPurchaseShares(f.id,[...f.rows.values()]).shares;
async function measuredWrite(f,label,fn){
 const before=new Map([...f.rows].map(([key,row])=>[key,JSON.stringify(row)])),oldShares=cp(currentShares(f));f.queries.length=0;f.mutations.length=0;
 let result,error;try{result=await fn();}catch(e){error=e.message;}
 const added=[...f.rows].filter(([key])=>!before.has(key)),changed=[...f.rows].filter(([key,row])=>before.has(key)&&before.get(key)!==JSON.stringify(row));
 const byAction={};for(const [,row]of added){const key=row.action||'ENTITY';byAction[key]=(byAction[key]||0)+1;}
 const entry={label,error:error||null,addedRows:added.length,updatedRows:changed.length,addedByAction:byAction,writeCalls:f.mutations.length,rowsReturned:f.queries.reduce((n,q)=>n+q.rows,0),sharesUnchanged:JSON.stringify(oldShares)===JSON.stringify(currentShares(f))};
 report.writes.push(entry);return {entry,result};
}
async function run(){
 const f=setup();const first=request(f,1);
 assert.equal((await measuredWrite(f,'First costing plan',()=>f.operate(first))).entry.addedRows,5);
 assert.equal((await measuredWrite(f,'Original request replay',()=>f.operate(first))).entry.addedRows,0);
 const noop=await measuredWrite(f,'Same values with new request',()=>f.operate(request(f,2)));assert.match(noop.entry.error,/have not changed/);assert.equal(noop.entry.addedRows,0);
 const price=await measuredWrite(f,'Price-only change',()=>f.operate(request(f,3,32)));assert.equal(price.entry.sharesUnchanged,true);assert.equal(price.entry.addedByAction.PURCHASE_SOURCE_SHARES_SAVED,1);
 const transport=await measuredWrite(f,'Transport-only change',()=>f.operate(request(f,4,32,200,'SELF_COLLECT')));assert.equal(transport.entry.sharesUnchanged,true);assert.equal(transport.entry.addedByAction.PURCHASE_SOURCE_SHARES_SAVED,1);
 const qty=await measuredWrite(f,'Quantity change',()=>f.operate(request(f,5,32,210,'SELF_COLLECT')));assert.equal(qty.entry.sharesUnchanged,false);
 report.checks.push({id:'W01',observed:'D01 no-op fix remains effective; a real price/transport revision still creates an identical shares payload. Recovery necessity not yet disproved.'});
 const seed=setup();await seed.operate(request(seed,1));const seedRows=cp([...seed.rows]);
 for(const history of [0,1000,10000,100000]){
  const g=setup();g.rows.clear();for(const [key,row]of seedRows)g.rows.set(key,cp(row));
  for(let i=0;i<history;i++)g.rows.set('NCTActivity/H'+i,{_id:'H'+i,title:'H'+i,action:'DIAGNOSTIC_UNRELATED_HISTORY',result:'SAVED',description:'UNRELATED',activityTime:'2020-01-01T00:00:00Z',details:{}});
  g.queries.length=0;g.mutations.length=0;const size=g.rows.size,workspace=await g.read('NCT');assert.equal(workspace.tasks.length,2);assert.equal(g.rows.size,size);assert.equal(g.mutations.length,0);
  const readQueries=cp(g.queries),stable=cp(workspace);delete stable.fetchedAt;delete stable.purchaseOrders?.readAt;
  const stableHash=createHash('sha256').update(JSON.stringify(stable)).digest('hex');
  g.queries.length=0;await g.operate(request(g,2,32));
  report.growth.push({history,activeFixtureTasks:2,pageQueries:readQueries.length,pageRows:readQueries.reduce((n,q)=>n+q.rows,0),pageReadJsonBytes:readQueries.reduce((n,q)=>n+q.jsonBytes,0),responseJsonBytes:bytes(stable),stableHash,saveRows:g.queries.reduce((n,q)=>n+q.rows,0)});
 }
 assert.equal(new Set(report.growth.map(row=>row.stableHash)).size,1);
 assert.equal(report.growth.at(-1).pageRows-report.growth[0].pageRows,100000);
 assert.equal(report.growth.at(-1).saveRows-report.growth[0].saveRows,100000);
 report.checks.push({id:'R01',observed:'Fixed 2-task output remains identical while 100,000 unrelated rows add 100,000 rows to both page read and PLAN preparation.'});
 const {readPurchasePlan}=load('purchasePlan.js'),task={title:'T',description:'O',imageAltText:'L'};
 const event=(title,beforeRevision,totalCtn,date)=>({title,action:'PURCHASE_PLAN_SAVED',result:'SAVED',imageAltText:'T',description:'O',image:'L',activityTime:date,details:{beforeRevision,totalCtn}});
 const chain=[event('OCT','','200','2026-10-31'),event('NOV','OCT',190,'2026-11-01')];chain[0].details.totalCtn=200;
 assert.equal(readPurchasePlan(task,chain).totalCtn,190);assert.throws(()=>readPurchasePlan(task,chain.slice(1)),/history requires review/);assert.equal(readPurchasePlan(task,[]).totalCtn,null);
 report.checks.push({id:'M01',observed:'Month cutoff breaks revision continuity or removes an unchanged prior-month plan.'});
 const {queryAccountReadModel}=load('accountReadQuery.js');
 const rows=Array.from({length:10000},(_,i)=>({id:'P'+i,number:'P'+i,supplierId:'S',supplierName:'S',state:'HISTORY',completedAt:'2026-10-31T00:00:00Z',finance:{payableCents:100,paidCents:100,balanceCents:0}}));
 const paged=queryAccountReadModel(rows,{view:'SUPPLIER_COMPLETED',limit:50});assert.equal(paged.items.length,50);assert.equal(paged.total,10000);
 report.checks.push({id:'R02',inputRows:rows.length,returnedPageRows:paged.items.length,observed:'Existing Account query helper paginates supplied full rows; UI pagination alone is not database pagination.'});
 report.sourceHashes=Object.fromEntries(['purchaseWorkspace.web.js','purchaseOperations.js','purchaseOperations.web.js','purchasePlan.js','purchaseOperationJournal.js','accountReadQuery.js','accountPurchase.web.js'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(backend,name))).digest('hex')]));
 return report;
}
if(require.main===module)run().then(result=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:result.checks,growth:result.growth,writes:result.writes},null,2));}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,setup,request};
