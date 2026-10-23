const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const {createCurrentPackingService}=require('../prototypes/stock-current-state/current-packing-service.cjs');
const {createPackingPhotoFencedStore}=require('../prototypes/stock-current-state/packing-photo-fenced-store.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter}=require('../prototypes/stock-current-state/current-warehouse-receipt-router.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const filename=require.resolve('./stock-current-packing-service-v2.test.cjs');
const original=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',
 {require:createRequire(filename),Map});
async function fixture(coverage=true){
 const f=await original(),calls=[];
 f.db.set('NCTTasks:T',{_id:'T',company:'NCT',description:'O',imageAltText:'L',_version:'T0',stockCounterSchema:2,stockDispatchedCumulative:0,stockCounterGeneration:0});
 const bindings={...f.deps,...load('../prototypes/stock-current-state/warehousePreparation.candidate.js'),
  items:f.deps.items,createCurrentPackingService,createPackingPhotoFencedStore,planCollections,PURCHASE_CURRENT_PROJECTION_VERSION:2,
  currentMember:{getMember:async()=>{calls.push('MEMBER');return f.deps.readMember();}},
  fulfilmentStore:{all:async collection=>{calls.push(collection);if(collection==='StaffMasterAccess')return f.deps.readStaffRecords();if(collection==='PurchaseOrders')return[];throw Error('Unscoped table');}},
  readFulfilmentContext:async(...args)=>{calls.push('CONTEXT');return f.deps.readContext(...args);},
  createSdkConditionalStore:configuration=>{calls.push('SDK');assert.equal(configuration.company,'NCT');assert.deepEqual(copy(configuration.dateTimeFields),{NCTActivity:['activityTime'],NCTOrders:['masterReceivedTime','salesSubmissionTime'],NCTTasks:['lastCostCaptureTime']});return f.store;},
  requestPurchaseDocument:async command=>{calls.push(command.action);if(command.action==='ALLOCATE')return{ok:true,fileId:'original-root-packing-slot-'+String(calls.length).padStart(5,'0')};const receipt={ok:true,...command};delete receipt.base64;return receipt;},
  createSegmentedFencedProof:configuration=>{assert.equal(configuration.company,'NCT');assert.equal(configuration.domainWrites,true);if(configuration.stepsPerInvocation===1){assert.notEqual(configuration.store,f.store);return createSegmentedFencedProof(configuration);}return f.protocol;}};
 let source=fs.readFileSync(path.join(folder,'stockCurrentPacking.js'),'utf8');
 if(coverage)source=source.replace('const writerCoverage=Object.freeze({});','const writerCoverage=Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
 const create=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return createCurrentMasterPacking;})()',bindings);
 const authenticate=async department=>load('packingListContext.js').requirePackingStaff(await f.deps.readMember(),await f.deps.readStaffRecords(),department);
 const root=department=>create({company:'NCT',department,authenticateOriginalPacking:()=>authenticate(department)});
 return{...f,calls,root,create,authenticate};
}
test('actual-import private packing root Support SEND then Warehouse START uses original shared list and current stock holds, not physical movement',async()=>{
 const f=await fixture(),physical=JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:')));
 const support=await f.root('SUPPORT'),read=await support.read();assert.equal(read.tasks[0].ready,50);assert.equal(read.staff.staffId,'S');assert.equal(read.department,'SUPPORT');
 const request={requestId:f.request.requestId,stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'S',memberId:'M'},input:{action:'SEND',id:'LIST',revision:'REV0',version:read.version}};
 assert.equal((await support.save(request)).ok,true);assert.equal((await support.save(request)).stockGeneration,1);
 const warehouse=await f.root('WAREHOUSE'),outgoing=await warehouse.read();assert.equal(outgoing.lists[0].status,'SENT');assert.equal(outgoing.tasks.length,0);
 const started=await warehouse.save({...request,requestId:'22222222-2222-4222-8222-222222222222',stockGeneration:1,input:{action:'START',id:'LIST',revision:outgoing.lists[0].revision,version:outgoing.version}});
 assert.equal(started.stockGeneration,2);assert.equal((await warehouse.read()).lists[0].status,'PROCESSING');
 assert.equal(JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:'))),physical);
 assert.equal([...f.db.values()].some(row=>row.action==='CUSTOMER_SHIPMENT_CHANGED'),false);
});
test('private packing root retains closed coverage, original department/actor, bounded files and no-invoice boundaries',async()=>{
 const f=await fixture(false),root=await f.root('SUPPORT');await assert.rejects(root.read(),/coverage/);assert.equal(f.calls.includes('CONTEXT'),false);
 const approved=await fixture(),support=await approved.root('SUPPORT'),read=await support.read(),request={requestId:approved.request.requestId,stockProtocol:1,stockBuild:'TEST',stockGeneration:0,
  stockIdentity:{staffId:'S',memberId:'M'},input:{action:'PHOTOS'}};
 await assert.rejects(async()=>support.save(request),/bounded/);await assert.rejects(async()=>support.save({...request,input:{action:'INVOICE',id:'LIST',revision:'REV0',version:read.version}}));
 await assert.rejects(async()=>support.save({...request,input:{action:'SEND'},approved:true}),/bounded/);
 await assert.rejects(async()=>support.save({...request,input:{action:'SEND'},stockIdentity:{staffId:'OTHER',memberId:'M'}}),/bounded/);
 approved.deps.readMember=async()=>({_id:'M',loginEmail:'support@example.test',status:'PENDING'});await assert.rejects(approved.root('SUPPORT'));assert.equal((await approved.protocol.readControl()).generation,0);
});
test('actual-import private root reuses original document client and bounded packing PHOTOS without changing Packed, Loaded or physical positions',async()=>{
 const f=await fixture(),support=await f.root('SUPPORT'),initial=await support.read(),identity={staffId:'S',memberId:'M'};
 await support.save({requestId:'33333333-3333-4333-8333-333333333330',stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:identity,input:{action:'SEND',id:'LIST',revision:'REV0',version:initial.version}});
 const warehouse=await f.root('WAREHOUSE');let read=await warehouse.read();
 await warehouse.save({requestId:'33333333-3333-4333-8333-333333333331',stockProtocol:1,stockBuild:'TEST',stockGeneration:1,stockIdentity:identity,input:{action:'START',id:'LIST',revision:read.lists[0].revision,version:read.version}});
 read=await warehouse.read();await warehouse.save({requestId:'33333333-3333-4333-8333-333333333332',stockProtocol:1,stockBuild:'TEST',stockGeneration:2,stockIdentity:identity,input:{action:'PROGRESS',id:'LIST',revision:read.lists[0].revision,version:read.version,lines:[{taskId:'T',packed:50,loaded:40,reason:'Container full'}]}});
 read=await warehouse.read();const crypto=require('node:crypto'),bytes=Buffer.from([255,216,255,...Array(20).fill(2)]),photo={mimeType:'image/jpeg',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const physical=JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:'))),request={requestId:'33333333-3333-4333-8333-333333333333',stockProtocol:1,stockBuild:'TEST',stockGeneration:3,stockIdentity:identity,
  input:{action:'PHOTOS',id:'LIST',revision:read.lists[0].revision,version:read.version,taskId:'T',photoStage:'LOADING',photos:[photo]}};
 let result;for(let i=0;i<30;i++){const before=f.calls.filter(call=>call==='PHOTO_UPLOAD').length;result=await warehouse.save(request);assert.ok(f.calls.filter(call=>call==='PHOTO_UPLOAD').length-before<=1);if(result.ok)break;}
 assert.equal(result.ok,true);assert.equal(result.stockGeneration,4);assert.equal(f.calls.filter(call=>call==='ALLOCATE').length,1);assert.equal(f.calls.filter(call=>call==='PHOTO_UPLOAD').length,1);
 const line=(await warehouse.read()).lists[0].lines[0];assert.equal(line.photos.length,1);assert.equal(line.packed,50);assert.equal(line.loaded,40);
 assert.equal(JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:'))),physical);assert.equal(JSON.stringify([...f.db]).includes(photo.base64),false);
});
test('original two-method packing web gateway authenticates before mode; own recovery returns no stock even behind pending',async()=>{
 async function fixtureGateway(mode='ACTIVE',approved=true){
  const calls=[],control={_id:hash('NCT','STOCK_CONTROL'),company:'NCT',stockCommitVersion:'C',mode,schemaVersion:1,generation:2,pending:null};
  const bindings={Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(grant,fn)=>{assert.equal(grant,'SITE_MEMBER');return fn;},
   currentMember:{getMember:async()=>{calls.push('MEMBER');return{_id:'M',loginEmail:'s@example.test',status:approved?'APPROVED':'PENDING'};}},
   fulfilmentStore:{all:async collection=>{assert.equal(collection,'StaffMasterAccess');calls.push('STAFF');return[{title:'S',description:'M',staffEmail:'s@example.test',staffName:'Support',staffStatus:'ACTIVE',departments:['SUPPORT']}];},
    read:async(collection,id)=>{assert.equal(collection,'NCTActivity');assert.equal(id,control._id);calls.push('CONTROL');return control;}},
   requirePackingStaff:load('packingListContext.js').requirePackingStaff,operationId:hash,PURCHASE_COLLECTIONS:{NCT:{activity:'NCTActivity'}},createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter,
   createCurrentMasterPacking:async configuration=>{calls.push('ROOT');const staff=await configuration.authenticateOriginalPacking();assert.equal(staff.staffId,'S');return{read:async()=>{calls.push('CURRENT_READ');return{current:true};},save:async request=>{calls.push('CURRENT_SAVE');return{current:true,...request};}};},
   readPackingWorkroom:async()=>{calls.push('LEGACY_READ');return{legacy:true};},savePackingOperation:async()=>{calls.push('LEGACY_SAVE');return{legacy:true};}};
  const source=fs.readFileSync(path.join(folder,'packingLists.web.candidate.js'),'utf8');
  const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{getPackingLists,savePackingList};})()',bindings);
  return{calls,api,control};
 }
 const active=await fixtureGateway();assert.equal((await active.api.getPackingLists('NCT','SUPPORT')).current,true);assert.deepEqual(active.calls.slice(0,3),['MEMBER','STAFF','CONTROL']);
 assert.equal((await active.api.savePackingList('NCT','SUPPORT','ID',{}, {stockProtocol:1,stockBuild:'TEST',stockGeneration:2,stockIdentity:{staffId:'S',memberId:'M'}})).stockGeneration,2);
 assert.equal(active.calls.includes('LEGACY_READ'),false);assert.equal(active.calls.includes('LEGACY_SAVE'),false);
 const legacy=await fixtureGateway('LEGACY');assert.equal((await legacy.api.getPackingLists('NCT','SUPPORT')).legacy,true);assert.equal((await legacy.api.savePackingList('NCT','SUPPORT','ID',{})).legacy,true);assert.equal(legacy.calls.includes('ROOT'),false);
 for(const mode of ['MAINTENANCE','SHADOW','BAD']){const f=await fixtureGateway(mode);await assert.rejects(f.api.getPackingLists('NCT','SUPPORT'));assert.equal((await f.api.savePackingList('NCT','SUPPORT','ID',{})).ok,false);assert.equal(f.calls.includes('ROOT'),false);assert.equal(f.calls.includes('LEGACY_SAVE'),false);}
 const denied=await fixtureGateway('ACTIVE',false);await assert.rejects(denied.api.getPackingLists('NCT','SUPPORT'));assert.equal(denied.calls.includes('CONTROL'),false);
 const recovery=await fixtureGateway();recovery.control.pending={key:'PENDING'};const before=recovery.calls.length;
 const result=await recovery.api.getPackingLists('NCT','SUPPORT',{resume:'PACKING_V1'});assert.equal(result.schema,'PACKING_RESUME_CONTEXT_V1');assert.equal(result.staff.staffId,'S');assert.equal(result.stockCurrent,undefined);
 assert.deepEqual(recovery.calls.slice(before),['MEMBER','STAFF']);await assert.rejects(recovery.api.getPackingLists('NCT','WAREHOUSE',{resume:'PACKING_V1'}));
});
test('packing private root and original exact gateway generation are reproducible; original staff and validation catch unchanged',()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-master-packing-current.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(__dirname,'../backend/packingLists.web.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'packingLists.web.candidate.js'),'utf8');
 const staff=original.match(/async function staffContext[^\n]+/)[0];assert.equal(candidate.includes(staff),true);
 assert.equal(candidate.slice(candidate.indexOf(' catch(error)')),original.slice(original.indexOf(' catch(error)')));
 assert.equal((candidate.match(/webMethod\(Permissions.SiteMember/g)||[]).length,2);
 assert.equal(/webMethod\(|Permissions\./.test(fs.readFileSync(path.join(folder,'stockCurrentPacking.js'),'utf8')),false);
});
