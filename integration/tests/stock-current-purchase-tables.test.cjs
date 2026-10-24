const test=require('node:test'),assert=require('node:assert/strict');
const {createSdkConditionalStore}=require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const {createCurrentPurchaseTables}=require('../prototypes/stock-current-state/current-purchase-tables.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(company='NCT'){
  const journal=company==='NCT'?'NCTActivity':'NCTActivity1',orders=company==='NCT'?'NCTOrders':'NCTOrders1',tasks=company==='NCT'?'NCTTasks':'NCTTasks1',calls=[];
  const raw={_id:'T',company,stockCommitVersion:'V1',_updatedDate:new Date('2026-10-22T00:00:00Z'),stockCounterSchema:2,stockDispatchedCumulative:40};
  const tables={ [orders]:[{_id:'O',company,stockCommitVersion:'O1'}],[tasks]:[raw],
    [journal]:[{_id:'OLD',action:'ORDER_RECEIVED',activityTime:new Date('2026-10-20T00:00:00Z')},
      {_id:'NEW',company,stockCommitVersion:'J1',activityTime:new Date('2026-10-22T00:00:00Z'),details:{keep:'text',ordered:{z:1,a:2}}}],
    SharedSuppliers:[{_id:'S',title:'S'}],PurchaseOrders:[{_id:'P',company,stockCommitVersion:'P1'},
      {_id:'FOREIGN',company:company==='NCT'?'GHR':'NCT',stockCommitVersion:'FOREIGN'}] };
  const forbidden=()=>{throw Error('No per-listed-row SDK requests allowed');},items={query:forbidden,insert:forbidden,patch:forbidden,remove:forbidden},
    store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime']}}),
    read=createCurrentPurchaseTables({company,store,readOriginalTable:async collection=>{calls.push(collection);return tables[collection];}});
  return{company,journal,orders,tasks,raw,tables,store,read,calls,staff:{memberId:'M',staffId:'P'}};
}
for(const company of ['NCT','GHR'])test(`${company} original table pages normalize exact migrated versions without N+1 reads or historical journal rewrite`,async()=>{
  const f=fixture(company),before=JSON.stringify(f.tables),result=await f.read(company,f.staff);
  assert.equal(result[f.tasks][0]._version,'V1');assert.equal(result[f.tasks][0].stockDispatchedCumulative,40);
  assert.equal(Object.hasOwn(result[f.tasks][0],'stockCommitVersion'),false);assert.equal(Object.hasOwn(result[f.tasks][0],'_updatedDate'),false);
  assert.equal(result[f.journal][0].company,undefined);assert.equal(result[f.journal][0].activityTime,'2026-10-20T00:00:00.000Z');
  assert.equal(result[f.journal][1].activityTime,'2026-10-22T00:00:00.000Z');
  assert.equal(JSON.stringify(result[f.journal][1].details.ordered),'{"z":1,"a":2}');
  assert.deepEqual(result.PurchaseOrders.map(r=>r._id),['P']);assert.equal(JSON.stringify(f.tables),before);assert.equal(f.calls.length,5);
});
test('unmigrated mutable rows, duplicate/missing data, foreign journal and native Date mismatch fail rather than partial table success',async()=>{
  for(const variant of ['version','company','duplicate','missing','journal','date']){
    const f=fixture();
    if(variant==='version')delete f.raw.stockCommitVersion;
    if(variant==='company')f.raw.company='GHR';
    if(variant==='duplicate')f.tables[f.tasks].push(copy(f.raw));
    if(variant==='missing')f.tables[f.orders]=null;
    if(variant==='journal')f.tables[f.journal][0].company='GHR';
    if(variant==='date')f.tables[f.journal][1].activityTime='2026-10-22T00:00:00.000Z';
    await assert.rejects(f.read('NCT',f.staff),undefined,variant);
  }
});
test('no private table read for wrong company or missing original actor; listed codec has no write/permission side effect',async()=>{
  const f=fixture();await assert.rejects(f.read('GHR',f.staff));await assert.rejects(f.read('NCT',{memberId:'M'}));assert.equal(f.calls.length,0);
  assert.throws(()=>f.store.normalizeListedRow('StaffMasterAccess',f.raw),/scope/);
  assert.throws(()=>f.store.normalizeListedRow(f.tasks,{...f.raw,stockCommitVersion:''}),/migrated version/);
});
test('only exact company protocol lock may normalize without a stock version; no lock or legacy receipt is removed',async()=>{
 const f=fixture(),id=hash('NCT/PURCHASE','LOCK'),lock={_id:id,company:'NCT',owner:'REQUEST',attempt:'ATTEMPT',_updatedDate:new Date('2026-10-22T00:00:00Z')};
 f.tables[f.journal].push(lock);const before=JSON.stringify(f.tables),rows=await f.read('NCT',f.staff);
 assert.deepEqual(rows.NCTActivity.find(r=>r._id===id),{_id:id,company:'NCT',owner:'REQUEST',attempt:'ATTEMPT'});
 assert.equal(JSON.stringify(f.tables),before);
 for(const patch of [{_id:'FOREIGN'},{company:'GHR'},{attempt:''},{action:'PURCHASE_OPERATION_LOCK'},{details:{owner:'REQUEST'}}])
  assert.throws(()=>f.store.normalizeListedRow(f.journal,{...lock,...patch}));
});
