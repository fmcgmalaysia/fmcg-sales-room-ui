const test = require('node:test'), assert = require('node:assert/strict');
const { createPurchaseMarginRefresh } = require('./load-master-module.cjs')('purchaseMarginRefresh.js');
const { operationId } = require('./load-master-module.cjs')('purchaseOperationJournal.js');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const names = { orders: 'NCTOrders', tasks: 'NCTTasks', activity: 'NCTActivity' }, rows = new Map();
  const order = { _id: 'O', title: 'ORDER', sourceLineId: 'LINE', transactionCurrency: 'SGD', sellingPricePc: 10, orderId: 10,
    salesInvoiceNumber: '', gp: .1, adminFxSource: 3, orderQtyInCtn: 100, customerId: 'C' };
  const task = { _id: 'T', title: 'T', description: 'ORDER', imageAltText: 'LINE', purchaseQtyInCtn: 90,
    lpCtn: 240, lpPc: 24, disc1: 0, disc2: 0, disc3: 0 };
  rows.set(names.orders + '/O', clone(order)); rows.set(names.tasks + '/T', clone(task));
  const store = { read: async (c, id) => clone(rows.get(c + '/' + id) || null),
    insert: async (c, row) => { if (rows.has(c + '/' + row._id)) throw Error('Duplicate'); rows.set(c + '/' + row._id, clone(row)); },
    update: async (c, row) => rows.set(c + '/' + row._id, clone(row)), remove: async (c, id) => rows.delete(c + '/' + id) };
  let rate = 3.2;
  const input = () => ({ company: 'NCT', names, orders: [clone(rows.get(names.orders + '/O'))], tasks: [clone(rows.get(names.tasks + '/T'))],
    workspace: { tasks: [{ id: 'T', orderId: 'ORDER', sourceLineId: 'LINE',ord:90,supplierId:'S',procurement:{totalCtn:90,revision:'SAVED-PLAN'} }] } });
  const refresh = createPurchaseMarginRefresh({ store, readRates: async () => [{ currency: 'SGD', rateToMyr: rate, updatedAt: '2026-10-10T14:00:00Z' }] });
  return { names, rows, store, refresh, input, setRate: value => { rate = value; }, events: () => [...rows.values()].filter(row => row.action === 'GP_RECALCULATED') };
}
test('open GP uses latest Admin FX, persists only margin/FX cache, audits recalculation and skips unchanged reads', async () => {
  const f = fixture(), originalTask = clone(f.rows.get('NCTTasks/T'));
  assert.equal((await f.refresh(f.input())).get('T'), .25);
  assert.equal(f.rows.get('NCTOrders/O').gp, .25); assert.equal(f.rows.get('NCTOrders/O').adminFxSource, 3.2);
  assert.deepEqual(f.rows.get('NCTTasks/T'), originalTask); assert.equal(f.rows.get('NCTOrders/O').orderQtyInCtn, 100);
  assert.equal(f.rows.get('NCTOrders/O').sellingPricePc, 10); assert.equal(f.events().length, 1);
  await f.refresh(f.input()); assert.equal(f.events().length, 1);
  f.setRate(4); assert.equal((await f.refresh(f.input())).get('T'), .4); assert.equal(f.events().length, 2);
  assert.equal(f.events()[1].actorType, 'SYSTEM'); assert(!isNaN(Date.parse(f.events()[1].activityTime)));
});
test('missing current rate/cost never exposes the previous cached margin or substitutes zero', async () => {
  const f = fixture(); f.setRate(null); assert.equal((await f.refresh(f.input())).get('T'), null); assert.equal(f.events().length, 0);
  f.setRate(3.2); f.rows.get('NCTTasks/T').disc3 = null;
  assert.equal((await f.refresh(f.input())).get('T'), null); assert.equal(f.rows.get('NCTOrders/O').gp, .1);
  const refresh = createPurchaseMarginRefresh({ store: f.store, readRates: async () => { throw Error('Offline'); } });
  assert.equal((await refresh(f.input())).get('T'), null);
});
test('saved invoice snapshot is read-only, bare invoice without financial lock fails closed', async () => {
  const f = fixture(), order = f.rows.get('NCTOrders/O'); order.salesInvoiceNumber = 'INV-001';
  assert.equal((await f.refresh(f.input())).get('T'), null);
  order.financialLockedBy = 'STAFF'; order.gp = .375; f.setRate(5);
  assert.equal((await f.refresh(f.input())).get('T'), .375); assert.equal(order.adminFxSource, 3); assert.equal(f.events().length, 0);
});
test('concurrent cost save, invoice or quote changes cannot be overwritten by margin refresh', async () => {
  for (const mutation of [row => { row.salesInvoiceNumber = 'INV'; }, row => { row.sellingPricePc = 12; }]) {
    const f = fixture(), input = f.input(); mutation(f.rows.get('NCTOrders/O'));
    assert.equal((await f.refresh(input)).get('T'), null); assert.equal(f.events().length, 0);
  }
  const f = fixture(), input = f.input(); f.rows.get('NCTTasks/T').lpCtn = 260;
  assert.equal((await f.refresh(input)).get('T'), null); assert.equal(f.events().length, 0);
  const g = fixture(), lockId = operationId('NCT', 'T', 'COST_LOCK');
  g.rows.set('NCTActivity/' + lockId, { _id: lockId, details: { requestId: 'OTHER' } });
  assert.equal((await g.refresh(g.input())).get('T'), null); assert.equal(g.events().length, 0);
  assert.equal(g.rows.get('NCTActivity/' + lockId).details.requestId, 'OTHER');
});
test('lost cache write leaves no held task lock and the next refresh repairs GP without editing quantity', async () => {
  const f = fixture(), update = f.store.update; let fail = true;
  f.store.update = async (...args) => { if (fail) { fail = false; throw Error('Lost write'); } return update(...args); };
  assert.equal((await f.refresh(f.input())).get('T'), null);
  assert.equal(f.rows.has('NCTActivity/' + operationId('NCT', 'T', 'GP_LOCK')), false);
  assert.equal((await f.refresh(f.input())).get('T'), .25); assert.equal(f.rows.get('NCTTasks/T').purchaseQtyInCtn, 90);
});
test('failed GP lock cleanup cannot take the procurement save lock or fail the whole workspace', async () => {
  const f = fixture(); f.store.remove = async () => { throw Error('Cleanup unavailable'); };
  assert.equal((await f.refresh(f.input())).get('T'), null);
  assert.equal(f.rows.has('NCTActivity/' + operationId('NCT', 'T', 'COST_LOCK')), false);
  assert.equal(f.rows.has('NCTActivity/' + operationId('NCT', 'T', 'GP_LOCK')), true);
});

function withInvoice(input, quantity) {
  input.workspace.tasks[0].ord = 90;
  const line = { taskId:'T',quantity,sources:[{sourceTaskId:'T',quantity}] };
  const shipment = { id:'SHIP',company:'NCT',customerId:'C',currency:'SGD',status:'REQUESTED',lines:[line] };
  const event = { action:'CUSTOMER_SHIPMENT_CHANGED',result:'SAVED',description:'SHIP',activityTime:'2026-10-12T00:00:00Z',initiatedByStaffName:'SUPPORT' };
  input.activity = [
    {...event,title:'SELECT',details:{beforeRevision:'',shipment:clone(shipment)}},
    {...event,title:'INVOICE',details:{beforeRevision:'SELECT',shipment:{...shipment,status:'INVOICED',
      invoice:{number:'SI-001',date:'2026-10-12',amountCents:quantity*10000,currency:'SGD',rateToMyr:3,at:event.activityTime,by:'SUPPORT',byStaffId:'S'},
      lines:[{...line,sellingPriceCtn:100,rateToMyr:3,costSources:[{sourceTaskId:'T',quantity,netCostCtn:240}]}]}}}
  ];
  return input;
}

function withSources(f, input) {
  const source = { ...clone(f.rows.get('NCTTasks/T')), _id: 'B', title: 'B', procurementSource: true, customerDemandTaskId: 'T', purchaseQtyInCtn: 0, lpCtn: 300 };
  f.rows.set('NCTTasks/B', clone(source)); input.tasks.push(source);
  input.workspace.tasks[0].procurement = { totalCtn: 60,revision:'SAVED-A' };
  input.workspace.tasks.push({ id: 'B',orderId:'ORDER',sourceLineId:'LINE',ord:0, procurementSource: true, customerDemandTaskId: 'T', procurement: { totalCtn: 30,revision:'SAVED-B' } });
  return input;
}

test('multiple suppliers contribute weighted open cost while demand and each supplier price remain unchanged', async () => {
  const f = fixture(), input = withSources(f, f.input()), before = clone(input.tasks);
  assert.equal((await f.refresh(input)).get('T'), (320 - 260) / 320);
  assert.deepEqual(input.tasks, before); assert.equal(f.rows.get('NCTOrders/O').orderQtyInCtn, 100);
  assert.equal(f.rows.get('NCTTasks/B').lpCtn, 300);
});

test('supplier surplus stays out of the customer weighted GP cost',async()=>{
 const f=fixture(),input=withSources(f,f.input());input.workspace.tasks[1].procurement.expectedExtra=10;input.workspace.tasks[0].ord=80;
 assert.equal((await f.refresh(input)).get('T'),(320-255)/320);
 assert.equal(input.workspace.tasks[1].procurement.totalCtn,30);assert.equal(f.rows.get('NCTTasks/B').lpCtn,300);
});

test('partial invoice preserves its source snapshot and weights only remaining supplier cartons at current FX', async () => {
  const f = fixture(); f.setRate(4);
  const input = withSources(f, withInvoice(f.input(), 40));
  const revenue = 40 * 100 * 3 + 50 * 100 * 4;
  assert.equal((await f.refresh(input)).get('T'), (revenue - 40 * 240 - 20 * 240 - 30 * 300) / revenue);
  assert.equal(f.rows.get('NCTOrders/O').salesInvoiceSummary[0].rateToMyr, 3);
});

test('missing or concurrently edited secondary supplier cost cannot expose an inaccurate GP', async () => {
  for (const kind of ['missing', 'changed', 'locked']) {
    const f = fixture(), input = withSources(f, f.input());
    if (kind === 'missing') input.tasks[1].disc3 = null;
    if (kind === 'changed') f.rows.get('NCTTasks/B').lpCtn = 310;
    if (kind === 'locked') f.rows.set('NCTActivity/' + operationId('NCT', 'B', 'COST_LOCK'), { details: { requestId: 'OTHER' } });
    assert.equal((await f.refresh(input)).get('T'), null); assert.equal(f.events().length, 0);
  }
});

test('partial invoice writes CMS invoice summary and weighted GP without locking the remaining quantity', async () => {
  const f=fixture(); f.setRate(4); const input=withInvoice(f.input(),40);
  const expected=(40*100*3+50*100*4-90*240)/(40*100*3+50*100*4);
  assert.equal((await f.refresh(input)).get('T'),expected);
  const saved=f.rows.get('NCTOrders/O');assert.equal(saved.gp,expected);
  assert.equal(saved.salesInvoiceSummary[0].number,'SI-001');assert.equal(saved.salesInvoiceSummary[0].quantity,40);
  assert.equal(saved.salesInvoiceSummary[0].by,'SUPPORT');assert.equal(saved.salesInvoiceSummary[0].rateToMyr,3);
  assert.equal(saved.salesInvoiceNumber,'');assert.equal(saved.sellingPricePc,10);
  await f.refresh(withInvoice(f.input(),40));assert.equal(f.events().length,1);
  f.setRate(5);await f.refresh(withInvoice(f.input(),40));assert.equal(f.rows.get('NCTOrders/O').salesInvoiceSummary[0].rateToMyr,3);
  assert.notEqual(f.rows.get('NCTOrders/O').gp,expected);
});

test('fully invoiced GP and invoice summary cache do not require a current FX service response', async () => {
  const f=fixture(),refresh=createPurchaseMarginRefresh({store:f.store,readRates:async()=>{throw Error('Offline');}});
  assert.equal((await refresh(withInvoice(f.input(),90))).get('T'),.2);
  const saved=f.rows.get('NCTOrders/O');assert.equal(saved.gp,.2);assert.equal(saved.salesInvoiceSummary[0].rateToMyr,3);
  assert.equal(saved.adminFxSource,3);assert.equal(f.rows.get('NCTTasks/T').purchaseQtyInCtn,90);
});
test('unplanned reference prices and partially covered demand cannot produce a GP or refresh its cache',async()=>{
 for(const plan of [{totalCtn:null,revision:''},{totalCtn:90,revision:''},{totalCtn:60,revision:'PARTIAL'}]){
  const f=fixture(),input=f.input();input.workspace.tasks[0].procurement=plan;const before=clone(f.rows.get('NCTOrders/O'));
  assert.equal((await f.refresh(input)).get('T'),null);assert.deepEqual(f.rows.get('NCTOrders/O'),before);assert.equal(f.events().length,0);
 }
});
test('confirmed plan amount owns GP instead of stale task/reference prices, including FOC and inventory surplus',async()=>{
 for(const [total,extra,cents]of [[90,0,1620000],[110,20,100000]]){
  const f=fixture(),input=f.input();input.workspace.tasks[0].procurement={revision:'SAVED',totalCtn:total,expectedExtra:extra,costing:{schema:1,totalCtn:total,amountCents:cents,averageCostCtn:cents/100/total}};
  const before=clone(f.rows.get('NCTTasks/T'));assert.equal((await f.refresh(input)).get('T'),(320-cents/100/total)/320);assert.deepEqual(f.rows.get('NCTTasks/T'),before);
 }
});
test('missing or inconsistent confirmed amount cannot fall back to a reference price',async()=>{
 for(const costing of [{totalCtn:90,amountCents:null},{totalCtn:89,amountCents:1620000},{totalCtn:90,amountCents:-1}]){
  const f=fixture(),input=f.input();input.workspace.tasks[0].procurement.costing=costing;assert.equal((await f.refresh(input)).get('T'),null);assert.equal(f.events().length,0);
 }
});
test('multiple confirmed source amounts are weighted by customer share and keep invoice snapshots frozen',async()=>{
 for(const invoice of [false,true]){
  const f=fixture(),input=withSources(f,invoice?withInvoice(f.input(),40):f.input());f.setRate(4);
  for(const [row,cost]of [[input.workspace.tasks[0],120],[input.workspace.tasks[1],300]])row.procurement.costing={schema:1,totalCtn:row.procurement.totalCtn,amountCents:cost*row.procurement.totalCtn*100,averageCostCtn:cost};
  const expected=invoice?(40*100*3+50*100*4-40*240-20*120-30*300)/(40*100*3+50*100*4):(400-180)/400;
  assert.equal((await f.refresh(input)).get('T'),expected);if(invoice)assert.equal(input.activity.at(-1).details.shipment.lines[0].costSources[0].netCostCtn,240);
 }
});
test('Sales invoice cache refresh retains supplier children and uses their confirmed costs',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),f=fixture(),input=withSources(f,withInvoice(f.input(),40));
 input.workspace.tasks[0].procurement.costing={schema:1,totalCtn:60,amountCents:720000,averageCostCtn:120};
 for(const [i,event]of input.activity.entries())f.rows.set('NCTActivity/INVOICE-'+i,{_id:'INVOICE-'+i,...clone(event)});
 const wixData={query:collection=>{const filters=[];return {limit(){return this},eq(key,value){filters.push([key,value]);return this},async find(){return {items:[...f.rows].filter(([key,row])=>key.startsWith(collection+'/')&&filters.every(([field,value])=>row[field]===value)).map(([,row])=>clone(row)),hasNext:()=>false}}}},insert:f.store.insert,update:f.store.update,remove:f.store.remove};
 let source=fs.readFileSync(path.join(__dirname,'../backend/customerFulfilmentService.js'),'utf8'),bindings={wixData};
 for(const match of source.matchAll(/^import \{([^}]+)\} from '[^']+';/gm))for(const name of match[1].split(',').map(x=>x.trim()))bindings[name]=()=>null;
 Object.assign(bindings,{PURCHASE_COLLECTIONS:{NCT:f.names},projectPurchaseWorkspace:()=>clone(input.workspace),createPurchaseMarginRefresh,readCurrentAdminFx:async()=>[{currency:'SGD',rateToMyr:4}],readCustomerShipments:require('./load-master-module.cjs')('customerShipmentLedger.js').readCustomerShipments,createCustomerFulfilmentOperations:()=>async()=>({shipmentId:'SHIP'})});
 source=source.replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');const save=vm.runInNewContext('(function(){'+source+';return saveCustomerFulfilment;})()',bindings);
 await save({company:'NCT',staff:{},input:{action:'INVOICE'}});const revenue=40*100*3+50*100*4;assert.equal(f.rows.get('NCTOrders/O').gp,(revenue-40*240-20*120-30*300)/revenue);
});

test('partial allocation calculates each saved supplier independently including the first source sharing the mother ID',async()=>{
 const f=fixture(),input=withSources(f,f.input());input.workspace.tasks[0].ord=120;
 const before=clone(f.rows.get('NCTOrders/O')),result=await f.refresh(input);
 assert.equal(result.get('T'),null);assert.equal(result.get('SOURCE:T'),.25);assert.equal(result.get('SOURCE:B'),.0625);
 assert.deepEqual(f.rows.get('NCTOrders/O'),before);assert.equal(f.events().length,0);
});

test('incomplete or concurrently edited source cost hides only that individual source while mother stays unknown',async()=>{
 for(const kind of ['unconfirmed','missing','changed','locked']){
  const f=fixture(),input=withSources(f,f.input());input.workspace.tasks[0].ord=120;
  if(kind==='unconfirmed')input.workspace.tasks[1].procurement.revision='';
  if(kind==='missing')input.tasks[1].disc3=null;
  if(kind==='changed')f.rows.get('NCTTasks/B').lpCtn=310;
  if(kind==='locked')f.rows.set('NCTActivity/'+operationId('NCT','B','COST_LOCK'),{details:{requestId:'OTHER'}});
  const result=await f.refresh(input);assert.equal(result.get('T'),null);assert.equal(result.get('SOURCE:T'),.25);assert.equal(result.get('SOURCE:B'),null);assert.equal(f.events().length,0);
 }
});

test('individual source GP preserves its own invoiced cost and FX and does not copy the mother aggregate',async()=>{
 const f=fixture(),input=withSources(f,withInvoice(f.input(),40));input.workspace.tasks[0].ord=120;f.setRate(4);
 input.workspace.tasks[0].procurement.costing={totalCtn:60,amountCents:720000};
 const result=await f.refresh(input),revenue=40*100*3+20*100*4;
 assert.equal(result.get('T'),null);assert.equal(result.get('SOURCE:T'),(revenue-40*240-20*120)/revenue);assert.equal(result.get('SOURCE:B'),.25);assert.equal(f.events().length,0);
 assert.equal(input.activity.at(-1).details.shipment.lines[0].costSources[0].netCostCtn,240);
});

test('unknown source margins avoid redundant CMS reads without exposing cached values or changing records',async()=>{
 for(const kind of ['unplanned','missing-cost','missing-rate']){
  const f=fixture(),input=f.input(),before=clone([...f.rows]),calls=[];
  if(kind==='unplanned')input.workspace.tasks[0].procurement={totalCtn:null,revision:''};
  if(kind==='missing-cost')input.tasks[0].disc3=null;
  const store={...f.store,read:async(...args)=>{calls.push(args);return f.store.read(...args);}};
  const refresh=createPurchaseMarginRefresh({store,readRates:async()=>kind==='missing-rate'?[]:[{currency:'SGD',rateToMyr:3.2}]});
  const result=await refresh(input);
  assert.equal(result.get('T'),null);assert.equal(result.get('SOURCE:T'),null);
  assert.deepEqual(calls,[]);assert.deepEqual(clone([...f.rows]),before);
 }
});
