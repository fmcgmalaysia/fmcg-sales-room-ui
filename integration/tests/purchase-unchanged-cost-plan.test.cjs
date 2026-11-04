const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const file=path.join(__dirname,'purchase-operations.test.cjs'),req=createRequire(file);
const fixture=vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nfixture;',{require:name=>name==='node:test'?()=>{}:req(name),Map,Buffer});
const copy=x=>JSON.parse(JSON.stringify(x)),rid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const normal={schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:200,freeCtn:0,prices:{lpPc:1,lpCtn:16,disc1:0,disc2:0,disc3:0}};
function request(f,n,cost=normal,overrides={}){const row=f.workspace().tasks.find(t=>t.id===f.id);return {...f.base,requestId:rid(n),operation:'PLAN',input:{taskId:f.id,version:row.editVersion,planRevision:row.procurement.revision||'',totalCtn:cost.paidCtn+cost.freeCtn,transportMode:'SUPPLIER_DELIVER',reason:'Test supplier plan',draftPlan:true,costing:copy(cost),...overrides}};}
const count=f=>[...f.rows.values()].filter(r=>r.action==='PURCHASE_PLAN_SAVED').length;
for(const type of ['NORMAL','FOC','TOTAL'])test('unchanged '+type+' costing with fresh identity leaves all durable rows unchanged',async()=>{
 const f=fixture(),cost=type==='NORMAL'?normal:{...normal,mode:'FOC',paidCtn:180,freeCtn:20,...(type==='TOTAL'?{moneySource:'TOTAL',amountCents:280001}:{})};
 await f.operate(request(f,1,cost));const before=copy([...f.rows]);await assert.rejects(f.operate(request(f,2,cost)),/have not changed/);assert.deepEqual(copy([...f.rows]),before);
});
test('CMS field ordering does not manufacture a changed plan',async()=>{
 const f=fixture();await f.operate(request(f,1));const reverse=x=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reverse(v)])):x;
 for(const row of f.rows.values())if(row.action==='PURCHASE_PLAN_SAVED')row.details.costing=reverse(row.details.costing);
 const before=copy([...f.rows]);await assert.rejects(f.operate(request(f,2)),/have not changed/);assert.deepEqual(copy([...f.rows]),before);
});
test('changed quantity and FOC composition persist even with the same resulting unit cost',async()=>{
 const f=fixture();await f.operate(request(f,1));await f.operate(request(f,2,{...normal,mode:'FOC',paidCtn:100,freeCtn:100,prices:{...normal.prices,lpPc:2,lpCtn:32}}));
 assert.equal(count(f),2);assert.equal(f.task().lpCtn,16);assert.equal(f.workspace().tasks.find(t=>t.id===f.id).procurement.costing.freeCtn,100);
 await f.operate(request(f,3,{...normal,paidCtn:150}));assert.equal(count(f),3);assert.equal(f.workspace().tasks.find(t=>t.id===f.id).procurement.totalCtn,150);
});
test('changed discounts with equal net cost retain their commercial revision',async()=>{
 const f=fixture();await f.operate(request(f,1));await f.operate(request(f,2,{...normal,prices:{...normal.prices,lpPc:2,lpCtn:32,disc1:.5}}));assert.equal(count(f),2);assert.equal(f.task().lpCtn,16);
});
test('transport-only and draft supplier changes are not swallowed',async()=>{
 const f=fixture();await f.operate(request(f,1));await f.operate(request(f,2,normal,{transportMode:'SELF_COLLECT'}));assert.equal(count(f),2);
 f.rows.set('SharedSuppliers/B',{_id:'B',title:'B',companyName:'Supplier B',supplierStatus:'ACTIVE'});
 await f.operate(request(f,3,normal,{transportMode:'SELF_COLLECT',supplierId:'B'}));assert.equal(count(f),3);assert.equal(f.task().supplierId,'B');
});
test('new money source with equal total remains a real revision',async()=>{
 const f=fixture();await f.operate(request(f,1));await f.operate(request(f,2,{...normal,moneySource:'TOTAL',amountCents:320000}));assert.equal(count(f),2);
});
test('same original request returns its existing result without new rows',async()=>{
 const f=fixture(),r=request(f,1);const first=await f.operate(r),before=copy([...f.rows]);assert.deepEqual(await f.operate(r),first);assert.deepEqual(copy([...f.rows]),before);
});
for(const boundary of ['TASK','PLAN_EVENT','RESULT'])test('changed cost resumes original request after '+boundary+' interruption',async()=>{
 const f=fixture();await f.operate(request(f,1));const r=request(f,2,{...normal,prices:{...normal.prices,lpPc:2,lpCtn:32}});let hit=false;const update=f.store.update,insert=f.store.insert;
 f.store.update=async(c,row)=>{const value=await update(c,row);if(!hit&&boundary==='TASK'&&c==='NCTTasks'){hit=true;throw Error('SIMULATED');}return value;};
 f.store.insert=async(c,row)=>{if(!hit&&(boundary==='PLAN_EVENT'&&row.action==='PURCHASE_PLAN_SAVED'||boundary==='RESULT'&&row.action==='PURCHASE_OPERATION_RESULT')){hit=true;throw Error('SIMULATED');}return insert(c,row);};
 await assert.rejects(f.operate(r),/SIMULATED/);f.store.update=update;f.store.insert=insert;assert.equal((await f.operate(r)).ok,true);assert.equal(f.task().lpCtn,32);assert.equal(count(f),2);
 const before=copy([...f.rows]);await f.operate(r);assert.deepEqual(copy([...f.rows]),before);
});
