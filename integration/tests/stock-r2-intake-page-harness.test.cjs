const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../prototypes/stock-current-state/r2-intake-capacity-page.candidate.js'),'utf8');
const checkpoint={count:1202,key:'5a7eb83b6d6e7a1cb390c9f258b8b219',digest:'8c8260ce8b951aa7e8704361bb4911b5',planHash:'4b841011c2e29deab7ec45a1771253ad',phase:'BEFORE',cursor:20};
function fixture({enabled=true,fail=false,wrong=false}={}){let start,inspects=0,advances=0;const calls=[],logs=[];
 vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace('const R2_INTAKE_PAGE_ENABLED = false;',`const R2_INTAKE_PAGE_ENABLED = ${enabled};`),{
  $w:{onReady:fn=>start=fn},console:{info:line=>logs.push(line),error:line=>logs.push(line)},verifyR2Intake:async({step})=>{
   calls.push(step);if(fail&&step==='ADVANCE')throw Error('504 unknown');let result;
   if(step==='INSPECT')result=++inspects===1?{generation:0,pending:{...checkpoint,...(wrong?{cursor:40}:{})}}:inspects===2?{mixedReadBlocked:true}:{taskCount:300,orderCount:300,productCount:300,verifiedDomainImages:1202};
   else if(step==='ADVANCE')result=++advances===1?{control:{generation:0,pending:{...checkpoint,cursor:1200}}}:{control:{generation:1,pending:null}};
   else if(step==='FAULT')result={stage:'KNOWN_INTERRUPTION_CONFIRMED',partialBusinessInserts:3,pending:{...checkpoint,phase:'APPLY',cursor:0}};
   else if(step==='REPLAY')result={mutationAttempted:false};else throw Error('Unexpected step');
   return{ok:true,schema:'R2_REAL_INTAKE_CAPACITY_V1',step,...result};}});
 return{calls,logs,start:()=>start()};}
test('unpublished harness is disabled by default and only resumes the exact recorded checkpoint',async()=>{
 const closed=fixture({enabled:false});await closed.start();assert.equal(closed.calls.length,0);
 const wrong=fixture({wrong:true});await wrong.start();assert.deepEqual(wrong.calls,['INSPECT']);assert.ok(wrong.logs.at(-1).startsWith('R2INTAKE_PAGE_STOP '));
});
test('harness waits for each confirmed result, exercises interruption and finishes with strong readback plus zero-write replay',async()=>{
 const f=fixture();await f.start();assert.deepEqual(f.calls,['INSPECT','ADVANCE','FAULT','INSPECT','ADVANCE','INSPECT','REPLAY']);
 assert.ok(f.logs.at(-1).startsWith('R2INTAKE_PAGE_COMPLETE '));assert.equal(f.calls.includes('SEED'),false);
});
test('uncertain backend call stops immediately, retaining confirmations and never retrying or cleaning up',async()=>{
 const f=fixture({fail:true});await f.start();assert.deepEqual(f.calls,['INSPECT','ADVANCE']);const stop=JSON.parse(f.logs.at(-1).slice('R2INTAKE_PAGE_STOP '.length));
 assert.equal(stop.confirmedReceipts.length,1);assert.equal(stop.noAutomaticRetryResetOrCleanup,true);
});
