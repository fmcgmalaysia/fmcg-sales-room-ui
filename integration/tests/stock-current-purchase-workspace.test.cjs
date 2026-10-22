const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentPurchaseWorkspaceRead}=require('../prototypes/stock-current-state/current-purchase-workspace-read.cjs');
const filename=require.resolve('./stock-current-margin-reference.test.cjs'),build=vm.runInNewContext(fs.readFileSync(filename,'utf8')
  .replace("const test = require('node:test')",'const test = () => {}')+';fixture;',{require:createRequire(filename),Map,Buffer});
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(company='NCT'){
  const f=build(company),staff={staffId:'P',memberId:'M',staffName:'Purchase'},calls=[];
  f.order.gp=0.25;f.order.adminFxSource=3.2;
  const control={company,generation:4,mode:'ACTIVE',schemaVersion:1,transferIndexVersion:2,writerBuild:'TEST',_version:'C4',pending:null};
  const protocol={readSnapshot:async fn=>{const version=control._version;if(control.pending)throw Error('Inventory pending');
    const rows=await fn(copy(control));if(control._version!==version||control.pending)throw Error('Inventory changed');return{rows,generation:control.generation};}};
  const workspace={...copy(f.args.workspace),staff,stockAllocationView:'CURRENT_V2',customers:[{id:'C',name:'Customer'}]};
  const tables={...f.args.tables,PurchaseOrders:[]};
  const relation={id:'R',borrowerTaskId:'T',lenderTaskId:'X',lenderSourceId:'X',replacementSourceId:'T',quantity:30,repaid:0,returned:0};
  const dependencies={company,protocol,authenticate:async()=>{calls.push('AUTH');return staff;},readCurrentContext:async()=>{calls.push('CONTEXT');return{workspace:copy(workspace),tables:copy(tables)};},
    readRates:async currencies=>{calls.push(['RATES',copy(currencies)]);return f.args.readRates(currencies);},createPurchaseMarginRefresh:load('purchaseMarginRefresh.js').createPurchaseMarginRefresh,
    readCustomerShortNames:async()=>{calls.push('NAMES');return[{customerId:'C',shortName:'SHORT'}];},projectPurchaseOrders:()=>[],
    applyPurchaseProgress:result=>{calls.push('PROGRESS');for(const task of result.tasks){task.archived=true;task.stage='SHIPPED';}},
    readOutstanding:async()=>{calls.push('RELATIONS');return{schema:'CURRENT_BORROW_RELATIONS_V1',company,view:'OUTSTANDING',generation:control.generation,
      version:'a'.repeat(32),offset:0,total:1,items:[relation],nextCursor:null};},now:f.args.now};
  const read=()=>createCurrentPurchaseWorkspaceRead(dependencies)(company);
  return{...f,staff,calls,control,protocol,workspace,tables,relation,dependencies,read};
}

test('both companies return same-generation original GP/progress/names plus halos independently of archived state, with no writes',async()=>{
  for(const company of ['NCT','GHR']){
    const f=fixture(company),before=JSON.stringify(f.tables),result=await f.read();
    assert.equal(result.tasks[0].gp,0.25);assert.equal(result.tasks[0].sourceGp,0.25);
    assert.equal(result.tasks[0].archived,true);assert.equal(result.tasks[0].stockTransferOutstanding,true);
    assert.equal(result.stockCurrent.stockGeneration,4);assert.equal(result.stockCurrent.stockBuild,'TEST');assert.equal(result.customers[0].shortName,'SHORT');
    assert.equal(f.calls[0],'AUTH');assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==='RATES').length,1);
    assert.equal(JSON.stringify(f.tables),before);assert.equal(JSON.stringify(result).includes('sellingPrice'),false);
  }
});

test('needed GP cache refresh returns only exact authenticated request suggestion, never draft GP/FX/private workspace or writes',async()=>{
  const f=fixture();f.order.gp=0.1;const before=JSON.stringify(f.tables),result=await f.read();
  assert.equal(result.schema,'PURCHASE_MARGIN_REFRESH_REQUIRED_V1');assert.equal(result.taskId,'T');assert.equal(result.staff.memberId,'M');
  assert.equal(result.stockCurrent.stockGeneration,4);assert.equal(Object.hasOwn(result,'tasks'),false);assert.equal(Object.hasOwn(result,'results'),false);
  assert.equal(JSON.stringify(result).includes('rateToMyr'),false);assert.equal(f.calls.includes('RELATIONS'),false);assert.equal(JSON.stringify(f.tables),before);
});

test('one ORIGINAL open-currency snapshot excludes an old locked currency instead of suppressing valid current GP',async()=>{
  const f=fixture(),old={...copy(f.order),_id:'O2',title:'OLD',sourceLineId:'L2',customerId:'C2',transactionCurrency:'REMOVED_CURRENCY',
    gp:0.4,salesInvoiceNumber:'LOCKED',financialLockedBy:'ACCOUNT'};
  f.tables[f.orders].push(old);f.tables[f.tasks].push({...copy(f.task),_id:'X',title:'X',description:'OLD',imageAltText:'L2'});
  f.workspace.tasks.push({...copy(f.workspace.tasks[0]),id:'X',orderId:'OLD',sourceLineId:'L2',customerId:'C2'});
  f.dependencies.readRates=async currencies=>{assert.deepEqual(copy(currencies),['SGD']);f.calls.push('ONE_FX');return[{currency:'SGD',rateToMyr:3.2}];};
  const result=await f.read();assert.equal(result.tasks.find(row=>row.id==='T').gp,0.25);assert.equal(result.tasks.find(row=>row.id==='X').gp,0.4);
  assert.equal(result.tasks.find(row=>row.id==='X').stockTransferOutstanding,true);assert.equal(f.calls.filter(value=>value==='ONE_FX').length,1);
});

test('unknown rates stay unknown, missing short names warn, and incomplete relationship reads cannot clear halos',async()=>{
  const f=fixture();f.dependencies.readRates=async()=>{throw Error('FX unavailable');};f.dependencies.readCustomerShortNames=async()=>{throw Error('Names unavailable');};
  const result=await f.read();assert.equal(result.tasks[0].gp,null);assert.equal(result.tasks[0].sourceGp,null);
  assert.match(result.customerNamesError,/Short Name/);assert.equal(result.tasks[0].stockTransferOutstanding,true);
  const g=fixture();g.dependencies.readOutstanding=async()=>({schema:'CURRENT_BORROW_RELATIONS_V1',company:'NCT',view:'OUTSTANDING',generation:4,
    version:'a'.repeat(32),offset:0,total:1,items:[],nextCursor:null});await assert.rejects(g.read(),/Complete current transfer/);
});

test('denied staff, pending/control mode, changed generation, mismatched current context and missing coverage cannot use a legacy writer',async()=>{
  const denied=fixture();denied.dependencies.authenticate=async()=>{throw Error('Denied');};await assert.rejects(denied.read(),/Denied/);assert.equal(denied.calls.length,0);
  for(const kind of ['pending','mode','context','generation']){
    const f=fixture();if(kind==='pending')f.control.pending={key:'OTHER'};if(kind==='mode')f.control.mode='LEGACY';
    if(kind==='context')f.workspace.stockAllocationView=undefined;
    if(kind==='generation')f.dependencies.readCustomerShortNames=async()=>{f.control._version='C5';return[];};
    await assert.rejects(f.read(),/pending|current|changed|current Purchase/);
  }
});
