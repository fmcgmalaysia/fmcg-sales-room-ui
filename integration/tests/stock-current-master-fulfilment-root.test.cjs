const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const sourceFile=require.resolve('./stock-current-warehouse-dispatch-save.test.cjs');
const base=vm.runInNewContext(fs.readFileSync(sourceFile,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';({fixture,api});',
 {require:createRequire(sourceFile),__dirname:path.dirname(sourceFile),Map,Buffer});
const {createCurrentWarehouseDispatchSave,createCurrentWarehouseShipmentRead}=require('../prototypes/stock-current-state/current-warehouse-dispatch-save.cjs'),
 {createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter}=require('../prototypes/stock-current-state/current-warehouse-receipt-router.cjs'),
 {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs'),{hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
function originalRead(){
 const source=fs.readFileSync(path.join(folder,'customerFulfilmentService.candidate.js'),'utf8'),body=source.slice(source.indexOf('export async function readCustomerFulfilment(')).replace(/^export /,'');
 return vm.runInNewContext(body+';readCustomerFulfilment;',{
  ...load('customerShipmentLedger.js'),...load('customerShipmentPlan.js'),...load('salesOrderAdjustment.js'),
  readFulfilmentContext:async()=>{throw Error('Current private read must not recapture legacy context');},
  projectCustomerAccount:()=>({entries:[],balances:[]}),projectCustomerDebtors:()=>[{sensitive:'DEBTOR'}],
  customerAccountVersion:()=> 'ACCOUNT',shipmentVersion:base.api.shipmentVersion,Date,Math});
}
async function fixture({department='WAREHOUSE',mode='ACTIVE',coverage=true,changed=false,steps=100,dispatch=true}={}){
 const f=await base.fixture(),calls=[];let staffReads=0;
 const read=originalRead(),control=f.db.get('NCTActivity:'+f.protocol.ids.controlId);control.mode=mode;
 const staffRow={title:'W',description:'M',staffEmail:'master@example.test',staffName:'Warehouse',role:'STAFF',staffStatus:'ACTIVE',departments:[department]};
 const legacyResult={company:'NCT',lines:[{sellingPriceCtn:50,name:'LEGACY'}],shipments:[],debtorInvoices:['PRIVATE'],customerAccount:{},accountVersion:'A'};
 const fulfilmentStore={all:async collection=>{calls.push(collection);if(collection==='StaffMasterAccess'){staffReads++;return[{...staffRow,departments:changed&&staffReads>1?['SUPPORT']:staffRow.departments}];}if(collection==='PurchaseOrders')return[];throw Error('Unscoped full table');},
  read:async(collection,id)=>{calls.push('CONTROL');const row=await f.deps.store.read(collection,id);return row?{...row,stockCommitVersion:row._version}:null;}};
 const bindings={...f.deps,...load('../prototypes/stock-current-state/warehousePreparation.candidate.js'),items:f.deps.items,fulfilmentStore,readFulfilmentContext:async(...args)=>{calls.push('CURRENT_CONTEXT');return f.deps.readContext(...args);},
  readCustomerFulfilment:read,CUSTOMER_CURRENT_FULFILMENT_VERSION:2,SHIPMENT_CURRENT_ALLOCATION_VERSION:2,PURCHASE_CURRENT_PROJECTION_VERSION:2,WAREHOUSE_CURRENT_READY_VERSION:2,
  createCurrentWarehouseDispatchSave,createCurrentWarehouseShipmentRead,planCollections:require('../prototypes/stock-current-state/domain-scope.cjs').planCollections,
  createSdkConditionalStore:()=>{calls.push('SDK');return f.deps.store;},createSegmentedFencedProof:()=>steps===100?f.protocol:require('../prototypes/stock-current-state/segmented-fenced-proof.cjs').createSegmentedFencedProof({store:f.deps.store,domainWrites:true,stepsPerInvocation:steps})};
 let rootSource=fs.readFileSync(path.join(folder,'stockCurrentFulfilment.js'),'utf8');
 if(coverage)rootSource=rootSource.replace('const writerCoverage=Object.freeze({});','const writerCoverage=Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
 // Explicit OFFLINE opt-in exercises the future dispatch algorithm; shipped root
 // must retain its independent Loaded-only release gate even after coverage passes.
 if(dispatch)rootSource=rootSource.replace('export const CURRENT_PHYSICAL_DISPATCH_ENABLED=false;','export const CURRENT_PHYSICAL_DISPATCH_ENABLED=true;');
 const root=vm.runInNewContext('(function(){'+rootSource.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return createCurrentMasterFulfilment;})()',bindings);
 const gatewaySource=fs.readFileSync(path.join(folder,'customerFulfilment.web.candidate.js'),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');
 const api=vm.runInNewContext('(function(){'+gatewaySource+';return{getCustomerFulfilment,saveCustomerShipment};})()',{
  createCurrentMasterFulfilment:root,CURRENT_PHYSICAL_DISPATCH_ENABLED:dispatch,createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter,operationId:hash,PURCHASE_COLLECTIONS:load('purchaseProjection.js').PURCHASE_COLLECTIONS,
  webMethod:(_permission,fn)=>fn,Permissions:{SiteMember:'SITE_MEMBER'},currentMember:{getMember:async()=>{calls.push('MEMBER');return{_id:'M',status:'APPROVED',loginEmail:'master@example.test'};}},fulfilmentStore,
  readCustomerFulfilment:async()=>{calls.push('LEGACY_READ');return copy(legacyResult);},saveCustomerFulfilment:async request=>{calls.push('LEGACY_SAVE');return{ok:true,legacy:true,requestId:request.requestId};}});
 return{...f,api,calls,staffRow,control,read,root,
  meta:()=>({stockProtocol:1,stockBuild:'TEST',stockGeneration:control.generation,stockIdentity:{staffId:'W',memberId:'M'}})};
}
test('actual private root plus original shared staff gateway supplies current Warehouse read/redaction and dispatches once without changing original invoice',async()=>{
 const f=await fixture(),beforeInvoice=JSON.stringify(f.db.get('NCTActivity:INV')),read=await f.api.getCustomerFulfilment('NCT');
 assert.equal(read.lines[0].allocated,50);assert.equal(read.lines[0].sellingPriceCtn,undefined);assert.deepEqual(copy(read.debtorInvoices),[]);assert.equal(read.customerAccount,undefined);assert.equal(read.accountVersion,undefined);
 assert.deepEqual(copy(read.staff),{staffName:'Warehouse',staffId:'W',memberId:'M'});assert.equal(read.permissions.dispatch,true);assert.equal(read.permissions.invoice,false);
 const input={action:'DISPATCH',id:'SHIP',version:read.version,reference:'ACTUAL-CONTAINER',reason:'Physical exit'},requestId='aaaaaaaa-1111-4111-8111-111111111111',meta=f.meta();
 const result=await f.api.saveCustomerShipment('NCT',requestId,input,meta);assert.equal(result.ok,true);assert.equal(result.stockGeneration,1);assert.equal(result.status,'DISPATCHED');
 assert.deepEqual(copy(await f.api.saveCustomerShipment('NCT',requestId,input,meta)),copy(result));assert.equal(f.calls.some(call=>call.startsWith('LEGACY')),false);
 assert.equal(JSON.stringify(f.db.get('NCTActivity:INV')),beforeInvoice);assert.equal(f.db.get('NCTTasks:T').stockDispatchedCumulative,20);
 assert.equal([...f.db.values()].find(row=>row.sourceTaskId==='T'&&row.receiptAccepted===50).onHand,30);
});

test('shipped Loaded-only gate blocks real physical exit independently of complete writer coverage and browser flags',async()=>{
 const source=fs.readFileSync(path.join(folder,'stockCurrentFulfilment.js'),'utf8');
 assert.match(source,/export const CURRENT_PHYSICAL_DISPATCH_ENABLED=false;/);
 const f=await fixture({dispatch:false}),read=await f.api.getCustomerFulfilment('NCT');
 assert.equal(read.permissions.dispatch,false);assert.equal(read.permissions.invoice,false);
 const before=JSON.stringify([...f.db]),requestId='acacacac-1111-4111-8111-111111111111';
 const input={action:'DISPATCH',id:'SHIP',version:read.version,reference:'CONTAINER',reason:'Beyond Loaded',dispatchEnabled:true};
 for(const meta of [f.meta(),{...f.meta(),CURRENT_PHYSICAL_DISPATCH_ENABLED:true}]){
  const result=await f.api.saveCustomerShipment('NCT',requestId,input,meta);
  assert.equal(result.ok,false);assert.equal(result.pending,undefined);assert.match(result.error,/Loaded/);
  assert.equal(JSON.stringify([...f.db]),before);
 }
 const support=await fixture({department:'SUPPORT',dispatch:false}),supportRead=await support.api.getCustomerFulfilment('NCT');
 assert.equal(supportRead.permissions.invoice,false);assert.equal(supportRead.permissions.dispatch,false);
 const legacy=await fixture({mode:'LEGACY',dispatch:false});
 assert.equal((await legacy.api.getCustomerFulfilment('NCT')).permissions.dispatch,true,'original legacy grant preserved');
});
test('original Support and Account keep shared current read permissions without gaining dispatch or enabling a real invoice',async()=>{
 for(const department of ['SUPPORT','ACCOUNT']){
  const f=await fixture({department}),read=await f.api.getCustomerFulfilment('NCT');assert.equal(read.stockCurrent.stockGeneration,0);assert.ok(read.customerAccount);assert.equal(read.debtorInvoices[0].sensitive,'DEBTOR');
  assert.equal(read.permissions.dispatch,false);assert.equal(read.permissions.invoice,false);
  const before=JSON.stringify([...f.db]);
  for(const action of ['DISPATCH','INVOICE'])assert.equal((await f.api.saveCustomerShipment('NCT','bbbbbbbb-1111-4111-8111-111111111111',{action,id:'SHIP',version:read.version,reason:'Not granted',reference:'X'},f.meta())).ok,false);
  assert.equal(JSON.stringify([...f.db]),before);assert.equal(f.calls.includes('LEGACY_SAVE'),false);
 }
});
test('server LEGACY alone retains original read/save; ACTIVE missing metadata never falls back, maintenance/pending/unknown refuse',async()=>{
 const legacy=await fixture({mode:'LEGACY'});assert.equal((await legacy.api.getCustomerFulfilment('NCT')).lines[0].name,'LEGACY');
 assert.equal((await legacy.api.saveCustomerShipment('NCT','cccccccc-1111-4111-8111-111111111111',{action:'DISPATCH'})).legacy,true);assert.equal(legacy.calls.includes('SDK'),false);
 assert.equal((await legacy.api.saveCustomerShipment('NCT','cccccccc-1111-4111-8111-111111111111',{action:'DISPATCH'},legacy.meta())).ok,false);
 for(const mode of ['SHADOW','MAINTENANCE','UNKNOWN']){const f=await fixture({mode});await assert.rejects(f.api.getCustomerFulfilment('NCT'));assert.equal((await f.api.saveCustomerShipment('NCT','dddddddd-1111-4111-8111-111111111111',{action:'DISPATCH'})).ok,false);assert.equal(f.calls.includes('LEGACY_SAVE'),false);}
 const pending=await fixture();pending.control.pending={key:'OTHER'};await assert.rejects(pending.api.getCustomerFulfilment('NCT'),/pending/);assert.equal(pending.calls.includes('CURRENT_CONTEXT'),false);
 const active=await fixture();assert.equal((await active.api.saveCustomerShipment('NCT','eeeeeeee-1111-4111-8111-111111111111',{action:'DISPATCH'})).ok,false);assert.equal(active.calls.includes('LEGACY_SAVE'),false);
});
test('closed writer coverage, original staff revocation, changed actor and wrong expected identity refuse before company stock facts',async()=>{
 const closed=await fixture({coverage:false});await assert.rejects(closed.api.getCustomerFulfilment('NCT'),/writers/);assert.equal(closed.calls.includes('CURRENT_CONTEXT'),false);
 const denied=await fixture({department:'PURCHASE'});await assert.rejects(denied.api.getCustomerFulfilment('NCT'),/not authorized/);assert.equal(denied.calls.includes('SDK'),false);
 const changed=await fixture({changed:true});await assert.rejects(changed.api.getCustomerFulfilment('NCT'),/identity changed/);assert.equal(changed.calls.includes('SDK'),false);
 const f=await fixture(),read=await f.api.getCustomerFulfilment('NCT');const before=JSON.stringify([...f.db]);
 assert.equal((await f.api.saveCustomerShipment('NCT','ffffffff-1111-4111-8111-111111111111',{action:'DISPATCH',id:'SHIP',version:read.version,reason:'Exit',reference:'R'}, {...f.meta(),stockIdentity:{staffId:'W',memberId:'OTHER'}})).ok,false);assert.equal(JSON.stringify([...f.db]),before);
});
test('private context seam keeps original three-argument source and rejects customer/anonymous privilege substitution',async()=>{
 const f=await fixture();
 for(const staff of [{},{customerId:'CUSTOMER',canDispatchShipment:true},{customerId:'CUSTOMER',readFinancial:true}])await assert.rejects(f.read('NCT',staff,'',{company:'NCT',stockAllocationView:'CURRENT_V2'}),/Verified current/);
 await assert.rejects(f.read('NCT',{customerId:'C'},'OTHER',{company:'NCT',stockAllocationView:'CURRENT_V2'}),/Verified current/);
 for(const file of ['build-master-fulfilment-current.cjs','build-sales-fulfilment-candidate.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(__dirname,'../backend/customerFulfilment.web.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'customerFulfilment.web.candidate.js'),'utf8');
 const auth=original.slice(original.indexOf('async function staffContext()'),original.indexOf('export const getCustomerFulfilment='));assert.equal(candidate.includes(auth),true,'original staff authority byte-exact');
 assert.deepEqual([...candidate.matchAll(/export const (\w+)=webMethod/g)].map(match=>match[1]),['getCustomerFulfilment','saveCustomerShipment'],'same original public method inventory');
});
test('original Warehouse auth-only dispatch recovery works behind pending/closed coverage with no company facts; Support cannot use it as a dispatch grant',async()=>{
 const f=await fixture({coverage:false});f.control.pending={key:'ORIGINAL'};
 const result=await f.api.getCustomerFulfilment('NCT',{resume:'WAREHOUSE_DISPATCH_V1'});assert.equal(result.schema,'WAREHOUSE_DISPATCH_RESUME_V1');assert.deepEqual(copy(result.staff),{staffId:'W',memberId:'M',staffName:'Warehouse'});
 assert.equal(f.calls.includes('SDK'),false);assert.equal(f.calls.includes('CONTROL'),false);assert.equal(f.calls.includes('CURRENT_CONTEXT'),false);
 for(const input of [{resume:'OTHER'},{resume:'WAREHOUSE_DISPATCH_V1',grant:true}])await assert.rejects(f.api.getCustomerFulfilment('NCT',input),/recovery identity/);
 await assert.rejects(f.api.getCustomerFulfilment('UNKNOWN',{resume:'WAREHOUSE_DISPATCH_V1'}),/recovery identity/);
 const support=await fixture({department:'SUPPORT'});await assert.rejects(support.api.getCustomerFulfilment('NCT',{resume:'WAREHOUSE_DISPATCH_V1'}),/recovery identity/);assert.equal(support.calls.includes('SDK'),false);
});
test('same login with reissued employee ID cannot adopt an already-prepared original dispatch by changing only expected identity',async()=>{
 const f=await fixture({steps:1}),read=await f.api.getCustomerFulfilment('NCT'),requestId='abababab-1111-4111-8111-111111111111';
 const input={action:'DISPATCH',id:'SHIP',version:read.version,reference:'CONTAINER',reason:'Physical exit'},meta=f.meta();
 assert.equal((await f.api.saveCustomerShipment('NCT',requestId,input,meta)).pending,true);assert.ok((await f.protocol.readControl()).pending);
 f.staffRow.title='W2';const changed={...meta,stockIdentity:{staffId:'W2',memberId:'M'}};
 for(let attempt=0;attempt<20;attempt++)await f.api.saveCustomerShipment('NCT',requestId,input,changed);
 assert.equal(f.db.get('NCTTasks:T').stockDispatchedCumulative,0,'prepared original actor cannot be replaced before apply');
 assert.equal([...f.db.values()].filter(row=>row.details?.shipment?.status==='DISPATCHED').length,0);assert.equal((await f.protocol.readControl()).generation,0);
 f.staffRow.title='W';let result;for(let attempt=0;attempt<20;attempt++){result=await f.api.saveCustomerShipment('NCT',requestId,input,meta);if(result.ok)break;}
 assert.equal(result.ok,true);assert.equal(f.db.get('NCTTasks:T').stockDispatchedCumulative,20);assert.equal((await f.protocol.readControl()).generation,1);
});
