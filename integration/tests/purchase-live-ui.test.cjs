const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../purchase-live/app.js'), 'utf8');
function harness() {
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
    crypto:{ randomUUID:()=>String(++count) }, setTimeout:callback=>timers.push(callback), Date, Number, Map, Set });
  function reply(workspace,request=messages.at(-1),extra={}) {
    for(const callback of listeners.get('window:message')) callback({ source:parent,data:{type:'PURCHASE_WORKSPACE_RESULT',requestId:request.requestId,company:request.company,ok:true,workspace,...extra} });
  }
  return { node,messages,timers,reply,
    click(attrs){const control={ id:'',dataset:attrs };for(const callback of listeners.get('document:click'))callback({ target:{ closest:selector=>selector==='#closeModal'?null:control } }); },
    switchCompany(value){listeners.get('#companySelect:change')({target:{value}});} };
}
const workspace=()=>({ company:'NCT',staff:{staffName:'ACTUAL STAFF'},fetchedAt:'2026-10-10T03:00:00Z',suppliers:[],
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
