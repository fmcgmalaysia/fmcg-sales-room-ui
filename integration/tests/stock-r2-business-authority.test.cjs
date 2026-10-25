'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildIsolatedCohort}=require('../prototypes/stock-current-state/build-isolated-cohort.cjs');
const packet=buildIsolatedCohort();
const roots={
 'stockCurrentBorrow.web.js':{call:'privateGateway',args:['NCT'],localGrant:true},
 'stockCurrentWarehouse.web.js':{call:'receiptSave',args:['NCT',true],localGrant:true},
 'stockCurrentAccountPurchase.js':{call:'createCurrentAccountPurchase',args:['NCT'],localGrant:true},
 'stockCurrentExceptions.js':{call:'createCurrentStockExceptions',args:['NCT'],localGrant:true},
 'stockCurrentCostReference.js':{call:'createCurrentCostReference',args:['NCT'],localGrant:true},
 'stockCurrentPurchaseOrders.js':{call:'createCurrentPurchaseOrders',args:['NCT'],localGrant:true},
 'stockCurrentSourceSales.js':{call:'createCurrentSourceSales',delegation:true,localGrant:true},
 'stockCurrentFulfilment.js':{call:'createCurrentMasterFulfilment',delegation:true,localGrant:true,readOnly:true},
 'stockCurrentOrderIntake.js':{call:'createCurrentOrderIntake',args:[{company:'NCT',captureCosts:()=>{}}]},
 'stockCurrentQuantityRead.js':{call:'createCurrentPurchaseQuantityRead',args:['NCT'],readOnly:true}
};
function fixture(target,{deny=false,company='NCT'}={}){
 const source=packet.output.get('MASTER/r2'+target),elevations=[],requests=[],staff={memberId:'M',staffId:'S',staffName:'Staff',canDispatchShipment:true};let storeItems,granted=!roots[target].localGrant;
 const context={Object,Date,Error,Map,Set,JSON};
 for(const match of source.matchAll(/^import\s*\{([^}]+)\}\s*from[^\n]+/gm))for(const part of match[1].split(',')){
  const key=part.trim().split(/\s+as\s+/).at(-1);context[key]=key.endsWith('_VERSION')?2:()=>{};
 }
 const grant=async()=>{if(deny)throw Error('ORIGINAL_DENIED');granted=true;return staff;};
 const requireGrant=()=>{if(deny)throw Error('ORIGINAL_DENIED');granted=true;return staff;};
 const sdkItems=Object.fromEntries(['query','insert','bulkInsert','patch','remove'].map(method=>[method,(...args)=>{requests.push([method,...args]);return method;} ]));
 Object.assign(context,{sdkItems,auth:{elevate:fn=>{assert.equal(granted,true,'Original grant before elevation');elevations.push(fn);return fn;}},
  getPurchaseStaffContext:grant,currentMember:{getMember:async()=>({_id:'M',loginEmail:'staff@example.invalid',status:'APPROVED'})},
  requireAccountStaff:requireGrant,requireStockStaff:requireGrant,requireWarehouseStaff:requireGrant,requireOriginalSalesDelegation:requireGrant,
  fulfilmentStore:{all:async()=>[],read:async()=>({_id:'CONTROL',company,schemaVersion:1,stockCommitVersion:'V',generation:0,pending:null,mode:'ACTIVE'})},
  operationId:()=> 'CONTROL',PURCHASE_COLLECTIONS:{NCT:{activity:'R2NCTActivity'},GHR:{activity:'R2NCTActivity1'}},
  planCollections:()=>['R2NCTActivity'],createSdkConditionalStore:options=>{storeItems=options.items;throw Error('BOUNDARY_CAPTURED');},
  webMethod:(_,fn)=>fn,Permissions:{SiteMember:'SITE_MEMBER'}});
 const run=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';'+roots[target].call+';',context);
 let args=roots[target].args;
 if(roots[target].delegation)args=[{company,authenticateOriginalDelegation:grant,authenticateOriginalWarehouse:grant}];
 return{source,sdkItems,elevations,requests,run:()=>run(...args),getItems:()=>storeItems};
}
for(const [target,definition]of Object.entries(roots)){
 test('R2 authority preserves original boundary and minimum methods: '+target,async()=>{
  const f=fixture(target);await assert.rejects(f.run(),/BOUNDARY_CAPTURED/);assert.equal(f.requests.length,0);
  const items=f.getItems();assert.deepEqual(Object.keys(items).sort(),['bulkInsert','insert','patch','query','remove']);
  assert.equal(f.elevations.length,definition.readOnly?1:4);assert.equal(items.query,f.sdkItems.query);
  assert.throws(()=>items.remove('R2NCTActivity','x'),/deletion not enabled/);assert.equal(f.requests.length,0);
  for(const method of ['insert','bulkInsert','patch']){
   if(definition.readOnly)assert.throws(()=>items[method](),/mutation not enabled/);else assert.equal(items[method],f.sdkItems[method]);
  }
  assert.match(f.source,/const writerCoverage\s*=\s*Object\.freeze\(\{\}\)/);
  if(target==='stockCurrentFulfilment.js')assert.match(f.source,/CURRENT_PHYSICAL_DISPATCH_ENABLED=false/);
 });
 if(definition.localGrant)test('original rejected actor never constructs privileged methods: '+target,async()=>{
  const f=fixture(target,{deny:true});await assert.rejects(f.run(),/ORIGINAL_DENIED/);assert.equal(f.elevations.length,0);assert.equal(f.requests.length,0);assert.equal(f.getItems(),undefined);
 });
}
test('Packing, Admin diagnostics, ordinary originals and Source quotation dependencies are not elevated by the Master policy',()=>{
 for(const [key,source]of packet.output){
  if(!key.endsWith('.js')||!source.includes("from '@wix/essentials'"))continue;
  if(['FMCGMALAYSIA/r2nctSalesIntake.js','FMCGMALAYSIA/r2onboarding.web.js'].includes(key))continue;
  assert.equal(key.startsWith('MASTER/r2'),true);assert.ok(roots[key.slice('MASTER/r2'.length)],key);
 }
 const packing=packet.output.get('MASTER/r2stockCurrentPacking.js');assert.doesNotMatch(packing,/auth\.elevate|sdkItems|privileged deletion/);
 assert.deepEqual(packet.report.retainedDependencies.map(row=>row.target).sort(),['catalogueSelection.web.js','fxRates.web.js','staffAuth.web.js']);
});
