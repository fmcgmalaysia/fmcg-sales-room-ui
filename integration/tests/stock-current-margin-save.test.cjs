const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentMarginReferenceSave}=require('../prototypes/stock-current-state/current-margin-reference-save.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs'),{hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const filename=require.resolve('./stock-current-margin-reference.test.cjs'),fixtures=vm.runInNewContext(fs.readFileSync(filename,'utf8')
  .replace("const test = require('node:test')",'const test = () => {}')+';({fixture,invoices});',{require:createRequire(filename),Buffer,Map});
const copy=value=>JSON.parse(JSON.stringify(value));
async function fixture(company='NCT',verified=true){
  const f=fixtures.fixture(company),db=new Map(),calls=[];let failOrder=false,contexts=0;
  for(const [collection,rows]of Object.entries(f.args.tables))for(const row of rows)db.set(collection+':'+row._id,copy(row));
  const store={read:async(collection,id)=>copy(db.get(collection+':'+id)||null),
    insert:async(collection,row)=>{if(db.has(collection+':'+row._id))throw Error('Duplicate');db.set(collection+':'+row._id,copy(row));},
    compareAndSet:async(collection,id,version,row)=>{if(collection===f.orders&&failOrder){failOrder=false;throw Error('Cache interrupted');}
      if(db.get(collection+':'+id)?._version!==version)throw Error('Conflict');db.set(collection+':'+id,copy(row));},
    compareAndRemove:async(collection,id,attempt)=>{if(db.get(collection+':'+id)?.attempt!==attempt)throw Error('Wrong attempt');db.delete(collection+':'+id);}};
  const protocol=createSegmentedFencedProof({company,store,domainWrites:true,stepsPerInvocation:2});await protocol.initialize();
  Object.assign(db.get(f.journal+':'+protocol.ids.controlId),{mode:'ACTIVE',schemaVersion:1,writerBuild:'TEST',transferIndexVersion:2});
  const member={_id:'MEMBER',loginEmail:'purchase@example.test',status:'APPROVED'},record={title:'STAFF',description:member._id,staffEmail:member.loginEmail,
    staffName:'Purchase',staffStatus:'ACTIVE',departments:['PURCHASE']};
  const dependencies={...f.args,readMember:async()=>{calls.push('MEMBER');return member;},readStaffRecords:async()=>{calls.push('STAFF');return[record];},
    requirePurchaseStaff:load('purchaseProjection.js').requirePurchaseStaff,
    readMarginContext:async(selectedCompany,staff,control)=>{assert.equal(selectedCompany,company);assert.equal(control.mode,'ACTIVE');contexts++;
      return{workspace:{...copy(f.args.workspace),stockAllocationView:'CURRENT_V2',staff},tables:Object.fromEntries([f.orders,f.tasks,f.journal]
        .map(collection=>[collection,[...db].filter(([key])=>key.startsWith(collection+':')).map(([,row])=>copy(row))]))};}};
  const coverage=verified?Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])):{};
  const save=createCurrentMarginReferenceSave({company,store,protocol,coverage,authorityDependencies:dependencies});
  const request={requestId:'11111111-1111-4111-8111-111111111111',input:{taskId:'T'},stockProtocol:1,stockBuild:'TEST',stockGeneration:0};
  const finish=async(command=request)=>{let result,count=0;do{result=await save(command);assert.ok(count++<40);}while(result.pending);return result;};
  return{...f,db,store,protocol,dependencies,member,record,calls,save,request,finish,contexts:()=>contexts,interrupt:()=>{failOrder=true;}};
}

test('both companies use ORIGINAL Purchase GP/FX calculation under one current save with exact receipt and no inventory/task writes',async()=>{
  for(const company of ['NCT','GHR']){
    const f=await fixture(company),before=copy(f.db.get(f.tasks+':T')),saved=await f.finish();
    assert.equal(saved.stockGeneration,1);assert.equal(new Map(saved.marginReceipt.results).get('T'),0.25);
    assert.equal(f.db.get(f.orders+':O').gp,0.25);assert.equal(f.db.get(f.orders+':O').adminFxSource,3.2);
    assert.equal(f.db.get(f.orders+':O').sellingPricePc,10);assert.equal(f.db.get(f.orders+':O').orderQtyInCtn,100);
    assert.deepEqual(f.db.get(f.tasks+':T'),before);assert.equal([...f.db.keys()].some(key=>key.startsWith('Stock')),false);
    assert.equal(f.contexts(),1);assert.equal(f.reads(),1);assert.equal([...f.db.values()].filter(row=>row.action==='GP_RECALCULATED').length,1);
    assert.deepEqual(await f.save(f.request),saved);assert.equal(f.contexts(),1);assert.equal(f.reads(),1);
    assert.equal(JSON.stringify(saved).includes('rateToMyr'),false);assert.equal(JSON.stringify(saved).includes('sellingPrice'),false);
  }
});

test('interrupted audit/cache retains exact original request/rate/plan and hides pending snapshot until once-only completion',async()=>{
  const f=await fixture();f.interrupt();let interrupted=false;
  for(let i=0;i<20;i++){try{const value=await f.save(f.request);assert.equal(value.ok,false);}catch(error){assert.match(error.message,/Cache interrupted/);interrupted=true;break;}}
  assert.equal(interrupted,true);assert.equal(f.db.get(f.orders+':O').gp,0.1);
  assert.equal([...f.db.values()].filter(row=>row.action==='GP_RECALCULATED').length,1);
  await assert.rejects(f.protocol.readSnapshot(()=>null),/pending/);
  f.setRate(5);const saved=await f.finish();assert.equal(new Map(saved.marginReceipt.results).get('T'),0.25);
  assert.equal(f.reads(),1);assert.equal(f.contexts(),1);assert.equal((await f.protocol.readControl()).generation,1);
  const second=await f.finish({...f.request,requestId:'22222222-2222-4222-8222-222222222222',stockGeneration:1});
  assert.equal(new Map(second.marginReceipt.results).get('T'),0.52);assert.equal(f.db.get(f.orders+':O').gp,0.52);
  const replay=await f.save(f.request);assert.equal(replay.marginReceipt.generation,1);assert.equal(new Map(replay.marginReceipt.results).get('T'),0.25,
    'old receipt is retained evidence, not permission to label its GP as latest');
});

test('unchanged/unknown/locked original results can retain an explicit save receipt without fabricating GP cache updates',async()=>{
  for(const kind of ['unchanged','unknown','invoice','gpLock','costLock']){
    const f=await fixture();
    if(kind==='unchanged')Object.assign(f.db.get(f.orders+':O'),{gp:0.25,adminFxSource:3.2});
    if(kind==='unknown')f.setRate(null);
    if(kind==='invoice')Object.assign(f.db.get(f.orders+':O'),{salesInvoiceNumber:'INV',financialLockedBy:'ACCOUNT',gp:0.375});
    if(kind==='gpLock'||kind==='costLock'){
      const id=hash('NCT','T',kind==='gpLock'?'GP_LOCK':'COST_LOCK');f.db.set(f.journal+':'+id,{_id:id,company:'NCT',details:{requestId:'OTHER'}});
    }
    const before=copy(f.db.get(f.orders+':O')),saved=await f.finish();
    assert.deepEqual(f.db.get(f.orders+':O'),before);assert.equal([...f.db.values()].filter(row=>row.action==='GP_RECALCULATED').length,0);
    assert.equal([...f.db.values()].filter(row=>row.action==='MARGIN_REFERENCE_RESULT').length,1);
    assert.equal(new Map(saved.marginReceipt.results).get('T'),kind==='unchanged'?0.25:kind==='invoice'?0.375:null);
    if(kind==='gpLock'||kind==='costLock')assert.equal([...f.db.values()].some(row=>row.details?.requestId==='OTHER'),true);
  }
});

test('original Purchase rights, all-writer coverage and actual current context cannot be replaced by browser flags',async()=>{
  for(const kind of ['role','member','coverage','workspace']){
    const f=await fixture('NCT',kind!=='coverage');
    if(kind==='role')f.record.departments=['WAREHOUSE'];if(kind==='member')f.member.status='PENDING';
    if(kind==='workspace')f.dependencies.readMarginContext=async()=>({workspace:{...f.args.workspace,staff:{staffId:'OTHER',memberId:'MEMBER'}},tables:f.args.tables});
    await assert.rejects(f.save({...f.request,coverage:'FORGED',approvedBy:'FORGED'}),/Purchase|approved|coverage|workspace/);
    assert.equal((await f.protocol.readControl()).generation,0);assert.equal(f.reads(),0);
    if(kind!=='workspace')assert.equal(f.contexts(),0);
  }
  const f=await fixture();await f.finish();f.record.departments=['SUPPORT'];
  await assert.rejects(f.save(f.request),/not authorized/);assert.equal(f.reads(),1,'completed replay still requires original current entitlement');
});

test('exact target is server-selected and arbitrary price/GP fields, missing roots, stale forms or altered payload cannot write',async()=>{
  for(const patch of [{input:{taskId:'T',gp:1}},{input:{taskId:'MISSING'}},{stockGeneration:99},{stockBuild:'FORGED'}]){
    const f=await fixture();await assert.rejects(f.save({...f.request,...patch}),/margin|group|form/);assert.equal(f.db.get(f.orders+':O').gp,0.1);
  }
  const f=await fixture();await f.finish();
  await assert.rejects(f.save({...f.request,input:{taskId:'OTHER'}}),/identity reused/);
});

test('malformed ORIGINAL dependency results and corrupted retained result remain unconfirmed, never exposed as successful live GP',async()=>{
  const f=await fixture();f.dependencies.createPurchaseMarginRefresh=()=>async()=>new Map([['PRIVATE_OTHER',0.5]]);
  await assert.rejects(f.save(f.request),/margin results/);assert.equal((await f.protocol.readControl()).generation,0);
  const g=await fixture();await g.finish();const receipt=[...g.db.values()].find(row=>row.action==='MARGIN_REFERENCE_RESULT');
  receipt.details.results=[['T','PRIVATE_INVALID']];await assert.rejects(g.save(g.request),/margin results/);
});
