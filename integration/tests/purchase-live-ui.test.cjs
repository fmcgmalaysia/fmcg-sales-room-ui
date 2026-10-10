const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../purchase-live/app.js'), 'utf8');
function harness(storage) {
  const nodes = new Map(), listeners = new Map(), messages = [], timers = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { innerHTML:'', textContent:'', value:'NCT', open:false,
      classList:{ toggle(){} }, addEventListener(type,callback){ listeners.set(id+':'+type,callback); },
      showModal(){ this.open=true; }, close(){ this.open=false; }, focus(){},setSelectionRange(){} });
    return nodes.get(id);
  }
  const parent = { postMessage:message => messages.push(message) }, window = { parent, addEventListener(type,callback){ const key='window:'+type;listeners.set(key,[...(listeners.get(key)||[]),callback]); } };
  let count=0;
  vm.runInNewContext(source,{ window, document:{ querySelector:node, querySelectorAll:()=>[], addEventListener(type,callback){
    const key='document:'+type;listeners.set(key,[...(listeners.get(key)||[]),callback]); } },
    crypto:{ randomUUID:()=>String(++count) }, sessionStorage:storage,setTimeout:callback=>timers.push(callback),setInterval:()=>{}, Date, Number, Map, Set });
  function reply(workspace,request=messages.at(-1),extra={}) {
    for(const callback of listeners.get('window:message')) callback({ source:parent,data:{type:'PURCHASE_WORKSPACE_RESULT',requestId:request.requestId,company:request.company,ok:true,workspace,...extra} });
  }
  return { node,messages,timers,reply,
    event(type,target){for(const callback of listeners.get('document:'+type)||[])callback({target});},
    send(message){for(const callback of listeners.get('window:message'))callback({source:parent,data:message});},
    change(attrs){for(const callback of listeners.get('document:change')||[])callback({target:attrs});},
    click(attrs){const control={ id:attrs.controlId||'',dataset:attrs };for(const callback of listeners.get('document:click'))callback({ target:{ closest:selector=>selector==='button'?control:selector==='#closeModal'&&control.id==='closeModal'?control:selector==='[data-supplier-tab]'&&attrs.supplierTab?control:selector==='#addSupplierContact'&&control.id==='addSupplierContact'?control:null } }); },
    switchCompany(value){listeners.get('#companySelect:change')({target:{value}});} };
}
const workspace=()=>({ company:'NCT',staff:{staffId:'STAFF',memberId:'MEMBER',staffName:'ACTUAL STAFF'},fetchedAt:'2026-10-10T03:00:00Z',suppliers:[],
  customers:[{id:'C',name:'ACTUAL CUSTOMER'}],tasks:[{id:'TASK',customerId:'C',orderId:'ORDER',barcode:'00123',name:'ACTUAL PRODUCT',packing:'SIZE x16',
    ord:250,inc:null,stage:'NEW_INCOMING',lpPc:1,lpCtn:16,disc1:.1,disc2:.05,disc3:2,netCostCtn:11.68,costStatus:'ERROR',
    costErrorReason:'UNAVAILABLE_CBMPERCTN',submittedByName:'ACTUAL SALESPERSON',history:[]}] });
test('live page starts empty, requests real Master data and never seeds demo business records',()=>{
  const h=harness();assert.equal(h.messages.length,1);assert.equal(h.messages[0].type,'PURCHASE_WORKSPACE_REQUEST');
  assert.doesNotMatch(h.node('#app').innerHTML,/AVATA|Supplier A|CORN FLAKES/);
  h.reply(workspace());assert.match(h.node('#app').innerHTML,/ACTUAL CUSTOMER/);assert.equal(h.node('#session').textContent,'ACTUAL STAFF / Purchase');
});
test('customer entry displays actual quantity and opens a cost exception with actual salesperson',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/ACTUAL PRODUCT/);
  assert.match(h.node('#app').innerHTML,/250/);assert.match(h.node('#app').innerHTML,/Cost Error/);
  h.click({cost:'TASK'});assert.equal(h.node('#modal').open,true);assert.match(h.node('#dialogContent').innerHTML,/ACTUAL SALESPERSON/);
  assert.match(h.node('#dialogContent').innerHTML,/UNAVAILABLE_CBMPERCTN/);
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

test('CMS Dashboard retains the approved directory structure, summary icons and required add buttons',()=>{
  const h=harness();h.reply(workspace());const html=h.node('#app').innerHTML;
  for(const marker of ['dashboard-summary','summary-icon','directory-heading','customer-directory','supplier-directory','Add Customer','Add Supplier','Search customer','Search supplier / brand'])assert.ok(html.includes(marker),marker);
  assert.match(html,/<th>Edit<\/th>/);
});

test('CMS Purchase Room restores v13 track, tools and approved columns plus the final task editor without changing task data',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});const html=h.node('#app').innerHTML;
  for(const marker of ['roomhead','Pending workload','Waiting for Acc Review','supplierFilter','stageFilter','Risk','task-edit','unified-save','Move selected','row-controls','qty-pair'])assert.ok(html.includes(marker),marker);
  const header=html.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)[1];
  const labels=[...header.matchAll(/<th>(.*?)<\/th>/gs)].map(match=>match[1]);
  assert.deepEqual(labels.slice(1),['Row','Order Received','Waiting','Description','Supplier','Qty','LP/Pc','LP/Ctn','Disc.1','Disc.2','Disc.3','Net CTN Cost','Our P.O. No.','Path','GP','Edit']);
  assert.equal(labels.length,17);
  assert.match(html,/width:20%/);
  assert.match(html,/data-cost="TASK"/);
  assert.match(html,/250/);
  assert.equal(h.messages.length,1,'layout restoration must not trigger any business writes');
});

test('actual Save uses draft revision and keeps inputs after failed or ambiguous results',()=>{
  const h=harness(),data=workspace();data.tasks[0].editVersion='REV';h.reply(data);h.click({customer:'C'});
  h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});
  const save=h.messages.at(-1);assert.equal(save.type,'PURCHASE_SAVE_REQUEST');assert.equal(save.input.edits[0].version,'REV');assert.equal(save.input.edits[0].changes.disc3,5);
  h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:false,error:'504 timeout'});
  assert.match(h.node('#dialogError').textContent,/输入仍保留/);h.click({controlId:'saveEdits'});assert.equal(h.messages.at(-1).requestId,save.requestId);
  h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:'WRONG',ok:true,result:{ok:true,requestId:'WRONG'}});assert.equal(h.node('#companySelect').disabled,true);
  h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:true,requestId:save.requestId}});assert.equal(h.messages.at(-1).type,'PURCHASE_WORKSPACE_REQUEST');assert.equal(h.node('#companySelect').disabled,false);
});

test('supplier dialog retains approved company/short-name pair, tabs and all six contact roles without demo brands',()=>{
  const h=harness(),data=workspace();data.suppliers=[{id:'SUP',name:'ACTUAL SUPPLIER',shortName:'ACTUAL'}];h.reply(data);h.click({editSupplier:'SUP'});
  const html=h.node('#dialogContent').innerHTML;
  for(const text of ['dialoghead','dialogbody','dialogfoot','Company Info','Sales Contacts','Brands','supplier-name-pair','Company Name *','Short Name','ACTUAL SUPPLIER'])assert.ok(html.includes(text),text);
  const contacts=h.node('#supplierContacts').innerHTML;
  for(const role of ['Sales Representative','Sales Manager','Director','Account Dept.','Warehouse','Others'])assert.ok(contacts.includes(role),role);
  assert.doesNotMatch(html,/Demo Brand|localStorage/);
  assert.equal(h.messages.filter(message=>message.type==='PURCHASE_SAVE_REQUEST').length,0);assert.equal(h.messages.filter(message=>message.type==='PURCHASE_PROFILE_REQUEST').length,1);assert.equal(h.messages.filter(message=>message.type==='PURCHASE_BRANDS_REQUEST').length,1);
});

test('row editor keeps barcode first, omits received quantity and gates changes on a saved supplier',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});h.click({taskEdit:'TASK'});
  const html=h.node('#dialogContent').innerHTML;
  for(const text of ['Catch Cost','Edit Qty','Cost Calculator','Reason *','ACTUAL PRODUCT','250 CTN'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('00123')<html.indexOf('ACTUAL PRODUCT'));
  assert.ok(html.indexOf('ACTUAL PRODUCT')<html.indexOf('SIZE x16'));
  assert.doesNotMatch(html,/Received Qty|Total Purchase|Add Item From/);
  assert.match(html,/id="saveTaskQty" disabled/);
  assert.match(html,/Select and save a supplier/);
  assert.equal(h.messages.length,1);
});

test('four-digit qty capsules preserve the warehouse value and edited left quantity is grey',()=>{
  const h=harness(),data=workspace();Object.assign(data.tasks[0],{ord:9999,inc:8888,qtyEdited:true});h.reply(data);h.click({customer:'C'});
  const html=h.node('#app').innerHTML;assert.match(html,/qty-edited/);assert.match(html,/9999/);assert.match(html,/8888/);assert.doesNotMatch(html,/9,999|8,888/);assert.match(html,/net-cost-cell/);assert.match(html,/data-task-edit="TASK"/);
});

test('reload checks the existing save identity and restores only the same staff member draft',()=>{
  const cache=new Map(),storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)};
  const first=harness(storage),data=workspace();data.tasks[0].editVersion='REV';first.reply(data);first.click({customer:'C'});first.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});first.click({controlId:'saveEdits'});const savedRequest=first.messages.at(-1);
  const reloaded=harness(storage);reloaded.reply(data);const check=reloaded.messages.at(-1);assert.equal(check.type,'PURCHASE_SAVE_CHECK_REQUEST');assert.equal(check.saveRequestId,savedRequest.requestId);assert.match(reloaded.node('#app').innerHTML,/value="5(?:\.00)?"/);
  reloaded.click({controlId:'refresh'});assert.equal(reloaded.messages.at(-1).requestId,savedRequest.requestId);assert.equal(reloaded.messages.at(-1).type,'PURCHASE_SAVE_REQUEST');
  const other=harness(storage);other.reply({...data,staff:{staffId:'STAFF',memberId:'OTHER',staffName:'OTHER'}});assert.equal(other.messages.length,1);assert.doesNotMatch(other.node('#app').innerHTML,/Unsaved changes/);
});


test('partial price input survives redraw and cannot submit a stale numeric value',()=>{
  const h=harness(),data=workspace();data.tasks[0].editVersion='REV';h.reply(data);h.click({customer:'C'});
  const field={id:'',dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'2.00'};
  h.event('focusin',field);assert.equal(field.value,'');h.event('focusout',field);assert.equal(field.value,'2.00');
  h.event('focusin',field);field.value='bad';h.event('input',field);h.event('focusout',field);h.click({controlId:'saveEdits'});
  assert.equal(h.messages.filter(message=>message.type==='PURCHASE_SAVE_REQUEST').length,0);
  h.click({customer:'C'});assert.match(h.node('#app').innerHTML,/value="bad"/);
});

test('cost calculator sends source amounts and internal note, not a client calculated price or quantity edit',()=>{
 const h=harness(),data=workspace();data.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(data.tasks[0],{supplierId:'S',editVersion:'REV',ea:16});h.reply(data);h.click({customer:'C'});h.click({taskEdit:'TASK'});h.click({taskTab:'average'});
 assert.match(h.node('#dialogContent').innerHTML,/Line Cost · MYR/);assert.match(h.node('#dialogContent').innerHTML,/Internal Note/);assert.match(h.node('#dialogContent').innerHTML,/id="applyAverageCost"/);
 h.node('#averageLineCost').value='921.50';h.node('#averageCartons').value='11';h.node('#averageNote').value='Buy ten get one';h.event('input',{id:'averageLineCost'});assert.equal(h.node('#averageResult').textContent,'MYR 83.77');
 h.click({controlId:'applyAverageCost'});const request=h.messages.at(-1);assert.equal(request.operation,'AVERAGE_COST');assert.equal(request.input.lineCost,921.5);assert.equal(request.input.cartons,11);assert.equal(request.input.note,'Buy ten get one');assert.equal(request.input.quantity,undefined);assert.equal(request.input.lpCtn,undefined);
});
