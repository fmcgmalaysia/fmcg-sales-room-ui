const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const actor={staffId:'W',memberId:'M'},cacheKey=(company='NCT',staff=actor)=>'fmcg-stock-exception-current-v1/'+company+'/'+encodeURIComponent(staff.staffId)+'/'+encodeURIComponent(staff.memberId);
function ui({company='NCT',english=false,storage=new Map(),failStorage=false}={}){
 const nodes=new Map(),listeners={},sent=[],timers=[],reads=[],writes=[];let sequence=0;
 const fields={sourceTaskId:'T',kind:'SHORT_EXPIRY',quantity:'5',reason:'Inspection'};
 function node(key){if(!nodes.has(key)){const events={};nodes.set(key,{value:key==='#stockFilter'?'OPEN':'',open:false,disabled:false,style:{},innerHTML:'',textContent:'',events,
  appendChild(){},addEventListener:(type,fn)=>{(events[type]??=[]).push(fn);},querySelector:node,querySelectorAll:selector=>selector.includes('data-close')?[node('[data-close]'),node('[data-back]')]:[],
  showModal(){this.open=true;},close(){this.open=false;},reportValidity:()=>true,removeAttribute(){},});}return nodes.get(key);}
 const select=node('#company');select.value=company;
 const parent={postMessage:message=>sent.push(copy(message))},window={parent,addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);}};
 const document={querySelector:selector=>selector==='nav[aria-label="Account navigation"]'?(english?node('nav'):null):selector==='dialog[open]'?(node('dialog').open?node('dialog'):null):node(selector),
  createElement:type=>node(type),body:node('body'),getElementById:id=>id==='company'?select:id==='companySelect'?null:id==='refresh'?node('#refresh'):node('#'+id)};
 const sessionStorage={getItem:key=>{reads.push(key);return storage.get(key)??null;},setItem:(key,value)=>{if(failStorage)throw Error('Quota');writes.push(key);storage.set(key,value);},removeItem:key=>{if(failStorage)throw Error('Quota');storage.delete(key);}};
 const FormData=function(){return Object.entries(fields);};
 const code=fs.readFileSync(path.join(folder,'account-ui/stock-exceptions.js'),'utf8');
 vm.runInNewContext(code,{window,document,parent,sessionStorage,FormData,Intl,Date,
  crypto:{randomUUID:()=>String(++sequence).padStart(8,'0')+'-1111-4111-8111-111111111111'},
  setTimeout:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;}});
 const emit=(message,source=parent)=>{for(const fn of listeners.message||[])fn({data:copy(message),source});};
 const reply=(result,request=sent.at(-1),extra={})=>emit({type:request.type.replace('_REQUEST','_RESULT'),company:request.company,requestId:request.requestId,stockSegment:request.stockSegment,ok:true,result,...extra});
 const identity=(staff=actor)=>({ok:true,schema:'STOCK_EXCEPTION_ORIGINAL_CONTEXT_V1',company,staff:{...staff,staffName:'Warehouse'}});
 const data=(extra={})=>({company,version:'ORIGINAL_VERSION',resolutionVersion:'RESOLUTION_VERSION',sources:[{id:'T',barcode:'1',name:'Item',po:'PO',supplierName:'Supplier',availablePhysical:20}],cases:extra.stockCurrent?.stockGeneration>0?[{id:'CASE',sourceTaskId:'T',quantity:5,kind:'SHORT_EXPIRY',byStaffId:'W',source:{barcode:'1',name:'Item',packing:'12',supplierName:'Supplier',po:'PO'}}]:[],permissions:{report:true},staff:{staffName:'Warehouse'},
  stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:actor},...extra});
 const click=selector=>{const target=node(selector);if(target.disabled)return;target.onclick?.();for(const fn of target.events.click||[])fn();};
 const open=()=>window.masterStockExceptions.open();
 const ready=()=>{open();reply(identity());reply(data());};
 const start=()=>{click('[data-report]');click('[data-save]');};
 const saves=()=>sent.filter(message=>message.type==='STOCK_SAVE_REQUEST');
 const success=(request=saves().at(-1),extra={})=>({ok:true,company,requestId:request.requestId,caseId:'CASE',stockGeneration:request.stockGeneration+1,...extra});
 const timeout=(ms=30000)=>{const timer=timers.filter(timer=>!timer.cancelled&&timer.ms===ms).at(-1);assert.ok(timer);timer.fn();};
 return{node,select,sent,timers,reads,writes,storage,fields,emit,reply,identity,data,click,open,ready,start,saves,success,timeout,setFailStorage:value=>{failStorage=value;}};
}

test('original shared dialog retains full request before send and clears only after strict receipt plus fresh same-actor/build read',()=>{
 for(const company of ['NCT','GHR']){
  const f=ui({company});f.ready();f.start();const request=f.saves()[0],stored=JSON.parse(f.storage.get(cacheKey(company))).request;
  const {stockSegment,...immutable}=request;assert.equal(stockSegment,1);assert.deepEqual(stored,immutable);assert.deepEqual(request.stockIdentity,actor);assert.equal(request.input.quantity,5);
  assert.equal(request.input.version,'ORIGINAL_VERSION');assert.equal(f.select.disabled,true);f.click('[data-save]');assert.equal(f.saves().length,1);
  f.reply(f.success(),request);assert.equal(f.storage.has(cacheKey(company)),true,'save receipt alone cannot clear original request');
  assert.equal(f.sent.at(-1).type,'STOCK_READ_REQUEST');
  f.reply(f.data({stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:1,stockIdentity:actor}}));
  assert.equal(f.storage.has(cacheKey(company)),false);assert.equal(f.select.disabled,false);
 }
});

test('quota failure sends nothing; wrong receipt/segment/parent and stale fresh state retain original request',()=>{
 const blocked=ui({failStorage:true});blocked.ready();blocked.start();assert.equal(blocked.saves().length,0);assert.match(blocked.node('#stockError').textContent,/尚未发送/);
 const f=ui();f.ready();f.start();const request=f.saves()[0];
 f.emit({type:'STOCK_SAVE_RESULT',company:'NCT',requestId:request.requestId,stockSegment:1,ok:true,result:f.success()},{});
 f.reply(f.success(),request,{stockSegment:99});assert.equal(f.sent.at(-1).type,'STOCK_SAVE_REQUEST');
 f.reply(f.success(request,{caseId:''}),request);assert.equal(f.storage.has(cacheKey()),true);f.click('[data-save]');const retry=f.saves().at(-1);
 assert.equal(retry.requestId,request.requestId);assert.equal(retry.stockSegment,2);
 f.reply(f.success(retry),retry);f.reply(f.data({stockCurrent:{stockProtocol:1,stockBuild:'OTHER',stockGeneration:1,stockIdentity:actor}}));
 assert.equal(f.storage.has(cacheKey()),true);assert.match(f.node('#stockError').textContent,/尚未确认/);
 f.click('[data-save]');f.reply(f.success());f.reply(f.data({stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:1,stockIdentity:{staffId:'OTHER',memberId:'M'}}}));
 assert.equal(f.storage.has(cacheKey()),true);
  f.click('[data-save]');f.reply(f.success());f.reply(f.data({cases:[],stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:1,stockIdentity:actor}}));
  assert.equal(f.storage.has(cacheKey()),true,'same-generation read must still contain this exact saved case');
});

test('same full request progresses finitely; timeout/late progress never auto-replays and explicit retry changes only transport segment',()=>{
 const f=ui();f.ready();f.start();const request=f.saves()[0],body=JSON.parse(f.storage.get(cacheKey())).request;
 const progress={ok:false,pending:true,requestId:request.requestId,phase:'APPLY',completedCount:1,totalRecords:5};
 f.reply(progress);f.timeout(250);assert.equal(f.saves().length,2);const next=f.saves().at(-1);assert.equal(next.stockSegment,2);
 const {stockSegment,...immutable}=next;assert.deepEqual(immutable,body);
 f.timeout();const timers=f.timers.length;f.reply(progress,next);assert.equal(f.timers.length,timers);assert.equal(f.saves().length,2);
 f.click('[data-save]');for(let i=0;i<70;i++){const previous=f.saves().length,count=f.timers.length;f.reply(progress,f.saves().at(-1));if(f.timers.length>count)f.timeout(250);if(f.saves().length===previous)break;}
 assert.ok(f.saves().length<=67);assert.match(f.node('#stockError').textContent,/暂停/);assert.deepEqual(JSON.parse(f.storage.get(cacheKey())).request,body);
});

test('reload reads ONLY freshly authenticated own cache and waits for explicit retry, never another member or malformed cache',()=>{
 const f=ui();f.ready();f.start();const body=JSON.parse(f.storage.get(cacheKey())).request;
 const restored=ui({storage:f.storage});restored.open();assert.deepEqual(restored.sent.at(-1).readOptions,{contextOnly:true});restored.reply(restored.identity());
 assert.equal(restored.saves().length,0);assert.match(restored.node('dialog').innerHTML,/原库存请求/);restored.click('[data-save]');
 const {stockSegment,...retry}=restored.saves()[0];assert.deepEqual(retry,body);
 const other=ui({storage:f.storage});other.open();other.reply(other.identity({staffId:'OTHER',memberId:'OTHER_MEMBER'}));
 assert.equal(other.reads.includes(cacheKey()),false);assert.equal(other.saves().length,0);assert.equal(other.sent.at(-1).type,'STOCK_READ_REQUEST');
 const broken=ui({storage:new Map([[cacheKey(),'{invalid']])});broken.open();broken.reply(broken.identity());assert.equal(broken.saves().length,0);assert.match(broken.node('#stockError').textContent,/需要核对/);assert.equal(broken.select.disabled,true);
});

test('original Account dialog remains English; cleanup failure retains exact request and stale transport cannot finish it',()=>{
 const f=ui({english:true});f.ready();f.start();const request=f.saves()[0];f.reply(f.success(),request);f.setFailStorage(true);
 f.reply(f.data({stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:1,stockIdentity:actor}}));assert.match(f.node('#stockError').textContent,/cleanup unconfirmed/);
 assert.equal(/[\u3400-\u9fff]/.test(f.node('#stockError').textContent),false);assert.equal(f.storage.has(cacheKey()),true);
 f.setFailStorage(false);f.click('[data-save]');f.reply(f.success(request),request);assert.equal(f.storage.has(cacheKey()),true,'old segment ignored');
 f.reply(f.success());f.reply(f.data({stockCurrent:{stockProtocol:1,stockBuild:'TEST',stockGeneration:1,stockIdentity:actor}}));assert.equal(f.storage.has(cacheKey()),false);
});

function parentPanel(file,api,onReply){let handler;const room={onMessage:fn=>{handler=fn;},postMessage:onReply},$w=()=>room;$w.onReady=fn=>fn();
 vm.runInNewContext(fs.readFileSync(path.join(folder,file),'utf8').replace(/^import[^\n]+\n/gm,''),{$w,handlePackingList:async()=>false,wixLocationFrontend:{query:{}},...api});return message=>handler({data:copy(message)});}
test('all three original parent panels relay exact current identity/segment and original stock methods, rejecting malformed transport',async()=>{
 for(const file of ['purchase-room-page.candidate.js','account-department-page.candidate.js','warehouse-ui/warehouse-department-page.js']){
  const calls=[],replies=[],relay=parentPanel(file,{getStockExceptions:async(...args)=>{calls.push(args);return{ok:true};},saveStockException:async(...args)=>{calls.push(args);return{ok:true};}},message=>replies.push(message));
  const h=ui();h.open();await relay(h.sent.at(-1));assert.deepEqual(copy(calls[0]),['NCT',{contextOnly:true}]);
  h.reply(h.identity());h.reply(h.data());h.start();const request=h.saves()[0];await relay(request);
  assert.deepEqual(copy(calls[1]),['NCT',request.requestId,request.input,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:actor}]);assert.equal(replies.at(-1).stockSegment,1);
  await relay({...request,stockSegment:0});assert.equal(calls.length,2);assert.equal(replies.at(-1).ok,false);
 }
});

test('original shared dialog → actual parent → current web/private root commits isolation once then confirms fresh read',async()=>{
 const filename=require.resolve('./stock-current-exception-root.test.cjs');
 const fixture=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',{require:createRequire(filename),__dirname,Map,Buffer});
 const f=await fixture(),h=ui(),queue=[];const relay=parentPanel('warehouse-ui/warehouse-department-page.js',f.api,message=>h.emit(message));let cursor=0;
 h.open();await relay(h.sent[cursor++]);await relay(h.sent[cursor++]);h.start();
 for(let i=0;i<80;i++){
  while(cursor<h.sent.length){await relay(h.sent[cursor++]);}
  if(!h.storage.has(cacheKey()))break;
  const timer=h.timers.filter(timer=>timer.ms===250&&!timer.cancelled&&!queue.includes(timer)).at(-1);assert.ok(timer,'bounded progress must schedule continuation');queue.push(timer);timer.fn();
 }
 assert.equal(h.storage.has(cacheKey()),false);assert.equal(f.control().generation,1);
 assert.equal([...f.db.values()].filter(row=>row.action==='STOCK_EXCEPTION_REPORTED').length,1);
 const position=[...f.db.values()].find(row=>row.sourceTaskId==='T');assert.equal(position.isolated,5);assert.equal(position.available,15);assert.equal(position.receiptAccepted,20);
});

test('all four builders reproducible; generated dialog is shared exact overlay, original form builders byte-exact',()=>{
 for(const name of ['build-purchase-borrow-panel.cjs','build-account-current-ui.cjs','build-current-stock-ui.cjs','build-warehouse-current-ui.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,name),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(__dirname,'../../master-shared/stock-exceptions.js'),'utf8').replace(/\r\n/g,'\n');
 const forms=source=>source.slice(source.indexOf('const field='),source.indexOf('function lock('));
 let common;
 for(const area of ['purchase-ui','account-ui','warehouse-ui']){
  const source=fs.readFileSync(path.join(folder,area,'stock-exceptions.js'),'utf8').replace(/\r\n/g,'\n');assert.equal(forms(source),forms(original));if(common)assert.equal(source,common);common=source;
  assert.match(fs.readFileSync(path.join(folder,area,'index.html'),'utf8'),/src="stock-exceptions.js\?v=20261023-current-exception-v1"/);
 }
});
