const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const meta = { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 3,stockIdentity:{staffId:'S',memberId:'SOURCE_SALES/S'} };
function fixture(db=new Map()) {
  const sent = [], timers = new Map(), sections = [], handlers = new Map(),events=[],gets=[]; let ids = 0,failWrite=false,failRemove=false;
  function element() {
    const nodes = new Map();
    return { nodes, open: false, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; },
      querySelector(selector) { return nodes.get(selector)||sections.at(-1)?.nodes.get(selector); },
      querySelectorAll(selector) { const children=[...nodes.values(),...(this===dialog?[...(sections.at(-1)?.nodes.values()||[])]:[])];
        return selector === '[data-task]' || selector === '[data-plan-task]' || selector === '[data-cancel]'
        ? children.filter(node => node.kind === selector) : children; },
      set innerHTML(html) { nodes.clear(); for (const match of html.matchAll(/data-([a-z-]+)(?:="([^"]*)")?/g)) {
        const key = '[data-' + match[1] + ']';
        if (!nodes.has(key)) nodes.set(key, { kind: key, value: '', checked: false, disabled: false, hidden: true, textContent: '',setAttribute(){},focus(){},
          dataset: { task: match[2], planTask: match[2], cancel: match[2] }, querySelector: selector => nodes.get(selector), after: section => sections.push(section) });
      } }
    };
  }
  const dialog = element(),dialogs=[], parent = { postMessage: request => {events.push('NETWORK');sent.push(structuredClone(request));} };
  const window = { parent,customerShipmentBatches:{notify(){}},dispatchEvent(){}, addEventListener: (name, handler) => {if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler);} };
  const context={
    window,parent,CustomEvent:function(){},document: { createElement: type => {if(type!=='dialog')return element();const value=dialogs.length?element():dialog;dialogs.push(value);return value;}, body: { appendChild() {} } },
    crypto: { randomUUID: () => String(++ids).padStart(8, '0') + '-1111-4111-8111-111111111111' },
    setTimeout: (fn, ms) => { const id = ++ids; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    sessionStorage:{getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Cache unavailable');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../prototypes/stock-current-state/source-sales-current-requests.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/sales-shipment-ui.candidate.js'), 'utf8'),context);
  function reply(result, extra = {}) {for(const handler of [...handlers.get('message')])handler({ source: parent, data: { type: 'SALES_ROOM_SHIPMENT_RESULT',
    requestId: sent.at(-1).requestId, company: 'NCT', ok: true, result, ...extra } }); }
  function start(action, stockCurrent = meta) {
    window.masterShipments.open('C');
    reply({ version: 'SHIP-V', planVersion: 'PLAN-V', lines: [{ taskId: 'T', orderId: 'O', barcode: '1', name: 'Item', packing: '12', available: 10, requested: 10 }],
      plans: [], shipments: [{ id: 'SHIP', status: 'REQUESTED', requestedAt: 'Today', requestedBy: 'Sales', lines: [{ quantity: 2 }] }], ...(stockCurrent ? { stockCurrent } : {}) });
    dialog.nodes.get('[data-reason]').value = 'Reason';
    if (action === 'SELECT') { dialog.nodes.get('[data-select]').checked = true; dialog.nodes.get('[data-qty]').value = '5'; dialog.nodes.get('[data-save]').onclick(); }
    if (action === 'CANCEL') dialog.nodes.get('[data-cancel]').onclick();
    if (action === 'PLAN') { const section = sections.at(-1); section.nodes.get('[data-plan-select]').checked = true;
      section.nodes.get('[data-first]').value = '4'; section.nodes.get('[data-second]').value = '6'; section.nodes.get('[data-plan-reason]').value = 'Split';
      section.nodes.get('[data-plan-save]').onclick(); }
  }
  return { sent, timers, dialog,dialogs,start, reply, handlers, window,db,events,gets,loadAdjustment:()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../prototypes/stock-current-state/sales-order-adjustment.candidate.js'),'utf8'),context),failWrite:()=>failWrite=true,failRemove:()=>failRemove=true,allowRemove:()=>failRemove=false,retry: () => dialog.nodes.get('[data-retry]').onclick() };
}

test('actual original SELECT/CANCEL/PLAN UI carries current READ metadata and preserves same request across phases', () => {
  for (const action of ['SELECT', 'CANCEL', 'PLAN']) {
    const f = fixture(); f.start(action); const request = structuredClone(f.sent.at(-1));
    assert.equal(request.action, action); assert.deepEqual(request.input.stockCurrent, meta);
    const oldTimeout = [...f.timers.values()].find(t => t.ms === 30000).fn;
    for (const phase of ['BEFORE', 'APPLY', 'VERIFY']) {
      f.reply({ ok: false, pending: true, requestId: request.requestId, phase, completedCount: 1, totalRecords: 3 });
      assert.equal(f.sent.length, phase === 'BEFORE' ? 2 : phase === 'APPLY' ? 3 : 4);
      const continuation = [...f.timers.entries()].find(([, timer]) => timer.ms === 250); assert.ok(continuation);
      f.timers.delete(continuation[0]); continuation[1].fn(); assert.deepEqual(f.sent.at(-1), request);
      oldTimeout(); assert.equal(f.dialog.nodes.get('[data-save]').disabled, true);
    }
    f.reply({ ok: true,company:'NCT',status:action==='CANCEL'?'CANCELLED':'REQUESTED',shipmentId:'SHIP',planId:'PLAN',requestId: request.requestId, stockGeneration: 4 });
    assert.equal(f.sent.at(-1).action, 'READ'); assert.equal(f.sent.at(-1).input, undefined);
  }
});

test('current unknown/error results and reopen cannot discard unresolved shipment; manual retry is identical', () => {
  const f = fixture(); f.start('PLAN'); const request = structuredClone(f.sent.at(-1));
  for (const result of [{}, { ok: true, requestId: request.requestId, stockGeneration: 3 },
    { ok: true, requestId: 'FOREIGN', stockGeneration: 4 }, { ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 4, totalRecords: 3 }]) {
    f.reply(result); const length = f.sent.length; f.window.masterShipments.open('OTHER'); assert.equal(f.sent.length, length);
    f.retry(); assert.deepEqual(f.sent.at(-1), request);
  }
  f.reply(null, { ok: false, error: 'Inventory changed; keep this original request' }); f.retry(); assert.deepEqual(f.sent.at(-1), request);
  let warned = false; const leave = { preventDefault: () => { warned = true; } };for(const handler of f.handlers.get('beforeunload'))handler(leave); assert.equal(warned, true);
});

test('legacy shipment response stays legacy and malformed current READ never admits a save', () => {
  const f = fixture(); f.start('CANCEL', null); assert.equal(f.sent.at(-1).input.stockCurrent, undefined); f.reply({ legacy: true });
  assert.equal(f.sent.at(-1).action, 'READ');
  const g = fixture(); g.window.masterShipments.open('C');
  g.reply({ stockCurrent: { ...meta, stockGeneration: -1 } }); assert.equal(g.dialog.nodes.get('[data-retry]').hidden, false);
  assert.match(g.dialog.nodes.get('[data-status]').textContent, /unavailable/);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function resume(f,customerId='C',staffId='S'){
  assert.deepEqual(f.sent.at(-1).input,{resume:'SOURCE_SALES_V1'});
  f.reply({ok:true,schema:'SOURCE_SALES_RESUME_V1',company:'NCT',customerId,staff:{staffId,memberId:'SOURCE_SALES/'+staffId}});
}
test('each original shipment action retains exact full request/view before send; unavailable cache prevents mutation',()=>{
  for(const action of ['SELECT','CANCEL','PLAN']){const f=fixture();f.start(action);assert.deepEqual(f.events,['NETWORK','CACHE','NETWORK']);
    const entry=JSON.parse([...f.db.values()][0]);assert.deepEqual(entry.request,f.sent.at(-1));assert.equal(entry.ui.kind,'SHIPMENT');assert.equal(entry.ui.customer,'C');
    const blocked=fixture();blocked.failWrite();blocked.start(action);assert.equal(blocked.sent.length,1);assert.equal(blocked.dialog.nodes.get('[data-save]').disabled,true);
    assert.match(blocked.dialog.nodes.get('[data-status]').textContent,/Cache unavailable/);
  }
});
test('SELECT CANCEL and PLAN reload keep exact original immutable inputs and await explicit retry after customer authorization',async()=>{
  for(const action of ['SELECT','CANCEL','PLAN']){
    const first=fixture();first.start(action);const request=structuredClone(first.sent.at(-1)),f=fixture(first.db);
    f.window.masterShipments.open('OTHER');f.reply({stockCurrent:meta});assert.equal(f.sent.at(-1).customerId,'C');resume(f);await tick();
    assert.equal(f.sent.filter(value=>value.action===action).length,0);assert.equal(f.dialog.nodes.get('[data-company]').disabled,true);
    assert.equal(f.dialog.nodes.get('[data-reason]').value,request.input.reason);
    if(action==='SELECT'){assert.equal(f.dialog.nodes.get('[data-select]').checked,true);assert.equal(f.dialog.nodes.get('[data-qty]').value,'5');}
    if(action==='PLAN'){const row=f.dialog.querySelectorAll('[data-plan-task]')[0];assert.equal(row.querySelector('[data-plan-select]').checked,true);
      assert.equal(row.querySelector('[data-first]').value,'4');assert.equal(row.querySelector('[data-second]').value,'6');assert.equal(row.querySelector('[data-first]').disabled,true);}
    f.retry();assert.deepEqual(f.sent.at(-1),request);assert.equal(f.db.size,1);
  }
});
test('pending company READ recovers owned shipment behind fence, but another staff member cannot read that cache',async()=>{
  const first=fixture();first.start('SELECT');const request=structuredClone(first.sent.at(-1)),f=fixture(first.db);
  f.window.masterShipments.open('C');f.reply(null,{ok:false,error:'Company save pending'});assert.equal(f.gets.length,0);
  resume(f);await tick();resume(f);await tick();f.retry();assert.deepEqual(f.sent.at(-1),request);
  const other=fixture(first.db);other.window.masterShipments.open('C');other.reply(null,{ok:false,error:'Company save pending'});resume(other,'C','OTHER');await tick();
  assert.equal(other.gets.some(key=>key.includes('/S/')),false);assert.equal(other.db.size,1);assert.equal(other.sent.filter(value=>value.action==='SELECT').length,0);
});
test('wrong final action receipt or failed cleanup retains exact shipment request instead of sending next READ',()=>{
  for(const action of ['SELECT','CANCEL','PLAN']){
    const f=fixture();f.start(action);const request=structuredClone(f.sent.at(-1));
    const receipt={ok:true,company:'NCT',status:action==='CANCEL'?'CANCELLED':'REQUESTED',shipmentId:'SHIP',planId:'PLAN',requestId:request.requestId,stockGeneration:4};
    for(const bad of [{...receipt,company:'GHR'},action==='PLAN'?{...receipt,planId:''}:{...receipt,status:'OTHER'}]){f.reply(bad);assert.equal(f.db.size,1);f.retry();assert.deepEqual(f.sent.at(-1),request);}
    f.failRemove();f.reply(receipt);assert.equal(f.sent.at(-1).action,action);assert.equal(f.db.size,1);f.allowRemove();f.retry();f.reply(receipt);
    assert.equal(f.db.size,0);assert.equal(f.sent.at(-1).action,'READ');
  }
});
test('late queued phase continuation cannot send the post-commit READ or another request',()=>{
  const f=fixture();f.start('SELECT');const request=f.sent.at(-1);
  f.reply({ok:false,pending:true,requestId:request.requestId,phase:'APPLY',completedCount:1,totalRecords:2});
  const old=[...f.timers.values()].find(timer=>timer.ms===250).fn;
  f.reply({ok:true,company:'NCT',status:'REQUESTED',shipmentId:'SHIP',requestId:request.requestId,stockGeneration:4});
  const length=f.sent.length;old();assert.equal(f.sent.length,length);assert.equal(f.sent.at(-1).action,'READ');
});
test('opening adjustment after reload routes owned shipment to actual original shipment dialog, never creates a second save',async()=>{
  const first=fixture();first.start('SELECT');const request=structuredClone(first.sent.at(-1)),f=fixture(first.db);f.loadAdjustment();
  f.window.salesOrderAdjustment.open({company:'NCT',customerId:'C',orderId:'O',lineId:'L',quantity:100});f.reply({stockCurrent:meta});resume(f);await tick();
  assert.equal(f.dialogs.length,2);assert.equal(f.dialogs[0].open,false);assert.equal(f.dialogs[1].open,true);assert.equal(f.dialogs[1].className,'master-shipment-dialog');
  assert.equal(f.sent.filter(value=>value.action==='SELECT').length,0);f.dialogs[1].nodes.get('[data-retry]').onclick();assert.deepEqual(f.sent.at(-1),request);
});
test('opening shipment routes owned adjustment into original adjustment view with original quantity and retry request',async()=>{
  const first=fixture(),request={type:'SALES_ROOM_SHIPMENT_REQUEST',company:'NCT',customerId:'C',requestId:'11111111-1111-4111-8111-111111111111',action:'ADJUST',input:{orderId:'O',taskId:'T',mode:'SPLIT',quantity:4,version:'ADJ',stockCurrent:meta}};
  first.window.sourceSalesCurrent.retain(request,{kind:'ADJUST',selection:{company:'NCT',customerId:'C',orderId:'O',lineId:'L',quantity:10},data:{line:{taskId:'T',requested:10},quantity:10,version:'ADJ',stockCurrent:meta},mode:'SPLIT'});
  const f=fixture(first.db);f.loadAdjustment();f.window.masterShipments.open('C');f.reply({stockCurrent:meta});resume(f);await tick();
  assert.equal(f.dialogs.length,2);assert.equal(f.dialogs[0].open,false);const adjusted=f.dialogs[1];assert.equal(adjusted.open,true);assert.equal(adjusted.className,'order-adjustment-dialog');
  assert.equal(adjusted.nodes.get('[data-first]').value,'4');assert.equal(adjusted.nodes.get('[data-first]').disabled,true);
  assert.equal(f.sent.filter(value=>value.action==='ADJUST').length,0);adjusted.nodes.get('[data-retry]').onclick();assert.deepEqual(f.sent.at(-1),request);
});
