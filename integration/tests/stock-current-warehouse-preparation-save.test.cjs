const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentWarehousePreparationSave}=require('../prototypes/stock-current-state/current-warehouse-preparation-save.cjs');
const {readCurrentPurchaseProjection}=require('../prototypes/stock-current-state/purchase-current-projection.cjs');
const {currentWarehouseReadyContext}=require('../prototypes/stock-current-state/current-warehouse-ready-context.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const file=require.resolve('./stock-current-purchase-projection.test.cjs'),copy=value=>JSON.parse(JSON.stringify(value));
const original=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
 {require:createRequire(file),__dirname:path.dirname(file),Map,Buffer});
async function fixture(){
 const f=await original(),paired=load('../prototypes/stock-current-state/warehousePreparation.candidate.js');let grants=0,contexts=0,approved=true;
 const authenticateOriginalWarehouse=async()=>{grants++;const member=await f.deps.readMember();return load('warehouseReceiving.js').requireWarehouseStaff(member,approved?[{
  title:'W',description:member._id,staffEmail:member.loginEmail,staffName:'Warehouse',staffStatus:'ACTIVE',departments:['WAREHOUSE']}]:[]);};
 const readCurrentContext=async(company,staff,control)=>{
  contexts++;for(const row of f.db.values())if(row.action==='WAREHOUSE_PREPARATION_SAVED'&&!f.originalArguments.activity.some(event=>event.title===row.title))f.originalArguments.activity.push(copy(row));
  f.context.activity=f.originalArguments.activity;
  const current=await readCurrentPurchaseProjection({...f.args,company,staff,control,readPreparation:paired.readPreparation,projectPreparation:paired.projectPreparation});
  return{workspace:current.workspace,originalContext:f.context,products:current.products,tables:{PurchaseOrders:[]}};
 };
 const deps={...f.deps,company:'NCT',store:f.store,items:f.items,protocol:f.protocol,coverage:Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])),
  authenticateOriginalWarehouse,readCurrentContext,...paired,currentReadyVersion:paired.WAREHOUSE_CURRENT_READY_VERSION,
  now:()=>new Date('2026-10-22T09:00:00Z')};
 const quote=async taskId=>{const staff=await authenticateOriginalWarehouse(),snapshot=await f.protocol.readSnapshot(async control=>{
  const data=await readCurrentContext('NCT',staff,control),context=currentWarehouseReadyContext({context:{...data.workspace,activity:data.originalContext.activity},
   states:[...data.products.values()].map(product=>product.state),requiredTaskIds:['A','B'],readAllocations:f.deps.readAllocations,readCustomerShipments:f.deps.readCustomerShipments});
  return paired.projectPreparation(context).find(row=>row.taskId===taskId);});return{row:snapshot.rows,generation:snapshot.generation};};
 let ids=0;const command=async(input,taskId='B')=>{const{row,generation}=await quote(taskId);return{requestId:'33333333-3333-4333-8333-'+String(++ids).padStart(12,'0'),
  input:{id:row.id,version:row.version,...input},stockProtocol:1,stockBuild:'TEST',stockGeneration:generation};};
 const save=createCurrentWarehousePreparationSave(deps),complete=async request=>{let result,attempts=0;
  do{result=await save(request);assert.ok(attempts++<40);}while(result.pending);return result;};
 return{...f,deps,quote,command,save,complete,revoke:()=>{approved=false;},counts:()=>({grants,contexts})};
}
test('current PACK/LOAD/unload/UNPACK keep original validators/events, same-request replay and physical stock unchanged',async()=>{
 const f=await fixture(),before=[...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE').map(row=>copy(row));
 const actions=[{action:'PACK'},{action:'LOAD',loaded:40,note:'Container full'},{action:'LOAD',loaded:0,note:'Unload correction'},{action:'UNPACK',note:'Reverse preparation'}];
 for(const [index,input]of actions.entries()){
  const request=await f.command(input),result=await f.complete(request);assert.equal(result.stockGeneration,index+1);assert.equal(result.id,request.input.id);
  assert.deepEqual(copy(await f.complete(request)),copy(result));const read=await f.quote('B');assert.equal(read.row.loaded,input.loaded||0);
  assert.deepEqual([...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE').map(row=>copy(row)),before);
 }
 assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED').length,4);
 assert.equal([...f.db.values()].some(row=>row.action==='CUSTOMER_SHIPMENT_CHANGED'),false);
 const request=await f.command({action:'PACK'});await f.complete(request);f.revoke();await assert.rejects(f.save(request),/configured/);
});
test('borrowed but insufficient ownership cannot PACK full demand; no other customer stock or physical dispatch invented',async()=>{
 const f=await fixture();await f.borrow();const request=await f.command({action:'PACK'},'A'),before=JSON.stringify([...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE'));
 await assert.rejects(f.save(request),/insufficient/);assert.equal(JSON.stringify([...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE')),before);
 assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED').length,0);
 assert.equal((await f.quote('A')).row.readyStock,30);assert.equal((await f.quote('B')).row.readyStock,70);
});
test('photo/file actions, missing all-writer coverage, stale form, partial-load reason and UNPACK while loaded fail without a legacy apply',async()=>{
 const f=await fixture();assert.throws(()=>createCurrentWarehousePreparationSave({...f.deps,currentReadyVersion:1}),/Paired/);
 for(const input of [{action:'PHOTOS'},{action:'PACK',photos:[{base64:'X'}]},{action:'PACK',photos:null}]){
  const before=f.counts();await assert.rejects(f.save({input}),/non-photo/);assert.deepEqual(f.counts(),before);
 }
 const request=await f.command({action:'PACK'});await assert.rejects(createCurrentWarehousePreparationSave({...f.deps,coverage:{}})(request),/coverage/);
 await assert.rejects(f.save({...request,input:{...request.input,version:'STALE'}}),/changed/);
 await f.complete(request);await assert.rejects(f.save(await f.command({action:'LOAD',loaded:40})),/explain partial/);
 await f.complete(await f.command({action:'LOAD',loaded:40,note:'Container full'}));
 await assert.rejects(f.save(await f.command({action:'UNPACK',note:'No'})),/unload first/);
 assert.equal((await f.quote('B')).row.loaded,40);
});
test('paired current photo PACK/PHOTOS/LOAD reuse actual original validation, frozen slots, current holds and once-only physical stock',async()=>{
 const f=await fixture(),{createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs'),
  {createWarehousePhotoFencedStore}=require('../prototypes/stock-current-state/warehouse-photo-fenced-store.cjs'),crypto=require('node:crypto');
 const commands=[],allocated=[],files=new Map();let lost=false,renamed=false;
 const documentService=async command=>{commands.push(copy(command));const old=files.get(command.fileId);if(old)assert.deepEqual(old,copy(command));else files.set(command.fileId,copy(command));
  const receipt={ok:true,...command};delete receipt.base64;if(lost){lost=false;throw Error('Lost actual photo reply');}return receipt;};
 const save=createCurrentWarehousePreparationSave({...f.deps,authenticateOriginalWarehouse:async()=>({...await f.deps.authenticateOriginalWarehouse(),staffName:renamed?'Warehouse Renamed':'Warehouse'}),
  createPhotoProtocol:({request,staff})=>({...createSegmentedFencedProof({company:'NCT',domainWrites:true,stepsPerInvocation:1,
    store:createWarehousePhotoFencedStore({company:'NCT',staff,request,store:f.store,documentService})}),readSnapshot:f.protocol.readSnapshot}),
  allocatePhotoSlots:async count=>{const slots=Array.from({length:count},()=> 'actual-original-slot-'+String(allocated.length+1).padStart(5,'0'));allocated.push(...slots);return slots;}});
 const bytes=Buffer.from([255,216,255,...Array(20).fill(2)]),photo={mimeType:'image/jpeg',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const complete=async request=>{for(let index=0;index<50;index++){const result=await save(request);if(result.ok)return result;}throw Error('Photo did not finish');};
 const physical=()=>JSON.stringify([...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE'));
 const before=physical(),request=await f.command({action:'PACK',photos:[photo],photoStage:'PACKING'}),actor=await f.deps.authenticateOriginalWarehouse();request.stockIdentity={staffId:actor.staffId,memberId:actor.memberId};lost=true;
 await assert.rejects(complete(request),/Lost actual photo/);assert.ok((await f.protocol.readControl()).pending);assert.equal(allocated.length,1);renamed=true;
 await complete(request);assert.equal(physical(),before);assert.equal(allocated.length,1);assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);
 const calls=commands.length;await complete(request);assert.equal(commands.length,calls);assert.equal(allocated.length,1);
 await complete(await f.command({action:'PHOTOS',photos:[photo],photoStage:'PACKING'}));
 await complete(await f.command({action:'LOAD',loaded:40,note:'Container full',photos:[photo],photoStage:'LOADING'}));
 const read=await f.quote('B');assert.equal(read.row.loaded,40);assert.equal(read.row.photos.length,3);assert.equal(physical(),before);assert.equal(files.size,3);
 assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_PHOTO_CONFIRMED').length,3);
 await complete(await f.command({action:'PHOTOS',note:'Original note-only evidence update'}));assert.equal(files.size,3);assert.equal(allocated.length,3,'empty original PHOTOS remains no-file, even when the request omits photos');
 const allocations=allocated.length;await assert.rejects(save(await f.command({action:'PHOTOS',photos:[{...photo,sha256:'0'.repeat(64)}],photoStage:'PACKING'})),/content/);assert.equal(allocated.length,allocations,'original file validation occurs before external generated IDs');
});
