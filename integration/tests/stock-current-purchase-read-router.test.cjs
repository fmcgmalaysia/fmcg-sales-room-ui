const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{createCurrentPurchaseReadRouter}=require('../prototypes/stock-current-state/current-purchase-read-router.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),folder=path.join(__dirname,'../prototypes/stock-current-state');
function fixture(company='NCT',mode='ACTIVE'){
  const calls=[],control={_id:hash(company,'STOCK_CONTROL'),company,stockCommitVersion:'V',schemaVersion:1,generation:4,pending:null,mode};
  const read=createCurrentPurchaseReadRouter({company,readControl:async()=>control,readLegacy:async()=>{calls.push('LEGACY');return 'LEGACY';},
    readCurrent:async selected=>{assert.equal(selected,company);calls.push('CURRENT');return 'CURRENT';}});
  return{calls,control,read};
}

test('only confirmed server LEGACY can run old GP-writing workspace; ACTIVE cannot be selected away by caller metadata',async()=>{
  for(const company of ['NCT','GHR']){
    const f=fixture(company);assert.equal(await f.read({mode:'LEGACY'}),'CURRENT');assert.deepEqual(f.calls,['CURRENT']);
    f.control.mode='LEGACY';assert.equal(await f.read(),'LEGACY');assert.deepEqual(f.calls,['CURRENT','LEGACY']);
  }
});

test('missing/corrupt control, pending, maintenance and shadow never fall back to an old writer',async()=>{
  for(const patch of [{mode:'MAINTENANCE'},{mode:'SHADOW'},{mode:'UNKNOWN'},{company:'GHR'},{pending:{}},{pending:undefined},
    {stockCommitVersion:''},{schemaVersion:2},{generation:-1},{_id:'FOREIGN'}]){
    const f=fixture();Object.assign(f.control,patch);await assert.rejects(f.read());assert.deepEqual(f.calls,[]);
  }
  await assert.rejects(createCurrentPurchaseReadRouter({company:'NCT',readControl:async()=>null,
    readLegacy:async()=>assert.fail('legacy'),readCurrent:async()=>assert.fail('current')})(),/unconfirmed/);
});

function native(mode='ACTIVE',authorized=true){
  const calls=[],control=fixture('NCT',mode).control;
  const workspace={company:'NCT',staff:{staffId:'P',memberId:'M',staffName:'Purchase'},tasks:[],customers:[],suppliers:[]};
  const bindings={Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(permission,fn)=>{assert.equal(permission,'SITE_MEMBER');return fn;},
    createCurrentPurchaseReadRouter,operationId:hash,PURCHASE_COLLECTIONS:{NCT:{orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'}},
    getPurchaseStaffContext:async()=>{calls.push('AUTH');if(!authorized)throw Error('Denied');return workspace.staff;},
    getPurchaseWorkspaceCurrent:async company=>{calls.push('CURRENT');return{...workspace,current:true};},
    createPurchaseMarginRefresh:()=>async()=>{calls.push('LEGACY_MARGIN');return new Map();},
    projectPurchaseWorkspace:()=>{calls.push('LEGACY_PROJECT');return workspace;},readCustomerShortNames:async()=>[],readCurrentAdminFx:async()=>[],
    projectPurchaseOrders:()=>[],applyPurchaseProgress:()=>{},
    wixData:{query:collection=>{let exact=false;const q={eq:(field,id)=>{assert.equal(field,'_id');assert.equal(id,control._id);exact=true;return q;},
      limit:()=>q,find:async()=>{calls.push(exact?'CONTROL':'LEGACY_TABLE');return{items:exact?[control]:[],hasNext:()=>false};}};return q;}}};
  const source=fs.readFileSync(path.join(folder,'purchaseWorkspace.web.candidate.js'),'utf8');
  const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{getPurchaseWorkspace};})()',bindings);
  return{calls,control,api};
}

test('actual original workspace wrapper authenticates before control and never calls old refresh in ACTIVE',async()=>{
  const f=native(),result=await f.api.getPurchaseWorkspace('NCT');assert.equal(result.current,true);
  assert.deepEqual(f.calls,['AUTH','CONTROL','CURRENT']);
  const denied=native('ACTIVE',false);await assert.rejects(denied.api.getPurchaseWorkspace('NCT'),/Denied/);assert.deepEqual(denied.calls,['AUTH']);
  const legacy=native('LEGACY');await legacy.api.getPurchaseWorkspace('NCT');assert.equal(legacy.calls.includes('CURRENT'),false);
  assert.equal(legacy.calls.filter(value=>value==='LEGACY_MARGIN').length,1);
});

test('candidate minimum wrapper strips back to exact original read body, without changing original GP policy or records',()=>{
  assert.match(execFileSync(process.execPath,[path.join(folder,'build-purchase-workspace-route-candidate.cjs'),'--check'],{encoding:'utf8'}),/verified/);
  const candidate=fs.readFileSync(path.join(folder,'purchaseWorkspace.web.candidate.js'),'utf8'),original=fs.readFileSync(path.join(__dirname,'../backend/purchaseWorkspace.web.js'),'utf8').replace(/\r\n/g,'\n');
  const prefix="import { createCurrentPurchaseReadRouter } from 'backend/stockCurrentCommands.js';\nimport { getPurchaseWorkspaceCurrent } from 'backend/stockCurrentBorrow.web';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\n";
  const stripped=candidate.replace(prefix,'').replace(/\n  return createCurrentPurchaseReadRouter\(\{company,readCurrent:getPurchaseWorkspaceCurrent,[\s\S]*?readLegacy:async\(\)=>\{/,'')
    .replace('\n  }})();\n});','\n});');
  assert.equal(stripped,original);
});
