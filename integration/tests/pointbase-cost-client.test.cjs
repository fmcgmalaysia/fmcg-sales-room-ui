const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../backend/pointbaseCostClient.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
const {createPointbaseCostClient}=vm.runInNewContext('(function(){'+source+'\nreturn {createPointbaseCostClient};})()', {URL,getSecret:()=>{},JSON,Error,Promise});
test('Apps Script output redirect is fetched with GET and without forwarded secret or request body',async()=>{
  const calls=[],costs={B:{costCurrency:'MYR'}};
  const client=createPointbaseCostClient({getSharedSecret:async()=>'MOCK SECRET',send:async(url,options)=>{
    calls.push({url,options});return calls.length===1?{status:302,headers:{get:()=> 'https://script.googleusercontent.com/macros/echo?mock=1'}}:
      {status:200,json:async()=>({ok:true,result:{kind:'MASTER_POINTBASE_COST_V1',costs}})};
  }});
  assert.equal((await client(['B'])).B.costCurrency,'MYR');assert.equal(calls[1].options.method,'GET');
  assert.equal(calls[1].options.body,undefined);assert.equal(calls[1].options.headers,undefined);
  assert.match(calls[0].options.body,/MASTER_CAPTURE_COST/);
});
test('unexpected redirect cannot transmit any secret to another host',async()=>{
  const client=createPointbaseCostClient({getSharedSecret:async()=>'MOCK SECRET',send:async()=>({status:302,headers:{get:()=> 'https://example.test/output'}})});
  await assert.rejects(client(['B']),error=>error.code==='POINTBASE_REDIRECT_DENIED');
});
test('authentication failure and malformed response retain actionable sanitized codes',async()=>{
  const auth=createPointbaseCostClient({getSharedSecret:async()=>'MOCK',send:async()=>({status:200,json:async()=>({ok:false,error:'Unauthorized request'})})});
  await assert.rejects(auth(['B']),error=>error.code==='POINTBASE_AUTH_REJECTED');
  const malformed=createPointbaseCostClient({getSharedSecret:async()=>'MOCK',send:async()=>({status:200,json:async()=>{throw Error('html');}})});
  await assert.rejects(malformed(['B']),error=>error.code==='POINTBASE_NON_JSON_RESPONSE');
});
