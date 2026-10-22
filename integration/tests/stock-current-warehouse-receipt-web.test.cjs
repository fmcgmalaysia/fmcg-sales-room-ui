const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),{stockKey}=require('../prototypes/stock-current-state/current-model.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {createCurrentWarehouseReceiptSave}=require('../prototypes/stock-current-state/current-department-saves.cjs');
const {createCurrentWarehouseReceiptRouter}=require('../prototypes/stock-current-state/current-warehouse-receipt-router.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
async function fixture(company='NCT',coverage=true,productCount=2,stepsPerInvocation=100){
  const filename=require.resolve('./stock-current-warehouse-authority.test.cjs');
  const original=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')
    .replaceAll("'NCT'",'company')+';fixture;',{require:createRequire(filename),company});
  const f=original(),db=new Map(),calls=[],journal=company==='NCT'?'NCTActivity':'NCTActivity1',tasks=company==='NCT'?'NCTTasks':'NCTTasks1';
  if(productCount!==2){const first=copy(f.context.tasks[0]);f.context.tasks=Array.from({length:productCount},(_,i)=>({...copy(first),id:'T'+i,sourceLineId:'L'+i,barcode:String(i)}));}
  const store={read:async(c,id)=>copy(db.get(c+'/'+id)||null),insert:async(c,row)=>{
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
  const items={query:c=>{const filters=[];let limit=50;const q={eq:(k,v)=>{filters.push(row=>row[k]===v);return q;},
    gt:(k,v)=>{filters.push(row=>row[k]>v);return q;},ascending:()=>q,limit:n=>{limit=n;return q;},find:async()=>{
      const rows=[...db].filter(([key,row])=>key.startsWith(c+'/')&&filters.every(fn=>fn(row))).map(([,row])=>copy(row)).sort((a,b)=>a._id.localeCompare(b._id));
      return{items:rows.slice(0,limit),totalCount:rows.length};}};return q;}};
  const modules=['warehouseReceiving.js','purchaseOrderWorkflow.js','plannerAllocation.js','customerShipmentLedger.js','packingListOperations.js','packingListModel.js','warehousePreparation.js'];
  const bindings={...Object.assign({},...modules.map(name=>load(name))),planCollections,createCurrentWarehouseReceiptSave,
    Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(permission,fn)=>{assert.equal(permission,'SITE_MEMBER');return fn;},
    currentMember:{getMember:async()=>{calls.push('MEMBER');return f.deps.readMember();}},items,
    fulfilmentStore:{all:async c=>{calls.push(c);if(c==='StaffMasterAccess')return f.deps.readStaffRecords();if(c==='PurchaseOrders')return [];throw Error('Unexpected full scan');}},
    readFulfilmentContext:async selected=>{calls.push('CONTEXT');assert.equal(selected,company);
      f.context.activity=[...db].filter(([key])=>key.startsWith(journal+'/')).map(([,row])=>copy(row));
      f.context.tasks.forEach(task=>{task.warehouse=load('warehouseReceiving.js').readWarehouseTask({title:task.id,description:task.orderId,imageAltText:task.sourceLineId,purchaseQtyInCtn:task.ord},f.context.activity);});
      return copy(f.context);},
    createSdkConditionalStore:args=>{calls.push('SDK');assert.equal(args.company,company);assert.deepEqual(copy(args.dateTimeFields),{[journal]:['activityTime']});return store;},
    createSegmentedFencedProof:args=>{assert.equal(args.company,company);assert.equal(args.domainWrites,true);return protocol;}};
  let source=fs.readFileSync(path.join(folder,'stockCurrentWarehouse.web.js'),'utf8');
  if(coverage)source=source.replace('const writerCoverage = Object.freeze({});','const writerCoverage = Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
  const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{saveWarehouseReceiptCurrent};})()',bindings);
  const initial=f.request();delete initial.company;Object.assign(initial,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0});
  return{...f,db,protocol,api,initial,calls,journal,tasks};
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
  for(const variant of ['coverage','metadata','role','company','uuid','browserGrant','over']){
    const f=await fixture('NCT',variant!=='coverage'),request=copy(f.initial);
    if(variant==='metadata')delete request.stockBuild;if(variant==='role')f.deps.readMember=async()=>({_id:'M',status:'PENDING'});
    if(variant==='uuid')request.requestId='BAD';if(variant==='browserGrant')request.approved=true;if(variant==='over')request.input.lines[0].accepted=101;
    const result=await f.api.saveWarehouseReceiptCurrent(variant==='company'?'FOREIGN':'NCT',request);
    assert.equal(result.ok,false,variant);assert.equal([...f.db.values()].some(row=>row.action==='WAREHOUSE_RECEIPT_SAVED'),false,variant);
    if(['coverage','metadata','role','company','uuid','browserGrant'].includes(variant))assert.equal(f.calls.includes('CONTEXT'),false,variant);
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
test('actual original Warehouse wrapper authenticates before server mode read; ACTIVE calls only paired root and LEGACY calls only old save',async()=>{
  async function invoke(mode,approved=true){
    const calls=[],member={_id:'M',loginEmail:'w@example.test',status:approved?'APPROVED':'PENDING'},
      control={_id:hash('NCT','STOCK_CONTROL'),company:'NCT',stockCommitVersion:'V',mode,schemaVersion:1,generation:0,pending:null};
    const bindings={Permissions:{SiteMember:'SITE_MEMBER'},webMethod:(_grant,fn)=>fn,currentMember:{getMember:async()=>{calls.push('MEMBER');return member;}},
      requireWarehouseStaff:load('warehouseReceiving.js').requireWarehouseStaff,createCurrentWarehouseReceiptRouter,operationId:hash,
      PURCHASE_COLLECTIONS:{NCT:{activity:'NCTActivity'}},createWarehouseOperations:()=>({save:async()=>{calls.push('LEGACY');return{ok:true,legacy:true};}}),
      createPreparationOperations:()=>()=>{},createWarehouseCbmCapture:()=>()=>{},requestPurchaseDocument:()=>{},capturePointbaseCosts:()=>{},
      saveWarehouseReceiptCurrent:async(company,request)=>{calls.push('CURRENT');assert.equal(company,'NCT');return{ok:true,current:true,stockGeneration:request.stockGeneration};},
      wixData:{query:c=>{let exact=false;const q={limit:()=>q,eq:(field,id)=>{assert.equal(field,'_id');assert.equal(id,control._id);exact=true;return q;},
        find:async()=>{calls.push(exact?'CONTROL':'STAFF');return{items:c==='StaffMasterAccess'?[{title:'W',description:'M',staffName:'Warehouse',staffEmail:member.loginEmail,staffStatus:'ACTIVE',departments:['WAREHOUSE']}]:[control],hasNext:()=>false};}};return q;}}};
    const source=fs.readFileSync(path.join(folder,'warehouseReceiving.web.candidate.js'),'utf8');
    const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return{saveWarehouseReceipt};})()',bindings);
    return{calls,run:()=>api.saveWarehouseReceipt('NCT','UUID',{},mode==='ACTIVE'?{stockProtocol:1,stockBuild:'TEST',stockGeneration:0}:undefined)};
  }
  const active=await invoke('ACTIVE');assert.equal((await active.run()).current,true);assert.deepEqual(active.calls,['MEMBER','STAFF','CONTROL','CURRENT']);
  const legacy=await invoke('LEGACY');assert.equal((await legacy.run()).legacy,true);assert.deepEqual(legacy.calls,['MEMBER','STAFF','CONTROL','LEGACY']);
  const denied=await invoke('ACTIVE',false);await assert.rejects(denied.run());assert.deepEqual(denied.calls,['MEMBER','STAFF']);
});
test('generated receipt root and minimum wrapper are exact; other original Warehouse read/preparation/CBM paths untouched',()=>{
  for(const file of ['build-warehouse-receipt-web.cjs','build-warehouse-receipt-route-candidate.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
  let candidate=fs.readFileSync(path.join(folder,'warehouseReceiving.web.candidate.js'),'utf8');
  candidate=candidate.replace("import { createCurrentWarehouseReceiptRouter } from 'backend/stockCurrentCommands.js';\nimport { saveWarehouseReceiptCurrent } from 'backend/stockCurrentWarehouse.web';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\n",'')
    .replace('async(company,requestId,input,stockCurrent)=>{','async(company,requestId,input)=>{')
    .replace("return await createCurrentWarehouseReceiptRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:saveWarehouseReceiptCurrent,saveLegacy:()=>operations.save({company,staff,requestId,input})})({requestId,input,stockCurrent});",'return await operations.save({company,staff,requestId,input});');
  assert.equal(candidate,fs.readFileSync(path.join(__dirname,'../backend/warehouseReceiving.web.js'),'utf8').replace(/\r\n/g,'\n'));
});
