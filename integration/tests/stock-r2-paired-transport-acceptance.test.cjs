'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createPairedTransportAcceptance}=require('../prototypes/stock-current-state/r2-paired-transport-acceptance.cjs');
const cohortError='Order program changed. Refresh the original order; no new receipt was created.';
const unavailable='Current purchase quantities could not be confirmed. Please refresh.';
function fixture(){
  const f={calls:[],secrets:[],status:503,body:{ok:false,error:unavailable},secret:'TEST_ONLY_SENSITIVE_VALUE'};
  f.options={fetch:async(url,options)=>{f.calls.push({url,options});if(f.fail)throw Error('unsafe headers '+f.secret);
    return{status:f.status,json:async()=>{if(f.badJson)throw Error(f.secret);return f.body;}};},
    getSecret:async name=>{f.secrets.push(name);if(f.failSecret)throw Error('unsafe credential '+f.secret);return f.secret;}};
  f.run=createPairedTransportAcceptance(f.options);return f;
}
test('fixed negative controls never access a real credential and validate the actual handler messages',async()=>{
  const f=fixture();f.status=409;f.body={ok:false,error:cohortError};
  assert.equal((await f.run({step:'COHORT_REJECTION'})).ok,true);assert.equal(f.secrets.length,0);
  assert.equal(f.calls[0].options.headers['X-FMCG-Cohort'],'R2_FIXED_INVALID_COHORT');
  f.status=401;f.body={ok:false,error:'Unauthorized request.'};
  assert.equal((await f.run({step:'AUTH_REJECTION'})).ok,true);assert.equal(f.secrets.length,0);
  assert.equal(f.calls[1].options.headers['X-FMCG-Cohort'],'MASTER_20261024_R2');
});
test('authorized503 proves only the authenticated handler was reached, not inventory readiness or its failure cause',async()=>{
  const f=fixture(),result=await f.run({step:'AUTHORIZED_READ'});
  assert.equal(result.ok,true);assert.equal(result.authorizedHandlerReached,true);assert.equal(result.businessReadConfirmed,false);
  assert.equal(result.maintenanceCauseProven,false);assert.equal(result.activationAllowed,false);assert.equal(result.writerCoverageAccepted,false);
  assert.deepEqual(f.secrets,['MASTER_INTAKE_SHARED_SECRET']);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://fmcg999.wixstudio.com/master/_functions/r2PurchaseQuantities?rc=test-site');
  assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+f.secret);
  assert.equal(JSON.stringify(result).includes(f.secret),false);
});
test('callers cannot redirect the credential, change scope or request a mutation',async()=>{
  for(const input of [{step:'AUTHORIZED_READ',url:'https://example.invalid'},{step:'AUTHORIZED_READ',secret:'caller'},
    {step:'AUTHORIZED_READ',company:'GHR'},{step:'RUN'},[],true,null]){
    const f=fixture();await assert.rejects(f.run(input),/Fixed paired read/);assert.equal(f.calls.length,0);assert.equal(f.secrets.length,0);
  }
  const f=fixture();await f.run({step:'AUTHORIZED_READ'});
  const body=JSON.parse(f.calls[0].options.body);
  assert.equal(body.company,'NCT');assert.equal(body.customerId,'R2-TRANSPORT-READ-FIXTURE');
  assert.equal(f.calls[0].options.method,'post');
});
test('404, generic503, unauthorized or foreign results never become successful integration proof',async()=>{
  for(const [status,body]of [[404,{}],[503,{error:'Service unavailable'}],[401,{ok:false,error:'Unauthorized request.'}],
    [200,{orders:[{orderId:'FOREIGN',customerId:'PRIVATE'}]}],[200,{}]]){
    const f=fixture();f.status=status;f.body=body;const result=await f.run({step:'AUTHORIZED_READ'});
    assert.equal(result.ok,false);assert.equal(result.authorizedHandlerReached,false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
});
test('unknown transport, parser and secret failures return no credential or headers and are never retried',async()=>{
  for(const change of [f=>f.fail=true,f=>f.badJson=true,f=>f.failSecret=true,f=>f.secret='']){
    const f=fixture();change(f);const result=await f.run({step:'AUTHORIZED_READ'});
    assert.equal(result.ok,false);assert.equal(JSON.stringify(result).includes('TEST_ONLY_SENSITIVE_VALUE'),false);assert.ok(f.calls.length<=1);
  }
});
test('compiled endpoint grants Admin only and exposes no caller credential or write service',async()=>{
  const {source}=require('../prototypes/stock-current-state/build-r2-paired-transport-acceptance.cjs'),f=fixture(),grants=[],logs=[];
  const run=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';inspectMasterTestTransport;',
    {...f.options,Permissions:{Admin:'ADMIN'},webMethod:(permission,fn)=>{grants.push(permission);return fn;},console:{info:text=>logs.push(text)}});
  assert.deepEqual(grants,['ADMIN']);assert.equal((await run({step:'AUTHORIZED_READ'})).ok,true);
  assert.equal(logs.some(text=>text.includes(f.secret)),false);
  assert.doesNotMatch(source,/Permissions\.(Anyone|SiteMember)|wix-data|@wix\/data|\.insert\(|\.patch\(|\.remove\(/);
});
