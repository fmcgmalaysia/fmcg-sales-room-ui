const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const {createCurrentStockExceptionSave}=require('../prototypes/stock-current-state/current-stock-exception-save.cjs');
const {createCurrentStockResolutionSave}=require('../prototypes/stock-current-state/current-stock-resolution-save.cjs');
const {createCurrentPurchaseTables}=require('../prototypes/stock-current-state/current-purchase-tables.cjs');
const {readCurrentPurchaseProjection}=require('../prototypes/stock-current-state/purchase-current-projection.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const filename=require.resolve('./stock-current-exception-save.test.cjs');
const baseFixture=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test=()=>{}')+';fixture;',
 {require:createRequire(filename),Map,Buffer});
async function fixture({company='NCT',coverage=true,reserved=false,generated=false}={}){
 const f=await baseFixture(company,reserved),calls=[],journal=company==='NCT'?'NCTActivity':'NCTActivity1',orders=company==='NCT'?'NCTOrders':'NCTOrders1',tasks=company==='NCT'?'NCTTasks':'NCTTasks1';
 const rawTask={...(await f.deps.readCurrentTaskRows(company,['T']))[0],title:'T',ourPoNumber:'PO'};
 f.db.set(tasks+':T',rawTask);f.store.normalizeListedRow=(_collection,row)=>copy(row);
 const originalModules=Object.assign({},...['stockExceptionWorkspace.js','inventoryExceptions.js','stockExceptionResolution.js','purchaseOrderWorkflow.js','departmentMessages.js','purchaseProjection.js','accountPurchaseReview.js','warehouseReceiving.js','plannerAllocation.js','customerShipmentLedger.js','packingListOperations.js','packingListModel.js'].map(name=>load(name)),
  load('../prototypes/stock-current-state/warehousePreparation.candidate.js'));
 let implementations={createCurrentStockExceptionSave,createCurrentStockResolutionSave,createCurrentPurchaseTables,readCurrentPurchaseProjection};
 if(generated){const runtime=fs.readFileSync(path.join(folder,'stockCurrentCommands.js'),'utf8');implementations=vm.runInNewContext(runtime.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({createCurrentStockExceptionSave,createCurrentStockResolutionSave,createCurrentPurchaseTables,readCurrentPurchaseProjection});',
  {createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});}
 const fulfilmentStore={read:async(c,id)=>{calls.push('CONTROL');const row=await f.store.read(c,id);return row?{...row,stockCommitVersion:row._version}:null;},
  all:async collection=>{calls.push(collection);if(collection==='StaffMasterAccess')return[f.employee];
   if(collection===orders)return[{_id:'O',title:'O',company,_version:'ORDER0'}];
   if(collection==='SharedSuppliers')return[{_id:'SUP',title:'SUP',name:'Supplier'}];
   if([journal,tasks,'PurchaseOrders'].includes(collection))return[...f.db].filter(([key])=>key.startsWith(collection+':')).map(([,row])=>copy(row));
   throw Error('Unexpected root table '+collection);}};
 const bindings={...originalModules,...implementations,items:f.items,operationId:hash,planCollections,fulfilmentStore,
  currentMember:{getMember:async()=>{calls.push('MEMBER');return f.member;}},PURCHASE_CURRENT_PROJECTION_VERSION:2,
  // Isolate root/raw-table wiring. Real original projector mathematics has its
  // separate current-projection suite; scoped readers/model/coordinator are real.
  projectPurchaseWorkspace:args=>{calls.push('PROJECT');assert.equal(args.company,company);
   const context=f.context();return{...context,staff:args.staff,...(args.currentStock?{stockAllocationView:'CURRENT_V2',allocations:copy(args.currentStock.allocations),
    tasks:context.tasks.map(task=>({...task,inc:args.currentStock.taskReceived.find(row=>row.taskId===task.id)?.quantity||0}))}:{})};},
  createSdkConditionalStore:config=>{calls.push('SDK');assert.equal(config.company,company);assert.deepEqual(copy(config.dateTimeFields),{[journal]:['activityTime'],[orders]:['masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']});return f.store;},
  createSegmentedFencedProof:config=>{assert.equal(config.domainWrites,true);assert.equal(config.store,f.store);return f.protocol;}};
 let source=fs.readFileSync(path.join(folder,'stockCurrentExceptions.js'),'utf8');
 if(coverage)source=source.replace('const writerCoverage=Object.freeze({});','const writerCoverage=Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
 const create=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';createCurrentStockExceptions;',bindings);
 let privateError;
 const web=fs.readFileSync(path.join(folder,'stockExceptions.web.candidate.js'),'utf8');
 const api=vm.runInNewContext(web.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({getStockExceptions,saveStockException,getDepartmentMessages,saveDepartmentMessage});',{
  ...originalModules,fulfilmentStore,currentMember:bindings.currentMember,Permissions:{SiteMember:'SITE'},webMethod:(_grant,fn)=>fn,
  createCurrentStockExceptions:async selected=>{const root=await create(selected);return root.save?{...root,save:async request=>{try{return await root.save(request);}catch(error){privateError=error;throw error;}}}:root;},
  createStockExceptionOperations:()=>async()=>{calls.push('LEGACY_REPORT');return{ok:true,legacy:true};},
  createStockResolutionOperations:()=>async()=>{calls.push('LEGACY_RESOLVE');return{ok:true,legacy:true};},
  createDepartmentMessageOperations:()=>()=>{throw Error('Disabled message save must never run');},
  readFulfilmentContext:async()=>{calls.push('LEGACY_READ');return f.context();}});
 const metadata={stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}};
 const send=(input=f.request.input,meta=metadata,requestId=f.request.requestId)=>api.saveStockException(company,requestId,input,meta);
 async function finish(input=f.request.input,meta=metadata,requestId=f.request.requestId){for(let i=0;i<30;i++){const result=await send(input,meta,requestId);if(!result.pending){assert.equal(result.ok,true,privateError?.stack||result.error);return result;}}throw Error('Still pending');}
 const control=()=>f.db.get(journal+':'+f.protocol.ids.controlId);
 return{...f,api,create,calls,metadata,send,finish,control,journal};
}

test('actual original exception web/private roots report and read both companies with generated coordinator and original permissions',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await fixture({company,generated:true}),read=await f.api.getStockExceptions(company);
  assert.equal(read.sources[0].received,20);assert.equal(read.sources[0].availablePhysical,20);assert.equal(read.permissions.report,true);
  assert.equal(read.sources[0].stockReportMaximum,20);assert.equal(read.sources[0].stockAttributionReviewRequired,false);
  assert.deepEqual(copy(read.stockCurrent),f.metadata);assert.equal(read.cases.length,0);
  const saved=await f.finish();assert.equal(saved.stockGeneration,1);assert.equal((await f.send()).caseId,saved.caseId);
  const after=await f.api.getStockExceptions(company);assert.equal(after.sources[0].received,20);assert.equal(after.sources[0].availablePhysical,10);
  assert.equal(after.cases.length,1);assert.equal(after.cases[0].source.availablePhysical,10);
  assert.equal(after.stockCurrent.stockGeneration,1);assert.equal(after.cases[0].byStaffId,'W');
  assert.equal(f.calls.some(value=>value.startsWith('LEGACY_')),false);
 }
});

test('actual resolution root keeps separate original Purchase decision and Warehouse movements, once-only original supplier references',async()=>{
 const f=await fixture(),saved=await f.finish();
 f.employee.departments=['PURCHASE'];f.employee.title='P';f.employee.staffName='Purchase';
 let read=await f.api.getStockExceptions('NCT');assert.equal(read.permissions.decide,true);assert.equal(read.permissions.report,false);
 const decision={action:'DECIDE',id:saved.caseId,version:read.resolutionVersion,reason:'Supplier agreed replacement',decision:'REPLACE',disposition:'RETURN',supplierReference:'SUP-REF',expectedDate:'2026-11-01'};
 const decided=await f.finish(decision,read.stockCurrent,'22222222-2222-4222-8222-222222222222');assert.equal(decided.stockGeneration,2);
 f.employee.departments=['WAREHOUSE'];f.employee.title='W';f.employee.staffName='Warehouse';read=await f.api.getStockExceptions('NCT');
 const replacement={action:'REPLACEMENT',id:saved.caseId,version:read.resolutionVersion,quantity:5,reference:'RPL-1',reason:'Good replacements received',acceptedGood:true};
 await f.finish(replacement,read.stockCurrent,'33333333-3333-4333-8333-333333333333');read=await f.api.getStockExceptions('NCT');
 assert.equal(read.sources[0].received,20);assert.equal(read.sources[0].availablePhysical,15);
 assert.equal(read.cases[0].resolution.decision.byStaffId,'P');assert.equal(read.cases[0].resolution.replacements[0].reference,'RPL-1');
 const returned={action:'RETURN',id:saved.caseId,version:read.resolutionVersion,quantity:5,reference:'RTN-1',reason:'Supplier collected isolated goods'};
 await f.finish(returned,read.stockCurrent,'44444444-4444-4444-8444-444444444444');read=await f.api.getStockExceptions('NCT');
 assert.equal(read.sources[0].received,20);assert.equal(read.sources[0].availablePhysical,15);
 const position=[...f.db.values()].find(row=>row.sourceTaskId==='T');assert.equal(position.onHand,20);assert.equal(position.isolated,5);assert.equal(position.replacementReceived,5);assert.equal(position.supplierReturned,5);
 assert.equal(f.calls.some(value=>value.startsWith('LEGACY_')),false);
});

test('actual exception root commits approved single-customer isolation; received CLOSED source display uses exact current row instead of historical receipt balance',async()=>{
 const reserved=await fixture({reserved:true}),saved=await reserved.finish();assert.equal(saved.ok,true);assert.equal(reserved.control().generation,1);
 const caseEvent=[...reserved.db.values()].find(row=>row.action==='STOCK_EXCEPTION_REPORTED');assert.equal(caseEvent.stockAttribution,'CUSTOMER');assert.equal(caseEvent.stockCustomerTaskId,'T');
 const reservedRead=await reserved.api.getStockExceptions('NCT');assert.equal(reservedRead.sources[0].availablePhysical,10);assert.equal(reservedRead.sources[0].stockReportMaximum,10);
 const f=await fixture();
 for(const [key,row] of f.db){
  if(key.startsWith('StockPositions:'))Object.assign(row,{onHand:0,available:0,isolated:0,reservedUsable:0,supplierReturned:20,status:'CLOSED'});
  if(key.startsWith('StockProducts:'))Object.assign(row,{onHand:0,available:0,isolated:0,reservedUsable:0,status:'CLOSED'});
 }
 const read=await f.api.getStockExceptions('NCT');assert.equal(read.sources[0].received,20);assert.equal(read.sources[0].availablePhysical,0);
 assert.equal(read.stockCurrent.stockGeneration,0);assert.equal(f.control().pending,null);
});

test('empty coverage, forbidden role, forged/currentless input and maintenance cannot route to original stock writes',async()=>{
 const closed=await fixture({coverage:false});await assert.rejects(closed.api.getStockExceptions('NCT'),/co-writers/);assert.equal((await closed.send()).ok,false);assert.equal(closed.calls.includes('PROJECT'),false);
 for(const mode of ['MAINTENANCE','SHADOW','UNKNOWN']){const f=await fixture();f.control().mode=mode;await assert.rejects(f.api.getStockExceptions('NCT'));assert.equal((await f.send()).ok,false);assert.equal(f.calls.some(value=>value.startsWith('LEGACY_')),false);}
 for(const meta of [null,{}, {stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'FORGED',memberId:'M'}}, {stockProtocol:1,stockBuild:'TEST',stockGeneration:0,approved:true}]){
  const f=await fixture();assert.equal((await f.send(f.request.input,meta)).ok,false);assert.equal(f.control().generation,0);assert.equal(f.calls.includes('LEGACY_REPORT'),false);
 }
 const f=await fixture();f.employee.departments=['SUPPORT'];assert.equal((await f.send()).ok,false);assert.equal(f.control().generation,0);
 await assert.rejects(f.create('FOREIGN'));f.member.status='PENDING';const before=f.calls.length;await assert.rejects(f.api.getStockExceptions('NCT'));assert.deepEqual(f.calls.slice(before),['MEMBER','StaffMasterAccess']);
});

test('pending save blocks actionable stock/messages but original identity-only read survives; same-member reissued staff cannot adopt plan',async()=>{
 const f=await fixture(),first=await f.send();assert.equal(first.pending,true);
 await assert.rejects(f.api.getStockExceptions('NCT'),/pending/);
 const identity=await f.api.getStockExceptions('NCT',{contextOnly:true});assert.equal(identity.schema,'STOCK_EXCEPTION_ORIGINAL_CONTEXT_V1');assert.equal(identity.stockCurrent,undefined);assert.equal(identity.staff.staffId,'W');
 f.employee.title='OTHER';assert.equal((await f.send()).ok,false);assert.equal((await f.send(f.request.input,{...f.metadata,stockIdentity:{staffId:'OTHER',memberId:'M'}})).ok,false);
 f.employee.title='W';assert.equal((await f.finish()).ok,true);
 const original=[...f.db.values()].filter(row=>row.action==='STOCK_EXCEPTION_REPORTED');assert.equal(original.length,1);assert.equal(original[0].initiatedByStaffId,'W');
});

test('original message read stays generation-guarded while disabled message send remains disabled; LEGACY only explicit clean control',async()=>{
 const f=await fixture(),messages=await f.api.getDepartmentMessages('NCT','WAREHOUSE');assert.equal(messages.threads.length,1);assert.equal(messages.stockCurrent.stockGeneration,0);
 f.control().pending={key:'PENDING'};await assert.rejects(f.api.getDepartmentMessages('NCT','WAREHOUSE'));f.control().pending=null;
 assert.equal((await f.api.saveDepartmentMessage('NCT','WAREHOUSE','ID',{action:'MESSAGE_SEND'})).ok,false);
 const legacy=await fixture();legacy.control().mode='LEGACY';const response=await legacy.api.saveStockException('NCT',legacy.request.requestId,legacy.request.input);
 assert.equal(response.legacy,true);assert.equal(legacy.calls.includes('LEGACY_REPORT'),true);
 assert.equal((await legacy.send()).ok,false,'current-tagged form never enters legacy writer');
 const missing=await fixture();missing.db.delete(missing.journal+':'+missing.protocol.ids.controlId);assert.equal((await missing.send()).ok,false);assert.equal(missing.calls.includes('LEGACY_REPORT'),false);
});

test('new original stock wrapper/root reproducible; original auth, public endpoints and exact rejection tail preserved',()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-current-stock-exceptions.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(__dirname,'../backend/stockExceptions.web.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'stockExceptions.web.candidate.js'),'utf8');
 for(const auth of ['async function staffContext()','async function messageStaffContext()']){const at=original.indexOf(auth),end=original.indexOf('\n}',at);assert.equal(candidate.includes(original.slice(at,auth.includes('message')?end+2:original.indexOf('\n',at))),true);}
 assert.equal(candidate.slice(candidate.indexOf(' catch(error)')),original.slice(original.indexOf(' catch(error)')).replace(
  " const staff=await messageStaffContext(),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});",
  " const staff=await messageStaffContext(),current=await createCurrentStockExceptions(company);if(current?.mode==='ACTIVE')return current.messages(staff,department);if(current?.mode!=='LEGACY')throw Error('Current stock messages unavailable');\n const context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});"));
 assert.equal((candidate.match(/webMethod\(Permissions.SiteMember/g)||[]).length,4);
 assert.equal(/webMethod\(|Permissions\./.test(fs.readFileSync(path.join(folder,'stockCurrentExceptions.js'),'utf8')),false);
});
