'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const {verifyR2PurchaseFlow}=require('../prototypes/stock-current-state/r2-purchase-flow-acceptance.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {stable}=require('../prototypes/stock-current-state/fresh-cohort-activation-schema.cjs');
const copy=value=>JSON.parse(JSON.stringify(value)),folder=path.join(__dirname,'../prototypes/stock-current-state/isolated-cohort/MASTER');
const cache={};
function originalModule(name) {
  if(cache[name])return cache[name];
  let source=fs.readFileSync(path.join(folder,name),'utf8').replace(/\r\n/g,'\n'),bindings={};
  source=source.replace(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';/gm,(_match,names,target)=>{
    const loaded=target.startsWith('backend/')?originalModule(target.slice(8)):require(target);
    for(const part of names.split(',')){const [key,alias]=part.trim().split(/\s+as\s+/);bindings[alias||key]=loaded[key];}return '';
  });
  assert.doesNotMatch(source,/^import /m,'Only actual pure R2 originals may enter this fixture');
  const exports=[...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(row=>row[1]);
  return cache[name]=vm.runInNewContext('(function(){'+source.replace(/^export /gm,'')+';return{'+exports.join(',')+'};})()',
    {...bindings,Date,JSON,Object,Array,Number,String,Promise,Map,Set,Math,Error,RegExp});
}
const runtimeText=fs.readFileSync(path.join(folder,'r2stockCurrentCommands.js'),'utf8');
const runtimeNames=['planCollections','createSdkConditionalStore','createSegmentedFencedProof','createCurrentOrderIntakeOperations','createCurrentPurchaseSave'];
const runtime=vm.runInNewContext(runtimeText.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({'+runtimeNames.join(',')+'});',
  {createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});
const original=Object.assign({},...['r2nctIntake.js','r2purchaseProjection.js','r2purchaseOperations.js','r2purchaseSources.js','r2purchaseTaskIdentity.js',
  'r2purchaseOperationJournal.js','r2purchaseOrderWorkflow.js','r2plannerAllocation.js','r2customerShipmentLedger.js','r2packingListOperations.js','r2packingListModel.js'].map(originalModule));
function fixture() {
  const file=require.resolve('./stock-r2-cas-native-acceptance.test.cjs');
  const make=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
    {require:createRequire(file),Map,Buffer,__dirname});
  const f=make('SPT-R2PURCHASEFLOW-20261025-a479:'),query=f.items.query;
  f.items.query=name=>{const q=query(name);q.startsWith=(key,prefix)=>{let limit=1;q.limit=value=>{limit=value;return q;};q.find=async()=>{
    const rows=[...f.rows.values()].filter(row=>String(row[key]).startsWith(prefix));return{items:copy(rows.slice(0,limit)),totalCount:rows.length};};return q;};return q;};
  f.items.bulkInsert=async(name,rows)=>{for(const row of rows)await f.items.insert(name,row);return{inserted:rows.length};};
  const member={_id:'WORKFLOW-MEMBER',status:'APPROVED',loginEmail:'fixture@example.invalid'};
  const staff={title:'WORKFLOW-STAFF',description:member._id,staffEmail:member.loginEmail,staffStatus:'ACTIVE',staffName:'Native fixture employee',departments:['PURCHASE']};
  f.identity={member,staffRows:[staff],staffId:staff.title};
  f.run=(step,enabled=true,extra={})=>verifyR2PurchaseFlow({input:{step},enabled,items:f.items,runtime,original,
    authenticate:async()=>copy(f.identity),hash,stable,copy,...extra});
  return f;
}
async function advance(f,step) {
  let result;
  for(let count=0;count<40;count++){
    result=await f.run(step);assert.equal(result.ok,true,JSON.stringify(result));
    if(result.result?.ok===true&&!result.result?.pending)return result;
  }
  throw Error('Bounded fixed request did not finish: '+step);
}
test('new native Purchase fixture is CLOSED and cannot accept caller quantities, identities or gates',async()=>{
  const f=fixture();assert.equal((await f.run('SEED',false)).stage,'CLOSED');assert.equal(f.rows.size,0);
  assert.equal((await f.run('INSPECT',false)).stage,'EMPTY_FIXED_WORKFLOW');assert.equal(f.rows.size,0);
  for(const input of [{step:'SEED',enabled:true},{step:'PLAN',quantity:999},{step:'OTHER'},null])
    await assert.rejects(verifyR2PurchaseFlow({input}),/Fixed Purchase workflow/);
  f.identity.staffRows[0].departments=['WAREHOUSE'];await assert.rejects(f.run('SEED'),/not authorized/);
  assert.equal(f.rows.size,0);assert.equal(f.calls.length,0);
});
test('compiled SiteMember diagnostic keeps original Purchase grant before official SDK elevation and defaults to read-only',async()=>{
  const {source}=require('../prototypes/stock-current-state/build-r2-purchase-flow-acceptance.cjs');
  const f=fixture(),grants=[],elevations=[];let granted=false,memberReads=0;
  const context={...runtime,...original,createHash:crypto.createHash,sdkItems:f.items,
    Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(permission,fn)=>{grants.push(permission);return fn;},
    currentMember:{getMember:async()=>{memberReads++;return copy(f.identity.member);}},
    wixData:{query:name=>{assert.equal(name,'StaffMasterAccess');return{limit:n=>{assert.equal(n,1000);return{find:async options=>{
      assert.equal(options.suppressAuth,true);assert.equal(options.consistentRead,true);
      return{items:copy(f.identity.staffRows),hasNext:()=>false};}};}};}},
    requirePurchaseStaff:(...args)=>{const staff=original.requirePurchaseStaff(...args);granted=true;return staff;},
    auth:{elevate:fn=>{assert.equal(granted,true);elevations.push(fn);return fn;}},console:{info:()=>{}}
  };
  const run=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyPurchaseWorkflow;',context);
  assert.deepEqual(grants,['SITE_MEMBER']);assert.equal((await run({step:'SEED'})).stage,'CLOSED');
  assert.equal(memberReads,0);assert.equal(elevations.length,0);
  for(const input of [{step:'INSPECT',enabled:true},{step:'SEED',company:'GHR'},null])await assert.rejects(run(input),/Fixed Purchase/);
  assert.equal(memberReads,0);
  assert.equal((await run({step:'INSPECT'})).stage,'EMPTY_FIXED_WORKFLOW');assert.equal(f.rows.size,0);
  assert.equal(elevations.length,4);
  granted=false;elevations.length=0;f.identity.staffRows[0].departments=['WAREHOUSE'];
  await assert.rejects(run({step:'INSPECT'}),/not authorized/);assert.equal(elevations.length,0);
  assert.doesNotMatch(source,/Permissions\.(Anyone|Admin)|R2_BORROW_REPAYMENT_ENABLED|SPT-R2BORROW-|SPT-R2INTAKE300-|\.compareAndRemove\([^)]*,/);
});
test('actual isolated R2 intake and Purchase factories retain demand100, procure90, assign PO once, and create no physical stock',async t=>{
  const f=fixture();assert.equal((await f.run('SEED')).stage,'SEEDED');
  await assert.rejects(f.run('SEED'),/Occupied/);
  for(const step of ['INTAKE','PLAN','PO']){
    await advance(f,step);const before=stable([...f.rows]);await advance(f,step);assert.equal(stable([...f.rows]),before,'same original request is read-only after commit');
  }
  const final=await f.run('INSPECT',false);assert.equal(final.complete,true,JSON.stringify(final));
  assert.equal(final.generation,3);assert.equal(final.physicalStock,0);assert.equal(final.taskCount,1);assert.equal(final.orderCount,1);
  assert.equal(final.customerDemand,100);assert.equal(final.purchaseQuantity,90);
  assert.equal(final.activationAllowed,false);assert.equal(final.pairedSourceTransportAccepted,false);assert.equal(final.writerCoverageAccepted,false);
  assert.equal(f.calls.some(([method])=>method==='remove'),false);
  t.diagnostic(JSON.stringify({localOnly:true,generation:final.generation,physicalStock:final.physicalStock,retainedImages:f.rows.size,nativeAccepted:false}));
});
test('lost response after a native-shaped PO patch is confirmed by exact after-image without duplicate writes or a new request',async()=>{
  const f=fixture();await f.run('SEED');await advance(f,'INTAKE');await advance(f,'PLAN');
  const patch=f.items.patch;let lost=false;
  f.items.patch=(collection,id)=>{const p=patch(collection,id),run=p.run;p.run=async options=>{const result=await run(options);
    if(!lost&&id.includes(':R2NCTTasks:')){lost=true;throw Error('KNOWN_LOST_PATCH_REPLY');}return result;};return p;};
  await advance(f,'PO');assert.equal(lost,true);
  const final=await f.run('INSPECT');assert.equal(final.complete,true,JSON.stringify(final));
  const commands=[...f.rows.values()].filter(row=>row._id.includes(':FLOW_COMMAND:'));
  assert.equal(commands.length,2);assert.ok(commands.every(row=>typeof row.details.requestJson==='string'));
});
test('known interruption before the PO patch retains the original request, blocks a mixed result, and resumes without resetting generation',async()=>{
  const f=fixture();await f.run('SEED');await advance(f,'INTAKE');await advance(f,'PLAN');
  const patch=f.items.patch;let interrupted=false;
  f.items.patch=(collection,id)=>{const p=patch(collection,id),run=p.run;p.run=async options=>{
    if(!interrupted&&id.includes(':R2NCTTasks:')){interrupted=true;throw Error('KNOWN_BEFORE_PATCH_INTERRUPTION');}return run(options);};return p;};
  await assert.rejects(advance(f,'PO'),/KNOWN_BEFORE_PATCH_INTERRUPTION/);assert.equal(interrupted,true);
  const pending=await f.run('INSPECT');assert.equal(pending.generation,2);assert.ok(pending.pending);assert.equal(pending.complete,false);
  const command=[...f.rows.values()].find(row=>row._id.endsWith(':FLOW_COMMAND:PO'));
  const originalRequest=command.details.requestJson;
  await advance(f,'PO');assert.equal((await f.run('INSPECT')).complete,true);
  assert.equal([...f.rows.values()].find(row=>row._id===command._id).details.requestJson,originalRequest);
});
test('revoked original Purchase access and a different member cannot inspect or resume another employee fixture',async()=>{
  const f=fixture();await f.run('SEED');await advance(f,'INTAKE');const before=stable([...f.rows]);
  f.identity.member._id='OTHER';f.identity.staffRows[0].description='OTHER';
  await assert.rejects(f.run('PLAN'),/Owned fixed workflow/);assert.equal(stable([...f.rows]),before);
  f.identity.staffRows[0].departments=['WAREHOUSE'];await assert.rejects(f.run('INSPECT'),/not authorized/);
});

function pageHarness(f,{armed=true,env='browser',query='20261025-a479',intercept=null}={}) {
  const {pageAddition,acceptanceBuild}=require('../prototypes/stock-current-state/build-r2-purchase-flow-acceptance.cjs');
  const session=new Map(),calls=[],titles=[],errors=[];let ready;
  const source=pageAddition.replace(/^import[^\n]+\n/gm,'').replace('R2_PURCHASE_FLOW_PAGE_ENABLED=false','R2_PURCHASE_FLOW_PAGE_ENABLED='+armed);
  vm.runInNewContext(source,{$w:{onReady:fn=>{ready=fn;}},
    purchaseFlowLocation:{query:{r2PurchaseFlow:query}},purchaseFlowWindow:{rendering:{env}},
    purchaseFlowSeo:{setTitle:async title=>titles.push(title)},
    purchaseFlowSession:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value)},
    verifyPurchaseWorkflow:async input=>{calls.push(input.step);if(intercept)return intercept(input,f,acceptanceBuild);
      return{...(await f.run(input.step)),acceptanceBuild};},
    console:{info:()=>{},error:value=>errors.push(value)}
  });
  return{run:()=>ready(),calls,titles,errors,session};
}
test('actual browser driver completes bounded same-request Purchase flow and a reload performs inspection only',async()=>{
  const f=fixture(),page=pageHarness(f);await page.run();
  assert.equal(page.titles.at(-1),'R2 Purchase Workflow PASS',page.errors.join('\n'));
  assert.equal(page.errors.length,0);assert.equal(page.calls.filter(step=>step==='SEED').length,1);
  const before=stable([...f.rows]),start=page.calls.length;await page.run();
  assert.deepEqual(page.calls.slice(start),['INSPECT']);assert.equal(stable([...f.rows]),before);
});
test('page keeps old gates untouched and does nothing when closed, SSR, or on an unrelated URL',async()=>{
  for(const option of [{armed:false},{env:'backend'},{query:'wrong'}]){
    const f=fixture(),page=pageHarness(f,option);await page.run();assert.equal(page.calls.length,0);assert.equal(f.rows.size,0);
  }
  const {pageSource}=require('../prototypes/stock-current-state/build-r2-purchase-flow-acceptance.cjs');
  assert.match(pageSource,/R2_INTAKE_PAGE_ENABLED = false/);assert.match(pageSource,/R2_EMPLOYEE_TERMINAL_PAGE_ENABLED=false/);
  assert.match(pageSource,/R2_PURCHASE_FLOW_PAGE_ENABLED=false/);
});
test('transport uncertainty is retained across reload without another mutation attempt, and a wrong build cannot seed',async()=>{
  const f=fixture(),page=pageHarness(f,{intercept:async(input,model,acceptanceBuild)=>{
    if(input.step==='INTAKE')throw Error('SIMULATED_504_UNKNOWN');return{...(await model.run(input.step)),acceptanceBuild};
  }});
  await page.run();assert.equal(page.titles.at(-1),'R2 Purchase Workflow STOP');assert.equal(page.calls.filter(step=>step==='INTAKE').length,1);
  const before=stable([...f.rows]);await page.run();
  assert.equal(page.calls.filter(step=>step==='INTAKE').length,1);assert.equal(stable([...f.rows]),before);
  const wrong=fixture(),mismatch=pageHarness(wrong,{intercept:async(input,model)=>({...await model.run(input.step),acceptanceBuild:'0'.repeat(40)})});
  await mismatch.run();assert.equal(mismatch.titles.at(-1),'R2 Purchase Workflow STOP');assert.deepEqual(mismatch.calls,['INSPECT']);assert.equal(wrong.rows.size,0);
});
