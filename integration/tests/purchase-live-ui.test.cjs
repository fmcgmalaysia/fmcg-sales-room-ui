const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../purchase-live/app.js'), 'utf8');
function harness(storage,feedbackRows=[]) {
  const nodes = new Map(), listeners = new Map(), messages = [], timers = [], intervals=[];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { innerHTML:'', textContent:'', value:'NCT', open:false, dataset:{},
      classList:{ toggle(){} }, addEventListener(type,callback){ listeners.set(id+':'+type,callback); },
      showModal(){ this.open=true; }, close(){ this.open=false; }, focus(){},setSelectionRange(){} });
    return nodes.get(id);
  }
  const parent = { postMessage:message => messages.push(message) }, window = { parent, addEventListener(type,callback){ const key='window:'+type;listeners.set(key,[...(listeners.get(key)||[]),callback]); } };
  let count=0;
  vm.runInNewContext(source,{ window, document:{ querySelector:node, querySelectorAll:selector=>selector.includes("#taskRows .drop-target")||selector.includes("#taskRows .grip-down")?feedbackRows.filter(row=>["grip-down","dragging-row","drop-target"].some(name=>selector.includes("."+name)&&row.classes.has(name))):[], addEventListener(type,callback){
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
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/填写采购单号/);assert.match(html,/po-number-entry/);assert.match(html,/po-items/);assert.doesNotMatch(html,/<small>TASK<\/small>|每行任务 ID/);
 assert.ok(html.indexOf('id="poNumber"')<html.indexOf('class="rowlist po-items"'));assert.match(html,/275/);
 h.node('#poNumber').value='NCT-00123';h.click({controlId:'savePo'});const request=h.messages.at(-1);assert.equal(request.operation,'PO');assert.deepEqual(Array.from(request.input.taskIds),['TASK']);assert.equal(request.input.versions.TASK,'REV');assert.equal(request.input.poNumber,'NCT-00123');
});

test('P.O. details stay read-only and show human product references without internal IDs',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',po:'NCT-00123',procurement:{totalCtn:275}});h.reply(w);h.click({poView:'TASK'});
 const html=h.node('#dialogContent').innerHTML;assert.match(html,/采购单详情/);assert.match(html,/NCT-00123/);assert.match(html,/00123/);assert.doesNotMatch(html,/<small>TASK<\/small>|id="poNumber"|id="savePo"/);assert.equal(h.messages.length,1);
});

test('a company prefix alone cannot create a PO or lose the current input',()=>{
 const h=harness(),w=workspace();w.suppliers=[{id:'S',name:'SUPPLIER'}];Object.assign(w.tasks[0],{supplierId:'S',editVersion:'REV'});h.reply(w);h.event('click',{closest:selector=>selector==='input[data-po-reference]'?{dataset:{poReference:'TASK'}}:null});
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

test('shared expected-stock view includes all company customers but never enables allocation',()=>{
 const h=harness(),w=workspace();w.tasks[0].procurement={expectedExtra:25,totalCtn:275};w.tasks.push({...w.tasks[0],id:'OTHER',customerId:'OTHER-CUSTOMER',barcode:'OTHER-BARCODE',procurement:{expectedExtra:10,totalCtn:260}});h.reply(w);h.click({customer:'C'});h.click({view:'stock'});
 const html=h.node('#app').innerHTML;assert.match(html,/OTHER-BARCODE/);assert.match(html,/Awaiting warehouse/);assert.match(html,/<button class="btn" disabled>Allocate/);assert.doesNotMatch(html,/data-allocate/);
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

test('CMS Dashboard retains the approved directory structure, summary icons and supplier entry without customer registration',()=>{
  const h=harness();h.reply(workspace());const html=h.node('#app').innerHTML;
  for(const marker of ['dashboard-summary','summary-icon','directory-heading','customer-directory','supplier-directory','Add Supplier','Search customer','Search supplier / brand'])assert.ok(html.includes(marker),marker);
  assert.match(html,/<th>Edit<\/th>/);assert.doesNotMatch(html,/Add Customer|id="addCustomer"/);
});

test('CMS Purchase Room restores v13 track, tools and approved columns plus the final task editor without changing task data',()=>{
  const h=harness();h.reply(workspace());h.click({customer:'C'});const html=h.node('#app').innerHTML;
  for(const marker of ['roomhead','Pending workload','Waiting for Acc Review','supplierFilter','stageFilter','allocationFilter','task-edit','unified-save','Move selected','row-controls','qty-pair'])assert.ok(html.includes(marker),marker);
  const header=html.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)[1];
  const labels=[...header.matchAll(/<th>(.*?)<\/th>/gs)].map(match=>match[1].includes('history-heading')?'History':match[1]);
  assert.deepEqual(labels.slice(1),['Row','Since','Waiting','Description','Supplier','Qty','LP/Pc','LP/Ctn','Disc.1','Disc.2','Disc.3','Net Cost','Our P.O. No.','Path','GP','Edit']);
  assert.equal(labels.length,17);
  assert.match(html,/width:22.5%/);
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

test('receipt checks stop after three pending results and explicit retry preserves the original save identity',async()=>{
 const h=harness(),w=workspace();w.tasks[0].editVersion='REV';h.reply(w);h.click({customer:'C'});
 h.change({dataset:{moneyTask:'TASK',moneyField:'disc3'},value:'5'});h.click({controlId:'saveEdits'});const save=h.messages.at(-1);h.timers[1]();
 for(let attempt=0;attempt<3;attempt++){const check=h.messages.at(-1);h.send({type:'PURCHASE_SAVE_CHECK_RESULT',company:'NCT',requestId:check.requestId,ok:true,result:{ok:false,pending:true,requestId:save.requestId}});await new Promise(resolve=>setImmediate(resolve));if(attempt<2)h.timers.at(-1)();}
 assert.equal(h.node('#saveEdits').disabled,false);assert.match(h.node('#liveStatus').textContent,/尚未取得保存完成回执/);
 assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,1);h.click({controlId:'saveEdits'});assert.equal(h.messages.at(-1).requestId,save.requestId);assert.equal(h.messages.at(-1).input.edits[0].changes.disc3,5);
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
  for(const text of ['Catch Cost','Customer Qty','Cost Calculator','Reason *','ACTUAL PRODUCT','250 CTN'])assert.ok(html.includes(text),text);
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

test('history icon keeps the actual history dialog and progress capsules keep existing counts without writes',()=>{
 const h=harness(),w=workspace();w.tasks[0].history=[{id:'E1',action:'PURCHASE_QTY_REDUCED',time:'2026-10-10T12:00:00Z',actor:'LAW',message:'Supplier only 90 cartons'}];
 h.reply(w);h.click({customer:'C'});const html=h.node('#app').innerHTML;
 assert.match(html,/class="path task-history" data-path="TASK" aria-label="History 00123"/);
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
