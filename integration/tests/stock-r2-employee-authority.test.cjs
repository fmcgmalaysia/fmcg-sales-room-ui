'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {verifyR2SdkAuthority}=require('../prototypes/stock-current-state/r2-sdk-authority-probe.cjs');
const {source}=require('../prototypes/stock-current-state/build-r2-employee-authority-probe.cjs');
test('new employee endpoints preserve original authorization before even a CLOSED probe and never accept browser scope',async()=>{
 const calls=[];const api=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({verifyPurchaseR2Authority,verifyWarehouseR2Authority});',{
  items:{},auth:{elevate:()=>{throw Error('No elevated access while closed');}},Permissions:{SiteMember:'MEMBER',Admin:'ADMIN'},webMethod:(permission,fn)=>{assert.ok(['MEMBER','ADMIN'].includes(permission));return fn;},
  getPurchaseStaffContext:async()=>{calls.push('PURCHASE_AUTH');throw Error('ORIGINAL_DENIED');},currentMember:{getMember:async()=>{calls.push('WAREHOUSE_AUTH');throw Error('ORIGINAL_DENIED');}},console:{info:()=>{}}
 });
 for(const fn of Object.values(api))await assert.rejects(fn({step:'RUN',collection:'Orders'}),/ORIGINAL_DENIED/);
 assert.deepEqual(calls,['PURCHASE_AUTH','WAREHOUSE_AUTH']);assert.doesNotMatch(source,/items\.remove|Permissions\.Anyone|suppressAuth|setMode/);
});
test('administrator raw read success is explicitly refused as ordinary employee proof before mutation',async()=>{
 let calls=0;const q={hasSome:()=>q,limit:()=>q,find:async()=>{calls++;return{items:[],totalCount:0};}},items={query:()=>q,insert:()=>{throw Error('No insert');},bulkInsert:()=>{},patch:()=>{}};
 const r=await verifyR2SdkAuthority({items,elevate:fn=>fn,input:{step:'RUN'},enabled:true,fixture:'PURCHASE',requireUnprivileged:true});
 assert.equal(r.stage,'PRIVILEGED_CONTEXT');assert.equal(r.mutationAttempted,false);assert.equal(r.ordinaryStaffAuthorizationAccepted,false);assert.equal(calls,1);
});
test('network or unknown baseline error is not permission-denial proof and cannot write',async()=>{
 let mutations=0;const q={hasSome:()=>q,limit:()=>q,find:async()=>{throw Error('504 UNKNOWN');}};
 const r=await verifyR2SdkAuthority({items:{query:()=>q,insert:()=>mutations++,bulkInsert:()=>mutations++,patch:()=>mutations++},elevate:fn=>fn,input:{step:'RUN'},enabled:true,fixture:'WAREHOUSE',requireUnprivileged:true});
 assert.equal(r.ok,false);assert.equal(r.error,'504 UNKNOWN');assert.equal(r.mutationAttempted,false);assert.equal(mutations,0);
});
test('employee fixtures cannot omit ordinary permission evidence or select arbitrary records',async()=>{
 for(const fixture of ['WAREHOUSE','PURCHASE','ANY'])await assert.rejects(verifyR2SdkAuthority({input:{step:'RUN'},fixture}),/fixture required/);
 await assert.rejects(verifyR2SdkAuthority({input:{step:'RUN',fixture:'PURCHASE'}}),/Exact authority probe/);
});
test('CLOSED employee INSPECT proves raw denial and scoped elevated read without any write',async()=>{
 let reads=0,writes=0;const query=denied=>{const q={hasSome:()=>q,limit:()=>q,find:async()=>{reads++;if(denied)throw Error('WDE0027: read denied');return{items:[],totalCount:0};}};return q;};
 const rawQuery=()=>query(true),items={query:rawQuery,insert:()=>writes++,bulkInsert:()=>writes++,patch:()=>writes++};
 const r=await verifyR2SdkAuthority({items,elevate:fn=>fn===rawQuery?()=>query(false):fn,input:{step:'INSPECT'},enabled:false,fixture:'PURCHASE',requireUnprivileged:true});
 assert.equal(r.ok,true);assert.equal(r.ordinaryStaffReadAccepted,true);assert.equal(r.ordinaryReadDenied,true);assert.equal(r.ordinaryStaffAuthorizationAccepted,false);assert.equal(r.complete,false);assert.equal(reads,2);assert.equal(writes,0);
});
for(const env of ['backend','browser'])test('temporary read page never repeats writes or runs employee calls on server: '+env,async()=>{
 const fs=require('node:fs'),path=require('node:path'),page=fs.readFileSync(path.join(__dirname,'../prototypes/stock-current-state/r2-employee-authority-page.additions.js'),'utf8');
 assert.doesNotMatch(page,/step:'RUN'/);let ready;const calls=[],titles=[];
 const inspect=role=>async input=>{calls.push(role);assert.equal(input.step,'INSPECT');return{ok:true,complete:true,ordinaryStaffReadAccepted:true,mutationAttempted:false};};
 vm.runInNewContext(page.replace(/^import[^\n]+\n/gm,'').replace('R2_EMPLOYEE_PAGE_ENABLED=false','R2_EMPLOYEE_PAGE_ENABLED=true'),{
  $w:{onReady:fn=>ready=fn},wixWindowFrontend:{rendering:{env}},wixSeoFrontend:{setTitle:async title=>titles.push(title)},
  verifyPurchaseR2Authority:inspect('PURCHASE'),verifyWarehouseR2Authority:inspect('WAREHOUSE'),console:{info:()=>{},error:()=>{}}
 });await ready();assert.deepEqual(calls,env==='browser'?['PURCHASE','WAREHOUSE']:[]);assert.deepEqual(titles,env==='browser'?['R2 Employee Read Check RUNNING','R2 Employee Read Check PASS']:[]);
});
