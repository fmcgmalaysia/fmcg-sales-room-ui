const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),load=require('./load-master-module.cjs');
const {createCurrentSalesRead}=require('../prototypes/stock-current-state/current-sales-read.cjs');
const {createCurrentSalesDemandSave}=require('../prototypes/stock-current-state/current-sales-save.cjs');
const {createCurrentSalesShipmentSave}=require('../prototypes/stock-current-state/current-sales-shipment-save.cjs');
const {createCurrentSalesArrangementSave}=require('../prototypes/stock-current-state/current-sales-arrangement-save.cjs');
const {requireOriginalSalesDelegation}=require('../prototypes/stock-current-state/sales-delegation.cjs');
const {dispatchCurrentSalesGateway}=require('../prototypes/stock-current-state/sales-gateway-current.cjs');
const {planCollections}=require('../prototypes/stock-current-state/domain-scope.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const filename=require.resolve('./stock-current-sales-save.test.cjs'),original=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',{require:createRequire(filename),Map});
async function fixture(coverage=true){
 const f=await original(true),calls=[],modules=Object.assign({},...['customerShipmentPlan.js','customerShipmentLedger.js','salesOrderAdjustment.js','customerAccountLedger.js','customerDebtor.js','packingListOperations.js','packingListModel.js'].map(file=>load(file)),
  load('../prototypes/stock-current-state/customerFulfilment.candidate.js'),load('../prototypes/stock-current-state/warehousePreparation.candidate.js'));
 const readContext=f.deps.readContext;f.deps.readContext=async(...args)=>{const context=await readContext(...args);return{...context,tasks:context.tasks.map(task=>({...task,transactionCurrency:'USD'}))};};
 const originalSource=fs.readFileSync(path.join(folder,'customerFulfilmentService.candidate.js'),'utf8'),readBody=originalSource.slice(originalSource.indexOf('export async function readCustomerFulfilment(')).replace(/^export /,'');
 const readOriginal=vm.runInNewContext(readBody+';readCustomerFulfilment;',{...modules,Date,Math,readFulfilmentContext:()=>{throw Error('Current source read must supply original verified context');}});
 for(const row of await f.deps.readCurrentTaskRows('NCT',['T','U']))f.db.set('NCTTasks/'+row._id,row);
 const bindings={...modules,readAllocations:f.deps.readAllocations,projectPurchaseOrders:f.deps.projectPurchaseOrders,items:f.deps.items,createCurrentSalesRead,createCurrentSalesDemandSave,createCurrentSalesShipmentSave,createCurrentSalesArrangementSave,
  requireOriginalSalesDelegation,planCollections,PURCHASE_CURRENT_PROJECTION_VERSION:2,CUSTOMER_CURRENT_FULFILMENT_VERSION:2,operationId:cryptoHash,
  fulfilmentStore:{read:async(collection,id)=>{calls.push('CONTROL');const row=await f.deps.store.read(collection,id);return row?{...row,stockCommitVersion:row._version}:null;},
   all:async collection=>{calls.push(collection);assert.equal(collection,'PurchaseOrders');return[];}},
  readFulfilmentContext:async(...args)=>{calls.push('CONTEXT');return f.deps.readContext(...args);},readCustomerFulfilment:readOriginal,
  createSdkConditionalStore:configuration=>{calls.push('SDK');assert.equal(configuration.company,'NCT');assert.deepEqual(copy(configuration.dateTimeFields),{NCTActivity:['activityTime']});return f.deps.store;},
  createSegmentedFencedProof:configuration=>{assert.equal(configuration.company,'NCT');assert.equal(configuration.domainWrites,true);return f.deps.protocol;}};
 let source=fs.readFileSync(path.join(folder,'stockCurrentSourceSales.js'),'utf8');
 if(coverage)source=source.replace('const writerCoverage=Object.freeze({});','const writerCoverage=Object.freeze('+JSON.stringify(Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])))+');');
 const create=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';return createCurrentSourceSales;})()',bindings);
 const authenticate=async()=>{calls.push('DELEGATION');return{...await f.deps.authenticateOriginalDelegation(),canEditShipmentDate:true,canUploadCustomerDocument:true};};
 const root=()=>create({company:'NCT',authenticateOriginalDelegation:authenticate});
 const gatewaySource=fs.readFileSync(path.join(folder,'customerFulfilmentGateway.candidate.js'),'utf8');
 const gateway=vm.runInNewContext(gatewaySource.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';handleSalesFulfilment;',{
  Buffer,timingSafeEqual:crypto.timingSafeEqual,getSecret:async()=>{calls.push('BEARER');return'SYNTHETIC-TEST-ONLY';},createCurrentSourceSales:create,dispatchCurrentSalesGateway,
  readCustomerFulfilment:async()=>{calls.push('LEGACY_READ');return{legacy:true};},saveCustomerFulfilment:async()=>{calls.push('LEGACY_SAVE');return{legacy:true};},saveCustomerAccountDocument:async()=>{calls.push('LEGACY_DOCUMENT');return{legacy:true};},handleSalesTaskChat:async()=>({chat:true})});
 const send=(body,authorized=true)=>gateway({headers:authorized?{Authorization:'Bearer SYNTHETIC-TEST-ONLY'}:{},body:{json:async()=>body}});
 return{...f,calls,create,root,send};
}
const cryptoHash=(...parts)=>crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const body=(action,input={},requestId='11111111-1111-4111-8111-111111111111')=>({company:'NCT',customerId:'C',customerName:'Customer',staff:{staffId:'S',staffName:'Sales'},action,input,requestId});
test('actual-import source root and original one-argument bearer gateway READ/increase/SPLIT retain customer scope and original PO/receipt rows',async()=>{
 const f=await fixture(),initial=await f.send(body('READ'));assert.equal(initial.status,200,initial.body.error);const read=initial.body.result;
 assert.equal(read.lines.find(line=>line.taskId==='U').allocated,10);assert.deepEqual(copy(read.stockCurrent.stockIdentity),{staffId:'S',memberId:'SOURCE_SALES/S'});
 const immutable=JSON.stringify([...f.db].filter(([key])=>/^(StockPositions|StockClaims|PurchaseOrders|NCTTasks|NCTOrders)\//.test(key)));
 const increase=body('ADJUST',{taskId:'T',orderId:'O',mode:'INCREASE',quantity:50,batchId:'',version:read.adjustmentVersion,stockCurrent:read.stockCurrent});
 const increased=await f.send(increase);assert.equal(increased.status,200);assert.equal(increased.body.result.requested,150);assert.equal(increased.body.result.taskId,'T');assert.equal(increased.body.result.company,'NCT');
 assert.deepEqual(copy((await f.send(increase)).body.result),copy(increased.body.result));
 const next=(await f.send(body('READ'))).body.result,plan=next.plans.find(row=>row.orderId==='O');
 const split=await f.send(body('ADJUST',{taskId:'T',orderId:'O',mode:'SPLIT',quantity:70,batchId:plan.id+'|1',version:next.adjustmentVersion,stockCurrent:next.stockCurrent},'22222222-2222-4222-8222-222222222222'));
 assert.equal(split.status,200);assert.equal(split.body.result.requested,150);
 const final=(await f.send(body('READ'))).body.result;assert.deepEqual(copy(final.plans.find(row=>row.orderId==='O').batches.map(batch=>batch.lines[0].quantity)),[70,80]);
 assert.equal(final.lines.every(line=>line.customerId==='C'),true);assert.equal(JSON.stringify([...f.db].filter(([key])=>/^(StockPositions|StockClaims|PurchaseOrders|NCTTasks|NCTOrders)\//.test(key))),immutable);
 assert.equal(f.calls.includes('LEGACY_SAVE'),false);assert.equal(f.calls.includes('StaffMasterAccess'),false,'source authority stays original bearer, not invented Master employee grant');
});
test('source root also preserves original SELECT/CANCEL reservations and PLAN intent without invoice or physical stock changes',async()=>{
 const f=await fixture(),initial=await f.send(body('READ'));assert.equal(initial.status,200,initial.body.error);const read=initial.body.result;
 const planned=await f.send(body('PLAN',{orderId:'O',reason:'Two shipments',version:read.planVersion,stockCurrent:read.stockCurrent,batches:[{label:'First',lines:[{taskId:'T',quantity:40}]},{label:'Next',lines:[{taskId:'T',quantity:60}]}]}));
 assert.equal(planned.status,200);assert.equal(planned.body.result.stockGeneration,2);
 const next=(await f.send(body('READ'))).body.result,selected=await f.send(body('SELECT',{version:next.version,stockCurrent:next.stockCurrent,reason:'Partial shipment',lines:[{taskId:'U',quantity:5}]},'33333333-3333-4333-8333-333333333333'));
 assert.equal(selected.status,200,selected.body.error);assert.equal(selected.body.result.status,'REQUESTED');
 const latest=(await f.send(body('READ'))).body.result,cancelled=await f.send(body('CANCEL',{version:latest.version,stockCurrent:latest.stockCurrent,id:selected.body.result.shipmentId,reason:'Rearrange'},'44444444-4444-4444-8444-444444444444'));
 assert.equal(cancelled.status,200,cancelled.body.error);assert.equal(cancelled.body.result.status,'CANCELLED');
 assert.equal([...f.db.values()].filter(row=>row.sourceTaskId==='U'&&row.onHand===10).length,1);
 assert.equal([...f.db.values()].some(row=>row.details?.shipment?.status==='INVOICED'||row.details?.shipment?.status==='DISPATCHED'),false);
});

test('actual source bearer root accepts original date/version with current metadata and replays one date event without quantity or PO mutation',async()=>{
 const f=await fixture();f.db.set('NCTActivity/ORIGINAL_INTAKE',{_id:'ORIGINAL_INTAKE',title:'ORIGINAL_INTAKE',company:'NCT',_version:'R0',description:'O',action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB',taskIds:['T']}});
 const initial=await f.send(body('READ'));assert.equal(initial.status,200,initial.body.error);
 const immutable=JSON.stringify([...f.db].filter(([key])=>/^(StockProducts|StockPositions|StockClaims|PurchaseOrders|NCTTasks|NCTOrders)\//.test(key)));
 const request=body('ORDER_DATE',{orderId:'O',submissionId:'SUB',date:'2026-11-01',version:'',stockCurrent:initial.body.result.stockCurrent});
 const saved=await f.send(request);assert.equal(saved.status,200,saved.body.error);assert.equal(saved.body.result.date,'2026-11-01');assert.equal(saved.body.result.orderId,'O');assert.equal(saved.body.result.customerId,'C');assert.equal(saved.body.result.stockGeneration,2);
 assert.deepEqual(copy((await f.send(request)).body.result),copy(saved.body.result));assert.equal([...f.db.values()].filter(row=>row.action==='SALES_SHIPMENT_DATE_SAVED').length,1);
 assert.equal(JSON.stringify([...f.db].filter(([key])=>/^(StockProducts|StockPositions|StockClaims|PurchaseOrders|NCTTasks|NCTOrders)\//.test(key))),immutable);
 const changed=await f.send({...request,input:{...request.input,date:'2026-11-02'}});assert.equal(changed.status,400);assert.equal(f.calls.includes('LEGACY_SAVE'),false);
});
test('default source gateway validates bearer before control/data, never falls back on missing/maintenance/current metadata or unconnected document',async()=>{
 const f=await fixture();assert.equal((await f.send(body('READ'),false)).status,401);assert.deepEqual(f.calls,['BEARER']);
 const control=f.db.get('NCTActivity/'+f.deps.protocol.ids.controlId);
 for(const mode of ['MAINTENANCE','SHADOW','BAD']){control.mode=mode;const result=await f.send(body('READ'));assert.equal(result.status,400);assert.equal(f.calls.includes('LEGACY_READ'),false);}
 control.mode='ACTIVE';assert.equal((await f.send(body('ADJUST',{taskId:'T',customerId:'C'}))).status,400);
 assert.equal((await f.send(body('DOCUMENT',{type:'CUSTOMER_RECEIPT'}))).status,400);assert.equal(f.calls.includes('LEGACY_DOCUMENT'),false,'DOCUMENT pending same-fence connection, not a production-ready disabled workflow');
 const closed=await fixture(false);assert.equal((await closed.send(body('READ'))).status,400);assert.equal(closed.calls.includes('CONTEXT'),false);
 const legacy=await fixture();legacy.db.get('NCTActivity/'+legacy.deps.protocol.ids.controlId).mode='LEGACY';assert.equal((await legacy.send(body('READ'))).body.result.legacy,true);assert.equal(legacy.calls.includes('SDK'),false);
 assert.equal((await legacy.send(body('ADJUST',{stockCurrent:{schema:'CURRENT_STOCK_V2',stockProtocol:1}}))).status,400);assert.equal(legacy.calls.includes('LEGACY_SAVE'),false);
 const native=await f.root();assert.throws(()=>native.save({requestId:'55555555-5555-4555-8555-555555555555',stockProtocol:1,stockBuild:'TEST',stockGeneration:1,
  stockIdentity:{staffId:'OTHER',memberId:'SOURCE_SALES/OTHER'},input:{action:'ADJUST',customerId:'C'}}),/identity/);
 assert.throws(()=>native.save({requestId:'55555555-5555-4555-8555-555555555555',stockProtocol:1,stockBuild:'TEST',stockGeneration:1,
  stockIdentity:{staffId:'S',memberId:'SOURCE_SALES/S'},input:{action:'ADJUST',customerId:'OTHER'}}),/identity/);
});
test('source auth-only resume remains original bearer/customer scope and returns no stock behind pending; other claims never authorize private root',async()=>{
 const f=await fixture(),control=f.db.get('NCTActivity/'+f.deps.protocol.ids.controlId);control.pending={key:'PENDING'};
 const result=await f.send(body('READ',{resume:'SOURCE_SALES_V1'}));assert.equal(result.status,200);assert.equal(result.body.result.schema,'SOURCE_SALES_RESUME_V1');assert.equal(result.body.result.customerId,'C');assert.equal(result.body.result.stockCurrent,undefined);assert.deepEqual(f.calls,['BEARER']);
 assert.equal((await f.send(body('READ',{resume:'SOURCE_SALES_V1',approved:true}))).status,400);
 for(const staff of [{memberId:'MASTER/M',staffId:'S',staffName:'Sales',customerId:'C',canSelectShipment:true},{memberId:'SOURCE_SALES/S',staffId:'S',staffName:'Sales',customerId:'C',canSelectShipment:false}]){
  const before=f.calls.length;await assert.rejects(f.create({company:'NCT',authenticateOriginalDelegation:async()=>staff}),/delegation/);assert.equal(f.calls.length,before);
 }
});
test('source native composition/default route reproducible and original bearer header/body checks are unchanged; no new web method',()=>{
 for(const file of ['build-source-sales-current.cjs','build-sales-transport-candidate.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
 const source=fs.readFileSync(path.join(folder,'stockCurrentSourceSales.js'),'utf8');assert.equal(/webMethod\(|Permissions\./.test(source),false);
 const candidate=fs.readFileSync(path.join(folder,'customerFulfilmentGateway.candidate.js'),'utf8'),original=fs.readFileSync(path.join(__dirname,'../backend/customerFulfilmentGateway.js'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(candidate.split(' const secret=')[1].split('\n try{')[0],original.split(' const secret=')[1].split('\n try{')[0]);
 assert.equal(candidate.split(' try{const body=')[1].split('\n const staff=')[0],original.split(' try{const body=')[1].split('\n const staff=')[0]);
 assert.match(candidate,/resolveCurrentSales=resolveOriginalSourceSales/);assert.equal(candidate.includes('resolveCurrentSales?'),false);
});
