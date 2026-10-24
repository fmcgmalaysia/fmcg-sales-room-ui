'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createCurrentPurchaseSaveRouter}=require('../prototypes/stock-current-state/current-purchase-save-router.cjs');
function fixture(file,expression){
  const filename=require.resolve('./'+file);
  return vm.runInNewContext(fs.readFileSync(filename,'utf8').replace(/const test\s*=\s*require\('node:test'\)/,'const test = () => {}')+';'+expression+';',
    {require:createRequire(filename),__dirname:require('node:path').dirname(filename),Map,Buffer});
}
const taskRoot=fixture('stock-current-purchase-task-web.test.cjs','root');
const copy=value=>JSON.parse(JSON.stringify(value));
test('original Purchase router forwards expected identity unchanged, without accepting it as authorization',async()=>{
  const f=await taskRoot(true),control={...await f.protocol.readControl(),stockCommitVersion:'V'};let received;
  const route=createCurrentPurchaseSaveRouter({company:'NCT',readControl:async()=>control,
    saveLegacy:async()=>assert.fail('No legacy fallback'),saveCurrent:async(_company,request)=>{received=copy(request);return request;}});
  const stockIdentity={staffId:'P',memberId:'M'};
  await route({...f.request,stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity}});
  assert.deepEqual(received.stockIdentity,stockIdentity);
});
for(const operation of ['EDIT','REORDER','MARGIN_REFRESH'])test(`actual Purchase ${operation} root refuses another staff identity before any plan or write`,async()=>{
  const f=await taskRoot(true),input=operation==='MARGIN_REFRESH'?{taskId:f.f.id}:copy(f.request.input);
  if(operation==='REORDER')delete input.edits;
  const before=JSON.stringify([...f.db]),request={...f.request,operation,input,stockIdentity:{staffId:'OTHER',memberId:'M'}};
  assert.equal((await f.api.savePurchaseTasksCurrent('NCT',request)).ok,false);
  assert.equal(JSON.stringify([...f.db]),before);
  assert.equal(f.calls.includes('NCTTasks'),false);
});
for(const operation of ['REORDER','MARGIN_REFRESH'])test(`actual Purchase ${operation} accepts only the original identity and unchanged same-request replay`,async()=>{
  const f=await taskRoot(true),input=operation==='MARGIN_REFRESH'?{taskId:f.f.id}:copy(f.request.input);
  if(operation==='REORDER')delete input.edits;
  const request={...f.request,operation,input,stockIdentity:{staffId:'P',memberId:'M'}};
  let result,attempts=0;do{result=await f.api.savePurchaseTasksCurrent('NCT',request);assert.ok(attempts++<30);}while(result.pending);
  assert.equal(result.ok,true);assert.deepEqual(await f.api.savePurchaseTasksCurrent('NCT',request),result);
  const before=JSON.stringify([...f.db]);
  assert.equal((await f.api.savePurchaseTasksCurrent('NCT',{...request,stockIdentity:undefined})).ok,false);
  assert.equal(JSON.stringify([...f.db]),before);
});
test('actual Purchase EDIT replay binds expected staff in immutable request, including reissued staff on the same login',async()=>{
  const f=await taskRoot(true),request={...f.request,stockIdentity:{staffId:'P',memberId:'M'}};
  const result=await f.api.savePurchaseTasksCurrent('NCT',request);assert.equal(result.ok,true);
  assert.deepEqual(await f.api.savePurchaseTasksCurrent('NCT',request),result);
  const before=JSON.stringify([...f.db]),rows=await f.deps.readStaffRecords();
  f.deps.readStaffRecords=async()=>rows.map(row=>({...row,title:'REISSUED'}));
  assert.equal((await f.api.savePurchaseTasksCurrent('NCT',request)).ok,false);
  assert.equal((await f.api.savePurchaseTasksCurrent('NCT',{...request,stockIdentity:{staffId:'REISSUED',memberId:'M'}})).ok,false);
  assert.equal((await f.api.savePurchaseTasksCurrent('NCT',(({stockIdentity,...rest})=>rest)(request))).ok,false);
  assert.equal(JSON.stringify([...f.db]),before);
});
