const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.PURCHASE_UI_BASELINE || path.join(__dirname, '../../purchase-live/app.js'), 'utf8');
test('clicked progress stage opens its task with explicit receiving issue instead of a false completion',()=>{
 const h=harness(),w=workspace();w.tasks[0].warehouse={accepted:250,hasPhysicalReceipt:true,issue:true};w.tasks[0].procurement={totalCtn:250,revision:'P'};h.reply(w);const before=h.messages.length;
 h.click({progressTask:'TASK',progressIndex:'3',progressIsSource:'true'});assert.match(h.node('#dialogContent').innerHTML,/current-progress problem/);assert.match(h.node('#dialogContent').innerHTML,/Problem \/ 待解决/);assert.match(h.node('#dialogContent').innerHTML,/00123/);assert.equal(h.messages.length,before);
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
 const row={id:'PO',version:'PV',number:'NCT-PO-1',supplierName:'SUPPLIER',amount:1000,taskIds:['TASK','OTHER'],state:'ACTIVE',documents:[],history:[],documentStatus:'MISSING',termDays:30,procurementHandoff:{stage:'LEGACY',submitted:false}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.node('#app').innerHTML,/提交财务/);h.click({poHandoff:'PO',handoffAction:'SUBMIT_FINANCE'});
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
  vm.runInNewContext(source,{ window, document:{ querySelector:selector=>selector.startsWith('#planPrice-')&&!node('#dialogContent').innerHTML.includes('id="planPrice-')?null:node(selector), querySelectorAll:selector=>selector.startsWith('#dialogContent input')?dialogFields:selector.includes("#taskRows .drop-target")||selector.includes("#taskRows .grip-down")?feedbackRows.filter(row=>["grip-down","dragging-row","drop-target"].some(name=>selector.includes("."+name)&&row.classes.has(name))):[], addEventListener(type,callback){
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
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML;assert.match(html,/<th>Customer<\/th>/);assert.match(html,/customer-short[^>]*>ALPHA/);assert.match(html,/customer-short[^>]*>BETA/);assert.doesNotMatch(html,/data-drag=/);
 h.change({dataset:{select:'TASK'},checked:true});h.change({dataset:{select:'OTHER'},checked:true});h.click({controlId:'createSelectedPo'});assert.match(h.node('#dialogContent').innerHTML,/1 Items · 2 Customers · 20 CTN/);assert.equal(h.messages.length,1);
 h.change({id:'activeCustomer',value:'C',dataset:{}});html=h.node('#app').innerHTML;assert.match(html,/data-drag="TASK"/);assert.doesNotMatch(html,/data-id="OTHER"/);
});

test('Active priorities count saved sources rather than demand remainder and open the original source actions',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];
 Object.assign(w.tasks[0],{supplierId:'S',ord:100,procurement:{totalCtn:60,revision:'P'},po:'PO-A',estimatedShipmentDate:'2026-10-28'});
 w.tasks.push({...w.tasks[0],id:'B',procurementSource:true,customerDemandTaskId:'TASK',ord:0,po:'',procurement:{totalCtn:30,revision:'B'},warehouse:{accepted:20,hasPhysicalReceipt:true,issue:true},quantityCases:[{id:'CASE',kind:'RECEIPT',quantity:10,status:'OPEN',blocks:['DISPATCH']}]});
 w.tasks.push({...w.tasks[0],id:'UNPLANNED',po:'',supplierId:'',procurement:{totalCtn:null,revision:''}});
 h.reply(w);h.click({view:'active'});const html=h.node('#app').innerHTML,before=h.messages.length;
 assert.match(html,/data-active-notice="pending"[\s\S]*?<b>1<\/b>/);assert.match(html,/data-active-notice="incoming"[\s\S]*?<b>1<\/b>/);
 assert.match(html,/ACTUAL CUSTOMER<small class="customer-shipment"[^>]*>ETA: 28 Oct 2026/);
 assert.equal((html.match(/<th>/g)||[]).length,11);assert.equal(h.node('#taskSignals').hidden,true);
 h.click({activeNotice:'pending'});assert.match(h.node('#dialogContent').innerHTML,/data-source-po-task="B"/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/UNPLANNED/);
 h.click({activeNotice:'incoming'});assert.match(h.node('#dialogContent').innerHTML,/Short received/);assert.match(h.node('#dialogContent').innerHTML,/data-progress-task="B" data-progress-index="3"/);assert.equal(h.messages.length,before);
 h.click({customer:'C'});assert.equal(h.node('#taskSignals').hidden,false);assert.doesNotMatch(h.node('#app').innerHTML,/ao-priorities|customer-shipment/);
});

test('Active demand summary is display-only and omits duplicate waiting text while retaining remainder and source actions',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{ord:100,procurement:{totalCtn:60,revision:'P'},supplierId:'A'});
 w.tasks.push({...w.tasks[0],id:'SOURCE',procurementSource:true,customerDemandTaskId:'TASK',ord:0,supplierId:'B',procurement:{totalCtn:30,revision:'B'}});
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML;const mother=html.match(/<tr data-id="TASK"[\s\S]*?<\/tr>/)[0],order=mother.match(/<td class="order-quantity">[\s\S]*?<\/td>/)[0];
 assert.match(order,/<span class="quantity-reference/);assert.match(order,/100 \| <span class="qty-mismatch">90<\/span>/);assert.doesNotMatch(order,/<button|data-sources|WAITING/);
 assert.doesNotMatch(html,/waiting-demand/);assert.match(html,/data-waiting-for="TASK"/);assert.match(html,/class="order-quantity">10<\/td>/);assert.match(html,/data-plan-task="TASK"/);assert.match(html,/data-plan-source="SOURCE"/);
 h.click({customer:'C'});html=h.node('#app').innerHTML;assert.match(html,/waiting-demand">WAITING 10 CTN/);assert.match(html,/data-sources="TASK" aria-label="Supplier sources/);
});

test('Active actual receipts never open supplier costing while receipt exception actions remain available',()=>{
 const h=harness(),w=workspace();Object.assign(w.tasks[0],{ord:100,procurement:{totalCtn:90,revision:'P'},supplierId:'A',warehouse:{accepted:80,hasPhysicalReceipt:true,issue:true},quantityCases:[{id:'RECEIPT-CASE',kind:'RECEIPT',quantity:10,status:'OPEN',blocks:['DISPATCH'],owner:'WAREHOUSE'}]});
 h.reply(w);h.click({view:'active'});let html=h.node('#app').innerHTML,receipt=html.match(/<td class="received-quantity">[\s\S]*?<\/td>/)[0];
 assert.match(receipt,/<span class="quantity-reference receipt-problem" title="Received \/ 实收">80<\/span>/);assert.doesNotMatch(receipt,/data-sources/);assert.match(receipt,/data-quantity-case="RECEIPT-CASE"/);assert.match(receipt,/>−10<\/button>/);
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
 w.tasks.push({...w.tasks[0],id:'SOURCE',procurementSource:true,customerDemandTaskId:'TASK',ord:0});w.tasks.push({...w.tasks[0],id:'OTHER'});
 h.reply(w);h.click({view:'active'});const before=h.messages.length;h.click({activeMove:'true'});assert.match(h.node('#dialogContent').innerHTML,/id="moveCustomer"/);
 h.node('#moveCustomer').value='C';h.click({controlId:'startCustomerMove'});assert.match(h.node('#app').innerHTML,/data-drag="TASK"/);
 h.click({drag:'TASK'});h.node('#moveTarget').value='bottom';h.click({controlId:'applyMove'});let html=h.node('#app').innerHTML;
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
 assert.equal(h.node('#modal').open,true);assert.match(h.node('#dialogContent').innerHTML,/Remaining \/ 尚需采购 50/);assert.match(h.node('#dialogContent').innerHTML,/id="sourceQty"[^>]*value="50"/);assert.match(h.node('#dialogContent').innerHTML,/data-source-po-task="TASK"/);
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
 const row={id:'PO',number:'NCT-PO-001',createdAt:'2026-10-11T01:00:00Z',createdBy:'LAW',supplierName:'SUPPLIER FULL NAME',supplierShortName:'SUP',customerName:'BUYER',amount:1200,status:'Paid W/T Inv',finance:{payableCents:100000,paidCents:100000,balanceCents:0,payments:[{id:'P',confirmed:true,reference:'BANK001',cents:100000,at:'2026-10-11T02:00:00Z',by:'FINANCE',proof:{fileId:'proof_123456789'}}]}};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 const html=h.node('#app').innerHTML;assert.match(html,/NCT-PO-001/);assert.match(html,/1,000.00/);assert.match(html,/Paid W\/T Inv/);assert.doesNotMatch(html,/付款申请流程尚未连接/);
 h.click({paymentProof:'PO'});const proof=h.node('#dialogContent').innerHTML;assert.match(proof,/BANK001/);assert.match(proof,/FINANCE/);assert.match(proof,/drive.google.com\/uc\?export=download/);assert.match(proof,/proof_123456789/);assert.doesNotMatch(proof,/type="file"|Record Payment|data-settlement/);
});

test('payment acknowledgement sends only the selected notice and cannot clear Finance or other payment notices',async()=>{
 const h=harness();h.reply(workspace());h.click({view:'payments'});const req=h.messages.at(-1),row={id:'PO',version:'PV',number:'PO-1',supplierName:'SUPPLIER',finance:{paidCents:30000,payments:[{id:'P1',confirmed:true,cents:30000,reference:'BANK1',proof:{fileId:'F1'}}]},paymentHandoff:{status:'PARTLY_PAID',unreadCount:1,notices:[{paymentId:'P1',acknowledgement:null}]}};
 h.send({type:'PURCHASE_ORDERS_RESULT',company:'NCT',requestId:req.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));assert.match(h.node('#app').innerHTML,/Partly paid \/ 部分付款/);assert.match(h.node('#app').innerHTML,/未确认/);
 h.click({paymentProof:'PO'});assert.match(h.node('#dialogContent').innerHTML,/data-payment-ack="P1"/);h.click({paymentAck:'P1',paymentPo:'PO'});
 const saved=h.messages.at(-1);assert.equal(saved.type,'PURCHASE_ORDER_SAVE_REQUEST');assert.equal(saved.input.action,'ACK_PAYMENT');assert.equal(saved.input.paymentId,'P1');assert.equal(saved.input.version,'PV');assert.equal(saved.input.enabled,undefined);assert.equal(saved.input.cents,undefined);
});

test('purchase orders render persisted documents and readable history, with upload input instead of fixture controls',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1);
 assert.equal(request.type,'PURCHASE_ORDERS_REQUEST');
 const row={id:'POID',version:'V',number:'NCT-PO-001',taskIds:['TASK'],customerName:'BUYER',supplierId:'S',supplierShortName:'SUP',supplierName:'SUPPLIER',itemCount:1,amount:100,termDays:30,documents:[{fileId:'file_123456789',type:'INV',number:'INV001',date:'2026-10-11',uploadedBy:'LAW'}],documentStatus:'COMPLETE',state:'ACTIVE',history:[{action:'PAYMENT_TERM_CHANGED',actor:'LAW',time:'2026-10-11T01:00:00Z',changes:{before:{termDays:15},after:{termDays:30},reason:'Agreed terms'}}]};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row],documentsConnected:true}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.node('#app').innerHTML,/doc-dot complete/);assert.match(h.node('#app').innerHTML,/BUYER/);
 h.click({poDocs:'POID'});assert.match(h.node('#dialogContent').innerHTML,/INV001/);assert.doesNotMatch(h.node('#dialogContent').innerHTML,/id="poDocumentFile"/);
 h.click({poUpload:'POID'});assert.match(h.node('#dialogContent').innerHTML,/id="poDocumentFile"/);assert.match(h.node('#dialogContent').innerHTML,/Upload Supplier PDF/);
 h.click({poHistory:'POID'});const history=h.node('#poHistoryEntries').innerHTML;assert.match(history,/15 → 30/);assert.match(history,/LAW/);assert.doesNotMatch(history,/"before"|PAYMENT_TERM_CHANGED/);
});

test('PDF stays disabled after file reading hands off to the actual pending save, and a second click does not upload twice',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1),row={id:'PO',version:'V',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],history:[],documentStatus:'MISSING',termDays:null};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row],documentsConnected:true}});await new Promise(resolve=>setImmediate(resolve));h.click({poUpload:'PO'});
 const pdf=Buffer.from('%PDF-1.4\nTEST');h.node('#poDocumentFile').files=[{size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)}];
 h.node('#poDocumentType').value='PI';h.node('#poDocumentDate').value='2026-10-11';h.node('#poDocumentNumber').value='TEST';h.node('#poDocumentReason').value='Test only';h.click({controlId:'uploadPurchaseDocument'});await new Promise(resolve=>setImmediate(resolve));
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

test('Path categories show human bilingual changes without internal action strings',async()=>{
 const h=harness(),w=workspace();h.reply(w);h.click({view:'po'});const request=h.messages.at(-1);
 const row={id:'PO',number:'NCT-PO-1',state:'ACTIVE',taskIds:['TASK'],documents:[],documentStatus:'MISSING',termDays:null,history:[{action:'PURCHASE_PRICE_SAVED',time:'2026-10-11T01:00:00Z',actor:'LAW',message:'PURCHASE PRICE SAVED',changes:{before:{lpCtn:20},after:{lpCtn:19}}},{action:'PAYMENT_CHASE_CHANGED',time:'2026-10-11T02:00:00Z',actor:'LAW',changes:{before:{chasePayment:false},after:{chasePayment:true},reason:'Urgent'}}]};
 h.send({type:'PURCHASE_ORDERS_RESULT',requestId:request.requestId,ok:true,result:{company:'NCT',orders:[row]}});await new Promise(resolve=>setImmediate(resolve));
 h.click({poHistory:'PO'});assert.match(h.node('#poHistoryEntries').innerHTML,/修改成本/);assert.doesNotMatch(h.node('#poHistoryEntries').innerHTML,/PURCHASE PRICE SAVED/);
 h.change({id:'poHistoryCategory',value:'CHASE',dataset:{}});assert.match(h.node('#poHistoryEntries').innerHTML,/Urgent/);assert.doesNotMatch(h.node('#poHistoryEntries').innerHTML,/修改成本/);
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
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/采购单详情/);assert.match(html,/NCT-00123/);assert.match(html,/00123/);assert.doesNotMatch(html,/<small>TASK<\/small>|id="poNumber"|id="savePo"/);assert.equal(h.messages.length,1);
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
 assert.equal(h.node('#companySelect').disabled,true);assert.match(h.node('#liveStatus').textContent,/Barcode 00123/);assert.match(h.node('#liveStatus').textContent,/WDE0118/);assert.ok(h.node('#liveStatus').textContent.includes('Ref / 操作编号: '+save.requestId));
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
