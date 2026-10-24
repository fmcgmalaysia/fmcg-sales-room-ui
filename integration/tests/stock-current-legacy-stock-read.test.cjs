const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),load=require('./load-master-module.cjs');
const {execFileSync}=require('node:child_process'),{createCurrentWarehouseOrdersRouter}=require('../prototypes/stock-current-state/current-warehouse-receipt-router.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),folder=path.join(__dirname,'../prototypes/stock-current-state');
function fixture(company='NCT'){
 let control={_id:hash(company,'STOCK_CONTROL'),company,stockCommitVersion:'V0',schemaVersion:1,mode:'LEGACY',generation:0,pending:null},allowed=true,change=null;
 const calls=[],context={company,tasks:[],orders:[],activity:[],allocations:[],customers:[]},member={_id:'M',status:'APPROVED'};
 const cache={'warehouseReceiving.js':{requireWarehouseStaff:(seen,records)=>{calls.push('AUTH');if(!allowed||seen!==member||records.length!==1)throw Error('Original Warehouse access refused');return{staffId:'W',staffName:'Warehouse',memberId:'M'};}}};
 const {createStockControlReader}=load('stockControlService.js',cache);
 const source=fs.readFileSync(path.join(folder,'stockControl.web.candidate.js'),'utf8');
 const read=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';getWarehouseStockControl;',{
  operationId:hash,createCurrentWarehouseOrdersRouter,createStockControlReader,currentMember:{getMember:async()=>{calls.push('MEMBER');return member;}},
  Permissions:{SiteMember:'SITE'},webMethod:(_,fn)=>fn,
  fulfilmentStore:{all:async collection=>{assert.equal(collection,'StaffMasterAccess');calls.push('STAFF');return[{}];},read:async(collection,id)=>{assert.equal(collection,company==='NCT'?'NCTActivity':'NCTActivity1');assert.equal(id,hash(company,'STOCK_CONTROL'));calls.push('CONTROL');return control?{...control}:null;}},
  readFulfilmentContext:async(selected,staff)=>{assert.equal(selected,company);assert.equal(staff.staffId,'W');calls.push('HISTORY');if(change)change();return context;}});
 return{read:input=>read(company,input),calls,get control(){return control;},set control(value){control=value;},deny:()=>{allowed=false;},race:fn=>{change=fn;}};
}
test('original Warehouse stock endpoint retains legacy response and original permission checks in both companies',async()=>{
 for(const company of ['NCT','GHR']){const f=fixture(company),result=await f.read({pageSize:50});assert.equal(result.company,company);assert.equal(result.items.length,0);assert.equal(result.permissions.adjust,false);assert.equal(result.staff.staffName,'Warehouse');assert.deepEqual(f.calls,['MEMBER','STAFF','AUTH','CONTROL','HISTORY','CONTROL']);}
 const denied=fixture();denied.deny();await assert.rejects(denied.read(),/Original Warehouse access/);assert.equal(denied.calls.includes('CONTROL'),false);
 const invalid=fixture();await assert.rejects(invalid.read({pageSize:1000}),/filters/);assert.deepEqual(invalid.calls,[]);
});
test('ACTIVE old endpoint explicitly requires updated current UI; maintenance/pending/missing/malformed never read history',async()=>{
 for(const mode of ['ACTIVE','MAINTENANCE','SHADOW','UNKNOWN']){const f=fixture();f.control.mode=mode;await assert.rejects(f.read(),mode==='ACTIVE'?/updated Stock Control/:/inventory/);assert.equal(f.calls.includes('HISTORY'),false);}
 for(const patch of [null,{pending:{key:'P',digest:'D'}},{stockCommitVersion:''},{company:'GHR'},{generation:-1},{schemaVersion:2}]){const f=fixture();f.control=patch===null?null:{...f.control,...patch};await assert.rejects(f.read());assert.equal(f.calls.includes('HISTORY'),false);}
});
test('a concurrent cutover or legacy mutation invalidates the entire old historical read, never mixed actionable quantities',async()=>{
 for(const change of [{mode:'ACTIVE'},{generation:1},{stockCommitVersion:'V1'},{pending:{key:'SAVE',digest:'D'}}]){const f=fixture();f.race(()=>Object.assign(f.control,change));await assert.rejects(f.read(),/changed during/);assert.equal(f.calls.filter(call=>call==='HISTORY').length,1);}
});
test('old stock wrapper reproducible; only context seam added, original web/auth/interface unchanged',()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-legacy-stock-read-guard.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(__dirname,'../backend/stockControl.web.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'stockControl.web.candidate.js'),'utf8');
 assert.equal(candidate.slice(candidate.indexOf('export const getWarehouseStockControl')),original.slice(original.indexOf('export const getWarehouseStockControl')));assert.equal((candidate.match(/webMethod\(Permissions.SiteMember/g)||[]).length,1);
});
