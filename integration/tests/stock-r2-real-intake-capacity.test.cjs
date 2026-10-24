'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{copy,same}=require('../prototypes/stock-current-state/segmented-plan.cjs'),{hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {verifyR2IntakeCapacity}=require('../prototypes/stock-current-state/r2-intake-capacity.cjs');
const folder='../prototypes/stock-current-state/isolated-cohort/MASTER/';
const runtime=vm.runInNewContext(fs.readFileSync(require.resolve(folder+'r2stockCurrentCommands.js'),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({createSdkConditionalStore,createSegmentedFencedProof,createCurrentOrderIntakeOperations});',{createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});
const intake=vm.runInNewContext(fs.readFileSync(require.resolve(folder+'r2nctIntake.js'),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({createNctIntake,createNctReceiptReader});',{createHash:crypto.createHash});
function fixture(){
 const name=require.resolve('./stock-r2-cas-native-acceptance.test.cjs');
 const base=vm.runInNewContext(fs.readFileSync(name,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',{require:createRequire(name),Map,Buffer,__dirname});
 const f=base('SPT-R2INTAKE300-20261024-4f8c:'),query=f.items.query;
 f.items.query=c=>{const q=query(c);q.startsWith=(k,prefix)=>{let limit=1;q.limit=n=>{limit=n;return q;};q.find=async()=>{const all=[...f.rows.values()].filter(row=>String(row[k]).startsWith(prefix));return{items:copy(all.slice(0,limit)),totalCount:all.length};};return q;};return q;};
 return{...f,run:(step,enabled=true)=>verifyR2IntakeCapacity({...runtime,...intake,items:f.items,hash,copy,same,input:{step},enabled})};
}
test('actual R2 intake diagnostic is Admin-only/CLOSED and cannot accept a browser gate or old test identity',async()=>{
 const f=fixture();assert.equal((await f.run('SEED',false)).blocked,true);assert.equal(f.rows.size,0);
 await assert.rejects(verifyR2IntakeCapacity({input:{step:'SEED',enabled:true}}));
 const source=require('../prototypes/stock-current-state/build-r2-intake-capacity.cjs').source,grants=[];
 const run=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyR2Intake;',{...runtime,...intake,items:f.items,createHash:crypto.createHash,Permissions:{Admin:'ADMIN'},webMethod:(p,fn)=>{grants.push(p);return fn;}});
 assert.deepEqual(grants,['ADMIN']);assert.equal((await run({step:'SEED'})).blocked,true);assert.equal(f.rows.size,0);
 assert.doesNotMatch(source,/SPT-R2CAPACITY-|SPT-COMMIT300-|SPT-R2CAS20-/);
});
test('actual generated R2 intake processes 300 distinct lines, known interruption and exact original receipt without deleting or recapturing',async t=>{
 const f=fixture();assert.equal((await f.run('SEED')).ok,true);const seed=copy([...f.rows]);assert.equal((await f.run('SEED')).ok,false);assert.deepEqual(copy([...f.rows]),seed);
 let rounds=0,result,interrupted=false,captures=0;const receipts=[];
 do{const control=[...f.rows.values()].find(row=>row.details?.writerBuild==='CAPACITY-FIXTURE-ONLY').details;
  const step=!interrupted&&control.pending?.phase==='BEFORE'&&control.pending.count-control.pending.cursor<20?'FAULT':'ADVANCE';
  result=await f.run(step);assert.equal(result.ok,true,JSON.stringify(result));captures+=result.captures||0;receipts.push(result);assert.ok(++rounds<200);
  if(step==='FAULT'){interrupted=true;assert.equal(result.partialBusinessInserts,3);assert.equal((await f.run('INSPECT')).mixedReadBlocked,true);}
 }while(result.control?.generation!==1);
 const final=await f.run('INSPECT');assert.equal(final.ok,true,JSON.stringify(final));assert.equal(final.taskCount,300);assert.equal(final.costErrorTaskCount,0);assert.equal(captures,1);assert.equal(interrupted,true);
 const rows=[...f.rows.values()].map(row=>row.details);assert.equal(rows.filter(row=>row.action==='ORDER_RECEIVED').length,1);
 assert.equal([...f.rows.keys()].filter(id=>id.includes(':R2NCTOrders:')).length,300);assert.equal([...f.rows.keys()].filter(id=>id.includes(':R2NCTTasks:')).length,300);assert.equal([...f.rows.keys()].filter(id=>id.includes(':R2StockProducts:')).length,300);
 const before=copy([...f.rows]);assert.equal((await f.run('REPLAY')).mutationAttempted,false);assert.deepEqual(copy([...f.rows]),before);assert.ok(f.calls.every(([action])=>action!=='remove'));
 assert.equal(final.originalBusinessCollectionsAccepted,false);assert.equal(final.activationReady,false);
 t.diagnostic(JSON.stringify({localOnly:true,rounds,maxQueries:Math.max(...receipts.map(r=>r.operationsAttempted.queries)),maxInserts:Math.max(...receipts.map(r=>r.operationsAttempted.inserts)),planCount:1202}));
});
