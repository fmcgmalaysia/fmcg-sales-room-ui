const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>structuredClone(value);
const roots=['stockCurrentAccountPurchase.js','stockCurrentBorrow.web.js','stockCurrentCostReference.js','stockCurrentExceptions.js',
 'stockCurrentFulfilment.js','stockCurrentOrderIntake.js','stockCurrentPacking.js','stockCurrentPurchaseOrders.js','stockCurrentQuantityRead.js',
 'stockCurrentSourceSales.js','stockCurrentWarehouse.web.js','stockRecoveryRead.web.js','stockMaintenanceAdmin.web.js'];
function schema(company){return{[company==='NCT'?'NCTActivity':'NCTActivity1']:['activityTime'],
 [company==='NCT'?'NCTOrders':'NCTOrders1']:['masterReceivedTime','salesSubmissionTime'],
 [company==='NCT'?'NCTTasks':'NCTTasks1']:['lastCostCaptureTime']};}
function boundFields(file,company){const source=fs.readFileSync(path.join(folder,file),'utf8'),match=source.match(/dateTimeFields:\s*(\{[^{}]*\})/);
 assert.ok(match,'Exact native date configuration required: '+file);const names={activity:company==='NCT'?'NCTActivity':'NCTActivity1',orders:company==='NCT'?'NCTOrders':'NCTOrders1',tasks:company==='NCT'?'NCTTasks':'NCTTasks1'};
 return JSON.parse(JSON.stringify(vm.runInNewContext('('+match[1]+')',{company,journal:names.activity,names,orders:names.orders,tasks:names.tasks,
  verifiedDateFields:{NCTActivity:['activityTime'],NCTActivity1:['activityTime']}})));}
function nativeStore(company,dateTimeFields){const db=new Map(),date='2026-10-23T02:00:00.000Z';
 const items={query:collection=>{const filters=[];const query={eq:(field,value)=>{filters.push(row=>row[field]===value);return query;},limit:()=>query,
  find:async()=>({items:[...db].filter(([key,row])=>key.startsWith(collection+'/')&&filters.every(fn=>fn(row))).map(([,row])=>copy(row))})};return query;},
  insert:async(collection,row)=>{db.set(collection+'/'+row._id,copy(row));return copy(row);},remove:()=>{throw Error('No deletion');},
  patch:(collection,id)=>{const set={},remove=[];const query={setField:(field,value)=>{set[field]=copy(value);return query;},removeField:field=>{remove.push(field);return query;},
   run:async options=>{const row=db.get(collection+'/'+id);assert.deepEqual(options,{condition:{company:{$eq:company},stockCommitVersion:{$eq:row.stockCommitVersion}}});
    const result={...row,...set};for(const field of remove)delete result[field];db.set(collection+'/'+id,copy(result));return copy(result);}};return query;}};
 return{db,date,store:createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields})};}

test('all current roots, read-only recovery and maintenance bind both companies exact CMS-inspected order/task/journal date fields',()=>{
 for(const file of roots)for(const company of ['NCT','GHR'])assert.deepEqual(boundFields(file,company),schema(company),file+' '+company);
});
test('root-bound actual adapter keeps native Date types through whole-row CAS while canonical plans and ordinary text stay unchanged',async()=>{
 for(const company of ['NCT','GHR'])for(const file of roots){const fields=boundFields(file,company),f=nativeStore(company,fields);
  for(const [collection,names] of Object.entries(fields)){
   const native={_id:'ROW',company,stockCommitVersion:'V0',ordinaryText:f.date,...Object.fromEntries(names.map(name=>[name,new Date(f.date)])),
    ...(/^NCTOrders1?$/.test(collection)?{estimatedShipmentDate:'2028-02-29'}:{})};f.db.set(collection+'/ROW',copy(native));
   const before=await f.store.read(collection,'ROW');for(const name of names)assert.equal(before[name],f.date);
   await f.store.compareAndSet(collection,'ROW','V0',{...before,_version:'V1',inventoryCounter:1});
   const actual=f.db.get(collection+'/ROW');for(const name of names){assert.ok(actual[name] instanceof Date,file+' '+collection+'.'+name);assert.equal(actual[name].toISOString(),f.date);}
   assert.equal(actual.ordinaryText,f.date);assert.equal(typeof actual.ordinaryText,'string');assert.equal(actual.inventoryCounter,1);
   if(/^NCTOrders1?$/.test(collection)){assert.equal(actual.estimatedShipmentDate,'2028-02-29');assert.equal(typeof actual.estimatedShipmentDate,'string');}
  }
 }
});

test('date-only order values including null and absent remain exact through every root without timezone conversion',async()=>{
 for(const company of ['NCT','GHR'])for(const file of roots)for(const value of ['2026-10-23','2026-01-01',null,undefined]){
  const f=nativeStore(company,boundFields(file,company)),collection=company==='NCT'?'NCTOrders':'NCTOrders1';
  const native={_id:'ROW',company,stockCommitVersion:'V0',...(value===undefined?{}:{estimatedShipmentDate:value})};f.db.set(collection+'/ROW',copy(native));
  const before=await f.store.read(collection,'ROW');await f.store.compareAndSet(collection,'ROW','V0',{...before,_version:'V1',inventoryCounter:0});
  const actual=f.db.get(collection+'/ROW');assert.equal(actual.estimatedShipmentDate,value);
  assert.equal(Object.hasOwn(actual,'estimatedShipmentDate'),value!==undefined);
 }
});

test('retained counterexample: old timestamp binding rejects a valid date-only order before any stock save',async()=>{
 const fields=schema('NCT');fields.NCTOrders=['estimatedShipmentDate',...fields.NCTOrders];const f=nativeStore('NCT',fields);
 f.db.set('NCTOrders/ROW',{_id:'ROW',company:'NCT',stockCommitVersion:'V0',estimatedShipmentDate:'2026-10-23'});
 await assert.rejects(f.store.read('NCTOrders','ROW'),/DateTime read type mismatch/);
 assert.equal(f.db.get('NCTOrders/ROW').stockCommitVersion,'V0');
});
test('retained counterexample: journal-only configuration silently writes an untouched task Date as text during another field update',async()=>{
 const f=nativeStore('NCT',{NCTActivity:['activityTime']}),native={_id:'ROW',company:'NCT',stockCommitVersion:'V0',lastCostCaptureTime:new Date(f.date)};
 f.db.set('NCTTasks/ROW',native);const before=await f.store.read('NCTTasks','ROW');await f.store.compareAndSet('NCTTasks','ROW','V0',{...before,_version:'V1',stockDispatchedCumulative:0});
 assert.equal(typeof f.db.get('NCTTasks/ROW').lastCostCaptureTime,'string','Witness is an unsafe old configuration, not a new accepted production path');
});
test('root-bound typed dates reject string-corrupt native rows instead of silently migrating or repairing them',async()=>{
 const fields=boundFields('stockCurrentWarehouse.web.js','NCT'),f=nativeStore('NCT',fields);
 f.db.set('NCTTasks/ROW',{_id:'ROW',company:'NCT',stockCommitVersion:'V0',lastCostCaptureTime:f.date});
 await assert.rejects(f.store.read('NCTTasks','ROW'),/DateTime read type mismatch/);assert.equal(f.db.get('NCTTasks/ROW').stockCommitVersion,'V0');
});
