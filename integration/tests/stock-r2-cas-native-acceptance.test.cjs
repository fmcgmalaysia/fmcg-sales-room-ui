'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {verifyR2CasAcceptance}=require('../prototypes/stock-current-state/r2-cas-acceptance.cjs');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {copy,same}=require('../prototypes/stock-current-state/segmented-plan.cjs');
function fixture(prefix='SPT-R2CAS-20261024-6d31:'){
 const rows=new Map(),calls=[];
 const scope=(c,id)=>{assert.equal(c,'StockProtocolTest');if(id)assert.ok(id.startsWith(prefix));};
 const items={query:c=>{scope(c);let filter=()=>true,limit=2;const q={eq:(k,v)=>{filter=r=>r[k]===v;return q;},hasSome:(k,v)=>{filter=r=>v.includes(r[k]);return q;},limit:n=>{limit=n;return q;},find:async o=>{assert.equal(o.consistentRead,true);const all=[...rows.values()].filter(filter);return{items:copy(all.slice(0,limit)),totalCount:all.length};}};return q;},
  insert:async(c,row)=>{scope(c,row._id);if(rows.has(row._id))throw Error('DUPLICATE');rows.set(row._id,copy(row));calls.push(['insert',row._id]);return copy(row);},
  patch:(c,id)=>{scope(c,id);const set=new Map(),remove=[];const p={setField:(k,v)=>{set.set(k,copy(v));return p;},removeField:k=>{remove.push(k);return p;},run:async o=>{const row=rows.get(id);if(Object.entries(o.condition).some(([k,v])=>row?.[k]!==v.$eq))throw Error('CONDITION');const next=copy(row);for(const k of remove)delete next[k];for(const[k,v]of set)next[k]=v;rows.set(id,next);calls.push(['patch',id]);return copy(next);}};return p;},
  remove:()=>{throw Error('DELETE FORBIDDEN');}};
 return{items,rows,calls,run:(step,enabled=true)=>verifyR2CasAcceptance({items,createSdkConditionalStore,createSegmentedFencedProof,hash,copy,same,input:{step},enabled})};
}
test('new native CAS diagnostic defaults CLOSED before any query; exact steps only, no browser gate or delete capability',async()=>{
 const f=fixture();assert.equal((await f.run('SEED',false)).blocked,true);assert.equal(f.calls.length,0);
 await assert.rejects(verifyR2CasAcceptance({input:{step:'SEED',enabled:true}}));
 const source=fs.readFileSync(require.resolve('../prototypes/stock-current-state/r2CasAcceptance.web.js'),'utf8');
 const grants=[],run=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyR2Cas;',
  {items:f.items,createHash:crypto.createHash,randomBytes:crypto.randomBytes,Permissions:{Admin:'ADMIN'},webMethod:(p,fn)=>{grants.push(p);return fn;}});
 assert.deepEqual(grants,['ADMIN']);assert.equal((await run({step:'SEED'})).blocked,true);
 assert.match(source,/remove:\(\)=>\{throw Error\('NO_DELETE_CAPABILITY'\)/);assert.equal(f.rows.size,0);
});

test('separate twenty-step native candidate matches database roots, performs at most twenty conditional domain updates and cannot alter stopped scenarios',async t=>{
 const {buildR2RuntimeAcceptance,source}=require('../prototypes/stock-current-state/build-r2-cas-runtime-acceptance.cjs');
 assert.doesNotMatch(source,/SPT-R2CAS-20261024-6d31:|SPT-COMMIT300-|SPT-R2CAPACITY-/);
 assert.match(source,/stepsPerInvocation:20/);assert.match(source,/\+\+counts.patches>24/);
 assert.throws(()=>buildR2RuntimeAcceptance(source),/anchor/);
 const f=fixture('SPT-R2CAS20-20261024-73b4:');
 const run=vm.runInNewContext(source.replace('NATIVE_R2_CAS_ACCEPTANCE_ENABLED=false','NATIVE_R2_CAS_ACCEPTANCE_ENABLED=true')
  .replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyR2Runtime;',
  {items:f.items,createHash:crypto.createHash,randomBytes:crypto.randomBytes,Permissions:{Admin:'ADMIN'},webMethod:(_,fn)=>fn});
 assert.equal((await run({step:'SEED'})).ok,true);let result,rounds=0;const receipts=[];
 do{result=await run({step:'ADVANCE'});assert.equal(result.ok,true,JSON.stringify(result));assert.ok(++rounds<8);receipts.push(result);}while(result.control?.generation!==1);
 const final=await run({step:'INSPECT'});assert.equal(final.totalOnHand,2200);assert.equal(final.verifiedImages,20);
 assert.equal(Math.max(...receipts.map(r=>r.operationsAttempted.patches)),22);
 const before=copy([...f.rows]);assert.equal((await run({step:'REPLAY'})).mutationAttempted,false);assert.deepEqual([...f.rows],before);
 t.diagnostic(JSON.stringify({runtime20MockInvocations:rounds,maxPatches:22,nativeAccepted:false}));
});
test('exact twenty-row native path known interruption, unchanged cursor, same request recovery, full inspection and replay',async t=>{
 const f=fixture();assert.equal((await f.run('SEED')).seeded,20);const seeded=copy([...f.rows]);
 assert.equal((await f.run('SEED')).ok,false);assert.deepEqual([...f.rows],seeded);
 let result,injected=false,runs=0;const receipts=[];
 do{const control=f.rows.get('SPT-R2CAS-20261024-6d31:NCTActivity:'+hash('NCT','STOCK_CONTROL'));
  const step=!injected&&control.pending?.phase==='BEFORE'&&control.pending.cursor===20?'FAULT':'ADVANCE';
  result=await f.run(step);assert.equal(result.ok,true,JSON.stringify(result));receipts.push(result);assert.ok(++runs<12);
  if(step==='FAULT'){injected=true;assert.equal(result.applied,3);assert.equal(result.cursorUnchanged,true);const pending=await f.run('INSPECT');assert.equal(pending.mixedReadBlocked,true);assert.equal(pending.applied,3);}
 }while(result.control?.generation!==1);
 assert.equal(injected,true);const final=await f.run('INSPECT');assert.equal(final.verifiedImages,20);assert.equal(final.totalOnHand,2200);
 const before=copy([...f.rows]);assert.equal((await f.run('REPLAY')).stage,'COMPLETED_REPLAY');assert.deepEqual([...f.rows],before);
 assert.ok(f.calls.every(([,id])=>id!=='SPT-R2CAS-20261024-6d31:NCTActivity:'+hash('NCT/PURCHASE','LOCK')));
 assert.equal(final.productionCapacityAccepted,false);assert.equal(final.activationReady,false);
 t.diagnostic(JSON.stringify({mockInvocations:runs,receipts:receipts.map(r=>({stage:r.stage,ops:r.operationsAttempted}))}));
});
