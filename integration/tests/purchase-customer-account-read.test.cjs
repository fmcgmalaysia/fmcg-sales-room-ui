const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup,request}=require('../prototypes/cms-read-review-20261103/read-growth-contract.cjs');
const load=require('./load-master-module.cjs'),{operationId}=load('purchaseOperationJournal.js');
const backend=path.resolve(__dirname,'../backend'),file=path.join(backend,'purchaseWorkspace.web.js');
const excluded=['CUSTOMER_ACCOUNT_DOCUMENT_SAVED','CUSTOMER_ACCOUNT_ALLOCATION_SAVED'];
const cp=x=>JSON.parse(JSON.stringify(x));
const oldSource=s=>excluded.reduce((text,action)=>text.replace(`.ne('action','${action}')`,''),s);
const stable=w=>{const out=cp(w);delete out.fetchedAt;delete out.purchaseOrders?.readAt;return out;};
function seedRows(f,rows){f.rows.clear();for(const [key,row] of rows)f.rows.set(key,cp(row));}
function customerHistory(f,count){for(let i=0;i<count;i++)f.rows.set('NCTActivity/AR'+i,{_id:'AR'+i,title:'AR'+i,action:excluded[i%2],result:'SAVED',description:'CUSTOMER_INVOICE',image:'C',activityTime:'2020-01-01T00:00:00Z',details:{document:{id:'D'+i,customerId:'C',amountCents:100},allocations:[{invoiceId:'SI',cents:100}]}});}

test('Purchase dependency closure has no consumer of the two excluded customer AR events',()=>{
 const seen=new Set();function visit(name){if(seen.has(name))return;seen.add(name);const source=fs.readFileSync(path.join(backend,name),'utf8');
  for(const action of excluded)if(name!=='purchaseWorkspace.web.js')assert.ok(!source.includes(action),name+' now consumes '+action);
  assert.doesNotMatch(source,/backend\/customerAccountLedger|backend\/customerInvoicePayments/);
  for(const match of source.matchAll(/from\s+['"]backend\/([^'"]+)['"]/g))visit(/\.js$/.test(match[1])?match[1]:match[1]+'.js');
 }visit('purchaseWorkspace.web.js');assert.ok(seen.size>=40);
});

for(const count of [0,1001,100000])test(`${count} customer AR events: identical complete Purchase response, no writes, bounded returned rows`,async()=>{
 const seed=setup();await seed.operate(request(seed,1));customerHistory(seed,count);const rows=cp([...seed.rows]);
 const old=setup({workspaceSourceTransform:oldSource}),current=setup();seedRows(old,rows);seedRows(current,rows);
 const before=cp([...current.rows]),a=await old.read('NCT'),b=await current.read('NCT');assert.deepEqual(stable(b),stable(a));assert.deepEqual(cp([...current.rows]),before);assert.equal(current.mutations.length,0);
 const oldRows=old.queries.reduce((n,q)=>n+q.rows,0),newRows=current.queries.reduce((n,q)=>n+q.rows,0);assert.equal(oldRows-newRows,count);assert.equal(newRows,10);assert.equal(current.queries.length,5);
});

for(const boundary of ['TASK','PRICE','SHARES','PLAN','RESULT'])test(`interrupted PLAN at ${boundary}: query exclusion preserves pending state and original recovery`,async()=>{
 const f=setup();await f.operate(request(f,1));customerHistory(f,20);const r=request(f,2,32,220),insert=f.store.insert,update=f.store.update;let hit=false;
 const target={PRICE:'PURCHASE_PRICE_SAVED',SHARES:'PURCHASE_SOURCE_SHARES_SAVED',PLAN:'PURCHASE_PLAN_SAVED',RESULT:'PURCHASE_OPERATION_RESULT'}[boundary];
 f.store.insert=async(c,row)=>{if(!hit&&row.action===target){hit=true;throw Error('OFFLINE_INTERRUPT');}return insert(c,row);};
 f.store.update=async(c,row)=>{const result=await update(c,row);if(!hit&&boundary==='TASK'&&c==='NCTTasks'){hit=true;throw Error('OFFLINE_INTERRUPT');}return result;};
 await assert.rejects(f.operate(r),/OFFLINE_INTERRUPT/);assert.ok(hit);f.store.insert=insert;f.store.update=update;
 const old=setup({workspaceSourceTransform:oldSource});seedRows(old,cp([...f.rows]));assert.deepEqual(stable(await f.read('NCT')),stable(await old.read('NCT')));
 await f.operate(r);assert.equal((await f.read('NCT')).tasks.find(row=>row.id===f.id).lpCtn,32);const before=cp([...f.rows]);await f.operate(r);assert.deepEqual(cp([...f.rows]),before);
});

function activityReader(rows,fail=false){
 const calls=[],query=()=>{let filters=[],size=1000;const q={ne(k,v){filters.push(r=>r[k]!=null&&r[k]!==v);return q;},isEmpty(k){filters.push(r=>r[k]==null||r[k]==='');return q;},hasSome(k,v){filters.push(r=>v.includes(r[k]));return q;},matches:r=>filters.every(f=>f(r)),or(other){const prior=filters;filters=[r=>prior.every(f=>f(r))||other.matches(r)];return q;},limit(n){size=n;return q;},async find(options){assert.equal(options.consistentRead,true);assert.equal(options.suppressAuth,true);if(fail)throw Error('QUERY_FAILED');const selected=rows.filter(q.matches);const page=start=>{const items=selected.slice(start,start+size);calls.push(items.map(r=>r.title));return {items,hasNext:()=>start+size<selected.length,next:async()=>page(start+size)};};return page(0);}};return q;};
 const source=fs.readFileSync(file,'utf8'),body=source.slice(source.indexOf('const options'),source.indexOf('export const getPurchaseWorkspace'));
 return {read:vm.runInNewContext(body+'\npurchaseActivity;',{wixData:{query},operationId}),calls};
}
test('cross-month, unknown and empty actions stay; only two AR actions and unrelated RESULT are excluded',async()=>{
 const actions=['WAREHOUSE_RECEIPT_SAVED','PURCHASE_PLAN_SAVED','PURCHASE_SOURCE_SHARES_SAVED','PURCHASE_OPERATION_PREPARED','PURCHASE_OPERATION_LOCK','FUTURE_ACTION','',null,undefined,...excluded,'PURCHASE_OPERATION_RESULT'];
 const rows=actions.map((action,i)=>({title:'R'+i,action,activityTime:'2020-01-01',result:'SAVED'}));const f=activityReader(rows),result=await f.read('NCTActivity');assert.deepEqual(cp(result),cp(rows.slice(0,9)));
});
test('legacy row-order receipts still fetched in bounded groups and all matching pages retained',async()=>{
 const prepared=Array.from({length:205},(_,i)=>({title:'P'+i,action:'PURCHASE_OPERATION_PREPARED',details:{plan:{displayOrder:{}}}})),receipts=prepared.map(row=>({title:operationId(row.title,'RESULT'),action:'PURCHASE_OPERATION_RESULT'}));
 const ordinary=Array.from({length:2005},(_,i)=>({title:'H'+i,action:'FUTURE_ACTION'}));const f=activityReader([...ordinary,...prepared,...receipts]);const rows=await f.read('NCTActivity');assert.equal(rows.length,2415);assert.deepEqual(f.calls.map(x=>x.length),[1000,1000,210,100,100,5]);assert.equal(new Set(rows.map(r=>r.title)).size,rows.length);
});
test('failed CMS read remains an error, never an empty successful workspace',async()=>{await assert.rejects(activityReader([],true).read('NCTActivity'),/QUERY_FAILED/);});
test('NCT activity never appears in GHR and invalid company still rejected',async()=>{
 const f=setup();customerHistory(f,20);const w=await f.read('GHR');assert.equal(w.tasks.length,0);assert.ok(f.queries.every(q=>!['NCTOrders','NCTTasks','NCTActivity'].includes(q.collection)));assert.ok(f.queries.some(q=>q.collection==='NCTActivity1'));await assert.rejects(f.read('OTHER'),/Select NCT or GHR/);
});
