const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process'),folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const staff={staffId:'W',memberId:'M',staffName:'Warehouse'},key='fmcg-warehouse-receipt-v1/NCT/W/M';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(db=new Map(),app=true){
 const sent=[],writes=[],gets=[],events=[],nodes=new Map(),listeners=new Set(),timers=new Map();let ids=0,timerIds=0,failWrite=false;
 const storage={getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Storage unavailable');writes.push(['SET',key]);events.push('CACHE');db.set(key,value);},removeItem:key=>{writes.push(['REMOVE',key]);db.delete(key);}};
 const parent={postMessage:value=>{events.push('NETWORK');sent.push(copy(value));}},window={parent,addEventListener:(type,fn)=>{if(type==='message')listeners.add(fn);},removeEventListener:(_type,fn)=>listeners.delete(fn)};
 const fields={accepted:{value:'100'},rejected:{value:'0'},kind:{value:'DELIVERY'},reason:{value:''},resolveIssue:{checked:false}};
 const section={dataset:{line:'0'},classList:{toggle(){}},querySelector:selector=>selector==='[data-receipt-normal]'?{}:fields[selector.match(/data-field=["']?([^"'\]]+)/)[1]]};
 const entryButton={dataset:{entry:'PO'}};
 function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='company'?'NCT':'',innerHTML:'',textContent:'',open:false,hidden:false,disabled:false,
   classList:{toggle(){}},addEventListener(){},querySelectorAll:selector=>id==='entryLines'&&selector==='[data-line]'?[section]:id==='tables'&&selector==='[data-entry]'?[entryButton]:[],
   showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);}
 const context={window,parent,sessionStorage:storage,document:{getElementById:node,querySelector:node,querySelectorAll:()=>[]},
   crypto:{randomUUID:()=> '11111111-1111-4111-8111-'+String(++ids).padStart(12,'0')},Intl,Date,Map,Boolean,
   setTimeout:(fn,ms)=>{const id=++timerIds;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval(){}};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-receipt-resume.js'),'utf8'),context);
 if(app){window.warehouseWorkroom={setData(){},cards:()=>'',incoming:()=>'',hydrate(){},resetFilter(){},isBusy:()=>false};
   vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/app.js'),'utf8'),context);}
 const emit=(data,source=parent)=>{for(const fn of [...listeners])fn({source,data});};
 const order={id:'PO',version:'V1',number:'PO-1',supplierId:'SUP',supplierName:'Supplier',customerName:'Customer',customerId:'C',history:[],status:'WAITING',
   lines:[{taskId:'TASK',planned:100,accepted:0,rejected:0,remaining:100,barcode:'1',name:'Product',packing:'12',expectedExtra:0}]};
 return{db,sent,writes,gets,events,node,fields,section,timers,emit,api:window.warehouseCurrentReceipt,failWrite:()=>{failWrite=true;},
   ready:(meta=true)=>{const request=sent.filter(row=>row.type==='WAREHOUSE_ORDERS_REQUEST').at(-1);emit({type:'WAREHOUSE_ORDERS_RESULT',company:'NCT',requestId:request.requestId,ok:true,
     result:{company:'NCT',staff,orders:[copy(order)],customerLines:[],deliveryTasks:[],...(meta?{stockCurrent:{schema:'CURRENT_WAREHOUSE_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:0,generation:0}}:{})}});},
   open:()=>entryButton.onclick(),save:()=>node('saveReceipt').onclick(),
   result:(result,extra={})=>{const request=sent.filter(row=>row.type==='WAREHOUSE_RECEIPT_REQUEST').at(-1);emit({type:'WAREHOUSE_RECEIPT_RESULT',company:'NCT',requestId:request.requestId,ok:true,result,...extra});}};
}
const request=()=>({type:'WAREHOUSE_RECEIPT_REQUEST',company:'NCT',requestId:'22222222-2222-4222-8222-222222222222',input:{id:'PO',version:'V',action:'RECEIVE',lines:[{taskId:'TASK',accepted:100}]},stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
test('own-tab receipt store persists exact request before network capability and never overwrites another pending request or scans keys',()=>{
 const f=fixture(undefined,false),original=request();f.api.retain(original,staff);assert.deepEqual(copy(f.api.pending('NCT',staff)),original);
 assert.throws(()=>f.api.retain({...original,requestId:'33333333-3333-4333-8333-333333333333'},staff),/Another/);
 assert.throws(()=>f.api.retain(original,{...staff,memberId:'OTHER'}),/session changed/);
 assert.throws(()=>f.api.clear({...original,input:{changed:true}},staff),/changed/);assert.equal(f.sent.length,0);
 assert.equal(f.gets.every(id=>id===key),true);f.api.clear(original,staff);assert.equal(f.db.has(key),false);
 const blocked=fixture(undefined,false);blocked.failWrite();assert.throws(()=>blocked.api.retain(original,staff));assert.equal(blocked.db.size,0);
});
test('actual receipt app retains metadata/full original request before first send, continues same UUID phases, and clears only verified complete original receipt',()=>{
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1);
 assert.equal(original.stockProtocol,1);assert.deepEqual(JSON.parse(f.db.get(key)),original);assert.equal(f.events.at(-2),'CACHE');
 for(const phase of ['BEFORE','APPLY','VERIFY']){
   f.result({ok:false,pending:true,requestId:original.requestId,phase,completedCount:2,totalRecords:10});
   assert.equal(f.db.has(key),true);assert.equal(f.node('entry').open,true);f.fields.accepted.value='999';
   [...f.timers.values()].filter(timer=>timer.ms===250).at(-1).fn();assert.deepEqual(f.sent.at(-1),original);
 }
 f.result({ok:true,company:'NCT',requestId:original.requestId,poId:'PO',receiptId:'RECEIPT',savedAt:'2026-10-22T08:00:00Z',stockGeneration:1});
 assert.equal(f.db.has(key),false);assert.equal(f.node('entry').open,false);assert.equal(f.sent.at(-1).type,'WAREHOUSE_ORDERS_REQUEST');
 assert.equal(f.sent.filter(row=>row.type==='WAREHOUSE_RECEIPT_REQUEST').length,4);
});
test('storage failure, unknown/retryable-false result, stale generation, malformed progress and old timer cannot discard or mutate current request',()=>{
 const blocked=fixture();blocked.ready();blocked.open();blocked.failWrite();blocked.save();assert.equal(blocked.sent.filter(row=>row.type==='WAREHOUSE_RECEIPT_REQUEST').length,0);
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1),saved=f.db.get(key),oldTimer=[...f.timers.values()].at(-1);
 f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:4});
 [...f.timers.values()].filter(timer=>timer.ms===250).at(-1).fn();oldTimer.fn();assert.equal(f.node('retryCurrentReceipt').disabled,true,'obsolete earlier send timer cannot unlock a later phase');
 for(const result of [{ok:false,retryable:false,error:'Unconfirmed'},{ok:true,requestId:original.requestId,stockGeneration:0},
   {ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:5,totalRecords:4}]){
   f.result(result);assert.equal(f.db.get(key),saved);assert.equal(f.node('entry').open,true);
 }
 const count=f.sent.length;f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:4});
 for(const timer of [...f.timers.values()].filter(timer=>timer.ms===250))timer.fn();assert.equal(f.sent.length,count,'late progress after unknown result must not restart automatic continuation');
});
test('reload behind pending barrier authenticates first, reads only own staff cache, and retries original without a fake PO workspace',async()=>{
 const db=new Map([[key,JSON.stringify(request())]]),f=fixture(db),read=f.sent[0];assert.equal(f.gets.length,0);
 f.emit({type:'WAREHOUSE_ORDERS_RESULT',company:'NCT',requestId:read.requestId,ok:false,error:'Inventory pending'});
 const auth=f.sent.at(-1);assert.equal(auth.type,'WAREHOUSE_RESUME_CONTEXT_REQUEST');assert.equal(f.gets.length,0);
 f.emit({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company:'NCT',staff}},{});
 assert.equal(f.gets.length,0);f.emit({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company:'NCT',staff}});await flush();
 assert.equal(f.gets.every(id=>id===key),true);assert.equal(f.node('entry').open,false);assert.equal(f.node('tables').innerHTML.includes('Product'),false);
 f.node('retryCurrentReceipt').onclick();assert.deepEqual(f.sent.at(-1),request());assert.equal(f.db.has(key),true);
 f.result({ok:true,company:'NCT',requestId:request().requestId,poId:'PO',receiptId:'RECEIPT',savedAt:'2026-10-22T08:00:00Z',stockGeneration:1});
 assert.equal(f.db.has(key),false);assert.equal(f.sent.at(-1).type,'WAREHOUSE_ORDERS_REQUEST');
});
test('changed member recovery cannot inspect another staff cache or auto-send its retained request',async()=>{
 const db=new Map([[key,JSON.stringify(request())]]),f=fixture(db),read=f.sent[0];
 f.emit({type:'WAREHOUSE_ORDERS_RESULT',company:'NCT',requestId:read.requestId,ok:false,error:'Pending'});const auth=f.sent.at(-1);
 f.emit({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company:'NCT',staff:{...staff,memberId:'OTHER'}}});await flush();
 assert.equal(f.gets.every(id=>id.endsWith('/OTHER')),true);assert.equal(f.sent.some(row=>row.type==='WAREHOUSE_RECEIPT_REQUEST'),false);assert.equal(f.db.has(key),true);
});
test('legacy receipt keeps original send/result path without introducing current cache',()=>{
 const legacy=fixture();legacy.ready(false);legacy.open();legacy.save();assert.equal(legacy.sent.at(-1).stockProtocol,undefined);assert.equal(legacy.writes.length,0);
 legacy.result({ok:true});assert.equal(legacy.node('entry').open,false);assert.equal(legacy.writes.length,0);
});
test('generated receipt UI and paired Wix relay preserve stock/read routes and pass only current version metadata to original receipt wrapper',async()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-warehouse-current-ui.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-current-stock-ui.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 let handler;const sent=[],calls=[],room={onMessage:fn=>handler=fn,postMessage:message=>sent.push(message)},$w=()=>room;$w.onReady=fn=>fn();
 const source=fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-department-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 vm.runInNewContext(source,{$w,handlePackingList:async()=>false,getWarehouseResumeContextCurrent:async company=>({ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company,staff}),
   saveWarehouseReceipt:async(...args)=>{calls.push(copy(args));return{ok:false,pending:true};}});
 await handler({data:request()});assert.deepEqual(calls[0].slice(0,3),['NCT',request().requestId,request().input]);
 assert.deepEqual(calls[0][3],{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
 await handler({data:{type:'WAREHOUSE_RESUME_CONTEXT_REQUEST',company:'NCT',requestId:'AUTH'}});
 assert.equal(sent.at(-1).type,'WAREHOUSE_RESUME_CONTEXT_RESULT');assert.equal(sent.at(-1).result.stockCurrent,undefined);
 assert.match(fs.readFileSync(path.join(folder,'warehouse-ui/packing-list-link.js'),'utf8'),/'20261022-current-warehouse-v2'/);
 const originalFile=path.join(__dirname,'warehouse-packing-host.test.cjs'),text=fs.readFileSync(originalFile,'utf8');
 const start=text.indexOf('function host('),end=text.indexOf("const id=",start);
 const host=vm.runInNewContext(text.slice(start,end).replace('../../warehouse-room/packing-list-link.js','../prototypes/stock-current-state/warehouse-ui/packing-list-link.js')+';host;',
   {fs,path,vm,__dirname,URL,URLSearchParams,Set,Number,Math,JSON});
 const pane=host('?v=20261022-current-warehouse-v2');assert.ok(pane.tab);pane.tab.render(pane.container,'NCT');assert.match(pane.children[0].src,/department=WAREHOUSE/);
 assert.equal(host('?v=unpaired').tab,undefined,'new marker cannot erase original old-entry gate');
 assert.match(fs.readFileSync(path.join(folder,'warehouse-ui/index.html'),'utf8'),/stock-control-link\.js\?v=20261022-current-stock-v1/);
});
