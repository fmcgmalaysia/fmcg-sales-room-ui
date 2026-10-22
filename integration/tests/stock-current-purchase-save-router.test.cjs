const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {createCurrentPurchaseSaveRouter}=require('../prototypes/stock-current-state/current-purchase-save-router.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),folder=path.join(__dirname,'../prototypes/stock-current-state');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(company='NCT',mode='ACTIVE'){
 const control={_id:hash(company,'STOCK_CONTROL'),company,stockCommitVersion:'V',schemaVersion:1,generation:8,pending:null,mode,writerBuild:'TEST'},legacy=[],current=[];
 const save=createCurrentPurchaseSaveRouter({company,readControl:async()=>control,saveLegacy:async()=>{legacy.push('OLD');return{ok:true,legacy:true};},
  saveCurrent:async(c,request)=>{current.push({company:c,request:copy(request)});return{ok:false,requestId:request.requestId,error:'Unconfirmed'};}});
 const request={requestId:'11111111-2222-4333-8444-555555555555',operation:'EDIT',input:{edits:[]},stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:8}};
 return{control,save,legacy,current,request};
}
for(const company of ['NCT','GHR'])test(`${company} ACTIVE server control cannot be bypassed by omitted or forged browser metadata`,async()=>{
 const f=fixture(company);await f.save(f.request);await f.save({...f.request,stockCurrent:undefined});await f.save({...f.request,stockCurrent:{stockProtocol:2,stockBuild:'FORGED'}});
 assert.equal(f.current.length,3);assert.equal(f.legacy.length,0);assert.equal(f.current[0].company,company);
 assert.deepEqual(f.current[0].request,{requestId:f.request.requestId,operation:'EDIT',input:{edits:[]},stockProtocol:1,stockBuild:'TEST',stockGeneration:8});
});
test('only confirmed LEGACY with no current form can call existing apply; missing/corrupt/maintenance/shadow controls never fall back',async()=>{
 const f=fixture('NCT','LEGACY');assert.equal((await f.save({...f.request,stockCurrent:undefined})).legacy,true);await assert.rejects(f.save(f.request));assert.equal(f.legacy.length,1);
 for(const patch of [{mode:'MAINTENANCE'},{mode:'SHADOW'},{mode:'UNKNOWN'},{company:'GHR'},{stockCommitVersion:''},{schemaVersion:2},{generation:-1}]){
  const g=fixture();Object.assign(g.control,patch);await assert.rejects(g.save({...g.request,stockCurrent:undefined}));assert.equal(g.legacy.length,0);assert.equal(g.current.length,0);
 }
 const missing=createCurrentPurchaseSaveRouter({company:'NCT',readControl:async()=>null,saveCurrent:async()=>assert.fail('current'),saveLegacy:async()=>assert.fail('legacy')});
 await assert.rejects(missing(f.request),/unconfirmed/);
});
function native(mode='ACTIVE',authorized=true){
 const calls=[],staff={staffId:'P',staffName:'LAW',memberId:'M',role:'PURCHASE'},control={_id:hash('NCT','STOCK_CONTROL'),company:'NCT',stockCommitVersion:'V',schemaVersion:1,generation:8,pending:null,mode};
 const legacy=name=>async request=>{calls.push({kind:name,request:copy(request)});return{ok:true,requestId:request.requestId};};
 const bindings={Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(_p,fn)=>fn,createCurrentPurchaseSaveRouter,operationId:hash,
  savePurchaseTasksCurrent:async(company,request)=>{calls.push({kind:'CURRENT',company,request:copy(request)});return{ok:false,pending:true,requestId:request.requestId,phase:'APPLY',completedCount:1,totalRecords:2};},
  PURCHASE_COLLECTIONS:{NCT:{activity:'NCTActivity'},GHR:{activity:'NCTActivity1'}},getPurchaseStaffContext:async()=>{calls.push({kind:'AUTH'});if(!authorized)throw Error('Denied');return staff;},
  createPurchaseOperations:()=>legacy('EDIT'),createPurchaseSourceOperations:()=>legacy('ADD_SOURCE'),createQuantityCaseOperations:()=>legacy('QUANTITY_CASE'),
  createPlannerAllocationOperations:()=>legacy('ALLOCATE'),createShortageOperations:()=>legacy('SHORTAGE'),createSharedSupplierOperations:()=>({}),getPointbaseBrands:()=>[],
  wixData:{query:c=>{let id;const q={eq:(key,value)=>{assert.equal(key,'_id');id=value;return q;},limit:n=>{assert.equal(n,2);return q;},find:async()=>{calls.push({kind:'CONTROL',collection:c,id});return{items:[control]};}};return q;}},
  console:{info(){},warn(){}}};
 const source=fs.readFileSync(path.join(folder,'purchaseOperations.web.candidate.js'),'utf8');
 const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{savePurchaseOperation};})()',bindings);
 return{api,calls,staff};
}
test('actual original web wrapper authenticates before control; ACTIVE no-metadata direct calls still go current, not legacy',async()=>{
 const f=native(),id='11111111-2222-4333-8444-555555555555',result=await f.api.savePurchaseOperation('NCT',id,'EDIT',{edits:[]});
 assert.equal(result.pending,true);assert.equal(f.calls[0].kind,'AUTH');assert.equal(f.calls[1].kind,'CONTROL');assert.equal(f.calls[2].kind,'CURRENT');
 assert.equal(f.calls.some(c=>c.kind==='EDIT'),false);assert.equal(f.calls[2].request.requestId,id);
 const denied=native('ACTIVE',false);await assert.rejects(denied.api.savePurchaseOperation('NCT',id,'EDIT',{}),/Denied/);assert.equal(denied.calls.length,1);
});
test('original LEGACY branch retains original actor/input and candidate is a minimum wrapper patch only',async()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-purchase-operation-route-candidate.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const f=native('LEGACY'),id='11111111-2222-4333-8444-555555555555',input={edits:[]};await f.api.savePurchaseOperation('NCT',id,'EDIT',input);
 const actual=f.calls.find(c=>c.kind==='EDIT').request;assert.deepEqual(actual,{company:'NCT',requestId:id,operation:'EDIT',input,staff:f.staff});
 assert.equal(f.calls.some(c=>c.kind==='CURRENT'),false);
 const candidate=fs.readFileSync(path.join(folder,'purchaseOperations.web.candidate.js'),'utf8'),original=fs.readFileSync(path.join(__dirname,'../backend/purchaseOperations.web.js'),'utf8').replace(/\r\n/g,'\n');
 const prefix="import { createCurrentPurchaseSaveRouter } from 'backend/stockCurrentCommands.js';\nimport { savePurchaseTasksCurrent } from 'backend/stockCurrentBorrow.web';\n";
 let stripped=candidate.replace(prefix,'').replace('async(company,requestId,operation,input,stockCurrent)=>{','async(company,requestId,operation,input)=>{');
 stripped=stripped.replace(/return await createCurrentPurchaseSaveRouter\(\{company,readControl:[^\n]*?saveLegacy:async\(\)=>/,'return ')
  .replace('})({requestId,operation,input,stockCurrent});',';');
 assert.equal(stripped,original);
});
