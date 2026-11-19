'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createEmployeeTerminalAcceptance,terminalPrefixes}=require('../prototypes/stock-current-state/r2-employee-terminal-acceptance.cjs');
const {probeBody,source,authorityBuild,probeSourceSha256}=require('../prototypes/stock-current-state/build-r2-employee-terminal-acceptance.cjs');
const probe=vm.runInNewContext(probeBody+';verifyR2SdkAuthority;');
const copy=value=>structuredClone(value);
function fixture(profile='PURCHASE'){
 const f={rows:new Map(),calls:[],owner:'MEMBER',staff:'STAFF',authCount:0};
 const q=privileged=>{let ids=[],limit=0;const query={hasSome:(key,values)=>{assert.equal(key,'_id');ids=values;return query;},limit:n=>{limit=n;return query;},
  find:async options=>{f.calls.push(['query',privileged]);assert.equal(options.consistentRead,true);assert.equal(options.returnTotalCount,true);
   if(!privileged)throw Error(f.baselineError||'WDE0027: denied');
   const rows=[...f.rows.values()].filter(row=>ids.includes(row._id));return {items:copy(rows.slice(0,limit)),totalCount:rows.length};}};return query;};
 const insert=async(table,row)=>{assert.equal(table,'StockProtocolTest');assert.ok(row._id.startsWith(terminalPrefixes[profile]));
  f.calls.push(['insert',row._id]);if(f.rows.has(row._id))throw Error('DUPLICATE');f.rows.set(row._id,copy(row));
  if(row._id.endsWith('TERMINAL')&&f.loseTerminalReply)throw Error('TERMINAL_REPLY_LOST');return copy(row);};
 const bulkInsert=async(table,rows)=>{f.calls.push(['bulkInsert']);for(const row of rows)await insert(table,row);};
 const patch=(table,id)=>{const changes={};const p={setField:(key,value)=>{changes[key]=copy(value);return p;},run:async({condition})=>{
  assert.equal(table,'StockProtocolTest');f.calls.push(['patch',id]);const row=f.rows.get(id);
  if(row?.company!==condition.company.$eq||row?.stockCommitVersion!==condition.stockCommitVersion.$eq)throw Error('WDE0193 Condition not met');
  Object.assign(row,changes);return copy(row);}};return p;};
 const items={query:()=>q(false),insert:()=>{throw Error('UNPRIVILEGED_INSERT');},bulkInsert:()=>{throw Error('UNPRIVILEGED_BULK');},patch:()=>{throw Error('UNPRIVILEGED_PATCH');}};
 const elevated=new Map([[items.query,()=>q(true)],[items.insert,insert],[items.bulkInsert,bulkInsert],[items.patch,patch]]);
 f.items=items;f.elevate=fn=>{if(!elevated.has(fn))throw Error('Only official SDK methods');return elevated.get(fn);};
 f.authenticate=async()=>{f.authCount++;if(f.authError)throw Error('ORIGINAL_DENIED');if(f.authChange)f.authChange(f);return {memberId:f.owner,staffId:f.staff};};
 f.options={profile,authorityBuild,probeSourceSha256,probe,items,elevate:f.elevate,authenticate:f.authenticate,enabled:true};
 f.api=createEmployeeTerminalAcceptance(f.options);return f;
}
test('actual compiled probe writes only fresh fixed profile rows and persists a verified terminal receipt',async()=>{
 for(const profile of ['PURCHASE','WAREHOUSE']){
  const f=fixture(profile),result=await f.api.execute({step:'RUN'});
  assert.equal(result.stage,'NATIVE_EMPLOYEE_WRITE_TERMINAL_CONFIRMED');assert.equal(result.ordinaryStaffWriteAccepted,true);
  assert.equal(result.businessAuthorizationAccepted,false);assert.equal(result.writerCoverageAccepted,false);assert.equal(result.activationAllowed,false);
  assert.equal(f.rows.size,4);assert.ok([...f.rows.keys()].every(id=>id.startsWith(terminalPrefixes[profile])));
  const receipt=f.rows.get(terminalPrefixes[profile]+'TERMINAL');assert.equal(receipt.details.profile,profile);
  assert.equal(receipt.details.evidence.staleConditionRejected,true);assert.match(receipt.details.actorHash,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(receipt.details).includes('MEMBER'));assert.equal(f.calls.filter(row=>row[0]==='patch').length,2);
 }
});
test('lost final reply is proven by INSPECT alone and RUN cannot replay any occupied fixture',async()=>{
 const f=fixture();f.loseTerminalReply=true;await assert.rejects(f.api.execute({step:'RUN'}),/TERMINAL_REPLY_LOST/);
 const writes=f.calls.filter(row=>row[0]!=='query').length;
 const result=await f.api.execute({step:'INSPECT'});assert.equal(result.terminalReceiptVerified,true);assert.equal(result.mutationAttempted,false);
 assert.equal(f.calls.filter(row=>row[0]!=='query').length,writes);
 await assert.rejects(f.api.execute({step:'RUN'}),/Occupied/);assert.equal(f.calls.filter(row=>row[0]!=='query').length,writes);
});
test('three after-images without negative/stale terminal evidence can never become accepted write proof',async()=>{
 const f=fixture();f.options.probe=async args=>{await probe(args);throw Error('INTERRUPTED_BEFORE_TERMINAL');};
 f.api=createEmployeeTerminalAcceptance(f.options);await assert.rejects(f.api.execute({step:'RUN'}),/INTERRUPTED_BEFORE_TERMINAL/);
 assert.equal(f.rows.size,3);const result=await f.api.execute({step:'INSPECT'});assert.equal(result.ordinaryStaffWriteAccepted,false);
 await assert.rejects(f.api.execute({step:'RUN'}),/Occupied/);assert.equal(f.rows.size,3);
});
test('current employee, build, exact receipt and domain after-images all bind the immutable proof',async()=>{
 for(const mutate of [f=>f.owner='OTHER',f=>f.staff='REISSUED',f=>f.rows.get(terminalPrefixes.PURCHASE+'TERMINAL').details.authorityBuild='f'.repeat(40),
  f=>f.rows.get(terminalPrefixes.PURCHASE+'TERMINAL').details.evidence.staleConditionRejected=false,
  f=>f.rows.get(terminalPrefixes.PURCHASE+'CONDITIONAL').details.value=999]){
  const f=fixture();await f.api.execute({step:'RUN'});mutate(f);assert.equal((await f.api.execute({step:'INSPECT'})).terminalReceiptVerified,false);
 }
});
test('original grant denial and changed staff identity prevent creation of terminal proof',async()=>{
 const denied=fixture();denied.authError=true;await assert.rejects(denied.api.execute({step:'RUN'}),/ORIGINAL_DENIED/);assert.equal(denied.calls.length,0);
 const f=fixture();f.authChange=current=>{if(current.authCount===3)current.owner='OTHER';};
 await assert.rejects(f.api.execute({step:'RUN'}),/Same original/);assert.equal(f.rows.size,3);assert.ok(!f.rows.has(terminalPrefixes.PURCHASE+'TERMINAL'));
});
test('unknown baseline error, incomplete method report and administrative SDK context cannot be certified',async()=>{
 const f=fixture();f.baselineError='504 UNKNOWN';await assert.rejects(f.api.execute({step:'RUN'}),/not terminally verified/);assert.equal(f.rows.size,0);
 const g=fixture();g.options.probe=async args=>({...await probe(args),staleConditionRejected:false});g.api=createEmployeeTerminalAcceptance(g.options);
 await assert.rejects(g.api.execute({step:'RUN'}),/not terminally verified/);assert.equal(g.rows.size,3);
 const h=fixture();h.options.probe=async args=>({...await probe(args),ordinaryReadDenied:false});h.api=createEmployeeTerminalAcceptance(h.options);
 await assert.rejects(h.api.execute({step:'RUN'}),/not terminally verified/);assert.ok(!h.rows.has(terminalPrefixes.PURCHASE+'TERMINAL'));
});
test('closed mutation gate still requires original grant and supports read-only empty inspection',async()=>{
 const f=fixture();f.api=createEmployeeTerminalAcceptance({...f.options,enabled:false});
 assert.equal((await f.api.execute({step:'RUN'})).stage,'CLOSED');assert.equal(f.calls.length,0);assert.equal(f.authCount,1);
 const result=await f.api.execute({step:'INSPECT'});assert.equal(result.retainedRecords,0);assert.equal(result.terminalReceiptVerified,false);
 assert.equal(f.rows.size,0);
});
test('browser cannot select old fixture, employee, evidence, build, table or record identifiers',async()=>{
 for(const input of [null,[],{}, {step:'RUN',profile:'WAREHOUSE'},{step:'RUN',authorityBuild:'f'.repeat(40)},
  {step:'RUN',evidence:{staleConditionRejected:true}},{step:'RUN',collection:'NCTTasks'},{step:'RUN',ids:[]}]){
  const f=fixture();await assert.rejects(f.api.execute(input),/Exact terminal probe/);assert.equal(f.calls.length,0);assert.equal(f.authCount,0);
 }
 for(const profile of ['ADMIN','__proto__','OTHER'])assert.throws(()=>createEmployeeTerminalAcceptance({...fixture().options,profile}),/Fixed employee/);
});
test('generated module stays CLOSED, uses new prefixes and the original two staff gates',async()=>{
 assert.doesNotMatch(source,/SPT-R2AUTH-|Permissions\.Admin|Permissions\.Anyone|items\.remove|suppressAuth/);
 assert.match(source,/R2_EMPLOYEE_TERMINAL_ENABLED=false/);assert.ok(source.includes('backend/r2purchaseAccess.js'));
 let authCalls=0;const api=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({verifyPurchaseTerminal,verifyWarehouseTerminal});',{
  items:{query:()=>{},insert:()=>{}},auth:{elevate:()=>{throw Error('NO_ELEVATION');}},webMethod:(permission,fn)=>{assert.equal(permission,'MEMBER');return fn;},Permissions:{SiteMember:'MEMBER'},
  currentMember:{getMember:async()=>{authCalls++;throw Error('ORIGINAL_WAREHOUSE_DENIED');}},getPurchaseStaffContext:async()=>{authCalls++;throw Error('ORIGINAL_PURCHASE_DENIED');},
  createHash:require('node:crypto').createHash,console:{info:()=>{}}
 });
 await assert.rejects(api.verifyPurchaseTerminal({step:'RUN'}),/ORIGINAL_PURCHASE_DENIED/);
 await assert.rejects(api.verifyWarehouseTerminal({step:'RUN'}),/ORIGINAL_WAREHOUSE_DENIED/);assert.equal(authCalls,2);
});
function pageFixture(env='browser'){
 const {pageAddition}=require('../prototypes/stock-current-state/build-r2-employee-terminal-acceptance.cjs');
 const f={calls:[],titles:[],session:new Map(),complete:new Set(),logs:[]};let ready;
 const report=(profile,step)=>({schema:'R2_EMPLOYEE_TERMINAL_ACCEPTANCE_V1',cohort:'MASTER_20261024_R2',profile,authorityBuild,probeSourceSha256,
  ok:true,oldFixturesAccessed:false,businessAuthorizationAccepted:false,writerCoverageAccepted:false,activationAllowed:false,
  retainedRecords:f.complete.has(profile)?4:0,terminalReceiptVerified:f.complete.has(profile),ordinaryStaffWriteAccepted:f.complete.has(profile),mutationAttempted:step==='RUN'});
 const check=profile=>async({step})=>{f.calls.push([profile,step]);
  if(step==='RUN'){
   assert.equal(f.session.get('R2_TERMINAL_ATTEMPT_'+authorityBuild+'_'+profile),'ATTEMPTED');
   if(f.failRun===profile)throw Error('UNKNOWN_NETWORK');f.complete.add(profile);
   if(f.loseReply===profile){f.loseReply=null;throw Error('RECEIPT_REPLY_LOST');}
  }
  const result=report(profile,step);if(f.mismatch)result.authorityBuild='f'.repeat(40);return result;
 };
 vm.runInNewContext(pageAddition.replace(/^import[^\n]+\n/gm,'').replace('R2_EMPLOYEE_TERMINAL_PAGE_ENABLED=false','R2_EMPLOYEE_TERMINAL_PAGE_ENABLED=true'),{
  $w:{onReady:fn=>ready=fn},terminalWindowFrontend:{rendering:{env}},terminalSeoFrontend:{setTitle:async title=>f.titles.push(title)},
  terminalSession:{getItem:key=>f.session.get(key)||null,setItem:(key,value)=>f.session.set(key,value)},
  verifyPurchaseTerminal:check('PURCHASE'),verifyWarehouseTerminal:check('WAREHOUSE'),console:{info:line=>f.logs.push(line),error:line=>f.logs.push(line)}
 });f.ready=()=>ready();return f;
}
test('new acceptance page suppresses SSR and stores each attempt before one browser dispatch',async()=>{
 const server=pageFixture('backend');await server.ready();assert.equal(server.calls.length,0);assert.equal(server.session.size,0);
 const f=pageFixture();await f.ready();assert.deepEqual(f.calls,[['PURCHASE','INSPECT'],['PURCHASE','RUN'],['WAREHOUSE','INSPECT'],['WAREHOUSE','RUN']]);
 assert.equal(f.session.size,2);assert.equal(f.titles.at(-1),'R2 Employee Terminal Check PASS');
 await f.ready();assert.deepEqual(f.calls.slice(4),[['PURCHASE','INSPECT'],['WAREHOUSE','INSPECT']]);
});
test('an unknown browser reply cannot cause a second RUN on reload or proceed to the next employee',async()=>{
 const f=pageFixture();f.failRun='PURCHASE';await f.ready();await f.ready();
 assert.equal(f.calls.filter(([profile,step])=>profile==='PURCHASE'&&step==='RUN').length,1);
 assert.ok(!f.calls.some(([profile])=>profile==='WAREHOUSE'));assert.equal(f.titles.at(-1),'R2 Employee Terminal Check STOP');
});
test('lost client reply after durable receipt recovers read-only before first attempt for other profile',async()=>{
 const f=pageFixture();f.loseReply='PURCHASE';await f.ready();assert.equal(f.titles.at(-1),'R2 Employee Terminal Check STOP');
 await f.ready();assert.equal(f.calls.filter(([profile,step])=>profile==='PURCHASE'&&step==='RUN').length,1);
 assert.equal(f.calls.filter(([profile,step])=>profile==='WAREHOUSE'&&step==='RUN').length,1);assert.equal(f.titles.at(-1),'R2 Employee Terminal Check PASS');
});
test('wrong published backend build stops before attempting any native write',async()=>{
 const f=pageFixture();f.mismatch=true;await f.ready();assert.deepEqual(f.calls,[['PURCHASE','INSPECT']]);
 assert.equal(f.session.size,0);assert.equal(f.titles.at(-1),'R2 Employee Terminal Check STOP');
});
