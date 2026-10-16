const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.PURCHASE_UI_BASELINE || path.join(__dirname, '../../purchase-live/app.js'), 'utf8');
test('each checked orange source PO opens the same cross-row selection without a top PO control',()=>{
 for(const clicked of ['TASK','OTHER-CHILD']){
  const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SAME SUPPLIER'},{id:'B',name:'OTHER SUPPLIER'}];
  Object.assign(w.tasks[0],{supplierId:'S',po:'',editVersion:'V1',procurement:{totalCtn:20,revision:'P1'}});
  w.tasks.push({...w.tasks[0],id:'SIBLING',supplierId:'B',ord:0,procurementSource:true,customerDemandTaskId:'TASK',procurement:{totalCtn:10,revision:'P2'}},
   {...w.tasks[0],id:'OTHER',supplierId:'B',procurement:{totalCtn:40,revision:'P3'}},
   {...w.tasks[0],id:'OTHER-CHILD',ord:0,procurementSource:true,customerDemandTaskId:'OTHER',editVersion:'V2',procurement:{totalCtn:15,revision:'P4'}});
  h.reply(w);h.click({view:'active'});for(const id of ['TASK','OTHER-CHILD'])h.change({dataset:{select:id,selectKind:'source'},checked:true});
  assert.doesNotMatch(h.node('#app').innerHTML,/id="createSelectedPo"/);
  h.click({sourcePoTask:clicked});assert.match(h.node('#dialogContent').innerHTML,/35 CTN/);
  h.node('#poNumber').value='NCT-PO-MERGE';h.click({controlId:'savePo'});const sent=h.messages.at(-1);
  assert.deepEqual(Array.from(sent.input.taskIds),['TASK','OTHER-CHILD']);assert.equal(sent.input.versions.TASK,'V1');assert.equal(sent.input.versions['OTHER-CHILD'],'V2');
 }
});
test('orange source PO keeps unchecked and mixed-supplier selections from accidental merging; green PO still reviews',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'FIRST'},{id:'B',name:'SECOND'}];Object.assign(w.tasks[0],{supplierId:'S',po:'',procurement:{totalCtn:20,revision:'P1'}});
 w.tasks.push({...w.tasks[0],id:'CHILD',supplierId:'B',ord:0,procurementSource:true,customerDemandTaskId:'TASK',procurement:{totalCtn:15,revision:'P2'}},
  {...w.tasks[0],id:'GREEN',po:'NCT-PO-EXISTING'});h.reply(w);h.click({view:'active'});
 h.change({dataset:{select:'TASK',selectKind:'source'},checked:true});h.click({sourcePoTask:'CHILD'});assert.match(h.node('#liveStatus').textContent,/已勾选行/);assert.equal(h.node('#modal').open,false);
 h.change({dataset:{select:'CHILD',selectKind:'source'},checked:true});h.click({sourcePoTask:'CHILD'});assert.match(h.node('#liveStatus').textContent,/同一供应商/);assert.match(h.node('#app').innerHTML,/2 selected/);assert.equal(h.node('#modal').open,false);
 h.click({sourcePoTask:'GREEN'});assert.match(h.node('#dialogContent').innerHTML,/Review P.O./);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="savePo"/);assert.equal(h.messages.length,1);
});
test('clicked progress stage opens its task with explicit receiving issue instead of a false completion',()=>{
 const h=harness(),w=workspace();w.tasks[0].warehouse={accepted:250,hasPhysicalReceipt:true,issue:true};w.tasks[0].procurement={totalCtn:250,revision:'P'};h.reply(w);const before=h.messages.length;
 h.click({progressTask:'TASK',progressIndex:'3',progressIsSource:'true'});assert.match(h.node('#dialogContent').innerHTML,/current-progress problem/);assert.match(h.node('#dialogContent').innerHTML,/Problem 待解决/);assert.match(h.node('#dialogContent').innerHTML,/00123/);assert.equal(h.messages.length,before);
});

test('mother progress names the blocked source and drills into only that source without submitting writes',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'FIRST'},{id:'B',name:'SECOND'}];Object.assign(w.tasks[0],{supplierId:'S',ord:100,po:'PO-A',procurement:{totalCtn:60,revision:'P1'}});w.tasks.push({...w.tasks[0],id:'CHILD',supplierId:'B',ord:0,po:'',procurementSource:true,customerDemandTaskId:'TASK',procurement:{totalCtn:30,revision:'P2'}});h.reply(w);const before=h.messages.length;
 h.click({progressTask:'TASK',progressIndex:'0',progressIsSource:'false'});let html=h.node('#dialogContent').innerHTML;assert.match(html,/current-progress pending/);assert.match(html,/FIRST/);assert.match(html,/SECOND/);assert.match(html,/data-progress-task="CHILD" data-progress-index="0" data-progress-is-source="true"/);assert.match(html,/待安排需求/);assert.match(html,/data-plan-task="TASK"/);
 h.click({progressTask:'CHILD',progressIndex:'0',progressIsSource:'true'});html=h.node('#dialogContent').innerHTML;assert.match(html,/SECOND · P.O./);assert.match(html,/data-source-po-task="CHILD"/);assert.doesNotMatch(html,/FIRST|Sources \/ 来源明细/);assert.equal(h.messages.length,before);
 h.click({progressTask:'TASK',progressIndex:'0',progressIsSource:'true'});assert.match(h.node('#dialogContent').innerHTML,/current-progress complete/);assert.match(h.node('#dialogContent').innerHTML,/data-po-view="TASK"/);
});
test('disabled demand selection is ignored; first source selection opens only that PO and mixed suppliers remain blocked',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{supplierId:'S',procurement:{totalCtn:60,revision:'P1'}});w.suppliers=[{id:'S',name:'FIRST'},{id:'B',name:'SECOND'}];w.tasks.push({...w.tasks[0],id:'CHILD',supplierId:'B',ord:0,procurementSource:true,customerDemandTaskId:'TASK',procurement:{totalCtn:40,revision:'P2'}});h.reply(w);h.click({customer:'C'});
 h.change({dataset:{select:'TASK',selectKind:'demand'},checked:true,disabled:true});assert.match(h.node('#app').innerHTML,/0 selected/);
 h.change({dataset:{select:'TASK',selectKind:'source'},checked:true});assert.match(h.node('#app').innerHTML,/1 selected/);h.click({controlId:'createSelectedPo'});assert.match(h.node('#dialogContent').innerHTML,/60 CTN/);
 h.change({dataset:{select:'CHILD',selectKind:'source'},checked:true});h.click({controlId:'createSelectedPo'});assert.match(h.node('#liveStatus').textContent,/同一供应商/);
 h.click({controlId:'clearSelection'});assert.match(h.node('#app').innerHTML,/0 selected/);
});
test('PO submit dialog sends one complete saved version with optional urgency and no accidental term edit',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const request=h.messages.at(-1);
 const row={id:'PO',version:'PV',number:'NCT-PO-1',supplierName:'SUPPLIER',amount:1000,taskIds:['TASK','OTHER'],state:'ACTIVE',status:'Pending Payment',documents:[],history:[],documentStatus:'MISSING',termDays:30,procurementHandoff:{stage:'LEGACY',submitted:false}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(h.node('#app').innerHTML,/data-po-overview="PO"/);h.click({view:'payments'});assert.doesNotMatch(h.node('#app').innerHTML,/data-po-overview="PO"/);h.click({poOverview:'PO'});assert.match(h.node('#dialogContent').innerHTML,/提交财务/);h.click({poHandoff:'PO',handoffAction:'SUBMIT_FINANCE'});
 assert.match(h.node('#dialogContent').innerHTML,/2 行/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="poTermDays"/);
 h.node('#poChangeReason').value='Confirmed both sources';h.node('#poUrgent').checked=true;h.click({controlId:'savePurchaseOrderMeta'});
 const sent=h.messages.at(-1);assert.equal(sent.type,'PURCHASE_ORDER_SAVE_REQUEST');assert.equal(sent.input.action,'SUBMIT_FINANCE');assert.equal(sent.input.version,'PV');assert.equal(sent.input.urgent,true);assert.equal(sent.input.termDays,undefined);
});
function harness(storage,feedbackRows=[],signals=null,dialogFields=[]) {
  const nodes = new Map(), listeners = new Map(), messages = [], timers = [], intervals=[];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { innerHTML:'', textContent:'', value:'NCT', open:false, dataset:{},
      classList:{ toggle(){},remove(){},add(){} }, insertAdjacentHTML(position,html){node('#dialogContent').innerHTML+=html;}, addEventListener(type,callback){ listeners.set(id+':'+type,callback); },
      showModal(){ this.open=true; }, close(){ this.open=false; }, focus(){},setSelectionRange(){} });
    return nodes.get(id);
  }
  const parent = { postMessage:message => messages.push(message) }, window = { parent,masterTaskSignals:signals, addEventListener(type,callback){ const key='window:'+type;listeners.set(key,[...(listeners.get(key)||[]),callback]); } };
  let count=0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/task-grid.js'),'utf8'),{window});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/dashboard.js'),'utf8'),{window});
  vm.runInNewContext(source,{ window, document:{ querySelector:selector=>selector.startsWith('#planPrice-')&&!node('#dialogContent').innerHTML.includes('id="planPrice-')?null:node(selector), querySelectorAll:selector=>selector==='#taskRows tr[data-id],#taskRows tr[data-source-id]'?feedbackRows:selector.startsWith('#dialogContent input')?dialogFields:selector.includes("#taskRows .drop-target")||selector.includes("#taskRows .grip-down")?feedbackRows.filter(row=>["grip-down","dragging-row","drop-target"].some(name=>selector.includes("."+name)&&row.classes.has(name))):[], addEventListener(type,callback){
    const key='document:'+type;listeners.set(key,[...(listeners.get(key)||[]),callback]); } },
    crypto:{ randomUUID:()=>String(++count) }, btoa:binary=>Buffer.from(binary,'binary').toString('base64'),sessionStorage:storage,setTimeout:callback=>timers.push(callback),setInterval:callback=>intervals.push(callback), Date, Number, Map, Set });
  function reply(workspace,request=messages.at(-1),extra={}) {
    for(const callback of listeners.get('window:message')) callback({ source:parent,data:{type:'PURCHASE_WORKSPACE_RESULT',requestId:request.requestId,company:request.company,ok:true,workspace,...extra} });
  }
  return { node,messages,timers,intervals,reply,
    event(type,target,extra={}){for(const callback of listeners.get('document:'+type)||[])callback({...extra,target});},
    send(message){for(const callback of listeners.get('window:message'))callback({source:parent,data:message});},
    change(attrs){for(const callback of listeners.get('document:change')||[])callback({target:attrs});},
    click(attrs){const control={ id:attrs.controlId||'',dataset:attrs };for(const callback of listeners.get('document:click'))callback({ target:{ closest:selector=>selector==='button'?control:selector==='#closeModal'&&control.id==='closeModal'?control:selector==='[data-supplier-tab]'&&attrs.supplierTab?control:selector==='#addSupplierContact'&&control.id==='addSupplierContact'?control:null } }); },
    switchCompany(value){listeners.get('#companySelect:change')({target:{value}});} };
}
const workspace=()=>({ company:'NCT',staff:{staffId:'STAFF',memberId:'MEMBER',staffName:'ACTUAL STAFF'},fetchedAt:'2026-10-10T03:00:00Z',suppliers:[],
  customers:[{id:'C',name:'ACTUAL CUSTOMER'}],tasks:[{id:'TASK',customerId:'C',orderId:'ORDER',barcode:'00123',name:'ACTUAL PRODUCT',packing:'SIZE x16',
    ord:250,inc:null,stage:'NEW_INCOMING',lpPc:1,lpCtn:16,disc1:.1,disc2:.05,disc3:2,netCostCtn:11.68,costStatus:'ERROR',
    costErrorReason:'UNAVAILABLE_LPCTN',submittedByName:'ACTUAL SALESPERSON',history:[]}] });

test('Dashboard customer Entry opens Active Orders filtered to that customer, preserving sources and requiring no save',()=>{
 const h=harness(),w=workspace();w.customers.push({id:'D',name:'OTHER CUSTOMER'});Object.assign(w.tasks[0],{supplierId:'S',po:'NCT-PO-1',procurement:{totalCtn:200,revision:'P'}});w.suppliers=[{id:'S',name:'SUPPLIER'}];w.tasks.push({...w.tasks[0],id:'CHILD',customerDemandTaskId:'TASK',procurementSource:true,ord:0,po:'',procurement:{totalCtn:30,revision:'P2'}},{...w.tasks[0],id:'OTHER',customerId:'D',name:'OTHER PRODUCT'});h.reply(w);
 assert.match(h.node('#app').innerHTML,/class="room-entry" data-dashboard-entry="true" data-customer="C"/);
 h.click({customer:'C',dashboardEntry:'true'});const html=h.node('#app').innerHTML;assert.match(html,/active-order-heading/);assert.match(html,/<option value="C" selected/);assert.match(html,/data-source-id="CHILD"/);assert.doesNotMatch(html,/OTHER PRODUCT|class="roomhead"|<th>Progress<\/th>/);assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);
 h.click({poTask:'TASK'});assert.match(h.node('#dialogContent').innerHTML,/Review P.O./);
});

test('Dashboard Entry preserves another customer price draft and saves it with its original task/version',()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV-C';w.customers.push({id:'D',name:'OTHER CUSTOMER'});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D',name:'OTHER PRODUCT'});h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});h.click({view:'dashboard'});h.click({customer:'D',dashboardEntry:'true'});
 assert.match(h.node('#app').innerHTML,/active-order-heading/);assert.match(h.node('#app').innerHTML,/<option value="D" selected/);assert.match(h.node('#app').innerHTML,/OTHER PRODUCT/);assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);
 h.click({controlId:'saveEdits'});const sent=h.messages.at(-1);assert.equal(sent.operation,'EDIT');assert.equal(sent.input.edits[0].taskId,'TASK');assert.equal(sent.input.edits[0].version,'REV-C');assert.equal(sent.input.edits[0].changes.disc3,3);
});

test('stock-only supplier receipts cannot satisfy another supplier customer shortage',()=>{
 const h=harness(),w=workspace();
 Object.assign(w.tasks[0],{ord:100,procurement:{totalCtn:100,customerCtn:100,expectedExtra:0},warehouse:{accepted:60,hasPhysicalReceipt:true}});
 w.tasks.push({...w.tasks[0],id:'STOCK',customerDemandTaskId:'TASK',procurementSource:true,ord:0,procurement:{totalCtn:50,customerCtn:0,expectedExtra:50},warehouse:{accepted:50,hasPhysicalReceipt:true}});
 h.reply(w);h.click({customer:'C'});const html=h.node('#app').innerHTML;
 assert.match(html,/received-quantity[\s\S]*?>60<\/button>/);
 assert.match(html,/Stock rcv \/ 库存实收 \+50/);
});

test('Active Orders exposes customer short names, filters one customer for movement and previews cross-customer PO without writes',()=>{
 const h=harness(),w=workspace();w.customers=[{id:'C',name:'CUSTOMER ONE',shortName:'ALPHA'},{id:'D',name:'CUSTOMER TWO',shortName:'BETA'}];w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',editVersion:'V',procurement:{totalCtn:10},ord:10});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D'});
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML;assert.match(html,/<th>Customer<\/th>/);assert.match(html,/customer-short[^>]*>ALPHA/);assert.match(html,/customer-short[^>]*>BETA/);assert.match(html,/data-drag="TASK"/);assert.match(html,/data-drag="OTHER"/);
 h.change({dataset:{select:'TASK'},checked:true});h.change({dataset:{select:'OTHER'},checked:true});h.click({controlId:'createSelectedPo'});assert.match(h.node('#dialogContent').innerHTML,/1 Items · 2 Customers/);assert.match(h.node('#dialogContent').innerHTML,/<span>QTY<\/span><strong>20 CTN<\/strong>/);assert.match(h.node('#dialogContent').innerHTML,/<span>Amount<\/span><strong>MYR 233.60<\/strong>/);assert.equal(h.messages.length,1);
 h.change({id:'activeCustomer',value:'C',dataset:{}});html=h.node('#app').innerHTML;assert.match(html,/data-drag="TASK"/);assert.doesNotMatch(html,/data-id="OTHER"/);
});

test('Active priorities count saved sources and locate their task rows without writes',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];
 Object.assign(w.tasks[0],{supplierId:'S',ord:100,procurement:{totalCtn:60,revision:'P'},po:'PO-A',estimatedShipmentDate:'2026-10-28'});
 w.tasks.push({...w.tasks[0],id:'B',procurementSource:true,customerDemandTaskId:'TASK',ord:0,po:'',procurement:{totalCtn:30,revision:'B'},warehouse:{accepted:20,hasPhysicalReceipt:true,issue:true},quantityCases:[{id:'CASE',kind:'RECEIPT',quantity:10,status:'OPEN',blocks:['DISPATCH']}]});
 w.tasks.push({...w.tasks[0],id:'UNPLANNED',po:'',supplierId:'',procurement:{totalCtn:null,revision:''}});
 h.reply(w);h.click({view:'active'});const html=h.node('#app').innerHTML,before=h.messages.length;
 assert.match(html,/data-active-notice="pending"[\s\S]*?<b>3<\/b>/);assert.match(html,/data-active-notice="incoming"[\s\S]*?<b>1<\/b>/);
 assert.match(html,/ACTUAL CUSTOMER<small class="customer-shipment"[^>]*>ETA: 28 Oct 2026/);
 assert.equal((html.match(/<th>/g)||[]).length,11);assert.equal(h.node('#taskSignals').hidden,true);
 h.click({activeNotice:'pending'});assert.match(h.node('#dialogContent').innerHTML,/data-active-notice-row="B">Row 001 →/);assert.match(h.node('#dialogContent').innerHTML,/data-active-notice-row="UNPLANNED"/);assert.match(h.node('#dialogContent').innerHTML,/Unassigned 待分配/);assert.match(h.node('#dialogContent').innerHTML,/10 CTN/);assert.match(h.node('#dialogContent').innerHTML,/100 CTN/);
 h.click({activeNotice:'incoming'});assert.match(h.node('#dialogContent').innerHTML,/Short received/);assert.match(h.node('#dialogContent').innerHTML,/data-active-notice-row="B">Row 001 →/);h.click({activeNoticeRow:'B'});assert.equal(h.node('#modal').open,false);assert.match(h.node('#app').innerHTML,/data-source-id="B"/);assert.equal(h.messages.length,before);
 h.click({customer:'C'});assert.equal(h.node('#taskSignals').hidden,false);assert.doesNotMatch(h.node('#app').innerHTML,/ao-priorities|customer-shipment/);
});

test('Active demand summary is display-only and omits duplicate waiting text while retaining remainder and source actions',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{ord:100,procurement:{totalCtn:60,revision:'P'},supplierId:'A'});
 w.tasks.push({...w.tasks[0],id:'SOURCE',procurementSource:true,customerDemandTaskId:'TASK',ord:0,supplierId:'B',procurement:{totalCtn:30,revision:'B'}});
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML;const mother=html.match(/<tr data-id="TASK"[\s\S]*?<\/tr>/)[0],order=mother.match(/<td class="order-quantity">[\s\S]*?<\/td>/)[0];
 assert.match(order,/<span class="quantity-reference/);assert.match(order,/100 \| <span class="qty-mismatch">90<\/span>/);assert.doesNotMatch(order,/<button|data-sources|WAITING/);
 for(const cell of html.match(/<td class="order-quantity">[\s\S]*?<\/td>/g)||[])assert.doesNotMatch(cell,/This P\.O\.|Extra P\.O\.|本单|补采购/);assert.doesNotMatch(html,/waiting-demand/);assert.match(html,/data-waiting-for="TASK"/);assert.match(html,/class="order-quantity">10<\/td>/);assert.match(html,/data-plan-task="TASK"/);assert.match(html,/data-plan-source="SOURCE"/);
 h.click({customer:'C'});html=h.node('#app').innerHTML;assert.match(html,/waiting-demand">WAITING 10 CTN/);assert.match(html,/data-sources="TASK" aria-label="Supplier sources/);
});

test('Active actual receipts never open supplier costing while receipt exception actions remain available',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{ord:100,procurement:{totalCtn:90,revision:'P'},supplierId:'A',warehouse:{accepted:80,hasPhysicalReceipt:true,issue:true},quantityCases:[{id:'RECEIPT-CASE',kind:'RECEIPT',quantity:10,status:'OPEN',blocks:['DISPATCH'],owner:'WAREHOUSE'}]});
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML,receipt=html.match(/<td class="received-quantity">[\s\S]*?<\/td>/)[0];
 assert.match(receipt,/<span class="quantity-reference receipt-problem" aria-description="Received \/ 实收">80<\/span>/);assert.doesNotMatch(receipt,/data-sources/);assert.match(receipt,/data-quantity-case="RECEIPT-CASE"/);assert.match(receipt,/>−10<\/button>/);
 h.click({customer:'C'});html=h.node('#app').innerHTML;receipt=html.match(/<td class="received-quantity">[\s\S]*?<\/td>/)[0];assert.match(receipt,/<button class="quantity-reference receipt-problem" data-sources="TASK">80<\/button>/);
});

test('Active removes progress chrome and ignores the hidden room stage filter without changing room behavior',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',procurement:{totalCtn:90,revision:'P'},warehouse:{accepted:80,hasPhysicalReceipt:true,issue:true}});
 h.reply(w);h.click({customer:'C'});h.change({id:'stageFilter',value:'999',dataset:{}});assert.match(h.node('#app').innerHTML,/No matching tasks/);
 h.click({view:'active'});const html=h.node('#app').innerHTML,before=h.messages.length;
 assert.doesNotMatch(html,/ao-progress-overview|data-active-progress|row-progress|progress-node|<th>Progress<\/th>/);assert.match(html,/<select id="stageFilter" hidden>/);assert.match(html,/data-id="TASK"/);
 h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/row-progress/);assert.equal(h.messages.length,before);
});

test('Active reordered columns retain source actions and show green or red GP beside the barcode instead of a separate column',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',name:'ITEM $& & $1',ord:100,gp:.12,procurement:{totalCtn:60,revision:'P'},warehouse:{accepted:60,hasPhysicalReceipt:true}});
 w.tasks.push({...w.tasks[0],id:'SOURCE',ord:0,procurementSource:true,customerDemandTaskId:'TASK',procurement:{totalCtn:40,revision:'B'},warehouse:{accepted:30,hasPhysicalReceipt:true,issue:true},quantityCases:[{id:'ISSUE',kind:'RECEIPT',quantity:10,status:'OPEN',blocks:['DISPATCH']}]});
 w.tasks.push({...w.tasks[0],id:'LOW',gp:.03,ord:60});h.reply(w);h.click({view:'active'});const html=h.node('#app').innerHTML,rows=html.match(/<tr (?:data-id|data-source-id)=[\s\S]*?<\/tr>/g);
 assert.match(html,/<th>Order Qty<\/th><th>Supplier<\/th><th>Net Cost<\/th><th>Rcv Qty<\/th><th>Line Cost<\/th><th>Our P.O.<\/th>/);assert.doesNotMatch(html,/<th>GP<\/th>|risk-deal/);assert.ok(html.includes('ITEM $&amp; &amp; $1'));
 assert.match(rows[0],/class="barcode">00123<span class="gp gp-badge gp-good"[^>]*>12%<\/span>/);assert.match(html,/class="gp gp-badge gp-low"[^>]*><svg[^]*?<\/svg>3%<\/span>/);
 for(const row of rows){const cells=row.match(/<td\b[\s\S]*?<\/td>/g);assert.equal(cells.length,11);assert.match(cells[5],/order-quantity/);assert.match(cells[6],/supplier-cell/);assert.match(cells[7],/net-cost-cell/);assert.match(cells[8],/received-quantity/);assert.doesNotMatch(row,/row-progress|progress-node/);}
 h.change({id:'supplierFilter',value:'MISSING',dataset:{}});assert.match(h.node('#app').innerHTML,/<td colspan="11" class="empty">/);h.change({id:'supplierFilter',value:'',dataset:{}}); h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/<th>GP<\/th>/);assert.doesNotMatch(h.node('#app').innerHTML,/gp-badge/);
});

test('Active child rows are always visible with a noninteractive branch marker in each customer cell',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{supplierId:'S',ord:100,procurement:{totalCtn:60,revision:'P'}});
 w.tasks.push({...w.tasks[0],id:'SOURCE',ord:0,procurementSource:true,customerDemandTaskId:'TASK',procurement:{totalCtn:30,revision:'B'}});w.tasks.push({...w.tasks[0],id:'OTHER'});w.tasks.push({...w.tasks[1],id:'OTHER-SOURCE',customerDemandTaskId:'OTHER'});
 h.reply(w);h.click({view:'active'});const before=h.messages.length;let html=h.node('#app').innerHTML;assert.doesNotMatch(html,/ao-source-toggle|data-toggle-sources|aria-expanded/);
 const rows=html.match(/<tr\b[\s\S]*?<\/tr>/g);for(const row of rows.filter(row=>/data-source-id|data-waiting-for/.test(row))){assert.match(row,/<span class="ao-child-marker" role="img"/);const cell=row.match(/<td\b[\s\S]*?<\/td>/g)[3];assert.match(cell,/ao-child-marker/);assert.doesNotMatch(cell,/<button/);}
 h.change({dataset:{select:'SOURCE',selectKind:'source'},checked:true});html=h.node('#app').innerHTML;assert.match(html,/data-source-id="SOURCE"[^]*?data-select-kind="source"[^>]*checked/);assert.match(html,/data-waiting-for="TASK"/);assert.match(html,/data-source-id="OTHER-SOURCE"/);assert.match(html,/1 selected/);assert.equal(h.messages.length,before);
 h.click({customer:'C'});assert.doesNotMatch(h.node('#app').innerHTML,/ao-child-marker/);
});

test('Active move entry selects a customer and preserves the original grouped move and cancel without saving',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{supplierId:'S',editVersion:'V',procurement:{totalCtn:60,revision:'P'}});
 w.tasks.push({...w.tasks[0],id:'SOURCE',procurementSource:true,customerDemandTaskId:'TASK',ord:0});w.tasks.push({...w.tasks[0],id:'OTHER'});w.customers.push({id:'D',name:'SECOND'});w.tasks.push({...w.tasks[0],id:'D-TASK',customerId:'D'});
 h.reply(w);h.click({view:'active'});const before=h.messages.length;h.click({activeMove:'true'});assert.match(h.node('#dialogContent').innerHTML,/id="moveCustomer"/);
 h.node('#moveCustomer').value='C';h.click({controlId:'startCustomerMove'});assert.match(h.node('#app').innerHTML,/data-drag="TASK"/);
 h.click({drag:'TASK'});const moveMarkup=h.node('#dialogContent').innerHTML;assert.match(moveMarkup,/Move Row 移动行/);assert.match(moveMarkup,/To Top 移到顶部/);assert.match(moveMarkup,/To Bottom 移到底部/);assert.ok(moveMarkup.includes('<option value="OTHER">Before Row 002 前面</option>'));assert.doesNotMatch(moveMarkup,/<option value="SOURCE">/);h.node('#moveTarget').value='bottom';h.click({controlId:'applyMove'});let html=h.node('#app').innerHTML;
 assert.ok(html.indexOf('data-id="OTHER"')<html.indexOf('data-id="TASK"'));assert.ok(html.indexOf('data-id="TASK"')<html.indexOf('data-source-id="SOURCE"'));assert.match(html,/data-active-cancel="true"/);
 h.click({activeCancel:'true'});html=h.node('#app').innerHTML;assert.ok(html.indexOf('data-id="TASK"')<html.indexOf('data-id="OTHER"'));assert.doesNotMatch(html,/data-active-cancel/);assert.equal(h.messages.length,before);
});

test('cost-aware plan saves quantity and prices once and reopens remaining supplier planning only after a confirmed receipt',()=>{
 const h=harness(),w=workspace();w.sourcesVersion='S1';w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',ea:16,editVersion:'V',procurement:{totalCtn:null,revision:''}});
 h.reply(w);h.click({customer:'C'});h.click({planTask:'TASK'});
 for(const [id,value] of Object.entries({planSupplier:'S',planTotal:'200',planReason:'First supplier quotation','planPrice-lpPc':'3','planPrice-lpCtn':'48','planPrice-disc1':'2','planPrice-disc2':'0','planPrice-disc3':'0'}))h.node('#'+id).value=value;
 h.click({controlId:'saveSupplierPlan'});const request=h.messages.at(-1);assert.equal(request.operation,'PLAN');assert.equal(request.input.totalCtn,200);assert.equal(request.input.prices.lpCtn,48);assert.equal(request.input.prices.disc1,.02);assert.equal(request.input.supplierId,'S');
 const count=h.messages.length;h.click({controlId:'saveSupplierPlan'});assert.equal(h.messages.length,count);
 h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:request.requestId,ok:true,result:{ok:true,requestId:request.requestId}});
 Object.assign(w.tasks[0],{procurement:{totalCtn:200,revision:'P'},sourcing:{orderedCtn:200,unplacedCtn:50}});h.reply(w);
 assert.equal(h.node('#modal').open,true);assert.match(h.node('#dialogContent').innerHTML,/Remaining 尚需采购 50/);assert.match(h.node('#dialogContent').innerHTML,/id="sourceQty"[^>]*value="50"/);assert.match(h.node('#dialogContent').innerHTML,/data-source-po-task="TASK"/);
});

test('supplier sources keep ordered and physical received quantities separate and add a priced PO once',()=>{
 const h=harness(),w=workspace();w.sourcesVersion='SV';w.suppliers=[{id:'A',name:'Supplier A'},{id:'B',name:'Supplier B'}];
 Object.assign(w.tasks[0],{ea:16,ord:200,inc:150,po:'NCT-PO-A',supplierId:'A',procurement:{totalCtn:180},warehouse:{accepted:170,hasPhysicalReceipt:true,issue:true},sourcing:{orderedCtn:190,receivedCtn:180,hasReceipt:true,unplacedCtn:10}});
 w.tasks.push({...w.tasks[0],id:'SOURCE-B',procurementSource:true,customerDemandTaskId:'TASK',ord:0,inc:0,po:'NCT-PO-B',supplierId:'B',procurement:{totalCtn:10},warehouse:{accepted:10,hasPhysicalReceipt:true,issue:false},sourcing:undefined});
 h.reply(w);h.click({customer:'C'});let html=h.node('#app').innerHTML;
 assert.match(html,/200 \| <span class="qty-mismatch">190<\/span>/);assert.match(html,/received-quantity[\s\S]*?>180<\/button>/);assert.match(html,/data-shortage="TASK"/);
 h.click({sources:'SOURCE-B'});assert.match(h.node('#dialogContent').innerHTML,/NCT-PO-A/);assert.match(h.node('#dialogContent').innerHTML,/NCT-PO-B/);
 for(const [id,value] of Object.entries({sourceSupplier:'B',sourceQty:'10','sourcePrice-lpPc':'7.5','sourcePrice-lpCtn':'120','sourcePrice-disc1':'0','sourcePrice-disc2':'0','sourcePrice-disc3':'0',sourceReason:'Supply remaining cartons'}))h.node('#'+id).value=value;
 h.click({controlId:'saveAdditionalSource'});const request=h.messages.at(-1);
 assert.equal(request.operation,'ADD_SOURCE');assert.equal(request.input.parentTaskId,'TASK');assert.equal(request.input.version,'SV');assert.equal(request.input.quantity,10);assert.equal(request.input.prices.lpCtn,120);assert.equal(request.input.prices.lpPc,7.5);assert.equal(request.input.prices.disc1,0);assert.equal(request.input.prices.disc2,0);assert.equal(request.input.prices.disc3,0);
 const count=h.messages.length;h.click({controlId:'saveAdditionalSource'});assert.equal(h.messages.length,count,'duplicate click while saving cannot create another source');
});

test('additional source plan uses remaining customer capacity instead of its zero demand field',()=>{
 const h=harness(),w=workspace();w.staff.canEditCustomerDemand=true;Object.assign(w.tasks[0],{ord:200,po:'NCT-PO-A',supplierId:'A',procurement:{totalCtn:180,revision:'PA'}});
 w.tasks.push({...w.tasks[0],id:'B',procurementSource:true,customerDemandTaskId:'TASK',ord:0,po:'NCT-PO-B',procurement:{totalCtn:10,revision:'PB'},editVersion:'VB'});
 h.reply(w);h.click({qty:'B'});assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="saveTaskQty"/);h.click({controlId:'editSupplierPlan'});
 assert.match(h.node('#dialogContent').innerHTML,/可供客户数量<\/span><b>20 CTN/);
 h.node('#planTotal').value='15';h.node('#planReason').value='Five more now available';h.node('#planExtraKind').value='';h.node('#planConfirmExtra').checked=false;h.node('#planSupplierConfirmed').checked=true;
 h.click({controlId:'saveSupplierPlan'});const request=h.messages.at(-1);assert.equal(request.operation,'PLAN');assert.equal(request.input.taskId,'B');assert.equal(request.input.totalCtn,15);assert.equal(request.input.confirmExtra,false);
});

test('separate sourcing and receiving bubbles open a case-specific bilingual decision without clearing financial risk',()=>{
 const h=harness(),w=workspace();w.quantityCasesVersion='CASES';Object.assign(w.tasks[0],{po:'PO-A',ord:200,inc:180,procurement:{totalCtn:180},quantityCases:[{id:'UNPLACED',kind:'UNPLACED',quantity:10,status:'RESOLVED',decision:{customerDecision:'STOP',by:'PLANNER',at:'2026-10-12T03:00:00Z'}},{id:'RECEIPT',kind:'RECEIPT',quantity:10,status:'OPEN',financeRequired:true,owner:'PURCHASE'}]});
 h.reply(w);h.click({customer:'C'});const html=h.node('#app').innerHTML;assert.match(html,/quantity-case resolved[^>]*data-quantity-case="UNPLACED"/);assert.match(html,/quantity-case financial[^>]*data-quantity-case="RECEIPT"/);
 h.click({quantityCase:'RECEIPT'});assert.match(h.node('#dialogContent').innerHTML,/Receiving Issue/);assert.match(h.node('#dialogContent').innerHTML,/内部原因不会传给客户/);
 h.node('#caseCustomer').value='STOP';h.node('#caseSupplier').value='REFUND';h.node('#caseDate').value='';h.node('#caseReason').value='Supplier short delivered';h.node('#caseMessage').value='Available quantity is confirmed';h.click({controlId:'saveQuantityCase'});
 const request=h.messages.at(-1);assert.equal(request.operation,'QUANTITY_CASE');assert.equal(request.input.id,'RECEIPT');assert.equal(request.input.version,'CASES');assert.equal(request.input.customerDecision,'STOP');assert.equal(request.input.supplierDecision,'REFUND');assert.equal(request.input.enabled,undefined,'Purchase cannot send Finance clearance');
});
test('planner allocation editor sends the selected receipt and explicit customer quantities with a reason',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{po:'PO1',supplierId:'S',warehouse:{accepted:90},procurement:{availableCtn:90,allocationEnabled:true}});w.allocationVersion='AV';w.allocations=[];
 h.reply(w);h.click({view:'stock'});assert.match(h.node('#app').innerHTML,/data-allocate="TASK"/);h.click({allocate:'TASK'});
 assert.match(h.node('#dialogContent').innerHTML,/ACTUAL CUSTOMER/);h.node('#allocateQty0').value='80';h.node('#allocationReason').value='Hold ten cartons';h.click({controlId:'saveAllocation'});
 const request=h.messages.at(-1);assert.equal(request.operation,'ALLOCATE');assert.equal(request.input.version,'AV');assert.equal(request.input.targets[0].quantity,80);assert.equal(request.input.sourceTaskId,'TASK');assert.equal(request.input.reason,'Hold ten cartons');
});
test('Purchase Payment Follow-up reads shared paid/balance and displays proof links without finance write controls',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'payments'});const request=h.messages.at(-1);assert.equal(request.type,'PURCHASE_ORDERS_REQUEST');
 const row={id:'PO',number:'NCT-PO-001',createdAt:'2026-10-11T01:00:00Z',createdBy:'LAW',supplierName:'SUPPLIER FULL NAME',supplierShortName:'SUP',customerName:'BUYER',amount:1200,status:'Paid W/T Inv',procurementHandoff:{stage:'OWNED',submission:{at:'2026-10-11T01:00:00Z',by:'LAW',paymentRequest:{requestedCents:100000,paidCents:0,cnCents:0}}},paymentHandoff:{status:'PAID'},finance:{payableCents:100000,paidCents:100000,balanceCents:0,payments:[{id:'P',confirmed:true,reference:'BANK001',cents:100000,at:'2026-10-11T02:00:00Z',by:'FINANCE',proof:{fileId:'proof_123456789'}}]}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 const html=h.node('#app').innerHTML;assert.match(html,/NCT-PO-001/);assert.match(html,/1,000.00/);assert.match(html,/>Fully Paid</);assert.doesNotMatch(html,/付款申请流程尚未连接/);
 h.click({paymentProof:'PO'});const proof=h.node('#dialogContent').innerHTML;assert.match(proof,/BANK001/);assert.match(proof,/FINANCE/);assert.match(proof,/drive.google.com\/uc\?export=download/);assert.match(proof,/proof_123456789/);assert.doesNotMatch(proof,/type="file"|Record Payment|data-settlement/);
});

test('payment acknowledgement sends only the selected notice and cannot clear Finance or other payment notices',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'payments'});const req=h.messages.at(-1),row={id:'PO',version:'PV',number:'PO-1',supplierName:'SUPPLIER',procurementHandoff:{stage:'OWNED',submission:{at:'2026-10-11T01:00:00Z',paymentRequest:{requestedCents:50000,paidCents:0,cnCents:0}}},finance:{paidCents:30000,payments:[{id:'P1',confirmed:true,cents:30000,reference:'BANK1',proof:{fileId:'F1'}}]},paymentHandoff:{status:'PARTLY_PAID',unreadCount:1,notices:[{paymentId:'P1',acknowledgement:null}]}};
 h.send({type:'PURCHASE_ORDERS_RESULT',company:'NCT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));assert.match(h.node('#app').innerHTML,/Partially Paid/);assert.match(h.node('#app').innerHTML,/1 new/);
 h.click({paymentProof:'PO'});assert.match(h.node('#dialogContent').innerHTML,/data-payment-ack="P1"/);h.click({paymentAck:'P1',paymentPo:'PO'});
 const saved=h.messages.at(-1);assert.equal(saved.type,'PURCHASE_ORDER_SAVE_REQUEST');assert.equal(saved.input.action,'ACK_PAYMENT');assert.equal(saved.input.paymentId,'P1');assert.equal(saved.input.version,'PV');assert.equal(saved.input.enabled,undefined);assert.equal(saved.input.cents,undefined);
});

test('purchase orders render persisted documents and readable history, with upload input instead of fixture controls',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1);
 assert.equal(request.type,'PURCHASE_ORDERS_REQUEST');
 const row={id:'POID',version:'V',number:'NCT-PO-001',taskIds:['TASK'],customerName:'BUYER',supplierId:'S',supplierShortName:'SUP',supplierName:'SUPPLIER',itemCount:1,amount:100,termDays:30,documents:[{fileId:'file_123456789',linked:true,type:'INV',number:'INV001',date:'2026-10-11',uploadedBy:'LAW'}],documentStatus:'COMPLETE',state:'ACTIVE',history:[{action:'PAYMENT_TERM_CHANGED',actor:'LAW',time:'2026-10-11T01:00:00Z',changes:{before:{termDays:15},after:{termDays:30},reason:'Agreed terms'}}]};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row],documentsConnected:true}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.node('#app').innerHTML,/po-doc-badge available[^>]*data-po-doc-type="INV"/);assert.match(h.node('#app').innerHTML,/BUYER/);
 h.click({poDocs:'POID'});assert.match(h.node('#dialogContent').innerHTML,/INV001/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="poDocumentFile"/);
 h.click({poUpload:'POID',poDocType:'PI'});assert.match(h.node('#dialogContent').innerHTML,/id="poDocumentFile"/);assert.match(h.node('#dialogContent').innerHTML,/Upload PI/);
 h.click({poHistory:'POID'});const history=h.node('#poHistoryEntries').innerHTML;assert.match(history,/15 → 30/);assert.match(history,/LAW/);assert.doesNotMatch(history,/"before"|PAYMENT_TERM_CHANGED/);
});

test('PDF stays disabled after file reading hands off to the actual pending save, and a second click does not upload twice',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1),row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',termDays:null};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row],documentsConnected:true}});await new Promise(resolve=>setImmediate(resolve));h.click({poUpload:'PO',poDocType:'PI'});
 const pdf=Buffer.from('%PDF-1.4\nTEST');h.node('#poDocumentFile').files=[{size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)}];
 h.node('#poDocumentDate').value='2026-10-11';h.node('#poDocumentNumber').value='TEST';h.click({controlId:'uploadPurchaseDocument'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.node('#uploadPurchaseDocument').disabled,true);assert.equal(h.messages.filter(m=>m.type==='PURCHASE_ORDER_SAVE_REQUEST').length,1);h.click({controlId:'uploadPurchaseDocument'});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.messages.filter(m=>m.type==='PURCHASE_ORDER_SAVE_REQUEST').length,1);
});

test('PO history is current month only; independent history filters archived month, supplier and document number',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1),current=new Date().toISOString(),old=new Date();old.setUTCMonth(old.getUTCMonth()-2);
 const make=(id,state,completedAt,supplierId)=>({id,number:id,state,completedAt,supplierId,taskIds:['TASK'],documents:[{number:id+'-INV'}],history:[],documentStatus:'MISSING',amount:100,termDays:null});
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[make('ACTIVE-OLD','ACTIVE',old.toISOString(),'A'),make('CURRENT-DONE','HISTORY',current,'A'),make('OLDER-DONE','HISTORY',old.toISOString(),'B')]}});await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.node('#app').innerHTML,/ACTIVE-OLD/);h.click({poTab:'HISTORY'});assert.match(h.node('#app').innerHTML,/CURRENT-DONE/);assert.doesNotMatch(h.node('#app').innerHTML,/OLDER-DONE/);
 h.click({view:'pohistory'});assert.match(h.node('#app').innerHTML,/OLDER-DONE/);assert.doesNotMatch(h.node('#app').innerHTML,/ACTIVE-OLD/);
 h.change({id:'poSupplier',value:'B',dataset:{}});assert.match(h.node('#app').innerHTML,/OLDER-DONE/);assert.doesNotMatch(h.node('#app').innerHTML,/CURRENT-DONE/);
});

test('PO history directly lists every saved category newest first without a filter',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1);
 const row={id:'PO',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],documentStatus:'MISSING',termDays:null,history:[{action:'PURCHASE_PRICE_SAVED',time:'2026-10-11T01:00:00Z',actor:'LAW',message:'PURCHASE PRICE SAVED',changes:{before:{lpCtn:20},after:{lpCtn:19}}},{action:'PAYMENT_CHASE_CHANGED',time:'2026-10-11T02:00:00Z',actor:'LAW',changes:{before:{chasePayment:false},after:{chasePayment:true},reason:'Urgent'}}]};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 h.click({poHistory:'PO'});assert.match(h.node('#poHistoryEntries').innerHTML,/修改成本/);assert.doesNotMatch(h.node('#poHistoryEntries').innerHTML,/PURCHASE PRICE SAVED/);
 assert.doesNotMatch(h.node('#dialogContent').innerHTML,/<select|poHistoryCategory/);const history=h.node('#poHistoryEntries').innerHTML;assert.match(history,/Urgent/);assert.ok(history.indexOf('Urgent')<history.indexOf('修改成本'));h.change({id:'poHistoryCategory',value:'CHASE',dataset:{}});assert.match(h.node('#poHistoryEntries').innerHTML,/修改成本/);
});

test('quiet refresh retains the PO list until the new receipt and does not erase it on failure',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1);
 const row={id:'POID',number:'NCT-PO-001',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',amount:100,termDays:null};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 h.intervals[0]();h.reply(w);assert.match(h.node('#app').innerHTML,/NCT-PO-001/);assert.doesNotMatch(h.node('#app').innerHTML,/正在读取采购单/);
 const reread=h.messages.at(-1);assert.equal(reread.type,'PURCHASE_ORDERS_REQUEST');
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:reread.requestId,ok:false,error:'Temporary read failure'});await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.node('#app').innerHTML,/NCT-PO-001/);assert.match(h.node('#app').innerHTML,/Temporary read failure/);
 h.intervals[0]();const quiet=h.messages.at(-1);h.reply(null,quiet,{ok:false,error:'Workspace read failure'});assert.match(h.node('#app').innerHTML,/NCT-PO-001/);assert.match(h.node('#liveStatus').textContent,/Workspace read failure/);
});

test('GP is a read-only two-decimal percentage; missing and unsaved values never pretend to be zero',()=>{
 for(const [gp,shown] of [[.125,'12.50%'],[-.2,'-20.00%'],[0,'0.00%'],[null,'—'],[undefined,'—']]){
  const h=harness(),w=workspace();w.tasks[0].gp=gp;h.reply(w);h.click({customer:'C'});
  assert.equal(h.node('#app').innerHTML.match(/<b class="gp">([^<]*)<\/b>/)[1],shown);
  assert.equal(h.messages.length,1);
 }
 const h=harness(),w=workspace();w.tasks[0].gp=.125;h.reply(w);h.click({customer:'C'});
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({customer:'C'});
 assert.equal(h.node('#app').innerHTML.match(/<b class="gp">([^<]*)<\/b>/)[1],'—');
});

test('P.O. dialog hides system IDs, places an obvious input first and keeps original association payload',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',editVersion:'REV',procurement:{totalCtn:275}});h.reply(w);h.event('click',{closest:selector=>selector==='input[data-po-reference]'?{dataset:{poReference:'TASK'}}:null});
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/创建采购单/);assert.match(html,/po-number-entry/);assert.match(html,/po-items/);assert.doesNotMatch(html,/<small>TASK<\/small>|每行任务 ID/);
 assert.ok(html.indexOf('id="poNumber"')<html.indexOf('class="rowlist po-items"'));assert.match(html,/275/);
 h.node('#poNumber').value='NCT-00123';h.click({controlId:'savePo'});const request=h.messages.at(-1);assert.equal(request.operation,'PO');assert.deepEqual(Array.from(request.input.taskIds),['TASK']);assert.equal(request.input.versions.TASK,'REV');assert.equal(request.input.poNumber,'NCT-00123');
});

test('P.O. details stay read-only and show human product references without internal IDs',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',po:'NCT-00123',procurement:{totalCtn:275}});h.reply(w);h.click({poView:'TASK'});
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/Review P.O. 采购单预览/);assert.match(html,/NCT-00123/);assert.match(html,/00123/);assert.doesNotMatch(html,/<small>TASK<\/small>|id="poNumber"|id="savePo"/);assert.equal(h.messages.length,1);
});

test('existing PO review includes its complete saved group and exact FOC amounts without changing selection or sending a save',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'},{id:'OTHER',name:'OTHER SUPPLIER'}];
 Object.assign(w.tasks[0],{supplierId:'S',po:'NCT-00123',editVersion:'V1',procurement:{totalCtn:10,costing:{averageCostCtn:3.333333,amountCents:3333}}});
 w.customers.push({id:'D',name:'SECOND CUSTOMER'});
 w.tasks.push({...w.tasks[0],id:'SAME-PO',barcode:'FOC-ITEM',name:'FOC PRODUCT',customerId:'D',procurement:{totalCtn:110,costing:{mode:'FOC',paidCtn:100,freeCtn:10,averageCostCtn:9.090909,amountCents:100000}}});
 w.tasks.push({...w.tasks[0],id:'OTHER-PO',po:'NCT-OTHER',name:'EXCLUDE OTHER PO'},{...w.tasks[0],id:'OTHER-SUPPLIER',supplierId:'OTHER',name:'EXCLUDE OTHER SUPPLIER'});
 h.reply(w);h.change({dataset:{select:'OTHER-PO'},checked:true});h.click({poTask:'TASK'});
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/Review P.O./);assert.match(html,/FOC PRODUCT/);assert.match(html,/120 CTN/);assert.match(html,/MYR 1,033.33/);assert.match(html,/Paid 100 \+ FOC 10/);assert.match(html,/SECOND CUSTOMER/);assert.doesNotMatch(html,/EXCLUDE OTHER|id="savePo"|id="poNumber"/);assert.equal(h.messages.length,1);
 h.click({controlId:'closeModal'});h.click({poView:'TASK'});assert.equal(h.node('#dialogContent').innerHTML,html);assert.equal(h.messages.length,1);
});

test('PO number edit is explicit and retains all member versions in the original association operation',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',po:'NCT-OLD',editVersion:'V1',procurement:{totalCtn:10}});w.tasks.push({...w.tasks[0],id:'SECOND',editVersion:'V2'});h.reply(w);
 h.click({poTask:'TASK'});assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="savePo"/);h.click({editPo:'TASK'});assert.match(h.node('#dialogContent').innerHTML,/id="poNumber"/);assert.equal(h.messages.length,1);
 h.node('#poNumber').value='NCT-NEW';h.click({controlId:'savePo'});const sent=h.messages.at(-1);assert.equal(sent.operation,'PO');assert.deepEqual(Array.from(sent.input.taskIds),['TASK','SECOND']);assert.equal(sent.input.versions.TASK,'V1');assert.equal(sent.input.versions.SECOND,'V2');assert.equal(sent.input.poNumber,'NCT-NEW');
});

test('a company prefix alone cannot create a PO or lose the current input',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',editVersion:'REV',procurement:{totalCtn:250}});h.reply(w);h.event('click',{closest:selector=>selector==='input[data-po-reference]'?{dataset:{poReference:'TASK'}}:null});
 h.node('#poNumber').value='NCT-PO-';h.click({controlId:'savePo'});assert.equal(h.messages.length,1);assert.match(h.node('#dialogError').textContent,/采购单号码/);assert.equal(h.node('#poNumber').value,'NCT-PO-');
});

test('supplier plan confirms excess and keeps customer qty out of its write payload',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUP'}];w.tasks[0].supplierId='S';w.tasks[0].editVersion='V';w.tasks[0].procurement={revision:'',totalCtn:null};h.reply(w);h.click({taskEdit:'TASK'});h.click({controlId:'editSupplierPlan'});
 h.node('#planTotal').value='275';h.node('#planReason').value='Supplier bonus';h.node('#planExtraKind').value='FREE_GOODS';h.node('#planConfirmExtra').checked=false;
 h.click({controlId:'saveSupplierPlan'});assert.equal(h.messages.filter(m=>m.operation==='PLAN').length,0);
 h.node('#planConfirmExtra').checked=true;h.click({controlId:'saveSupplierPlan'});const saved=h.messages.at(-1);assert.equal(saved.operation,'PLAN');assert.equal(saved.input.totalCtn,275);assert.equal(saved.input.quantity,undefined);assert.equal(saved.input.receivedQtyInCtn,undefined);
 h.click({controlId:'saveSupplierPlan'});assert.equal(h.messages.at(-1).requestId,saved.requestId);
});

test('supplier quantity editor restores saved source and makes customer versus kept stock explicit',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUP'}];Object.assign(w.tasks[0],{ord:90,supplierId:'S',procurement:{revision:'P1',totalCtn:100,extraKind:'FREE_GOODS'}});
 h.reply(w);h.click({taskEdit:'TASK'});h.click({controlId:'editSupplierPlan'});
 assert.equal(h.node('#planExtraKind').value,'FREE_GOODS');
 h.node('#planTotal').value='100';h.event('input',{id:'planTotal'});
 assert.equal(h.node('#planStockResult').textContent,'10 CTN');assert.equal(h.node('#planExtraOptions').hidden,false);assert.equal(h.node('#saveSupplierPlan').disabled,true);
 h.node('#planTotal').value='90';h.event('input',{id:'planTotal'});
 assert.equal(h.node('#planStockResult').textContent,'0 CTN');assert.equal(h.node('#planExtraOptions').hidden,true);assert.equal(w.tasks[0].ord,90);
 assert.match(h.node('#dialogContent').innerHTML,/给客户/);assert.match(h.node('#dialogContent').innerHTML,/留库存/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/receivedQty|RECEIVED QTY/);
 assert.equal(h.messages.length,1,'preview never writes quantity or stock');
});

test('unchanged supplier quantities and unconfirmed P.O. changes give local feedback without failed backend requests',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUP'}];Object.assign(w.tasks[0],{supplierId:'S',po:'PO-1',procurement:{revision:'P1',totalCtn:250,extraKind:''}});
 h.reply(w);h.click({taskEdit:'TASK'});h.click({controlId:'editSupplierPlan'});
 h.node('#planTotal').value='250';h.node('#planReason').value='Same quantity';h.click({controlId:'saveSupplierPlan'});
 assert.match(h.node('#dialogError').textContent,/没有变化/);assert.equal(h.messages.length,1);
 h.node('#planTotal').value='275';h.node('#planExtraKind').value='FREE_GOODS';h.node('#planConfirmExtra').checked=true;h.node('#planSupplierConfirmed').checked=false;h.click({controlId:'saveSupplierPlan'});
 assert.match(h.node('#dialogError').textContent,/P.O./);assert.equal(h.messages.length,1);
 h.node('#planSupplierConfirmed').checked=true;h.click({controlId:'saveSupplierPlan'});assert.equal(h.messages.at(-1).operation,'PLAN');assert.equal(h.messages.at(-1).input.totalCtn,275);assert.equal(h.messages.at(-1).input.quantity,undefined);
});

test('shared expected-stock view includes all company customers and disables allocation before receipt',()=>{
 const h=harness(),w=workspace();w.tasks[0].procurement={expectedExtra:25,totalCtn:275};w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'OTHER-CUSTOMER',barcode:'OTHER-BARCODE',procurement:{expectedExtra:10,totalCtn:260}});h.reply(w);h.click({customer:'C'});h.click({view:'stock'});
 const html=h.node('#app').innerHTML;assert.match(html,/OTHER-BARCODE/);assert.match(html,/Awaiting warehouse/);assert.match(html,/<button class="btn" data-allocate="[^"]+" disabled>Allocate/);assert.equal([...html.matchAll(/<button[^>]*data-allocate[^>]*>/g)].every(match=>match[0].includes("disabled")),true);
});
test('live page starts empty, requests real Master data and never seeds demo business records',()=>{
  const h=harness();assert.equal(h.messages.length,1);assert.equal(h.messages[0].type,'PURCHASE_WORKSPACE_REQUEST');
  assert.doesNotMatch(h.node('#app').innerHTML,/AVATA|Supplier A|CORN FLAKES/);
  h.reply(workspace());assert.match(h.node('#app').innerHTML,/ACTUAL CUSTOMER/);assert.equal(h.node('#session').textContent,'ACTUAL STAFF / Purchase');
});
test('customer entry displays actual quantity and opens a cost exception with actual salesperson',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/ACTUAL PRODUCT/);
  assert.match(h.node('#app').innerHTML,/250/);assert.match(h.node('#app').innerHTML,/Cost Error/);
  h.click({cost:'TASK'});assert.equal(h.node('#modal').open,true);assert.match(h.node('#dialogContent').innerHTML,/ACTUAL SALESPERSON/);
  assert.match(h.node('#dialogContent').innerHTML,/UNAVAILABLE_LPCTN/);
});
test('late response from prior company cannot mix NCT and GHR data',()=>{
  const h=harness(),old=h.messages[0];h.switchCompany('GHR');h.reply(workspace(),old);
  assert.doesNotMatch(h.node('#app').innerHTML,/ACTUAL CUSTOMER/);assert.equal(h.node('#workspaceCompany').textContent,'GHR');
  h.reply({...workspace(),company:'GHR'});assert.match(h.node('#app').innerHTML,/ACTUAL CUSTOMER/);
});
test('read failure and timeout show explicit feedback without inventing zero records',()=>{
  const h=harness();h.reply(null,undefined,{ok:false,error:'Master staff access is not configured.'});
  assert.match(h.node('#liveStatus').textContent,/not configured/);assert.doesNotMatch(h.node('#app').innerHTML,/Supplier A|33/);
  const other=harness();other.timers[0]();assert.match(other.node('#liveStatus').textContent,/读取超时/);
});

test('compact Dashboard keeps both directories and supplier entry while replacing duplicated summary cards with a queue',()=>{
  const h=harness();h.reply(workspace());const html=h.node('#app').innerHTML;
  for(const marker of ['purchase-dashboard','pd-filters','pd-queue','customer-directory','supplier-directory','addSupplier','Search customer','supplierSearch'])assert.ok(html.includes(marker),marker);
  assert.match(html,/<th>Edit<\/th>/);assert.doesNotMatch(html,/Add Customer|id="addCustomer"/);
});

test('compact Purchase Room keeps track, drag controls and new read-only columns without business writes',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});const html=h.node('#app').innerHTML;
  for(const marker of ['roomhead','Pending workload','Waiting for Acc Review','supplierFilter','stageFilter','allocationFilter','supplier-plan-link','row-progress','unified-save','Move selected','row-controls','order-quantity','received-quantity'])assert.ok(html.includes(marker),marker);
  const header=html.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)[1];
  const labels=[...header.matchAll(/<th>(.*?)<\/th>/gs)].map(match=>match[1].includes('history-heading')?'History':match[1]);
  assert.deepEqual(labels.slice(1),['Row','Since','Description','Order Qty','Rcv Qty','Supplier','Net Cost','Line Cost','Our P.O.','GP','Progress']);
  assert.equal(labels.length,12);
  assert.match(html,/width:29%/);
  assert.match(html,/data-cost="TASK"/);
  assert.match(html,/250/);
  assert.equal(h.messages.length,1,'layout restoration must not trigger any business writes');
});

test('actual Save uses draft revision and keeps inputs after failed or ambiguous results',()=>{
  const h=harness(),data=workspace();data.tasks[0].editVersion='REV';h.reply(data);h.click({customer:'C'});
  h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});
  const save=h.messages.at(-1);assert.equal(save.type,'PURCHASE_SAVE_REQUEST');assert.equal(save.input.edits[0].version,'REV');assert.equal(save.input.edits[0].changes.disc3,5);
  h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:false,error:'504 timeout'});
  assert.match(h.node('#dialogError').textContent,/输入仍保留/);const check=h.messages.at(-1);assert.equal(check.type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(check.saveRequestId,save.requestId);h.click({controlId:'saveEdits'});assert.equal(h.messages.at(-1),check);
  h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:'WRONG',ok:true,result:{ok:true,requestId:'WRONG'}});assert.equal(h.node('#companySelect').disabled,true);
  h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:true,requestId:save.requestId}});assert.equal(h.messages.at(-1).type,'PURCHASE_WORKSPACE_REQUEST');assert.equal(h.node('#companySelect').disabled,false);
});

test('one click stays busy, blocks duplicate submission and resolves a lost response from the original receipt',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);
 assert.equal(h.node('#saveEdits').disabled,true);assert.match(h.node('#saveEdits').textContent,/保存中/);
 h.click({controlId:'saveEdits'});assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,1);
 h.timers[1]();const check=h.messages.at(-1);assert.equal(check.type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(check.saveRequestId,save.requestId);
 h.send({type:'PURCHASE_SAVE_CHECK_RESULT',company:'NCT',requestId:check.requestId,ok:true,result:{ok:true,requestId:save.requestId}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.messages.at(-1).type,'PURCHASE_WORKSPACE_REQUEST');assert.equal(h.node('#companySelect').disabled,false);
 assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,1);
});

test('unconfirmed CMS save keeps original identity and identifies affected tasks throughout receipt checks',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);
 h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:false,pending:true,errorCode:'WDE0118',error:'CMS connection WDE0118',requestId:save.requestId}});
 const check=h.messages.at(-1);assert.equal(check.type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(check.saveRequestId,save.requestId);
 assert.equal(h.node('#companySelect').disabled,true);assert.match(h.node('#liveStatus').textContent,/Barcode 00123/);assert.match(h.node('#liveStatus').textContent,/WDE0118/);assert.ok(h.node('#liveStatus').textContent.includes('Ref 操作编号: '+save.requestId));
 h.send({type:'PURCHASE_SAVE_CHECK_RESULT',company:'NCT',requestId:check.requestId,ok:false,error:'Read failure'});await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.node('#liveStatus').textContent,/WDE0118/);assert.match(h.node('#liveStatus').textContent,/暂时无法核对/);
 h.click({controlId:'retryPendingSave'});assert.equal(h.messages.at(-1).requestId,save.requestId);assert.equal(h.messages.at(-1).input.edits[0].changes.disc3,5);
});

test('receipt checks stop after three pending results and explicit retry preserves the original save identity',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);h.timers[1]();
 for(let attempt=0;attempt<3;attempt++){const check=h.messages.at(-1);h.send({type:'PURCHASE_SAVE_CHECK_RESULT',company:'NCT',requestId:check.requestId,ok:true,result:{ok:false,pending:true,requestId:save.requestId}});await new Promise(resolve=>setImmediate(resolve));if(attempt<2)h.timers.at(-1)();}
 assert.equal(h.node('#saveEdits').disabled,false);assert.match(h.node('#liveStatus').textContent,/尚未取得保存完成回执/);
 assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,1);h.click({controlId:'retryPendingSave'});assert.equal(h.messages.at(-1).requestId,save.requestId);assert.equal(h.messages.at(-1).input.edits[0].changes.disc3,5);
});

test('supplier dialog retains approved company/short-name pair, tabs and all six contact roles without demo brands',()=>{
  const h=harness(),data=workspace();data.suppliers=[{id:'SUP',name:'ACTUAL SUPPLIER',shortName:'ACTUAL'}];h.reply(data);h.click({editSupplier:'SUP'});
  const html=h.node('#dialogContent').innerHTML;
  for(const text of ['dialoghead','dialogbody','dialogfoot','Company Info','Phone Book','Brands','supplier-name-pair','Company Name *','Short Name','ACTUAL SUPPLIER'])assert.ok(html.includes(text),text);
  const contacts=h.node('#supplierContacts').innerHTML;
  for(const role of ['Sales Representative','Sales Manager','Director','Account Dept.','Warehouse','Others'])assert.ok(contacts.includes(role),role);
  assert.doesNotMatch(html,/Demo Brand|localStorage/);
  assert.equal(h.messages.filter(message=>message.type==='PURCHASE_SAVE_REQUEST').length,0);assert.equal(h.messages.filter(message=>message.type==='PURCHASE_PROFILE_REQUEST').length,1);assert.equal(h.messages.filter(message=>message.type==='PURCHASE_BRANDS_REQUEST').length,1);
});

test('row editor keeps barcode first, omits received quantity and gates changes on a saved supplier',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});h.click({taskEdit:'TASK'});
  const html=h.node('#dialogContent').innerHTML;
  for(const text of ['Catch Cost','Purchase Qty','Cost Calculator','客户需求由 Admin 管理','ACTUAL PRODUCT','250 CTN'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('00123')<html.indexOf('ACTUAL PRODUCT'));
  assert.ok(html.indexOf('ACTUAL PRODUCT')<html.indexOf('SIZE x16'));
  assert.doesNotMatch(html,/Received Qty|Total Purchase|Add Item From/);
  assert.doesNotMatch(html,/id="saveTaskQty"|id="taskNewQty"/);
  assert.match(html,/id="editSupplierPlan" disabled/);
  assert.match(html,/Select and save a supplier/);
  assert.equal(h.messages.length,1);
});

test('separate four-digit quantities preserve the legacy warehouse value and edited demand marker',()=>{
  const h=harness(),data=workspace();Object.assign(data.tasks[0],{ord:9999,inc:8888,qtyEdited:true});h.reply(data);h.click({customer:'C'});
  const html=h.node('#app').innerHTML;assert.match(html,/demand-edited/);assert.match(html,/9999/);assert.match(html,/8888/);assert.doesNotMatch(html,/9,999|8,888/);assert.match(html,/net-cost-cell/);assert.match(html,/data-plan-task="TASK"/);
});

test('reload checks the existing save identity and restores only the same staff member draft',()=>{
  const cache=new Map(),storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)};
  const first=harness(storage),data=workspace();data.tasks[0].editVersion='REV';first.reply(data);first.click({customer:'C'});first.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});first.click({controlId:'saveEdits'});const savedRequest=first.messages.at(-1);
  const reloaded=harness(storage);reloaded.reply(data);const check=reloaded.messages.at(-1);assert.equal(check.type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(check.saveRequestId,savedRequest.requestId);assert.match(reloaded.node('#app').innerHTML,/value="5(?:\.00)?"/);
  reloaded.click({controlId:'retryPendingSave'});assert.equal(reloaded.messages.at(-1).requestId,savedRequest.requestId);assert.equal(reloaded.messages.at(-1).type,'PURCHASE_SAVE_REQUEST');
  const other=harness(storage);other.reply({...data,staff:{staffId:'STAFF',memberId:'OTHER',staffName:'OTHER'}});assert.equal(other.messages.length,1);assert.doesNotMatch(other.node('#app').innerHTML,/Unsaved changes/);
});


test('partial price input survives redraw and cannot submit a stale numeric value',()=>{
  const h=harness(),data=workspace();data.tasks[0].editVersion='REV';h.reply(data);h.click({customer:'C'});
  const field={id:'',dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'2.00'};
  h.event('focusin',field);assert.equal(field.value,'');h.event('focusout',field);assert.equal(field.value,'2.00');
  h.event('focusin',field);field.value='bad';h.event('input',field);h.event('focusout',field);h.click({controlId:'saveEdits'});
  assert.equal(h.messages.filter(message=>message.type==='PURCHASE_SAVE_REQUEST').length,0);
  h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/Unsaved changes/);h.click({controlId:'saveEdits'});assert.match(h.node('#liveStatus').textContent,/标红/);
});

test('cost calculator sends source amounts and internal note, not a client calculated price or quantity edit',()=>{
 const h=harness(),data=workspace();data.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(data.tasks[0],{supplierId:'S',editVersion:'REV',ea:16});h.reply(data);h.click({customer:'C'});h.click({taskEdit:'TASK'});h.click({taskTab:'average'});
 assert.match(h.node('#dialogContent').innerHTML,/Line Cost · MYR/);assert.match(h.node('#dialogContent').innerHTML,/Internal Note/);assert.match(h.node('#dialogContent').innerHTML,/id="applyAverageCost"/);
 h.node('#averageLineCost').value='921.50';h.node('#averageCartons').value='11';h.node('#averageNote').value='Buy ten get one';h.event('input',{id:'averageLineCost'});assert.equal(h.node('#averageResult').textContent,'MYR 83.77');
 h.click({controlId:'applyAverageCost'});const request=h.messages.at(-1);assert.equal(request.operation,'AVERAGE_COST');assert.equal(request.input.lineCost,921.5);assert.equal(request.input.cartons,11);assert.equal(request.input.note,'Buy ten get one');assert.equal(request.input.quantity,undefined);assert.equal(request.input.lpCtn,undefined);
});

test('history icon keeps the actual history dialog and progress capsules keep existing counts without writes',()=>{
 const h=harness(),w=workspace();w.tasks[0].history=[{id:'E1',action:'PURCHASE_QTY_REDUCED',time:'2026-10-10T12:00:00Z',actor:'LAW',message:'Supplier only 90 cartons'}];
 h.reply(w);h.click({customer:'C'});const html=h.node('#app').innerHTML;
 assert.match(html,/data-progress-task="TASK"/);
 assert.doesNotMatch(html,/PURCHASE_QTY_REDUCED/);
 assert.equal((html.match(/class="stage-count">1<\/span>/g)||[]).length,7);
 assert.match(html,/class="circle stage-capsule [^"]*" data-stage="0"/);
 h.click({path:'TASK'});assert.equal(h.node('#modal').open,true);
 assert.match(h.node('#dialogContent').innerHTML,/Supplier only 90 cartons/);
 assert.match(h.node('#dialogContent').innerHTML,/LAW/);assert.equal(h.messages.length,1);
});

test('CBM alone does not flag a complete cost; financial cost errors remain visible',()=>{for(const [reason,lpCtn,shown] of [['UNAVAILABLE_CBMPERCTN',16,false],['UNAVAILABLE_CBMPERCTN',null,true],['UNAVAILABLE_CBMPERCTN; UNAVAILABLE_LPCTN',16,true],['POINTBASE_SERVICE_UNAVAILABLE',16,true]]){const h=harness(),w=workspace();Object.assign(w.tasks[0],{costErrorReason:reason,lpCtn});h.reply(w);h.click({customer:'C'});assert.equal(h.node('#app').innerHTML.includes('data-cost="TASK"'),shown);assert.equal(h.messages.length,1);}});
test('Risk Deal threshold uses valid saved GP; six percent and unknown GP are not flagged',()=>{for(const [gp,shown] of [[.0599,true],[.06,false],[-.1,true],[0,true],[null,false],[undefined,false]]){const h=harness(),w=workspace();w.tasks[0].gp=gp;h.reply(w);h.click({customer:'C'});assert.equal(h.node('#app').innerHTML.includes('class="risk-deal"'),shown);assert.doesNotMatch(h.node('#app').innerHTML,/id="riskFilter"/);}});
test('Save is hidden when clean and allocation is a same-room read-only filter',()=>{const h=harness(),w=workspace();w.tasks[0].procurement={expectedExtra:10};h.reply(w);h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/id="saveEdits" hidden/);h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});assert.equal(h.node('#saveEdits').hidden,false);h.change({id:'allocationFilter',dataset:{},value:'allocation'});assert.match(h.node('#app').innerHTML,/Awaiting warehouse/);assert.match(h.node('#app').innerHTML,/disabled>Allocate/);assert.match(h.node('#app').innerHTML,/class="roomhead"/);assert.equal(h.messages.length,1);});

test('negative net cost is explained before a write and known failed save frees editing without losing input',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{lpPc:.4652777778,lpCtn:7.4444444444,disc1:.15,disc2:0,disc3:0});h.reply(w);h.click({customer:'C'});
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'320'});h.click({controlId:'saveEdits'});
 assert.match(h.node('#liveStatus').textContent,/Barcode 00123/);assert.match(h.node('#liveStatus').textContent,/-313.67/);assert.equal(h.messages.length,1);
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'1'});h.click({controlId:'saveEdits'});const request=h.messages.at(-1);
 h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:request.requestId,ok:true,result:{ok:false,requestId:request.requestId,error:'Net cost cannot be negative.'}});
 assert.equal(h.node('#companySelect').disabled,false);assert.match(h.node('#liveStatus').textContent,/Net cost cannot be negative/);
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'0'});h.click({controlId:'saveEdits'});assert.notEqual(h.messages.at(-1).requestId,request.requestId);assert.equal(h.messages.at(-1).input.edits[0].changes.disc3,0);
});

test('drag feedback marks grip, source and exact insertion target while keeping original save ordering',()=>{
 const row=id=>{const classes=new Set();return {dataset:{id},classes,classList:{add(...names){names.forEach(name=>classes.add(name))},remove(...names){names.forEach(name=>classes.delete(name))}}}},first=row('TASK'),second=row('TASK2');
 const h=harness(undefined,[first,second]),w=workspace();w.tasks[0].editVersion='REV1';w.tasks.push({...w.tasks[0],id:'TASK2',editVersion:'REV2'});h.reply(w);h.click({customer:'C'});
 const grip={dataset:{drag:'TASK2'},closest:()=>second},handleTarget={closest:selector=>selector==='[data-drag]'?grip:null};
 h.event('pointerdown',handleTarget);assert(second.classes.has('grip-down'));
 h.event('dragstart',handleTarget,{dataTransfer:{setData(type,id){assert.equal(type,'text/plain');assert.equal(id,'TASK2')}}});assert(second.classes.has('dragging-row'));
 const target={closest:selector=>selector==='tr[data-id]'?first:null};h.event('dragover',target,{preventDefault(){}});assert(first.classes.has('drop-target'));assert.equal(h.messages.length,1);
 h.event('drop',target,{preventDefault(){}});assert(!first.classes.has('drop-target'));assert(!second.classes.has('dragging-row'));assert.equal(h.messages.length,1);
 h.click({controlId:'saveEdits'});const save=h.messages.at(-1);assert.deepEqual(Array.from(save.input.taskIds),['TASK2','TASK']);assert.equal(save.input.versions.TASK,'REV1');assert.equal(save.input.versions.TASK2,'REV2');assert.equal(save.input.edits.length,0);
});

test('department financial signals read without rebuilding unsaved task rows',async()=>{
 const mounts=[],h=harness(undefined,[],{mount:(host,department,data)=>mounts.push(data)}),w=workspace();h.reply(w);const request=h.messages.at(-1);assert.equal(request.type,'PURCHASE_ORDERS_REQUEST');h.click({customer:'C'});h.node('#app').innerHTML='UNSAVED FORM';h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[]}});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.node('#app').innerHTML,'UNSAVED FORM');assert.ok(mounts.length>=2);assert.equal(h.messages.filter(message=>message.type.includes('SAVE')).length,0);
});


test('pending save permits department navigation, customer filtering and read-only history without resubmitting',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';w.customers.push({id:'D',name:'SECOND CUSTOMER'});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D',name:'SECOND PRODUCT'});
 h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);
 h.click({view:'dashboard'});assert.match(h.node('#app').innerHTML,/Purchase Dashboard/);assert.equal(h.node('#saveTracker').hidden,false);assert.ok(h.node('#saveTracker').innerHTML.includes(save.requestId));
 h.click({view:'payments'});assert.match(h.node('#app').innerHTML,/Payment Follow-up/);
 h.click({view:'active'});h.change({id:'activeCustomer',dataset:{},value:'D'});assert.match(h.node('#app').innerHTML,/SECOND PRODUCT/);assert.doesNotMatch(h.node('#app').innerHTML,/data-id="TASK"/);
 h.click({path:'OTHER'});assert.equal(h.node('#modal').open,true);assert.match(h.node('#dialogContent').innerHTML,/Order/);
 h.click({controlId:'closeModal'});h.click({controlId:'createSelectedPo'});h.click({controlId:'saveEdits'});assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,1);
 h.click({controlId:'refresh'});assert.equal(h.messages.at(-1).type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(h.messages.at(-1).saveRequestId,save.requestId);
 h.switchCompany('GHR');assert.notEqual(h.node('#workspaceCompany').textContent,'GHR');assert.equal(h.messages.filter(m=>m.type==='PURCHASE_WORKSPACE_REQUEST').length,1);
});

test('late confirmation clears only submitted edits, retains unrelated drafts and stays on the viewed department',()=>{
 const cache=new Map(),storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},h=harness(storage),w=workspace();w.tasks[0].editVersion='V1';w.customers.push({id:'D',name:'SECOND CUSTOMER'});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D',name:'SECOND PRODUCT',editVersion:'V2'});
 h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'8'});assert.equal(save.input.edits[0].changes.disc3,5,'the transmitted request cannot change while pending');
 h.click({customer:'D'});h.change({dataset:{moneyTask:'OTHER',moneyField:'disc3'},value:'7'});h.click({view:'payments'});
 h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:true,requestId:save.requestId}});
 const saved=JSON.parse(cache.values().next().value);assert.deepEqual(saved.drafts.map(([id])=>id),['OTHER']);assert.equal(saved.drafts[0][1].changes.disc3,7);assert.equal(saved.savePending,null);
 w.tasks[0].disc3=5;w.tasks[0].editVersion='NEW';h.reply(w);assert.match(h.node('#app').innerHTML,/Payment Follow-up/);assert.equal(h.node('#saveTracker').hidden,true);
 h.click({view:'active'});h.click({controlId:'saveEdits'});const next=h.messages.at(-1);assert.equal(next.input.edits.length,1);assert.equal(next.input.edits[0].taskId,'OTHER');assert.equal(next.input.edits[0].version,'V2');assert.equal(next.input.edits[0].changes.disc3,7);
});

test('an unsaved row order remains scoped to its original customer while browsing another customer',()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='V';w.tasks.push({...w.tasks[0],id:'TASK2'});w.customers.push({id:'D',name:'SECOND CUSTOMER'});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D',name:'SECOND PRODUCT'});h.reply(w);h.click({customer:'C'});
 h.change({dataset:{select:'TASK2'},checked:true});h.click({controlId:'moveSelected'});h.node('#moveTarget').value='top';h.click({controlId:'applyMove'});
 h.click({view:'dashboard'});h.click({customer:'D'});assert.match(h.node('#app').innerHTML,/SECOND PRODUCT/);assert.doesNotMatch(h.node('#app').innerHTML,/data-id="TASK2"/);
 h.click({controlId:'saveEdits'});const save=h.messages.at(-1);assert.equal(save.input.customerId,'C');assert.deepEqual(Array.from(save.input.taskIds),['TASK2','TASK']);
 h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:true,requestId:save.requestId}});h.reply(w);assert.match(h.node('#app').innerHTML,/SECOND PRODUCT/);h.click({controlId:'saveEdits'});assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,1);
});

test('late receipt from an earlier save cannot resolve or retry a later operation',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const old=h.messages.at(-1);h.click({controlId:'refresh'});const check=h.messages.at(-1);
 h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:old.requestId,ok:true,result:{ok:true,requestId:old.requestId}});w.tasks[0].editVersion='NEW';h.reply(w);h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'6'});h.click({controlId:'saveEdits'});const next=h.messages.at(-1);
 h.send({type:'PURCHASE_SAVE_CHECK_RESULT',company:'NCT',requestId:check.requestId,ok:true,result:{ok:true,requestId:old.requestId}});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.node('#companySelect').disabled,true);assert.ok(h.node('#saveTracker').innerHTML.includes(next.requestId));assert.equal(h.messages.at(-1),next);
});

test('restored pending submission exposes original values and supports browsing without creating a save',()=>{
 const cache=new Map(),storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},w=workspace();w.tasks[0].editVersion='V';const first=harness(storage);first.reply(w);first.click({customer:'C'});first.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});first.click({controlId:'saveEdits'});const save=first.messages.at(-1);
 const h=harness(storage);h.reply(w);h.click({view:'payments'});assert.match(h.node('#app').innerHTML,/Payment Follow-up/);h.click({controlId:'viewPendingSave'});assert.match(h.node('#dialogContent').innerHTML,/Submitted values/);assert.ok(h.node('#dialogContent').innerHTML.includes(save.requestId));assert.match(h.node('#dialogContent').innerHTML,/disc3/);assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,0);
});


test('pending dialog unlock after a known rejection preserves fields that were already disabled',()=>{
 const supplier={dataset:{},disabled:true},reason={dataset:{},disabled:false},h=harness(undefined,[],null,[supplier,reason]),w=workspace();w.sourcesVersion='V';w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',ea:16,editVersion:'V',procurement:{totalCtn:100,revision:'P',draftPlan:true}});h.reply(w);h.click({customer:'C'});h.click({planTask:'TASK'});
 for(const [id,value]of Object.entries({planSupplier:'S',planTotal:'100',planReason:'Price updated','planPrice-lpPc':'3','planPrice-lpCtn':'48','planPrice-disc1':'0','planPrice-disc2':'0','planPrice-disc3':'0'}))h.node('#'+id).value=value;
 h.click({controlId:'saveSupplierPlan'});const save=h.messages.at(-1);assert.equal(reason.disabled,true);h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:false,requestId:save.requestId,error:'Check supplier costs and discounts.'}});assert.equal(supplier.disabled,true);assert.equal(reason.disabled,false);
});

test('pre-upgrade row-order cache retains customer scope after navigating to another customer',()=>{
 const cache=new Map([['fmcg-purchase-draft-v1/NCT/STAFF/MEMBER',JSON.stringify({customerId:'C',drafts:[],sequenceDraft:['TASK2','TASK'],sequenceVersions:{TASK:'V',TASK2:'V'}})]]),storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},h=harness(storage),w=workspace();w.tasks[0].editVersion='V';w.tasks.push({...w.tasks[0],id:'TASK2'});w.customers.push({id:'D',name:'SECOND CUSTOMER'});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D',name:'SECOND PRODUCT'});h.reply(w);h.click({customer:'D'});assert.match(h.node('#app').innerHTML,/SECOND PRODUCT/);h.click({controlId:'saveEdits'});const save=h.messages.at(-1);assert.equal(save.input.customerId,'C');assert.deepEqual(Array.from(save.input.taskIds),['TASK2','TASK']);
});


test('Active move entry immediately exposes native drag handles for a sole customer without submitting',()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'active'});const before=h.messages.length;
 assert.match(h.node('#app').innerHTML,/data-drag="TASK"/);h.click({activeMove:'true'});
 assert.match(h.node('#app').innerHTML,/draggable="true" aria-description="Drag to move · 拖动排列" data-drag="TASK"/);
 assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="moveCustomer"/);assert.equal(h.messages.length,before);
 assert.match(h.node('#liveStatus').textContent,/Save/);
});


test('All Customers keeps native handles across navigation and drags a complete group with a customer-scoped Save',()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='V1';w.customers.push({id:'D',name:'SECOND CUSTOMER'});
 w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D',editVersion:'VD'},{...w.tasks[0],id:'TASK2',editVersion:'V2'},{...w.tasks[0],id:'SOURCE2',procurementSource:true,customerDemandTaskId:'TASK2',editVersion:'VS'});
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML;assert.match(html,/data-drag="TASK2"/);assert.match(html,/data-drag="OTHER"/);assert.doesNotMatch(html,/data-drag="SOURCE2"/);
 h.click({view:'dashboard'});h.click({view:'active'});assert.match(h.node('#app').innerHTML,/data-drag="TASK2"/);
 h.change({id:'activeCustomer',value:'C',dataset:{}});h.change({id:'activeCustomer',value:'',dataset:{}});assert.match(h.node('#app').innerHTML,/data-drag="OTHER"/);
 const drag=()=>{h.event('dragstart',{closest:()=>({dataset:{drag:'TASK2'},closest:()=>null})},{dataTransfer:{setData(){}}});h.event('drop',{closest:()=>({dataset:{id:'TASK'}})},{preventDefault(){}});};
 const before=h.messages.length;drag();html=h.node('#app').innerHTML;assert.ok(html.indexOf('data-id="TASK2"')<html.indexOf('data-id="TASK"'));assert.ok(html.indexOf('data-source-id="SOURCE2"')<html.indexOf('data-id="OTHER"'));assert.equal(h.messages.length,before);
 h.click({view:'dashboard'});h.click({view:'active'});html=h.node('#app').innerHTML;assert.ok(html.indexOf('data-id="TASK2"')<html.indexOf('data-id="TASK"'));assert.match(html,/data-drag="TASK2"/);
 h.click({activeCancel:'true'});html=h.node('#app').innerHTML;assert.ok(html.indexOf('data-id="TASK"')<html.indexOf('data-id="TASK2"'));
 drag();h.click({controlId:'saveEdits'});const save=h.messages.at(-1);assert.equal(save.input.customerId,'C');assert.deepEqual(Array.from(save.input.taskIds),['TASK2','SOURCE2','TASK']);assert.deepEqual(Object.keys(save.input.versions).sort(),['SOURCE2','TASK','TASK2']);assert.equal(save.input.versions.OTHER,undefined);
});

test('All Customers rejects cross-customer drop and protects an existing customer sort draft',()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='V';w.customers.push({id:'D',name:'SECOND'});w.tasks.push({...w.tasks[0],id:'TASK2'},{...w.tasks[0],id:'OTHER',customerId:'D'});h.reply(w);h.click({view:'active'});const before=h.messages.length;
 const start=id=>h.event('dragstart',{closest:()=>({dataset:{drag:id},closest:()=>null})},{dataTransfer:{setData(){}}});
 start('TASK');h.event('drop',{closest:()=>({dataset:{id:'OTHER'}})},{preventDefault(){}});assert.match(h.node('#liveStatus').textContent,/同一客户/);h.click({controlId:'saveEdits'});assert.equal(h.messages.length,before);
 start('TASK2');h.event('drop',{closest:()=>({dataset:{id:'TASK'}})},{preventDefault(){}});
 let prevented=false;h.event('dragstart',{closest:()=>({dataset:{drag:'OTHER'},closest:()=>null})},{preventDefault(){prevented=true;},dataTransfer:{setData(){throw Error('must not start another customer');}}});assert.equal(prevented,true);
 h.click({controlId:'saveEdits'});assert.equal(h.messages.at(-1).input.customerId,'C');assert.deepEqual(Array.from(h.messages.at(-1).input.taskIds),['TASK2','TASK']);
});

test('Clicking a persistent handle in All Customers opens the original destination dialog for its customer',()=>{
 const h=harness(),w=workspace();w.tasks.push({...w.tasks[0],id:'TASK2'});w.customers.push({id:'D',name:'SECOND'});w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'D'});h.reply(w);h.click({view:'active'});const before=h.messages.length;
 h.click({drag:'TASK2'});assert.match(h.node('#dialogContent').innerHTML,/Move Row 移动行/);assert.match(h.node('#dialogContent').innerHTML,/Before Row 001 前面/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/<option value="OTHER">/);assert.equal(h.messages.length,before);
});


test('Active work tabs separate work content from filters and retain a row-order draft and supplier filter',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S1',name:'FIRST SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S1',editVersion:'V',procurement:{expectedExtra:10,totalCtn:20,revision:'P'}});w.tasks.push({...w.tasks[0],id:'TASK2'});h.reply(w);h.click({view:'active'});
 let html=h.node('#app').innerHTML;assert.match(html,/data-active-work="orders" aria-pressed="true"/);assert.match(html,/data-active-work="allocation" aria-pressed="false"/);assert.match(html,/id="allocationFilter" aria-label="Work source" hidden/);assert.match(html,/All Customers 全部客户/);assert.match(html,/All Suppliers 全部供应商/);
 h.change({id:'supplierFilter',value:'S1',dataset:{}});h.event('dragstart',{closest:()=>({dataset:{drag:'TASK2'},closest:()=>null})},{dataTransfer:{setData(){}}});h.event('drop',{closest:()=>({dataset:{id:'TASK'}})},{preventDefault(){}});const before=h.messages.length;
 h.click({activeWork:'allocation'});html=h.node('#app').innerHTML;assert.match(html,/data-active-work="allocation" aria-pressed="true"/);assert.match(html,/class="tools ao-allocation-tools"/);assert.match(html,/Awaiting warehouse/);assert.match(html,/disabled>Allocate/);assert.match(html,/class="save-group" (?!hidden)/);assert.ok(!html.includes('Sales / Buyer'));
 h.click({activeWork:'orders'});html=h.node('#app').innerHTML;assert.ok(html.indexOf('data-id="TASK2"')<html.indexOf('data-id="TASK"'));assert.match(html,/<option value="S1" selected>/);assert.equal((html.match(/data-drag=/g)||[]).length,2);assert.equal(h.messages.length,before);
 h.click({controlId:'saveEdits'});assert.deepEqual(Array.from(h.messages.at(-1).input.taskIds),['TASK2','TASK']);
});

test('Active work tabs allow read-only browsing during a pending Save without resubmitting',()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='V';w.tasks[0].procurement={expectedExtra:10};h.reply(w);h.click({view:'active'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});h.click({controlId:'saveEdits'});const count=h.messages.length,request=h.messages.at(-1);
 h.click({activeWork:'allocation'});assert.match(h.node('#app').innerHTML,/data-active-work="allocation" aria-pressed="true"/);h.click({activeWork:'orders'});assert.match(h.node('#app').innerHTML,/data-id="TASK"/);assert.match(h.node('#app').innerHTML,/data-drag="TASK"/);assert.equal(h.messages.length,count);assert.equal(h.messages.at(-1).requestId,request.requestId);
});

function rowErrorFixture(){const h=harness(),w=workspace();w.tasks.unshift({...w.tasks[0],id:'BEFORE-1',barcode:'B1'},{...w.tasks[0],id:'BEFORE-2',barcode:'B2'});return {h,w};}
function rejectSave(h,save){h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:false,error:'Select an active supplier.',requestId:save.requestId}});return h.node('#liveStatus').textContent;}
test('failed main-row edit identifies ROW 003 while preserving actual backend error and request reference',()=>{
 const {h,w}=rowErrorFixture();h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1),text=rejectSave(h,save);assert.match(text,/^ROW 003 · Barcode 00123/);assert.doesNotMatch(text,/的子行/);assert.ok(text.includes('Select an active supplier.'));assert.ok(text.includes(save.requestId));assert.equal(save.input.edits[0].taskId,'TASK');
});
test('new supplier failure identifies parent ROW 003 child even though no child task ID exists yet',()=>{
 const {h,w}=rowErrorFixture();Object.assign(w.tasks[2],{supplierId:'S',po:'PO1',procurement:{revision:'P1',totalCtn:200},sourcing:{unplacedCtn:50}});w.suppliers=[{id:'S',name:'Supplier'}];h.reply(w);h.click({customer:'C'});h.click({sources:'TASK'});
 for(const [id,value] of Object.entries({sourceSupplier:'S',sourceQty:'10','sourcePrice-lpPc':'1','sourcePrice-lpCtn':'16','sourcePrice-disc1':'0','sourcePrice-disc2':'0','sourcePrice-disc3':'0',sourceReason:'Test'}))h.node('#'+id).value=value;
 h.click({controlId:'saveAdditionalSource'});const save=h.messages.at(-1);assert.equal(save.operation,'ADD_SOURCE');assert.match(rejectSave(h,save),/^ROW 003 的子行 · Barcode 00123/);assert.equal(save.input.parentTaskId,'TASK');
});
test('existing supplier child reports the parent row rather than counting child rows as products',()=>{
 const {h,w}=rowErrorFixture();w.tasks.splice(1,0,{...w.tasks[2],id:'CHILD',procurementSource:true,customerDemandTaskId:'TASK'});h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'CHILD',moneyField:'disc3'},value:'3'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);assert.match(rejectSave(h,save),/^ROW 003 的子行/);
});

test('supplier-filtered diagnostics use the same visible product numbering as the table',()=>{
 const {h,w}=rowErrorFixture();w.tasks[0].supplierId='OTHER';w.tasks[1].supplierId='S';w.tasks[2].supplierId='S';w.suppliers=[{id:'S',name:'Supplier'},{id:'OTHER',name:'Other'}];h.reply(w);h.click({view:'active'});h.change({id:'supplierFilter',value:'S'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});h.click({controlId:'saveEdits'});assert.match(rejectSave(h,h.messages.at(-1)),/^ROW 002 ·/);
});
test('diagnostics follow moved product order without changing submitted edits or sequence',()=>{
 const {h,w}=rowErrorFixture();h.reply(w);h.click({customer:'C'});h.click({drag:'TASK'});h.node('#moveTarget').value='top';h.click({controlId:'applyMove'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);assert.equal(save.input.taskIds[0],'TASK');assert.match(rejectSave(h,save),/^ROW 001 ·/);
});
test('the original supplier record rendered as the first child is labelled as a child for source costing',()=>{
 const {h,w}=rowErrorFixture();w.tasks.push({...w.tasks[2],id:'CHILD',procurementSource:true,customerDemandTaskId:'TASK'});h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'3'});h.click({controlId:'saveEdits'});assert.match(rejectSave(h,h.messages.at(-1)),/^ROW 003 的子行/);
});

async function prewriteCmsFailure(save){
 const backend=fs.readFileSync(path.join(__dirname,'../backend/purchaseOperations.web.js'),'utf8');
 const callback=backend.slice(backend.indexOf('export const savePurchaseOperation='),backend.indexOf('export const getSupplierProfile=')).replace('export const savePurchaseOperation=','this.save=');
 const context={webMethod:(_,fn)=>fn,Permissions:{SiteMember:1},getPurchaseStaffContext:async()=>{throw Object.assign(Error('CMS lookup failed'),{code:'WDE0118'});},operate:async()=>{throw Error('Must never enter an operation');},console:{warn(){}}};vm.runInNewContext(callback,context);
 return context.save(save.company,save.requestId,save.operation,save.input);
}
test('first-attempt CMS lookup failure releases waiting and preserves original editable draft without refresh or receipt polling',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const first=h.messages.at(-1);
 h.send({type:'PURCHASE_SAVE_RESULT',company:first.company,requestId:first.requestId,ok:true,result:await prewriteCmsFailure(first)});
 assert.equal(h.node('#companySelect').disabled,false);assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_CHECK_REQUEST').length,0);assert.match(h.node('#liveStatus').textContent,/attempt did not start/);
 h.click({controlId:'saveEdits'});const next=h.messages.at(-1);assert.equal(next.type,'PURCHASE_SAVE_REQUEST');assert.notEqual(next.requestId,first.requestId);assert.equal(next.input.edits[0].changes.disc3,5);assert.equal(next.input.edits[0].version,'REV');
});
test('retry CMS lookup failure cannot clear an earlier uncertain save or permit a new request',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const first=h.messages.at(-1);
 h.send({type:'PURCHASE_SAVE_RESULT',company:first.company,requestId:first.requestId,ok:false,error:'504 timeout'});const check=h.messages.at(-1);h.send({type:'PURCHASE_SAVE_CHECK_RESULT',requestId:check.requestId,ok:false,error:'Read failed'});await new Promise(resolve=>setImmediate(resolve));
 h.click({controlId:'retryPendingSave'});const retry=h.messages.at(-1);assert.deepEqual(retry,first);h.send({type:'PURCHASE_SAVE_RESULT',company:first.company,requestId:first.requestId,ok:true,result:await prewriteCmsFailure(retry)});
 assert.equal(h.node('#companySelect').disabled,true);assert.equal(h.messages.at(-1).type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(h.messages.at(-1).saveRequestId,first.requestId);const before=h.messages.length;h.click({controlId:'saveEdits'});assert.equal(h.messages.length,before);
});
test('restored legacy pending request stays uncertain even when its next attempt cannot read CMS',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},h=harness(storage),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const first=h.messages.at(-1);
 const key=[...values.keys()][0],cached=JSON.parse(values.get(key));delete cached.saveAttemptCount;values.set(key,JSON.stringify(cached));
 const restored=harness(storage);restored.reply(w);const check=restored.messages.at(-1);restored.send({type:'PURCHASE_SAVE_CHECK_RESULT',requestId:check.requestId,ok:false,error:'Read failed'});await new Promise(resolve=>setImmediate(resolve));restored.click({controlId:'retryPendingSave'});const retry=restored.messages.at(-1);assert.equal(retry.requestId,first.requestId);
 restored.send({type:'PURCHASE_SAVE_RESULT',company:first.company,requestId:first.requestId,ok:true,result:await prewriteCmsFailure(retry)});assert.equal(restored.node('#companySelect').disabled,true);assert.equal(restored.messages.at(-1).type,'PURCHASE_SAVE_CHECK_REQUEST');
});

test('PO workspace has seven ordered columns, per-customer shipment ETA and unchanged source identity',async()=>{
 const h=harness(),w=workspace();w.customers=[{id:'C',name:'Full customer',shortName:'SHORT'},{id:'D',name:'Other customer',shortName:'OTHER'}];h.reply(w);h.click({view:'po'});const req=h.messages.at(-1);
 const row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',customerIds:['C','D'],taskIds:['TASK'],supplierName:'FULL SUPPLIER SDN BHD',supplierShortName:'SUP',documents:[],history:[],documentStatus:'MISSING',termDays:null,amount:100,shipmentDates:[{customerId:'C',date:'2026-10-28'},{customerId:'D',date:'2026-11-05'}]};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));const html=h.node('#app').innerHTML;
 assert.equal(h.node('#taskSignals').hidden,true);assert.deepEqual([...html.matchAll(/<th>(.*?)<\/th>/g)].map(match=>match[1].replace(/<button.*?<\/button>/g,'').trim()),['Created On','P.O. No.','Supplier','Purchase For','Amount MYR','Docs','Request Payment']);assert.match(html,/po-payment-ineligible">Not eligible/);assert.doesNotMatch(html,/>Details<|<th>Term/);assert.match(html,/North Cape Trading Sdn\. Bhd\./);assert.match(html,/SHORT<\/b><small[^>]*>ETA: 28 Oct 2026/);assert.match(html,/OTHER<\/b><small[^>]*>ETA: 05 Nov 2026/);assert.match(html,/FULL SUPPLIER SDN BHD/);assert.doesNotMatch(html,/<th>Chase Payment|<th>Status|<b>SUP<\/b>/);assert.match(html,/data-po-view="TASK"/);assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);
});

test('term dropdown sends Cash as zero through existing versioned save with factual audit reason',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1);const row={id:'PO',version:'PV',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',termDays:null};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));h.click({poTerm:'PO'});
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/<option value="0" selected>Cash/);for(const day of [7,14,30,45,60,90])assert.ok(html.includes('value="'+day+'"'));assert.doesNotMatch(html,/<textarea/);
 h.node('#poTermDays').value='0';h.click({controlId:'savePurchaseOrderMeta'});const sent=h.messages.at(-1);assert.equal(sent.type,'PURCHASE_ORDER_SAVE_REQUEST');assert.equal(sent.input.action,'TERM');assert.equal(sent.input.termDays,0);assert.equal(sent.input.version,'PV');assert.equal(sent.input.reason,'Payment term confirmed: Cash');
});

test('payment entry requires current linked Our PO and PI, SO or INV; stale and superseded documents do not qualify',async()=>{
 const doc=(type,extra={})=>({type,fileId:type+'-FILE',linked:true,number:type+'-1',...extra});
 for(const [documents,eligible] of [[[doc('PO')],false],[[doc('PI')],false],[[doc('PO'),doc('PI')],true],[[doc('PO'),doc('SO')],true],[[doc('PO'),doc('INV')],true],[[doc('PO',{superseded:true}),doc('PI')],false],[[doc('PO',{linked:false}),doc('PI')],false],[[doc('PO',{contentVersion:'OLD'}),doc('PI')],false]]){
  const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'V',contentVersion:'CURRENT',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents,history:[],documentStatus:'MISSING',termDays:null,amount:100};
  h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(/data-po-request="PO"/.test(h.node('#app').innerHTML),eligible);assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);
 }
});

test('Docs help is read-only and an unconnected payment form cannot submit an unsupported action',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[{type:'PO',linked:true,fileId:'OUR'},{type:'PI',linked:true,fileId:'PI',number:'PI-1'}],history:[],documentStatus:'PROVISIONAL',termDays:30,amount:100};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 h.click({controlId:'poDocsHelp'});assert.equal(h.node('#modal').open,false);assert.match(h.node('#app').innerHTML,/popover="auto"/);assert.match(h.node('#app').innerHTML,/Our Purchase Order/);assert.match(h.node('#app').innerHTML,/Credit Note from Supplier/);
 h.click({poRequest:'PO'});assert.match(h.node('#dialogContent').innerHTML,/id="poRequestTerm"/);assert.match(h.node('#dialogContent').innerHTML,/Connection pending/);h.click({controlId:'submitPaymentRequest'});assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);assert.match(h.node('#dialogError').textContent,/connection is pending/);
});

test('payment request omits manual date and client timestamp; submits saved PO version and entered amount',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[{type:'PO',linked:true,fileId:'OUR'},{type:'PI',linked:true,fileId:'PI',number:'PI-1'}],history:[],documentStatus:'PROVISIONAL',termDays:30,amount:100};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row],paymentRequestsConnected:true}});await new Promise(resolve=>setImmediate(resolve));h.click({poRequest:'PO'});
 assert.doesNotMatch(h.node('#dialogContent').innerHTML,/poRequestDate|type="date"/);assert.match(h.node('#dialogContent').innerHTML,/Submission time is recorded automatically/);
 h.node('#poRequestAmount').value='25.00';h.node('#poRequestPurpose').value='DEPOSIT';h.node('#poRequestBasis').value='PI';h.node('#poRequestTerm').value='30';h.click({controlId:'submitPaymentRequest'});
 const sent=h.messages.at(-1);assert.equal(sent.input.action,'REQUEST_PAYMENT');assert.equal(sent.input.requestedCents,2500);assert.equal(sent.input.version,'V');assert.equal(sent.input.requiredDate,undefined);assert.equal(sent.input.submittedAt,undefined);
});

test('submitted payment has green entry, recorded details and resubmission values; Account ownership or review prevents edits',async()=>{
 for(const [stage,review,editable] of [['SUBMITTED',null,true],['SUBMITTED',{stage:'RECEIVED'},true],['OWNED',null,false],['SUBMITTED',{stage:'REVIEWING'},false],['PROCESSING',null,false]]){
  const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[{type:'PO',linked:true,fileId:'OUR'},{type:'PI',linked:true,fileId:'PI',number:'PI-1'}],history:[],documentStatus:'PROVISIONAL',termDays:30,amount:100,procurementHandoff:{stage,submitted:true,submission:{at:'2026-10-16T08:12:00Z',by:'LAW',paymentRequest:{requestedCents:2500,purpose:'DEPOSIT',basisFileId:'PI',termDays:30}}},paymentHandoff:{review,status:'AWAITING_REVIEW'}};
  h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row],paymentRequestsConnected:true}});await new Promise(resolve=>setImmediate(resolve));assert.match(h.node('#app').innerHTML,/po-request-payment submitted/);h.click({poRequest:'PO'});
  let html=h.node('#dialogContent').innerHTML;assert.match(html,/Last Submitted/);assert.match(html,/16:12/);assert.match(html,/LAW/);assert.match(html,/25.00/);assert.equal(/data-po-request-edit/.test(html),editable);
  h.click({poRequestEdit:'PO'});html=h.node('#dialogContent').innerHTML;
  if(editable){assert.match(html,/value="25.00"/);assert.match(html,/value="DEPOSIT" selected/);}
  else{assert.doesNotMatch(html,/id="poRequestAmount"/);h.click({controlId:'submitPaymentRequest'});assert.match(h.node('#dialogError').textContent,/locked/);assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);}
 }
});

test('file panel separates upload time and document date; only the uploader sees the permitted Delete action',async()=>{
 for(const owner of ['STAFF','OTHER',null]){
  const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[{type:'PI',number:'PI-1',fileId:'FILE',name:'supplier.pdf',linked:true,uploadedAt:'2026-10-16T06:05:00Z',uploadedBy:'LAW',uploadedByStaffId:owner,deleteAllowed:true,date:'2026-10-15'}],history:[],documentStatus:'PROVISIONAL',termDays:30,amount:100};
  h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row],documentDeletionConnected:true}});await new Promise(resolve=>setImmediate(resolve));h.click({poDocs:'PO',poDocType:'PI'});const html=h.node('#dialogContent').innerHTML;
  assert.match(html,/Uploaded: .*14:05.*LAW/);assert.match(html,/Document date: 2026-10-15/);assert.equal(/data-po-delete="PO"/.test(html),owner==='STAFF');
  h.click({poDelete:'PO',poFile:'FILE'});
  if(owner==='STAFF'){assert.match(h.node('#dialogContent').innerHTML,/Google Drive Trash/);h.click({controlId:'deletePurchaseDocument'});const sent=h.messages.at(-1);assert.equal(sent.input.action,'DELETE_DOCUMENT');assert.equal(sent.input.fileId,'FILE');assert.equal(sent.input.version,'V');}
  else assert.equal(h.messages.filter(m=>m.type.includes('SAVE')).length,0);
 }
});

test('legacy document date never substitutes for an unknown upload timestamp',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[{type:'PI',number:'PI-1',fileId:'FILE',linked:true,date:'2026-10-15',uploadedBy:'LAW'}],history:[],documentStatus:'PROVISIONAL'};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));h.click({poDocs:'PO'});assert.match(h.node('#dialogContent').innerHTML,/Uploaded: Time unavailable · LAW/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/data-po-delete/);
});

test('document badges open only the selected category, including existing DO and credit notes',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1);const row={id:'PO',version:'PV',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[{type:'DO',number:'DO-ONE',fileId:'one'},{type:'CN',number:'CN-TWO',fileId:'two'}],history:[],documentStatus:'PROVISIONAL',termDays:21,procurementHandoff:{editable:false}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));h.click({poDocs:'PO',poDocType:'DO'});assert.match(h.node('#dialogContent').innerHTML,/DO-ONE/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/CN-TWO/);h.click({poDocs:'PO',poDocType:'CN'});assert.match(h.node('#dialogContent').innerHTML,/CN-TWO/);h.click({poTerm:'PO'});assert.match(h.node('#dialogContent').innerHTML,/<option value="21" selected>21 Days/);assert.match(h.node('#dialogContent').innerHTML,/id="poTermDays" disabled/);assert.match(h.node('#dialogContent').innerHTML,/id="savePurchaseOrderMeta" disabled/);
});

test('direct DO upload fixes its type and records an audit without a type dropdown or free-text note',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'PV',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',termDays:null};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row],documentsConnected:true}});await new Promise(resolve=>setImmediate(resolve));h.click({poUpload:'PO',poDocType:'DO'});const html=h.node('#dialogContent').innerHTML;
 assert.match(html,/Upload DO/);assert.doesNotMatch(html,/<select|<textarea|poDocumentType|poDocumentReason/);assert.match(html,/<input type="hidden" id="poDocumentAmount"/);
 const pdf=Buffer.from('%PDF-1.4\nTEST');h.node('#poDocumentFile').files=[{size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)}];h.node('#poDocumentDate').value='2026-10-16';h.node('#poDocumentNumber').value='DO-123';h.node('#poDocumentType').value='INV';h.click({controlId:'uploadPurchaseDocument'});await new Promise(resolve=>setImmediate(resolve));const sent=h.messages.at(-1);assert.equal(sent.type,'PURCHASE_ORDER_SAVE_REQUEST');assert.equal(sent.input.type,'DO');assert.equal(sent.input.version,'PV');assert.equal(sent.input.reason,'Uploaded DO document DO-123');
});

test('invoice upload retains mandatory amount validation and generic archive upload offers buttons',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'PV',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',termDays:null};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row],documentsConnected:true}});await new Promise(resolve=>setImmediate(resolve));h.click({poUpload:'PO'});assert.match(h.node('#dialogContent').innerHTML,/data-po-doc-type="CN"/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/<select/);h.click({poUpload:'PO',poDocType:'INV'});assert.match(h.node('#dialogContent').innerHTML,/input id="poDocumentAmount" inputmode/);h.node('#poDocumentAmount').value='0.00';h.click({controlId:'uploadPurchaseDocument'});assert.match(h.node('#dialogError').textContent,/MYR/);assert.equal(h.messages.filter(m=>m.type==='PURCHASE_ORDER_SAVE_REQUEST').length,0);
});

test('PO upload history shows saved actor time and actual filename, preserving original event data',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),event={id:'EV',action:'SUPPLIER_DOCUMENT_UPLOADED',result:'SAVED',actor:'LAW',time:'2026-10-16T07:00:00Z',changes:{type:'INV',number:'INV-09',fileId:'FILE-09',reason:'Supplier final invoice'}};
 const before=JSON.stringify(event),row={id:'PO',version:'PV',number:'NCT-PO-1',supplierName:'SUPPLIER',state:'ACTIVE',taskIds:['TASK'],documents:[{fileId:'FILE-09',type:'INV',number:'INV-09',name:'2026-10-16 SUP INV INV-09.pdf'}],history:[event],documentStatus:'COMPLETE',termDays:30};h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));h.click({poHistory:'PO'});
 const html=h.node('#poHistoryEntries').innerHTML;assert.match(html,/Date &amp; Time/);assert.match(html,/Staff 员工/);assert.match(html,/>LAW<\/td>/);assert.match(html,/2026-10-16 SUP INV INV-09\.pdf/);assert.match(html,/15:00:00/);assert.doesNotMatch(html,/Deleted|删除文件/);assert.equal(JSON.stringify(event),before);assert.equal(h.messages.filter(m=>m.type==='PURCHASE_ORDER_SAVE_REQUEST').length,0);
});

test('Active notice jump targets the exact supplier child and clears only hiding filters without saving',()=>{
 const classes=new Set(),target={dataset:{sourceId:'CHILD'},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},scrollIntoView(options){this.scrolled=options.block;}};
 const h=harness(undefined,[target]),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',po:'PO',procurement:{revision:'P',totalCtn:10}});w.tasks.push({...w.tasks[0],id:'CHILD',customerDemandTaskId:'TASK',procurementSource:true,po:'',procurement:{revision:'P2',totalCtn:20}});
 h.reply(w);h.click({view:'active'});h.change({id:'supplierFilter',value:'HIDDEN',dataset:{}});h.click({activeNotice:'pending'});assert.match(h.node('#dialogContent').innerHTML,/Row 001/);const before=h.messages.length;h.click({activeNoticeRow:'CHILD'});
 assert.equal(target.scrolled,'center');assert.ok(classes.has('highlight'));assert.match(h.node('#app').innerHTML,/data-source-id="CHILD"/);assert.equal(h.messages.length,before);
});
test('Dashboard receiving alert retains its original View action',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{supplierId:'S',procurement:{revision:'P',totalCtn:30},warehouse:{accepted:20,hasPhysicalReceipt:true,issue:true},quantityCases:[{id:'CASE',kind:'RECEIPT',quantity:10,status:'OPEN',blocks:['DISPATCH']}]});w.suppliers=[{id:'S',name:'SUPPLIER'}];h.reply(w);h.click({supplierShipmentAlert:'S'});assert.match(h.node('#dialogContent').innerHTML,/data-progress-task="TASK"/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/data-active-notice-row/);
});

test('request amount clears on focus and formats valid input to two decimals without masking invalid precision',()=>{
 const h=harness(),el={id:'poRequestAmount',value:'480.00',dataset:{}};
 h.event('focusin',el);assert.equal(el.value,'');
 h.event('focusout',el);assert.equal(el.value,'');
 el.value='36';h.event('focusout',el);assert.equal(el.value,'36.00');
 el.value='36.5';h.event('focusout',el);assert.equal(el.value,'36.50');
 el.value='36.555';h.event('focusout',el);assert.equal(el.value,'36.555');
 el.readOnly=true;h.event('focusin',el);assert.equal(el.value,'36.555');
});

test('Follow Up includes only submitted requests, filters actionable cards and deducts later applied credit',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1);
 const base={id:'PO',version:'V',number:'SUBMITTED-PO',supplierName:'SUPPLIER',customerName:'CUSTOMER',amount:480,documents:[],history:[],finance:{paidCents:10000,creditAppliedCents:5000},paymentHandoff:{status:'REVIEWING'},procurementHandoff:{stage:'SUBMITTED',submitted:true,submission:{at:'2026-10-16T08:00:00Z',by:'BUYER',paymentRequest:{requestedCents:43000,cnCents:5000,paidCents:0,creditAppliedCents:0}}}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[base,{...base,id:'NONE',number:'NEVER-SUBMITTED',procurementHandoff:{stage:'LEGACY'}},{...base,id:'WD',number:'WITHDRAWN-PO',procurementHandoff:{...base.procurementHandoff,stage:'WITHDRAWN'}},{...base,id:'RET',number:'RETURNED-PO',procurementHandoff:{...base.procurementHandoff,stage:'RETURNED'}}]}});await new Promise(resolve=>setImmediate(resolve));
 h.click({view:'payments'});let html=h.node('#app').innerHTML;assert.match(html,/SUBMITTED-PO/);assert.match(html,/RETURNED-PO/);assert.doesNotMatch(html,/NEVER-SUBMITTED|WITHDRAWN-PO/);assert.match(html,/280\.00/);assert.match(html,/Awaiting Review/);assert.match(html,/Action Required/);assert.match(html,/In Progress/);assert.match(html,/Payment Updates/);
 h.click({paymentFilter:'PROGRESS'});html=h.node('#app').innerHTML;assert.match(html,/SUBMITTED-PO/);assert.doesNotMatch(html,/RETURNED-PO/);
 h.click({paymentFilter:'ACTION'});html=h.node('#app').innerHTML;assert.match(html,/RETURNED-PO/);assert.doesNotMatch(html,/SUBMITTED-PO/);assert.match(html,/Needs review/);
});

test('Follow Up uses requested columns, Malaysian calendar dates, real Account notes and full/partial/problem states',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),now=Date.now();
 const base={id:'FULL',number:'FULL-PO',supplierName:'SUP',customerName:'BUYER',documents:[],finance:{paidCents:43000,creditAppliedCents:0,payments:[]},procurementHandoff:{stage:'OWNED',submitted:true,submission:{at:new Date(now).toISOString(),by:'BUYER',paymentRequest:{requestedCents:43000,paidCents:0,creditAppliedCents:0,cnCents:5000}}},paymentHandoff:{unreadCount:1},history:[{action:'ACCOUNT_TAKE_OWNERSHIP',result:'SAVED',time:'2026-10-16T01:00:00Z',actor:'ACCOUNT STAFF',message:'Confirm <supplier> documents'},{action:'PAYMENT_REQUEST_SUBMITTED',result:'SAVED',time:'2026-10-16T02:00:00Z',actor:'BUYER',message:'Private purchase action'}]};
 base.creditTransfers=[{id:'CT',at:'2026-10-16T03:00:00Z',by:'ACCOUNT CREDIT STAFF',reason:'Used verified credit balance',cents:5000}];
 const waiting={...base,id:'WAIT',number:'WAIT-PO',finance:{paidCents:0},paymentHandoff:{},procurementHandoff:{...base.procurementHandoff,stage:'SUBMITTED',submission:{...base.procurementHandoff.submission,at:new Date(now-86400000).toISOString()}}};
 const problem={...waiting,id:'BAD',number:'BAD-PO',procurementHandoff:{...waiting.procurementHandoff,stage:'RETURNED',submission:{...waiting.procurementHandoff.submission,at:new Date(now-2*86400000).toISOString()}}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[base,waiting,problem]}});await new Promise(resolve=>setImmediate(resolve));h.click({view:'payments'});const html=h.node('#app').innerHTML;
 assert.match(html,/<th>Requested<\/th><th>P.O. No.<\/th><th>Supplier<\/th><th>Purchase For<\/th><th>Amount MYR<\/th><th>Status<\/th><th><span class="pf-slip-heading">Pay Slip<\/span><\/th><th>Note from Acc.<\/th><th>History<\/th>/);
 for(const text of ['Today','Yesterday','2 Days ago','Fully Paid','Waiting for Acc. response','Problem','Used verified credit balance'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Private purchase action/);assert.equal(h.node('#taskSignals').hidden,true);
 h.click({paymentFilter:'UPDATES'});assert.match(h.node('#app').innerHTML,/FULL-PO/);assert.doesNotMatch(h.node('#app').innerHTML,/WAIT-PO|BAD-PO/);
 h.click({accountHistory:'FULL'});assert.match(h.node('#poHistoryEntries').innerHTML,/ACCOUNT STAFF/);assert.match(h.node('#poHistoryEntries').innerHTML,/Reviewing started/);assert.match(h.node('#poHistoryEntries').innerHTML,/Confirm &lt;supplier&gt; documents/);assert.match(h.node('#poHistoryEntries').innerHTML,/ACCOUNT CREDIT STAFF/);assert.doesNotMatch(h.node('#poHistoryEntries').innerHTML,/Private purchase action/);
});

test('Pending PO includes unassigned remainder once and excludes fulfilled or archived demands',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUP'}];Object.assign(w.tasks[0],{ord:30,po:'PO-A',supplierId:'S',procurement:{totalCtn:15,revision:'P'}});
 w.tasks.push({...w.tasks[0],id:'CHILD',procurementSource:true,customerDemandTaskId:'TASK',ord:0,po:'PO-B',procurement:{totalCtn:10,revision:'C'}},{...w.tasks[0],id:'FULL',ord:20,procurement:{totalCtn:25,expectedExtra:5,revision:'F'}},{...w.tasks[0],id:'ARCHIVED',archived:true,ord:100,procurement:{totalCtn:0}},{...w.tasks[0],id:'EMPTY',ord:0,procurement:{totalCtn:0}});
 h.reply(w);h.click({view:'active'});assert.match(h.node('#app').innerHTML,/data-active-notice="pending"[\s\S]*?<b>1<\/b>/);h.click({activeNotice:'pending'});const html=h.node('#dialogContent').innerHTML;
 assert.match(html,/Unassigned 待分配/);assert.match(html,/5 CTN/);assert.equal((html.match(/pd-supplier-alert-item/g)||[]).length,1);assert.match(html,/data-active-notice-row="TASK" data-active-notice-remaining="true"/);assert.doesNotMatch(html,/data-active-notice-row="(?:FULL|ARCHIVED|EMPTY|CHILD)"/);
});

test('Pay Slip disables absent proofs, views one linked proof and preserves multiple-proof selection and notices',async()=>{
 for(const count of [0,1,2]){
  const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1);
  const payments=Array.from({length:count},(_,i)=>({id:'PAY'+i,confirmed:true,direction:'PAYMENT',proof:{linked:true,fileId:'FILE'+i}}));
  payments.push({confirmed:false,proof:{linked:true,fileId:'DRAFT'}},{confirmed:true,proof:{linked:false,fileId:'UNLINKED'}},{confirmed:true,direction:'REFUND',proof:{linked:true,fileId:'REFUND'}});
  const row={id:'PO',number:'PO-1',documents:[],history:[],finance:{payments,paidCents:0},paymentHandoff:{unreadCount:1},procurementHandoff:{stage:'SUBMITTED',submission:{at:'2026-10-16T08:00:00Z',paymentRequest:{requestedCents:10000}}}};
  h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));h.click({view:'payments'});const html=h.node('#app').innerHTML;
  if(!count)assert.match(html,/pf-slip missing[^>]+disabled/);
  if(count===1)assert.match(html,/pf-slip available[^>]+href="https:\/\/drive.google.com\/file\/d\/FILE0\/view"/);
  if(count===2)assert.match(html,/pf-slip available[^>]+data-payment-proof="PO"/);
  assert.match(html,/pf-slip-notice[^>]+data-payment-proof="PO"/);assert.doesNotMatch(html,/file\/d\/(?:DRAFT|UNLINKED|REFUND)/);
 }
});

test('gray Follow-up statuses offer a reason-only chase, with lock on Reviewing and no optimistic red state',async()=>{
 for(const stage of ['SUBMITTED','OWNED']){
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1),row={id:'PO',version:'V',number:'PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',chasePayment:false,finance:{paidCents:0},procurementHandoff:{stage,submitted:true,submission:{at:'2026-10-16T08:00:00Z',paymentRequest:{requestedCents:10000}}}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));h.click({view:'payments'});const html=h.node('#app').innerHTML;assert.match(html,/data-followup-chase="PO"/);assert.equal(html.includes('class="pf-lock"'),stage==='OWNED');h.click({followupChase:'PO'});assert.doesNotMatch(h.node('#dialogContent').innerHTML,/<textarea/);for(const reason of ['急发货','账期已到','供应商催促','其他'])assert.ok(h.node('#dialogContent').innerHTML.includes(reason));h.node('#pfChaseReason').value='Other 其他';h.click({controlId:'sendPaymentChase'});assert.equal(h.messages.at(-1).input.action,'CHASE');assert.equal(h.messages.at(-1).input.enabled,true);assert.equal(h.messages.at(-1).input.reason,'Other 其他');assert.doesNotMatch(h.node('#app').innerHTML,/pf-chase sent/);
 }
});

test('Purchase History reads actual closure and finance totals, sorts closure dates and offers read-only documents',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'po'});const req=h.messages.at(-1);
 const base={id:'DONE',number:'DONE-PO',state:'HISTORY',completedAt:'2026-10-15T02:00:00Z',invoiceCheck:{by:'ACCOUNT'},supplierId:'S',supplierName:'SUP',customerName:'BUYER',taskIds:['TASK'],documents:[{type:'INV',linked:true,fileId:'INV',name:'saved.pdf'}],documentStatus:'COMPLETE',history:[],finance:{payableCents:43000,paidCents:43000,cashPaidCents:43000,refundCents:0,creditAppliedCents:0,supplierCreditCents:0}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[{...base,id:'OLD',number:'OLD-PO',completedAt:'2025-09-15T00:00:00Z'},base,{...base,id:'ACTIVE',number:'ACTIVE-PO',state:'ACTIVE'}]}});await new Promise(resolve=>setImmediate(resolve));h.click({view:'pohistory'});let html=h.node('#app').innerHTML;
 assert.match(html,/<th>Closed On<\/th><th>P.O. No.<\/th>/);assert.match(html,/430.00/);assert.match(html,/by ACCOUNT/);assert.doesNotMatch(html,/ACTIVE-PO|data-po-upload|data-po-term|data-po-chase/);assert.ok(html.indexOf('DONE-PO')<html.indexOf('OLD-PO'));
 h.click({poDocs:'DONE',poDocType:'INV'});assert.doesNotMatch(h.node('#dialogContent').innerHTML,/data-po-upload/);assert.match(h.node('#dialogContent').innerHTML,/saved.pdf|INV/);
 h.click({archiveView:'DONE'});assert.match(h.node('#dialogContent').innerHTML,/Net Amount/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/<input|<select/);
 h.change({id:'poHistoryYear',value:'2025',dataset:{}});html=h.node('#app').innerHTML;assert.match(html,/OLD-PO/);assert.doesNotMatch(html,/DONE-PO/);assert.equal(h.messages.filter(m=>m.type.includes('SAVE_REQUEST')).length,0);
});

test('Activity History merges task and PO audits once, preserves pre-PO records, filters Malaysia dates and shows failed outcomes',async()=>{
 const h=harness(),w=workspace(),event={id:'SHARED',action:'PURCHASE_PLAN_SAVED',result:'SAVED',actor:'LAW',time:'2026-10-15T18:00:00Z',message:'Quantity confirmed',changes:{before:30,after:25}};w.tasks[0].history=[event,{id:'PRE',action:'PURCHASE_PRICE_SAVED',result:'FAILED',actor:'BUYER',time:'2026-10-14T01:00:00Z',message:'Price rejected'}];h.reply(w);h.click({view:'po'});const req=h.messages.at(-1);
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[{id:'PO',number:'MERGED-PO',state:'ACTIVE',taskIds:['TASK'],documents:[],documentStatus:'MISSING',history:[event,{id:'ACCOUNT',action:'ACCOUNT_CHECK',result:'SAVED',actor:'ACCOUNT',time:'2026-10-16T03:00:00Z',message:'Account confirmed'}]}]}});await new Promise(resolve=>setImmediate(resolve));h.click({view:'history'});let html=h.node('#app').innerHTML;
 assert.equal((html.match(/Quantity confirmed/g)||[]).length,1);assert.match(html,/30 → 25/);assert.match(html,/MERGED-PO/);assert.match(html,/data-path="TASK"/);assert.match(html,/FAILED/);assert.match(html,/Account confirmed/);
 h.change({id:'activityFrom',value:'2026-10-16',dataset:{}});h.change({id:'activityTo',value:'2026-10-16',dataset:{}});html=h.node('#app').innerHTML;assert.match(html,/Quantity confirmed/);assert.doesNotMatch(html,/Price rejected/);
 h.change({id:'activityStaff',value:'ACCOUNT',dataset:{}});html=h.node('#app').innerHTML;assert.match(html,/Account confirmed/);assert.doesNotMatch(html,/Quantity confirmed/);
 assert.equal(h.messages.filter(m=>m.type.includes('SAVE_REQUEST')).length,0);
});

test('Activity hides numeric row-order noise while preserving ownership changes and underlying task history',()=>{
 const h=harness(),w=workspace(),events=[{id:'MOVE1',action:'PURCHASE_ROW_MOVED',result:'SAVED',actor:'LAW',time:'2026-10-16T01:00:00Z',message:'SORT-ONLY',changes:{before:7,after:5}},{id:'MOVE2',action:'PURCHASE_ROW_MOVED',result:'SAVED',message:'NO-CHANGE',changes:{before:1,after:1}},{id:'OWNER',action:'PURCHASE_CUSTOMER_CHANGED',result:'SAVED',actor:'LAW',message:'Customer ownership updated',changes:{before:{customerId:'A'},after:{customerId:'B'}}},{id:'UNKNOWN',action:'PURCHASE_ROW_MOVED',message:'Unknown old format'}];w.tasks[0].history=events;const before=JSON.stringify(events);h.reply(w);h.click({view:'history'});const html=h.node('#app').innerHTML;assert.doesNotMatch(html,/SORT-ONLY|NO-CHANGE/);assert.match(html,/Customer ownership updated|PURCHASE CUSTOMER CHANGED/);assert.match(html,/Unknown old format/);assert.equal(JSON.stringify(events),before);h.click({path:'TASK'});assert.match(h.node('#dialogContent').innerHTML,/SORT-ONLY/);assert.equal(h.messages.filter(m=>m.type.includes('SAVE_REQUEST')).length,0);
});
