'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(options={}){
 const rows=new Map(),calls=[],delayed=[];let fault;
 const key=(c,id)=>c+'/'+id;
 const items={query:c=>{let ids,limit;const q={eq:(k,v)=>{ids=[v];return q;},hasSome:(k,v)=>{ids=v;return q;},limit:n=>{limit=n;return q;},find:async o=>{
  assert.equal(o.consistentRead,true);const found=ids.map(id=>rows.get(key(c,id))).filter(Boolean);return{items:copy(found.slice(0,limit)),totalCount:found.length};}};return q;},
  insert:async(c,row)=>{calls.push(['single',c]);if(rows.has(key(c,row._id)))throw Error('DUPLICATE');rows.set(key(c,row._id),copy(row));return copy(row);},
  bulkInsert:async(c,input)=>{calls.push(['bulk',c,input.length]);const batch=copy(input),f=fault?.c===c?fault:null;if(f)fault=null;
   const apply=()=>{for(const row of batch)if(!rows.has(key(c,row._id)))rows.set(key(c,row._id),copy(row));};
   if(f?.kind==='delayed'){delayed.push(apply);throw Error('UNKNOWN_BULK');}
   if(f?.kind==='partial'){batch.splice(3);apply();return{errors:[{error:'REJECTED_ROW'}]};}
   if(f?.kind==='reject')throw Error('QUOTA');
   apply();if(f?.kind==='lost')throw Error('LOST_BULK_REPLY');return{inserted:batch.length};},
  patch:(c,id)=>{const set=new Map(),removed=[];const p={setField:(k,v)=>{set.set(k,copy(v));return p;},removeField:k=>{removed.push(k);return p;},run:async o=>{
   calls.push(['cas',c]);const row=rows.get(key(c,id));if(Object.entries(o.condition).some(([k,v])=>row?.[k]!==v.$eq))throw Error('CONDITION');
   const after=copy(row);for(const k of removed)delete after[k];for(const[k,v]of set)after[k]=v;rows.set(key(c,id),after);return copy(after);}};return p;},
  remove:()=>{throw Error('NO_DELETE');}};
 const store=createSdkConditionalStore({items,company:'NCT',collections:['NCTActivity','StockPositions','StockClaims']});
 const protocol=createSegmentedFencedProof({store,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,batchNewInserts:true,...options});
 const request={requestId:'11111111-1111-4111-8111-111111111111',memberId:'M',input:{amount:12},prepare:async()=>({writes:[
  ...Array.from({length:12},(_,i)=>({collection:'StockClaims',before:null,after:{_id:'C'+i,company:'NCT',quantity:1,_version:'V1'}})),
  {collection:'StockPositions',before:await store.read('StockPositions','P'),after:{_id:'P',company:'NCT',quantity:88,_version:'V1'}}]})};
 const setup=async()=>{await protocol.initialize();await store.insert('StockPositions',{_id:'P',company:'NCT',quantity:100,_version:'V0'});};
 const finish=async()=>{for(let i=0;i<12;i++){const r=await protocol.commit(request);if(r.ok)return r;}throw Error('BOUND');};
 return{items,store,protocol,rows,calls,delayed,request,setup,finish,inject:(kind,c='StockClaims')=>{fault={kind,c};}};
}
test('R2 new inserts are bounded/coalesced, mutable images remain conditional, completed replay writes nothing',async()=>{
 const f=fixture();await f.setup();assert.equal((await f.finish()).generation,1);
 assert.ok(f.calls.some(([kind,c])=>kind==='bulk'&&c==='StockClaims'));
 assert.equal(f.calls.filter(([kind,c])=>kind==='single'&&c==='StockClaims').length,0);
 assert.ok(f.calls.some(([kind,c])=>kind==='cas'&&c==='StockPositions'));
 assert.equal((await f.store.read('StockPositions','P')).quantity,88);
 const n=f.calls.length;await f.finish();assert.equal(f.calls.length,n);
});
for(const kind of ['partial','reject','delayed'])test(`R2 ${kind} bulk result leaves durable cursor pending and same immutable request recovers`,async()=>{
 const f=fixture();await f.setup();f.inject(kind);await assert.rejects(f.finish(),/unconfirmed|UNKNOWN_BULK|QUOTA/);
 const control=await f.protocol.readControl();assert.equal(control.generation,0);assert.ok(control.pending);
 await assert.rejects(f.protocol.readSnapshot(()=>[]),/pending/);assert.equal((await f.finish()).generation,1);
 for(let i=0;i<12;i++)assert.equal((await f.store.read('StockClaims','C'+i)).quantity,1);
 if(kind==='delayed'){
  const prior=await f.store.read('StockClaims','C0');
  await f.store.compareAndSet('StockClaims','C0',prior._version,{...prior,quantity:9,_version:'V2'});
  f.delayed[0]();assert.equal((await f.store.read('StockClaims','C0')).quantity,9,'late insert cannot overwrite a newer image');
 }
});
test('lost bulk reply is acknowledged only after full exact readback',async()=>{
 const f=fixture();await f.setup();f.inject('lost');assert.equal((await f.finish()).generation,1);
 assert.equal((await f.store.read('StockClaims','C11')).quantity,1);
});
for(const kind of ['reject','delayed','lost'])test(`R2 ${kind} fragment batch cannot expose an incomplete manifest or adopt orphan images`,async()=>{
 const f=fixture();await f.setup();f.inject(kind,'NCTActivity');
 if(kind==='lost')await f.finish();else{await assert.rejects(f.finish(),/UNKNOWN_BULK|QUOTA/);assert.equal((await f.protocol.readControl()).pending,null);}
 assert.equal((await f.finish()).generation,1);for(const apply of f.delayed)apply();
 assert.equal((await f.store.read('StockPositions','P')).quantity,88);
});
test('bulk duplicate with different payload blocks; no bulkSave or silent cursor advance',async()=>{
 const f=fixture();await f.setup();f.rows.set('StockClaims/C0',{_id:'C0',company:'NCT',quantity:999,stockCommitVersion:'FOREIGN'});
 await assert.rejects(f.finish(),/before-image stale/);assert.equal((await f.protocol.readControl()).generation,0);
 assert.equal(f.rows.get('StockClaims/C0').quantity,999);
});
test('adapter rejects oversized, duplicate, cross-company and unscoped batches before any SDK request',async()=>{
 const f=fixture(),row={_id:'X',company:'NCT',_version:'V1'};
 for(const [c,rows]of [['StockClaims',[]],['StockClaims',[row,row]],['Other',[row]],['StockClaims',[{...row,company:'GHR'}]],['StockClaims',[{...row,note:'😀'.repeat(120000)}]],['StockClaims',Array.from({length:33},(_,i)=>({...row,_id:String(i)}))]])await assert.rejects(f.store.insertMany(c,rows));
 assert.equal(f.calls.length,0);
});
test('default coordinator never opts into bulk; missing capability fails before staging',()=>{
 const f=fixture();const old={...f.store};delete old.insertMany;
 assert.throws(()=>createSegmentedFencedProof({store:old,batchApplyReads:true,batchNewInserts:true}),/capability/);
 assert.throws(()=>createSegmentedFencedProof({store:f.store,batchApplyReads:true,batchNewInserts:true,stepsPerInvocation:33}),/capability/);
 assert.doesNotThrow(()=>createSegmentedFencedProof({store:old}));
});
