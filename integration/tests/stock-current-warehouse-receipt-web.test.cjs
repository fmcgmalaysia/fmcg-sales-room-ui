const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),{stockKey}=require('../prototypes/stock-current-state/current-model.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {createCurrentWarehouseReceiptSave}=require('../prototypes/stock-current-state/current-department-saves.cjs');
const {createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter}=require('../prototypes/stock-current-state/current-warehouse-receipt-router.cjs');
const {createCurrentWarehouseOrdersRead}=require('../prototypes/stock-current-state/current-warehouse-orders-read.cjs');
const {createCurrentWarehousePreparationSave}=require('../prototypes/stock-current-state/current-warehouse-preparation-save.cjs');
const {createCurrentWarehouseCbmSave}=require('../prototypes/stock-current-state/current-warehouse-cbm-save.cjs');
const {createWarehousePhotoFencedStore}=require('../prototypes/stock-current-state/warehouse-photo-fenced-store.cjs');
const {readCurrentPurchaseProjection}=require('../prototypes/stock-current-state/purchase-current-projection.cjs');
const {createCurrentPurchaseTables}=require('../prototypes/stock-current-state/current-purchase-tables.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
async function fixture(company='NCT',coverage=true,productCount=2,stepsPerInvocation=100){
  const filename=require.resolve('./stock-current-warehouse-authority.test.cjs');
  const original=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')
    .replaceAll("'NCT'",'company')+';fixture;',{require:createRequire(filename),company});
  const f=original(),db=new Map(),calls=[],journal=company==='NCT'?'NCTActivity':'NCTActivity1',tasks=company==='NCT'?'NCTTasks':'NCTTasks1';
  if(productCount!==2){const first=copy(f.context.tasks[0]);f.context.tasks=Array.from({length:productCount},(_,i)=>({...copy(first),id:'T'+i,sourceLineId:'L'+i,barcode:String(i)}));}
  const store={normalizeListedRow:(_c,row)=>copy(row),read:async(c,id)=>copy(db.get(c+'/'+id)||null),insert:async(c,row)=>{
    assert.equal(db.has(c+'/'+row._id),false);db.set(c+'/'+row._id,copy(row));return copy(row);
  },compareAndSet:async(c,id,version,row)=>{assert.equal(db.get(c+'/'+id)?._version,version);db.set(c+'/'+id,copy(row));return copy(row);},
  compareAndRemove:async(c,id,attempt)=>{assert.equal(db.get(c+'/'+id)?.attempt,attempt);db.delete(c+'/'+id);}};
  const protocol=createSegmentedFencedProof({company,store,domainWrites:true,stepsPerInvocation});await protocol.initialize();
  Object.assign(db.get(journal+'/'+protocol.ids.controlId),{mode:'ACTIVE',schemaVersion:1,writerBuild:'TEST',transferIndexVersion:2});
  for(const task of f.context.tasks){
    db.set(tasks+'/'+task.id,{_id:task.id,title:task.id,company,description:task.orderId,imageAltText:task.sourceLineId,_version:'T0',
      stockCounterSchema:2,stockDispatchedCumulative:0,stockCounterGeneration:0});
    const key=stockKey(task),id=hash(company,key);
    db.set('StockProducts/'+id,{_id:id,company,stockKey:key,_version:'P0',revision:0,checkpointGeneration:0,lifecycleVersion:2,
      nextBorrowSequence:1,status:'CLOSED',reviewCodes:[],reviewRequired:false,onHand:0,reservedUsable:0,available:0,isolated:0});
  }
  const items={query:c=>{const filters=[];let limit=50,offset=0;const q={eq:(k,v)=>{filters.push(row=>Array.isArray(row[k])?row[k].includes(v):row[k]===v);return q;},
    gt:(k,v)=>{filters.push(row=>row[k]>v);return q;},ascending:()=>q,skip:n=>{offset=n;return q;},limit:n=>{limit=n;return q;},find:async()=>{
      const rows=[...db].filter(([key,row])=>key.startsWith(c+'/')&&filters.every(fn=>fn(row))).map(([,row])=>copy(row)).sort((a,b)=>a._id.localeCompare(b._id));
      return{items:rows.slice(offset,offset+limit),totalCount:rows.length};}};return q;}};
  const modules=['warehouseReceiving.js','purchaseOrderWorkflow.js','plannerAllocation.js','customerShipmentLedger.js','packingListOperations.js','packingListModel.js','warehousePreparation.js'];
  const bindings={...Object.assign({},...modules.map(name=>load(name))),planCollections,createCurrentWarehouseReceiptSave,
    createCurrentWarehouseOrdersRead,createCurrentWarehousePreparationSave,createCurrentWarehouseCbmSave,createWarehousePhotoFencedStore,createCurrentPurchaseTables,readCurrentPurchaseProjection,
    ...load('../prototypes/stock-current-state/warehousePreparation.candidate.js'),
    ...load('../prototypes/stock-current-state/purchaseProjection.candidate.js'),
    projectWarehouseCustomerReadiness:load('warehouseCustomerReadiness.js').projectWarehouseCustomerReadiness,
    ...load('warehouseCbm.js'),capturePointbaseCosts:async()=>{calls.push('POINTBASE');return{};},readCustomerShortNames:async()=>[],requestPurchaseDocument:async command=>{calls.push(command.action);return{ok:true,fileId:'root-original-file-'+calls.length};},
    Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(permission,fn)=>{assert.equal(permission,'SITE_MEMBER');return fn;},
    currentMember:{getMember:async()=>{calls.push('MEMBER');return f.deps.readMember();}},items,
    fulfilmentStore:{all:async c=>{calls.push(c);if(c==='StaffMasterAccess')return f.deps.readStaffRecords();
      if(['PurchaseOrders','SharedSuppliers',journal,tasks,company==='NCT'?'NCTOrders':'NCTOrders1'].includes(c))return [...db].filter(([key])=>key.startsWith(c+'/')).map(([,row])=>copy(row));throw Error('Unexpected full scan');}},
    readFulfilmentContext:async selected=>{calls.push('CONTEXT');assert.equal(selected,company);
      f.context.activity=[...db].filter(([key])=>key.startsWith(journal+'/')).map(([,row])=>copy(row));
      f.context.tasks.forEach(task=>{task.warehouse=load('warehouseReceiving.js').readWarehouseTask({title:task.id,description:task.orderId,imageAltText:task.sourceLineId,purchaseQtyInCtn:task.ord},f.context.activity);});
      return copy(f.context);},
    createSdkConditionalStore:args=>{calls.push('SDK');assert.equal(args.company,company);assert.deepEqual(copy(args.dateTimeFields),{[journal]:['activityTime']});return store;},
    createSegmentedFencedProof:args=>{assert.equal(args.company,company);assert.equal(args.domainWrites,true);if(args.stepsPerInvocation===1){assert.notEqual(args.store,store);return createSegmentedFencedProof(args);}return protocol;}};
  let source=fs.readFileSync(path.join(folder,'stockCurrentWarehouse.web.js'),'utf8');
  if(coverage)source=source.replace('const writerCoverage = Object.freeze({});','const writerCoverage = Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
  const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{saveWarehouseReceiptCurrent,saveWarehousePreparationCurrent,captureWarehouseCbmCurrent,getWarehouseOrdersCurrent,getWarehouseResumeContextCurrent};})()',bindings);
  const initial=f.request();delete initial.company;Object.assign(initial,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
  return{...f,db,store,items,protocol,api,initial,calls,journal,tasks,bindings};
}
test('actual-import Warehouse root preserves both-company original PO receipt contract and once-only scoped current stock',async()=>{
  for(const company of ['NCT','GHR']){
    const f=await fixture(company),result=await f.api.saveWarehouseReceiptCurrent(company,f.initial);
    assert.equal(result.ok,true);assert.equal(result.company,company);assert.equal(result.stockGeneration,1);
    assert.equal(result.poId,f.initial.input.id);assert.equal(result.receiptId,hash(company,f.initial.requestId,'M','WAREHOUSE_RECEIPT'));
    assert.ok(Number.isFinite(Date.parse(result.savedAt)));assert.equal(f.calls[0],'MEMBER');
    assert.deepEqual(copy(await f.api.saveWarehouseReceiptCurrent(company,f.initial)),copy(result));
    const rows=[...f.db.values()];assert.equal(rows.filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
    assert.equal(rows.filter(row=>row.sourceKind==='PURCHASE_SOURCE').reduce((n,row)=>n+row.onHand,0),200);
    assert.equal(f.calls.filter(call=>call==='CONTEXT').length,1,'completed replay reauthorizes without rebuilding receipt');
  }
});
test('partial receipt then remaining PO receipt retain original versions while accumulating one product summary per product',async()=>{
  const f=await fixture();f.initial.input.lines.forEach(line=>Object.assign(line,{accepted:40,kind:'PARTIAL',reason:'Remaining delivery later'}));
  const first=await f.api.saveWarehouseReceiptCurrent('NCT',f.initial);assert.equal(first.stockGeneration,1);
  const original=f.deps;f.context.activity=[...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED');
  f.context.tasks.forEach(task=>{task.warehouse=load('warehouseReceiving.js').readWarehouseTask({title:task.id,description:task.orderId,imageAltText:task.sourceLineId,purchaseQtyInCtn:100},f.context.activity);});
  const orders=original.projectWarehouseOrders({company:'NCT',purchaseOrders:original.projectPurchaseOrders({company:'NCT',workspace:f.context,records:[]}),tasks:f.context.tasks,activity:f.context.activity});
  const next=copy(f.initial);next.requestId='22222222-2222-4222-8222-222222222222';next.stockGeneration=1;next.input.version=orders[0].version;
  next.input.lines.forEach(line=>Object.assign(line,{accepted:60,kind:'DELIVERY',reason:'',resolveIssue:true}));
  const result=await f.api.saveWarehouseReceiptCurrent('NCT',next);assert.equal(result.stockGeneration,2);
  assert.equal([...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE').reduce((n,row)=>n+row.onHand,0),200);
  assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,2);
});
test('empty coverage, wrong metadata, original role revocation, bad envelope and over-approved PO never run legacy or create a receipt',async()=>{
  for(const variant of ['coverage','metadata','role','company','uuid','browserGrant','over','actor']){
    const f=await fixture('NCT',variant!=='coverage'),request=copy(f.initial);
    if(variant==='metadata')delete request.stockBuild;if(variant==='role')f.deps.readMember=async()=>({_id:'M',status:'PENDING'});
    if(variant==='uuid')request.requestId='BAD';if(variant==='browserGrant')request.approved=true;if(variant==='over')request.input.lines[0].accepted=101;
    if(variant==='actor')request.stockIdentity.memberId='OTHER';
    const result=await f.api.saveWarehouseReceiptCurrent(variant==='company'?'FOREIGN':'NCT',request);
    assert.equal(result.ok,false,variant);assert.equal([...f.db.values()].some(row=>row.action==='WAREHOUSE_RECEIPT_SAVED'),false,variant);
    if(['coverage','metadata','role','company','uuid','browserGrant','actor'].includes(variant))assert.equal(f.calls.includes('CONTEXT'),false,variant);
  }
  const f=await fixture();assert.equal((await f.api.saveWarehouseReceiptCurrent('NCT',f.initial)).ok,true);
  f.deps.readMember=async()=>({_id:'M',status:'PENDING'});assert.equal((await f.api.saveWarehouseReceiptCurrent('NCT',f.initial)).ok,false,'completed replay retains original role requirement');
});
test('original 300-line receipt executes bounded phases under SAME request and emits one final original receipt, never partial success',async()=>{
  const f=await fixture('NCT',true,300,20),identity=JSON.stringify(f.initial);let result,attempts=0,pending=0;
  do{
    result=await f.api.saveWarehouseReceiptCurrent('NCT',f.initial);assert.equal(JSON.stringify(f.initial),identity);
    assert.ok(attempts++<200,'bounded completion witness, not platform timeout acceptance');
    if(result.pending){pending++;assert.equal(result.ok,false);assert.equal(result.requestId,f.initial.requestId);
      assert.equal(result.receiptId,undefined);assert.equal(result.savedAt,undefined);
      await assert.rejects(f.protocol.readSnapshot(()=>assert.fail('mixed stock cannot be read')),/pending/);
    }
  }while(result.pending);
  assert.equal(result.ok,true);assert.equal(result.stockGeneration,1);assert.ok(pending>1);
  assert.equal([...f.db.values()].filter(row=>row.action==='WAREHOUSE_RECEIPT_SAVED').length,1);
  assert.equal([...f.db.values()].filter(row=>row.sourceKind==='PURCHASE_SOURCE').reduce((n,row)=>n+row.onHand,0),30000);
  assert.equal(f.calls.filter(call=>call==='CONTEXT').length,1,'all phases reuse one captured original receipt plan');
  assert.deepEqual(copy(await f.api.saveWarehouseReceiptCurrent('NCT',f.initial)),copy(result));
});
test('actual-import empty Warehouse workspace stays same-generation and read-only; closed coverage refuses before company tables while identity recovery remains authorized',async()=>{
  for(const company of ['NCT','GHR'])for(const coverage of [true,false]){
    const f=await fixture(company,coverage);
    for(const key of [...f.db.keys()])if(key.startsWith('StockProducts/')||key.startsWith(f.tasks+'/'))f.db.delete(key);
    const before=JSON.stringify([...f.db]);
    if(coverage){const result=await f.api.getWarehouseOrdersCurrent(company);assert.equal(result.stockCurrent.stockGeneration,0);
      assert.equal(result.orders.length,0);assert.equal(result.deliveryTasks.length,0);assert.equal(result.customerLines.length,0);
      assert.equal(f.calls.includes('CONTEXT'),false,'same native listed tables, not a second legacy context scan');
    }else{await assert.rejects(f.api.getWarehouseOrdersCurrent(company),/unavailable/);assert.equal(f.calls.includes(f.tasks),false);}
    assert.equal(JSON.stringify([...f.db]),before);
    const identity=await f.api.getWarehouseResumeContextCurrent(company);assert.equal(identity.schema,'WAREHOUSE_RESUME_CONTEXT_V1');
    assert.equal(identity.staff.memberId,'M');assert.equal(identity.stockCurrent,undefined,'auth-only endpoint grants no stock generation');
    f.deps.readMember=async()=>({_id:'M',status:'PENDING'});assert.equal((await f.api.getWarehouseResumeContextCurrent(company)).ok,false);
  }
});
test('receipt router uses server ACTIVE only and refuses unknown control/maintenance or legacy-current mismatch',async()=>{
  for(const company of ['NCT','GHR']){
    const calls=[],control={_id:hash(company,'STOCK_CONTROL'),company,stockCommitVersion:'C0',mode:'ACTIVE',schemaVersion:1,generation:3,pending:null};
    const route=createCurrentWarehouseReceiptRouter({company,readControl:async()=>control,saveCurrent:async(c,request)=>{calls.push('CURRENT');assert.equal(c,company);return request;},saveLegacy:async()=>{calls.push('LEGACY');return 'LEGACY';}});
    const request={requestId:'ID',input:{action:'RECEIVE'},stockCurrent:{stockProtocol:1,stockBuild:'B',stockGeneration:3}};
    assert.equal((await route(request)).stockGeneration,3);delete request.stockCurrent;
    await route(request);assert.deepEqual(calls,['CURRENT','CURRENT'],'missing metadata still goes only to guarded current save');
    control.mode='LEGACY';assert.equal(await route(request),'LEGACY');request.stockCurrent={stockProtocol:1};await assert.rejects(route(request),/mode changed/);
    for(const patch of [{mode:'SHADOW'},{mode:'MAINTENANCE'},{mode:'BAD'},{_id:'BAD'},{stockCommitVersion:''},{company:'FOREIGN'},{generation:-1}]){
      const before=calls.length,prior={...control};Object.assign(control,patch);await assert.rejects(route(request));assert.equal(calls.length,before);Object.assign(control,prior);
    }
  }
});
test('actual-import preparation root supplies paired current context/file factories and original Warehouse grant; closed coverage or invalid bounded files never reach old apply',async()=>{
  const f=await fixture(),request={...copy(f.initial),input:{action:'PACK',id:'BATCH',version:'V'}};let configuration;
  f.bindings.createCurrentWarehousePreparationSave=deps=>{configuration=deps;return async command=>{
    assert.equal((await deps.authenticateOriginalWarehouse()).staffId,'W');assert.deepEqual(copy(command),request);
    return{ok:false,pending:true,requestId:command.requestId,phase:'BEFORE',completedCount:0,totalRecords:2};
  };};
  const result=await f.api.saveWarehousePreparationCurrent('NCT',request);assert.equal(result.pending,true);
  assert.equal(configuration.protocol.planFormat,'SEGMENTED_V2');assert.equal(configuration.currentReadyVersion,2);
  assert.equal(typeof configuration.readCurrentContext,'function');assert.equal(typeof configuration.createPreparationOperations,'function');
  assert.equal(typeof configuration.createPhotoProtocol,'function');assert.equal(typeof configuration.allocatePhotoSlots,'function');
  const photoProtocol=configuration.createPhotoProtocol({request:{...request,input:{...request.input,photos:[]}},staff:{staffId:'W',staffName:'Warehouse',memberId:'M',canPrepareWarehouse:true}});
  assert.equal(photoProtocol.planFormat,'SEGMENTED_V2');assert.equal((await configuration.allocatePhotoSlots(2)).length,2);assert.equal(f.calls.filter(call=>call==='ALLOCATE').length,2);
  const closed=await fixture('NCT',false);assert.equal((await closed.api.saveWarehousePreparationCurrent('NCT',request)).ok,false);
  assert.equal(closed.calls.includes(closed.tasks),false,'actual common admission refuses before native listed tables');
  for(const input of [{action:'PHOTOS',id:'BATCH',photos:null},{action:'PACK',id:'BATCH',photos:[{},{},{},{}]}]){
    const count=f.calls.length;assert.equal((await f.api.saveWarehousePreparationCurrent('NCT',{...request,input})).ok,false);assert.equal(f.calls.length,count);
  }
});
test('actual original Warehouse wrapper authenticates before server mode read; ACTIVE calls only paired root and LEGACY calls only old save',async()=>{
  async function invoke(mode,approved=true){
    const calls=[],member={_id:'M',loginEmail:'w@example.test',status:approved?'APPROVED':'PENDING'},
      control={_id:hash('NCT','STOCK_CONTROL'),company:'NCT',stockCommitVersion:'V',mode,schemaVersion:1,generation:0,pending:null};
    const bindings={Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(_grant,fn)=>fn,currentMember:{getMember:async()=>{calls.push('MEMBER');return member;}},
      requireWarehouseStaff:load('warehouseReceiving.js').requireWarehouseStaff,createCurrentWarehouseReceiptRouter,createCurrentWarehouseOrdersRouter,operationId:hash,
      PURCHASE_COLLECTIONS:{NCT:{activity:'NCTActivity'}},createWarehouseOperations:()=>({save:async()=>{calls.push('LEGACY');return{ok:true,legacy:true};}}),
      createPreparationOperations:()=>async()=>{calls.push('LEGACY_PREP');return{ok:true,legacyPrep:true};},createWarehouseCbmCapture:()=>async()=>{calls.push('LEGACY_CBM');return{ok:true,legacyCbm:true};},requestPurchaseDocument:()=>{},capturePointbaseCosts:()=>{},
      saveWarehouseReceiptCurrent:async(company,request)=>{calls.push('CURRENT');assert.equal(company,'NCT');return{ok:true,current:true,stockGeneration:request.stockGeneration};},
      getWarehouseOrdersCurrent:async()=>{calls.push('CURRENT_READ');return{current:true};},
      saveWarehousePreparationCurrent:async()=>{calls.push('CURRENT_PREP');return{ok:true,currentPrep:true};},
      captureWarehouseCbmCurrent:async()=>{calls.push('CURRENT_CBM');return{ok:true,currentCbm:true};},
      projectPurchaseWorkspace:()=>({tasks:[],customers:[],suppliers:[]}),projectPurchaseOrders:()=>[],projectWarehouseOrders:()=>[],
      projectWarehouseCustomerReadiness:()=>[],projectPreparation:()=>[],readCustomerShortNames:async()=>[],
      wixData:{query:c=>{let exact=false;const q={limit:()=>q,eq:(field,id)=>{assert.equal(field,'_id');assert.equal(id,control._id);exact=true;return q;},
        find:async()=>{calls.push(exact?'CONTROL':c==='StaffMasterAccess'?'STAFF':'TABLE');return{items:c==='StaffMasterAccess'?[{title:'W',description:'M',staffName:'Warehouse',staffEmail:member.loginEmail,staffStatus:'ACTIVE',departments:['WAREHOUSE']}]:exact?[control]:[],hasNext:()=>false};}};return q;}}};
    const source=fs.readFileSync(path.join(folder,'warehouseReceiving.web.candidate.js'),'utf8');
    const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{saveWarehouseReceipt,saveWarehousePreparation,captureWarehouseCbm,getWarehouseOrders};})()',bindings);
    return{calls,run:()=>api.saveWarehouseReceipt('NCT','UUID',{},mode==='ACTIVE'?{stockProtocol:1,stockBuild:'TEST',stockGeneration:0}:undefined),read:()=>api.getWarehouseOrders('NCT'),prep:()=>api.saveWarehousePreparation('NCT','UUID',{}),cbm:()=>api.captureWarehouseCbm('NCT','UUID','a'.repeat(32))};
  }
  const active=await invoke('ACTIVE');assert.equal((await active.run()).current,true);assert.deepEqual(active.calls,['MEMBER','STAFF','CONTROL','CURRENT']);
  const legacy=await invoke('LEGACY');assert.equal((await legacy.run()).legacy,true);assert.deepEqual(legacy.calls,['MEMBER','STAFF','CONTROL','LEGACY']);
  const denied=await invoke('ACTIVE',false);await assert.rejects(denied.run());assert.deepEqual(denied.calls,['MEMBER','STAFF']);
  const currentRead=await invoke('ACTIVE');assert.equal((await currentRead.read()).current,true);assert.deepEqual(currentRead.calls,['MEMBER','STAFF','CONTROL','CURRENT_READ']);
  const legacyRead=await invoke('LEGACY');assert.equal((await legacyRead.read()).orders.length,0);assert.equal(legacyRead.calls.includes('CURRENT_READ'),false);
  const currentPrep=await invoke('ACTIVE');assert.equal((await currentPrep.prep()).currentPrep,true);assert.deepEqual(currentPrep.calls,['MEMBER','STAFF','CONTROL','CURRENT_PREP']);
  const legacyPrep=await invoke('LEGACY');assert.equal((await legacyPrep.prep()).legacyPrep,true);assert.deepEqual(legacyPrep.calls,['MEMBER','STAFF','CONTROL','LEGACY_PREP']);
  const currentCbm=await invoke('ACTIVE');assert.equal((await currentCbm.cbm()).currentCbm,true);assert.deepEqual(currentCbm.calls,['MEMBER','STAFF','CONTROL','CURRENT_CBM']);
  const legacyCbm=await invoke('LEGACY');assert.equal((await legacyCbm.cbm()).legacyCbm,true);assert.deepEqual(legacyCbm.calls,['MEMBER','STAFF','CONTROL','LEGACY_CBM']);
  const deniedCbm=await invoke('ACTIVE',false);await assert.rejects(deniedCbm.cbm());assert.deepEqual(deniedCbm.calls,['MEMBER','STAFF']);
});
test('actual-import CBM root composes original validator and guarded current read; closed coverage cannot read company tables',async()=>{
 const f=await fixture(),request={...copy(f.initial),input:{taskId:'a'.repeat(32)}};let configuration;
 f.bindings.createCurrentWarehouseCbmSave=deps=>{configuration=deps;return async command=>{
  assert.deepEqual(copy(command),request);assert.equal((await deps.authenticateOriginalWarehouse()).staffId,'W');
  return{ok:false,pending:true,requestId:command.requestId,phase:'BEFORE',completedCount:0,totalRecords:1};
 };};
 assert.equal((await f.api.captureWarehouseCbmCurrent('NCT',request)).pending,true);assert.equal(configuration.createWarehouseCbmCapture,f.bindings.createWarehouseCbmCapture);
 assert.equal(configuration.captureCosts,f.bindings.capturePointbaseCosts);assert.equal(configuration.protocol.planFormat,'SEGMENTED_V2');assert.equal(typeof configuration.readCurrentOrders,'function');
 const closed=await fixture('NCT',false);assert.equal((await closed.api.captureWarehouseCbmCurrent('NCT',request)).ok,false);
 assert.equal(closed.calls.includes(closed.tasks),false);assert.equal(closed.calls.includes('POINTBASE'),false);
 const other=await fixture();assert.equal((await other.api.captureWarehouseCbmCurrent('NCT',{...request,stockIdentity:{staffId:'OTHER',memberId:'M'}})).ok,false);assert.equal(other.calls.includes('SDK'),false);
 const count=f.calls.length;assert.equal((await f.api.captureWarehouseCbmCurrent('NCT',{...request,approved:true})).ok,false);assert.equal(f.calls.length,count);
});
test('generated receipt root and minimum wrappers are exact original bodies after removal of explicit current mode seams',()=>{
  for(const file of ['build-warehouse-receipt-web.cjs','build-warehouse-receipt-route-candidate.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
  let candidate=fs.readFileSync(path.join(folder,'warehouseReceiving.web.candidate.js'),'utf8');
  candidate=candidate.replace("import { createCurrentWarehouseReceiptRouter, createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';\nimport { saveWarehouseReceiptCurrent, saveWarehousePreparationCurrent, captureWarehouseCbmCurrent, getWarehouseOrdersCurrent } from 'backend/stockCurrentWarehouse.web';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\n",'')
    .replaceAll('async(company,requestId,input,stockCurrent)=>{','async(company,requestId,input)=>{')
    .replace("return await createCurrentWarehouseReceiptRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:saveWarehouseReceiptCurrent,saveLegacy:()=>operations.save({company,staff,requestId,input})})({requestId,input,stockCurrent});",'return await operations.save({company,staff,requestId,input});')
    .replace("  const staff=await staffContext();\n  return createCurrentWarehouseOrdersRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),readCurrent:getWarehouseOrdersCurrent,readLegacy:async()=>{\n  const {orders,customerLines,deliveryTasks}=await readWarehouseData(company,staff);let names=[];",'  const staff=await staffContext(),{orders,customerLines,deliveryTasks}=await readWarehouseData(company,staff);let names=[];')
    .replace('readAt:new Date().toISOString()};\n  }})();\n});','readAt:new Date().toISOString()};\n});');
  candidate=candidate.replace("return await createCurrentWarehouseReceiptRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:saveWarehousePreparationCurrent,saveLegacy:()=>savePreparation({company,staff:{...staff,canPrepareWarehouse:true},requestId,input})})({requestId,input,stockCurrent});",'return await savePreparation({company,staff:{...staff,canPrepareWarehouse:true},requestId,input});');
  candidate=candidate.replace("async(company,requestId,taskId,stockCurrent)=>{const staff=await staffContext();return createCurrentWarehouseReceiptRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:captureWarehouseCbmCurrent,saveLegacy:()=>captureCbm({company,requestId,taskId,staff})})({requestId,input:{taskId},stockCurrent});}",
   'async(company,requestId,taskId)=>captureCbm({company,requestId,taskId,staff:await staffContext()})');
  assert.equal(candidate,fs.readFileSync(path.join(__dirname,'../backend/warehouseReceiving.web.js'),'utf8').replace(/\r\n/g,'\n'));
});
