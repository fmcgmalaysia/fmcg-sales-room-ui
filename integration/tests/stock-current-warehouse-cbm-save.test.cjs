const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createCurrentWarehouseCbmSave}=require('../prototypes/stock-current-state/current-warehouse-cbm-save.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {createWarehouseCbmCapture,warehouseCbm}=load('warehouseCbm.js'),copy=value=>JSON.parse(JSON.stringify(value));
async function fixture(company='NCT',stepsPerInvocation=100){
 const rows=new Map(),journal=company==='NCT'?'NCTActivity':'NCTActivity1',calls=[];
 let actor={staffId:'W',memberId:'M',staffName:'Warehouse'},approved=true,lost=false;
 const store={read:async(c,id)=>copy(rows.get(c+'/'+id)||null),insert:async(c,row)=>{
  assert.equal(rows.has(c+'/'+row._id),false);rows.set(c+'/'+row._id,copy(row));
  if(lost&&row.action==='WAREHOUSE_CBM_CAPTURED'){lost=false;throw Error('Lost CBM insert reply');}return copy(row);
 },compareAndSet:async(c,id,version,row)=>{assert.equal(rows.get(c+'/'+id)?._version,version);rows.set(c+'/'+id,copy(row));return copy(row);},
 compareAndRemove:async(c,id,attempt)=>{assert.equal(rows.get(c+'/'+id)?.attempt,attempt);rows.delete(c+'/'+id);}};
 const protocol=createSegmentedFencedProof({company,store,domainWrites:true,stepsPerInvocation});await protocol.initialize();
 const control=rows.get(journal+'/'+protocol.ids.controlId);Object.assign(control,{mode:'ACTIVE',schemaVersion:1,writerBuild:'TEST'});
 const task={id:'a'.repeat(32),taskId:'a'.repeat(32),orderId:'O',sourceLineId:'L',barcode:'00123',dispatched:0,orphaned:false,cbmPerCtn:null};
 let value={unitBarcode:'00123',cbmPerCtn:.025,capturedAt:'2026-10-18T00:00:00Z',source:{sheetName:'FOOD',row:3},costIssues:['UNAVAILABLE_LPCTN']};
 const deps={company,store,protocol,coverage:Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])),
  authenticateOriginalWarehouse:async()=>{calls.push('AUTH');if(!approved)throw Error('Original Warehouse role revoked');return copy(actor);},
  readCurrentOrders:async()=>{calls.push('ORDERS');return{company,staff:copy(actor),stockCurrent:{schema:'CURRENT_WAREHOUSE_V2',stockBuild:'TEST',stockGeneration:control.generation},
   deliveryTasks:[{...task,cbmPerCtn:warehouseCbm(company,task,[...rows.values()])}]};},createWarehouseCbmCapture,
  captureCosts:async barcodes=>{calls.push('POINTBASE');assert.deepEqual(copy(barcodes),['00123']);return{'00123':copy(value)};},now:()=>new Date('2026-10-22T11:00:00Z')};
 const request={requestId:'aaaaaaaa-1111-4111-8111-111111111111',input:{taskId:task.id},stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}};
 const save=createCurrentWarehouseCbmSave(deps),complete=async r=>{for(let i=0;i<30;i++){const result=await save(r);if(!result.pending)return result;}throw Error('Bounded CBM test did not finish');};
 return{company,journal,rows,calls,store,protocol,control,task,deps,request,save,complete,setActor:next=>actor=next,revoke:()=>approved=false,
  setValue:patch=>value={...value,...patch},lose:()=>lost=true,event:()=>rows.get(journal+'/'+hash(company,task.id,'WAREHOUSE_CBM_CAPTURED'))};
}
test('both-company original missing CBM creates only one immutable supplement, retains original source and no physical/cost/product changes',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await fixture(company),task=copy(f.task),request=copy(f.request);f.lose();
  const result=await f.complete(request);assert.equal(result.ok,true);assert.equal(result.company,company);assert.equal(result.stockGeneration,1);assert.equal(result.cbmPerCtn,.025);
  assert.deepEqual(f.task,task);assert.deepEqual(request,f.request);assert.equal(f.event().description,'O');assert.equal(f.event().imageAltText,task.id);
  assert.deepEqual(f.event().details.source,{sheetName:'FOOD',row:3});assert.equal(f.event().activityTime,'2026-10-22T11:00:00.000Z');
  assert.equal([...f.rows.keys()].every(key=>key.startsWith(f.journal+'/')),true,'no Products/Positions/Claims/source task or money write');
  const before=JSON.stringify([...f.rows]);f.setValue({cbmPerCtn:.1});assert.deepEqual(await f.complete(request),result);
  assert.equal(f.calls.filter(call=>call==='POINTBASE').length,1);assert.equal(JSON.stringify([...f.rows]),before);assert.equal((await f.protocol.readControl()).pending,null);
 }
});
test('known CBM is an authenticated same-checkpoint read: stale form allowed without POINTBASE, journal row or generation bump',async()=>{
 const f=await fixture();f.task.cbmPerCtn=.02;f.control.generation=8;const before=JSON.stringify([...f.rows]);
 const result=await f.save(f.request);assert.equal(result.retained,true);assert.equal(result.cbmPerCtn,.02);assert.equal(result.stockGeneration,8);
 assert.equal(f.calls.includes('POINTBASE'),false);assert.equal(JSON.stringify([...f.rows]),before);assert.equal(f.request.stockGeneration,0);
 const blocked=await fixture();blocked.task.cbmPerCtn=.02;delete blocked.deps.coverage.RECEIPT;
 await assert.rejects(blocked.save(blocked.request),/coverage/);assert.equal(blocked.calls.includes('ORDERS'),false);
});
test('bounded phases retain original CBM plan and identity despite visible event; no early retained success or repeated POINTBASE',async()=>{
 const f=await fixture('NCT',1),first=await f.save(f.request);assert.equal(first.pending,true);
 assert.ok((await f.protocol.readControl()).pending);assert.equal(first.cbmPerCtn,undefined);
 await assert.rejects(f.protocol.readSnapshot(()=>null),/pending/);
 f.setValue({cbmPerCtn:.9});let sawEvent=false,result;
 for(let i=0;i<20;i++){result=await f.save(f.request);if(f.event()&&result.pending){sawEvent=true;assert.equal(result.retained,undefined);assert.equal(result.cbmPerCtn,undefined);}if(result.ok)break;}
 assert.equal(sawEvent,true);assert.equal(result.ok,true);assert.equal(result.cbmPerCtn,.025);assert.equal(f.calls.filter(call=>call==='POINTBASE').length,1);
});
test('reissued staff cannot adopt prepared CBM request even by changing expected identity; original staff resumes immutable plan',async()=>{
 const f=await fixture('NCT',1);await f.save(f.request);f.setActor({staffId:'W2',memberId:'M',staffName:'Replacement'});
 await assert.rejects(f.save(f.request),/identity/);
 await assert.rejects(f.save({...f.request,stockIdentity:{staffId:'W2',memberId:'M'}}),/pending|identity/);
 assert.equal(f.event(),undefined);f.setActor({staffId:'W',memberId:'M',staffName:'Renamed Warehouse'});
 assert.equal((await f.complete(f.request)).ok,true);assert.equal(f.event().initiatedByStaffName,'Warehouse');
 f.revoke();await assert.rejects(f.save(f.request),/revoked/);
});
test('invalid original CBM sources, no current task and stale writable requests refuse without legacy/save side effects',async()=>{
 for(const patch of [{cbmPerCtn:0},{cbmPerCtn:null},{unitBarcode:'OTHER'},{source:null},{costIssues:['DUPLICATE_BARCODE']}]){
  const f=await fixture(),before=JSON.stringify([...f.rows]);f.setValue(patch);await assert.rejects(f.save(f.request),/unavailable/);
  assert.equal(JSON.stringify([...f.rows]),before);
 }
 for(const patch of [{dispatched:1},{orphaned:true}]){
  const f=await fixture();Object.assign(f.task,patch);await assert.rejects(f.save(f.request),/unavailable/);assert.equal(f.calls.includes('POINTBASE'),false);
 }
 const f=await fixture();f.control.generation=1;await assert.rejects(f.save(f.request),/Stock form changed/);assert.equal(f.event(),undefined);
});
test('closed mode/build/coverage, other identity and malformed envelopes fail before native task or POINTBASE access',async()=>{
 for(const patch of [{mode:'LEGACY'},{mode:'SHADOW'},{mode:'MAINTENANCE'},{writerBuild:'OTHER'},{company:'GHR'},{schemaVersion:2}]){
  const f=await fixture();Object.assign(f.control,patch);await assert.rejects(f.save(f.request));assert.equal(f.calls.includes('ORDERS'),false);
 }
 for(const patch of [{stockIdentity:{staffId:'W',memberId:'OTHER'}},{stockIdentity:{staffId:'W',memberId:'M',approved:true}},
  {input:{taskId:'OTHER'}},{input:{taskId:'a'.repeat(32),approved:true}},{stockProtocol:2},{stockGeneration:-1}]){
  const f=await fixture();await assert.rejects(f.save({...f.request,...patch}));assert.equal(f.calls.includes('ORDERS'),false);
 }
});
