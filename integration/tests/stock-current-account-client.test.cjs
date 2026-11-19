const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
const key = 'fmcg-account-current-v1/NCT/A/M', meta = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { staffId: 'A', memberId: 'M' } };
function harness({ db = new Map(), failedStorage = false, settlement = false, payments = false } = {}) {
  const nodes = new Map(), events = new Map(), messages = [], timers = [], gets = [], writes = []; let ids = 0;
  function node(id) {
    if (!nodes.has(id)) {
      let html = ''; const value = { value: id === '#company' ? 'NCT' : '', textContent: '', disabled: false, dataset: {}, children: [], open: false, isConnected: true,
        classList: { add(){},remove(){},toggle(){} }, addEventListener(type,fn){const name=id+':'+type;events.set(name,[...(events.get(name)||[]),fn]);},
        querySelector: selector => node(id+' '+selector), querySelectorAll: () => [], reportValidity: () => true, setAttribute(){},removeAttribute(){},
        appendChild(child){child.owner=this;this.children.push(child);},remove(){if(this.owner)this.owner.children=this.owner.children.filter(child=>child!==this);this.isConnected=false;},
        showModal(){this.open=true;},close(){this.open=false;},click(){click({controlId:id.replace(/^#/, '')});} };
      Object.defineProperty(value,'innerHTML',{get:()=>html,set:text=>{html=text;value.children=[];}}); nodes.set(id,value);
    } return nodes.get(id);
  }
  const parent = { postMessage: message => messages.push(copy(message)) }, window = { parent, accountPaymentLayout: { isClosed: row => row.supplierAccount?.closed === true, render: () => '<div>Original Account</div>', inPaymentPlan: () => false },
    addEventListener(type,fn){const name='window:'+type;events.set(name,[...(events.get(name)||[]),fn]);} };
  const document = { querySelector: node, querySelectorAll: () => [], createElement: () => node('created-'+(++ids)), addEventListener(type,fn){const name='document:'+type;events.set(name,[...(events.get(name)||[]),fn]);} };
  const values = new Map(), storage = { getItem:id=>{gets.push(id);return db.get(id) ?? null;}, setItem:(id,text)=>{if(failedStorage)throw Error('Quota');writes.push(id);db.set(id,text);},removeItem:id=>{if(failedStorage)throw Error('Quota');writes.push(id);db.delete(id);} };
  const context = vm.createContext({ window,document,sessionStorage:storage,crypto:{randomUUID:()=> '11111111-1111-4111-8111-'+String(++ids).padStart(12,'0')},setTimeout:fn=>timers.push(fn),clearTimeout(){},
    FormData:class{get(name){return values.get(name)??null;}getAll(name){return values.has(name)?Array.isArray(values.get(name))?values.get(name):[values.get(name)]:[];}},
    FileReader:class{readAsDataURL(file){this.result='data:application/pdf;base64,'+file.base64;this.onload();}},Date,Map,Set,Number,location:{search:''} });
  vm.runInContext(fs.readFileSync(path.join(folder,'account-ui/account-current.js'),'utf8'),context);
  if(settlement)vm.runInContext(fs.readFileSync(path.join(folder,'account-ui/settlement.js'),'utf8'),context);
  else window.accountSettlement={busy:()=>window.accountCurrent.busy()};
  if(payments)vm.runInContext(fs.readFileSync(path.join(folder,'account-ui/purchase-payments.js'),'utf8'),context);
  function send(message,source=parent){for(const fn of events.get('window:message')||[])fn({source,data:copy(message)});}
  function click(attrs){const button={id:attrs.controlId||'',dataset:attrs};for(const fn of events.get('document:click')||[])fn({target:{closest:selector=>selector==='button'||selector==='#'+button.id?button:null},preventDefault(){},stopImmediatePropagation(){}});}
  function authorize(staff={staffId:'A',memberId:'M',staffName:'Account'}){const request=messages.findLast(message=>message.type==='ACCOUNT_CURRENT_CONTEXT_REQUEST');send({type:'ACCOUNT_CURRENT_CONTEXT_RESULT',company:request.company,requestId:request.requestId,ok:true,result:{ok:true,schema:'ACCOUNT_ORIGINAL_CONTEXT_V1',company:request.company,staff}});}
  const read = patch => ({ company:'NCT',staff:{staffId:'A',staffName:'Account'},stockCurrent:{...copy(meta),...patch},view:'SUPPLIER_ACTIVE',items:[] });
  const request = (patch={}) => window.accountCurrent.decorate({type:'ACCOUNT_SETTLEMENT_REQUEST',company:'NCT',requestId:'22222222-2222-4222-8222-222222222222',input:{id:'PO',version:'V0',action:'CN_NOT_APPLICABLE',enabled:true,reason:'Original request'},...patch});
  const saves = () => messages.filter(message=>message.type==='ACCOUNT_SETTLEMENT_REQUEST'||message.type==='ACCOUNT_CHECK_REQUEST');
  function reply(result,patch={}) {const last=saves().at(-1);send({type:last.type==='ACCOUNT_CHECK_REQUEST'?'ACCOUNT_CHECK_RESULT':'ACCOUNT_SETTLEMENT_RESULT',company:last.company,requestId:last.requestId,stockSegment:last.stockSegment,ok:true,result,...patch});}
  function fresh(patch={}){const last=messages.at(-1);send({type:'ACCOUNT_QUERY_RESULT',company:last.company,requestId:last.requestId,ok:true,result:read({stockGeneration:1,...patch})});}
  return { window,api:window.accountCurrent,context,db,events,node,messages,timers,gets,writes,authorize,read,request,saves,reply,fresh,send,click,values,failStorage:value=>failedStorage=value };
}
const success = req => ({ok:true,requestId:req.requestId,company:req.company,poId:req.input.id,stockGeneration:req.stockGeneration+1});
function ready(options){const h=harness(options);h.authorize();h.api.observe(h.read());return h;}

test('Account overlays reproduce exact originals and parent retains old routing, with bounded current metadata and transport segment only', () => {
  for(const file of ['build-account-current-ui.cjs','build-current-account-purchase.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
  const original=fs.readFileSync(path.join(__dirname,'../wix/account-department-page.js'),'utf8').replace(/\r\n/g,'\n'),panel=fs.readFileSync(path.join(folder,'account-department-page.candidate.js'),'utf8');
  const stripped=panel.replace(/\n    if\(message.type==='ACCOUNT_CURRENT_CONTEXT_REQUEST'\)\{[\s\S]*?\n    \}/,'').replace(/\n    if\(\['ACCOUNT_SETTLEMENT_REQUEST','ACCOUNT_CHECK_REQUEST'\].includes\(message.type\)&&message.stockProtocol!==undefined\)\{[\s\S]*?\n    \}/,'')
    .replace(/\n    if\(message.type==='STOCK_READ_REQUEST'&&message.readOptions!==undefined\)\{[\s\S]*?\n    \}/,'')
    .replace(/\n    if\(message.type==='STOCK_SAVE_REQUEST'&&message.stockProtocol!==undefined\)\{[\s\S]*?\n    \}/,'');
  assert.equal(stripped,original); const h=ready(),request=h.request(); let done=0;h.api.send(request,{done:()=>done++});
  assert.deepEqual(JSON.parse(h.db.get(key)).request,copy(request));assert.equal(h.saves().length,1);assert.equal(h.saves()[0].stockSegment,1);assert.equal(done,0);
  h.api.send(request);assert.equal(h.saves().length,1,'duplicate click while in flight');
});

test('initial quota or changed own cache prevents first send; retry cannot substitute another input or actor', () => {
  const blocked=ready({failedStorage:true}),req=blocked.request();blocked.api.send(req);assert.equal(blocked.saves().length,0);assert.equal(blocked.api.busy(),true);
  blocked.failStorage(false);blocked.api.send(req);assert.equal(blocked.saves().length,1);
  assert.throws(()=>blocked.api.send({...copy(req),input:{...req.input,enabled:false}}),/Another/);
  const h=ready(),request=h.request();h.db.set(key,JSON.stringify({schema:1,request:{...copy(request),input:{...request.input,reason:'OTHER'}}}));h.api.send(request);assert.equal(h.saves().length,0);
  assert.throws(()=>h.api.decorate(request),/pending/);assert.equal(h.gets.every(id=>id===key),true);
});

test('unknown/rejected/malformed or foreign final never clears pending by error text; only fresh same actor/build/generation permits cleanup', () => {
  const h=ready(),req=h.request();let done=0;h.api.send(req,{done:()=>done++});
  for(const patch of [{poId:'OTHER'},{company:'GHR'},{stockGeneration:0},{pending:true}]){h.reply({...success(req),...patch});assert.ok(h.db.get(key));assert.equal(done,0);h.api.send(req);}
  h.reply(null,{ok:false,error:'Purchase order changed.'});assert.equal(h.api.busy(),true);h.api.send(req);h.reply(success(req));assert.equal(done,0);assert.equal(h.messages.at(-1).type,'ACCOUNT_QUERY_REQUEST');
  h.fresh({stockIdentity:{staffId:'OTHER',memberId:'M'}});assert.ok(h.db.get(key));h.api.send(req);h.reply(success(req));h.fresh({stockBuild:'OTHER'});assert.ok(h.db.get(key));
  h.api.send(req);h.reply(success(req));h.fresh();assert.equal(done,1);assert.equal(h.db.has(key),false);assert.equal(h.api.busy(),false);
});

test('phase transport correlation rejects old/late packets, finite progress pauses, and cleanup failure retains identical retry', () => {
  const h=ready(),req=h.request();h.api.send(req);const pending={ok:false,pending:true,requestId:req.requestId,phase:'APPLY',completedCount:1,totalRecords:5};
  h.reply(pending);h.timers.at(-1)();assert.equal(h.saves().at(-1).stockSegment,2);const count=h.timers.length;
  h.reply(pending,{stockSegment:1});assert.equal(h.timers.length,count);h.timers.at(-1)();h.reply(pending);assert.equal(h.timers.length,count,'late pending after timeout cannot auto-send');
  h.api.send(req);h.reply(success(req));h.failStorage(true);h.fresh();assert.ok(h.db.get(key));h.failStorage(false);h.api.send(req);h.reply(success(req));h.fresh();assert.equal(h.db.has(key),false);
  const g=ready(),request=g.request();g.api.send(request);
  for(let i=0;i<70;i++){const before=g.timers.length;g.reply({...pending,requestId:request.requestId});if(g.timers.length>before)g.timers.at(-1)();}
  assert.ok(g.saves().length<=65);assert.equal(g.api.busy(),true);assert.deepEqual(JSON.parse(g.db.get(key)).request,copy(request));
});

test('reload reads only fresh authorized own key and never auto-replays; malformed files/wrong endpoint/cache actor cannot be adopted', () => {
  const source=ready(),req=source.request(),db=new Map([[key,JSON.stringify({schema:1,request:copy(req)})],['fmcg-account-current-v1/NCT/OTHER/M',JSON.stringify({schema:1,request:copy(req)})]]);
  const h=harness({db});assert.equal(h.gets.length,0);h.authorize();assert.equal(h.saves().length,0);assert.equal(h.api.busy(),true);assert.deepEqual(h.gets,[key]);
  const panel=h.node('#app').children[0];panel.querySelector('[data-current-retry]').onclick();assert.equal(h.saves().length,1);assert.deepEqual(JSON.parse(h.db.get(key)).request,copy(req));
  const other=harness({db});other.authorize({staffId:'B',memberId:'M',staffName:'Other'});assert.equal(other.api.busy(),false);assert.deepEqual(other.gets,['fmcg-account-current-v1/NCT/B/M']);
  for(const patch of [{input:{...req.input,action:'DOCUMENT_UPLOAD'}},{stockIdentity:{staffId:'OTHER',memberId:'M'}},{type:'ACCOUNT_CHECK_REQUEST'}]){const f=harness({db:new Map([[key,JSON.stringify({schema:1,request:{...copy(req),...patch}})]])});f.authorize();assert.equal(f.saves().length,0);assert.equal(f.api.busy(),true);}
});

test('legacy request path stays original and a fresh current read cannot enable malformed file or cross-endpoint action', () => {
  const h=harness();h.api.observe({company:'NCT',staff:{staffId:'A'}});const original={type:'ACCOUNT_SETTLEMENT_REQUEST',company:'NCT',requestId:'OLD',input:{action:'DOCUMENT_UPLOAD'}};assert.equal(h.api.decorate(original),original);
  const g=ready();for(const action of ['DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE','INVOICE_CHECK'])assert.throws(()=>g.request({input:{id:'PO',version:'V0',action}}),/unavailable/);
});

test('complete original PDF command above non-file cap is durable before network and explicit reload retry keeps exact bytes/identity',()=>{
 const payload=Buffer.from('%PDF-1.4\n'+'X'.repeat(210000)).toString('base64'),h=ready(),request=h.request({input:{id:'PO',version:'V0',action:'DOCUMENT_UPLOAD',type:'DO',base64:payload,date:'2026-10-22',number:'DO1',reason:'Original DO'}});
 h.api.send(request);assert.equal(h.saves().length,1);assert.equal(JSON.parse(h.db.get(key)).request.input.base64,payload);
 const reloaded=harness({db:h.db});reloaded.authorize();assert.equal(reloaded.saves().length,0);reloaded.node('#app').children[0].querySelector('[data-current-retry]').onclick();
 assert.equal(reloaded.saves()[0].input.base64,payload);assert.equal(reloaded.saves()[0].requestId,request.requestId);reloaded.reply(success(request));reloaded.fresh();assert.equal(reloaded.db.has(key),false);
 const maximum=Buffer.alloc(3*1024*1024,65);maximum.write('%PDF-');assert.equal(h.api.valid({...request,input:{...request.input,base64:maximum.toString('base64')}}),true);
 assert.equal(h.api.valid({...request,input:{...request.input,base64:maximum.toString('base64')+'A'}}),false);
});

test('actual original Account file dialog/parent/web/private save retains full PDF and verifies same original state before closing',async()=>{
 const file=require.resolve('./stock-current-account-root.test.cjs'),make=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',{require:createRequire(file),__dirname,Map,Buffer});
 const backend=await make({generated:true}),h=harness({settlement:true});let receive;const room={onMessage:fn=>receive=fn,postMessage:message=>h.send(message)},$w=()=>room;$w.onReady=fn=>fn();
 vm.runInNewContext(fs.readFileSync(path.join(folder,'account-department-page.candidate.js'),'utf8').replace(/^import[^\n]+\n/gm,''),{$w,getAccountPurchaseOrders:backend.api.getAccountPurchaseOrders,queryAccountPurchaseOrders:backend.api.queryAccountPurchaseOrders,saveAccountSettlement:backend.api.saveAccountSettlement,saveAccountInvoiceCheck:backend.api.saveAccountInvoiceCheck,wixLocationFrontend:{query:{}}});
 await receive({data:h.messages[0]});const listed=await backend.api.getAccountPurchaseOrders('NCT');h.api.observe(listed);
 const bytes=Buffer.from('%PDF-1.4\n'+'D'.repeat(210000)),payload=bytes.toString('base64');h.window.accountSettlement.edit(copy(listed.orders[0]),'do');
 h.values.set('reason','Original supplier DO');h.values.set('date','2026-10-22');h.values.set('reference','DO1');h.values.set('pdf',{name:'do.pdf',size:bytes.length,base64:payload});h.click({controlId:'settlementSubmit'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.saves()[0].input.base64,payload);assert.equal(JSON.parse(h.db.get(key)).request.input.base64,payload);let index=1;
 for(let step=0;step<40&&h.api.busy();step++){const request=h.messages[index++];assert.ok(request);await receive({data:request});if(h.api.busy()&&h.messages.length===index)h.timers.at(-1)();}
 assert.equal(h.api.busy(),false);assert.equal(h.node('#documents').open,false);assert.equal(backend.fileCommands.filter(command=>command.action==='UPLOAD').length,1);
 assert.equal(backend.db.get('PurchaseOrders:'+listed.orders[0].id).details.documents.filter(doc=>doc.number==='DO1').length,1);assert.equal(backend.calls.some(call=>call.startsWith('LEGACY_')),false);
});

test('actual original settlement dialog uses durable controller before network and waits for fresh read before closing', () => {
  const h=ready({settlement:true}),row={id:'PO',version:'V0',company:'NCT',supplierName:'Supplier',number:'PO1',finance:{},documents:[]};
  h.window.accountSettlement.edit(row,'cn');h.values.set('reason','Original CN decision');h.values.set('cn','on');h.click({controlId:'settlementSubmit'});
  const req=h.saves()[0];assert.ok(req);assert.equal(req.input.action,'CN_NOT_APPLICABLE');assert.equal(h.node('#documents').open,true);assert.deepEqual(JSON.parse(h.db.get(key)).request,(()=>{const {stockSegment,...request}=req;return request;})());
  h.reply(success(req));assert.equal(h.node('#documents').open,true);assert.ok(h.db.get(key));h.fresh();assert.equal(h.node('#documents').open,false);assert.equal(h.window.accountSettlement.busy(),false);
});

test('actual original legacy invoice-check controller retains its distinct endpoint and refreshes only after verified receipt', () => {
  const h=harness({payments:true});h.authorize();h.window.accountPayments.render({company:'NCT',view:'creditor'});
  const query=h.messages.at(-1),row={id:'PO',version:'V0',company:'NCT',supplierName:'Supplier',number:'PO1',state:'ACTIVE',documents:[],history:[],invoiceChecked:true};
  h.send({type:'ACCOUNT_QUERY_RESULT',company:'NCT',requestId:query.requestId,ok:true,result:{...h.read(),items:[row]}});
  h.node('#accountCheckReason').value='Original cancellation reason';h.node('#documents').showModal();h.click({accountConfirm:'PO'});
  const req=h.saves()[0];assert.ok(req);assert.equal(req.type,'ACCOUNT_CHECK_REQUEST');assert.equal(req.input.action,'INVOICE_CHECK');assert.equal(req.input.enabled,false);
  assert.equal(req.input.reason,'Original cancellation reason');assert.ok(h.db.get(key));
  h.reply(success(req),{type:'ACCOUNT_SETTLEMENT_RESULT'});assert.equal(h.messages.at(-1).type,'ACCOUNT_CHECK_REQUEST');
  h.reply(success(req));assert.equal(h.node('#documents').open,true);h.fresh();
  assert.equal(h.api.busy(),false);assert.equal(h.db.has(key),false);assert.equal(h.node('#documents').open,false);
  assert.equal(h.messages.at(-1).type,'ACCOUNT_QUERY_REQUEST');assert.equal(h.messages.at(-1).input.limit,50,'original query refresh resumes');
});

test('recovered original save requires explicit retry; verification timeout and foreign parent cannot unlock it', () => {
  const source=ready(),req=source.request(),h=harness({db:new Map([[key,JSON.stringify({schema:1,request:copy(req)})]])});
  h.authorize();h.node('#app').children[0].querySelector('[data-current-retry]').onclick();h.reply(success(req));
  const read=h.messages.at(-1);h.send({type:'ACCOUNT_QUERY_RESULT',company:'NCT',requestId:read.requestId,ok:true,result:h.read({stockGeneration:1})},{});
  assert.ok(h.db.get(key));h.timers.at(-1)();assert.equal(h.api.busy(),true);assert.ok(h.db.get(key));
  h.fresh();assert.ok(h.db.get(key),'late read after verification timeout is not adopted');
  h.node('#app').children[0].querySelector('[data-current-retry]').onclick();h.reply(success(req));h.fresh();
  assert.equal(h.api.busy(),false);assert.equal(h.db.has(key),false);assert.equal(h.node('#app').children.length,0);
});

test('actual original settlement UI/parent/web/private root complete segmented save once without legacy writer or stock changes', async () => {
  const file=require.resolve('./stock-current-account-root.test.cjs'),make=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',{require:createRequire(file),__dirname,Map,Buffer});
  const backend=await make({generated:true}),h=harness({settlement:true});let receive;const room={onMessage:fn=>receive=fn,postMessage:message=>h.send(message)},$w=()=>room;$w.onReady=fn=>fn();
  vm.runInNewContext(fs.readFileSync(path.join(folder,'account-department-page.candidate.js'),'utf8').replace(/^import[^\n]+\n/gm,''),{$w,getAccountPurchaseOrders:backend.api.getAccountPurchaseOrders,queryAccountPurchaseOrders:backend.api.queryAccountPurchaseOrders,saveAccountSettlement:backend.api.saveAccountSettlement,saveAccountInvoiceCheck:backend.api.saveAccountInvoiceCheck,wixLocationFrontend:{query:{}}});
  await receive({data:h.messages[0]});const listed=await backend.api.getAccountPurchaseOrders('NCT');h.api.observe(listed);const before=JSON.stringify([...backend.db].filter(([key])=>/^(Stock|NCTTasks|NCTOrders)/.test(key)));
  h.window.accountSettlement.edit(copy(listed.orders[0]),'cn');h.values.set('reason','Original CN applicability');h.values.set('cn','on');h.click({controlId:'settlementSubmit'});
  let index=1;for(let i=0;i<40&&h.api.busy();i++){const request=h.messages[index++];assert.ok(request);await receive({data:request});if(h.api.busy()&&h.messages.length===index)h.timers.at(-1)();}
  assert.equal(h.api.busy(),false);assert.equal(h.node('#documents').open,false);assert.equal(backend.control().generation,1);assert.equal(backend.calls.some(call=>call.startsWith('LEGACY_')),false);
  assert.equal(JSON.stringify([...backend.db].filter(([key])=>/^(Stock|NCTTasks|NCTOrders)/.test(key))),before);assert.equal(backend.db.get('PurchaseOrders:'+listed.orders[0].id).details.audit.length,1);
});
