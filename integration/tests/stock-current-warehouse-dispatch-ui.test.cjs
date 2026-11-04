const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{execFileSync}=require('node:child_process');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value)),staff={staffId:'W',memberId:'M',staffName:'Warehouse'},key='fmcg-warehouse-dispatch-v1/NCT/W/M';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(db=new Map()){
 const nodes=new Map(),listeners=new Set(),timers=new Map(),sent=[],events=[],gets=[];let ids=0,failWrite=false,failRemove=false;
 const dispatchButton={dataset:{dispatch:'SHIP'}};
 function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',checked:false,disabled:false,open:false,style:{},
  addEventListener(){},querySelector:selector=>node(selector),querySelectorAll:selector=>selector==='[data-dispatch]'?[dispatchButton]:selector==='button,input,textarea'?['[data-save]','[data-close]','[data-reference]','[data-reason]','[data-confirm]'].map(node):[],showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);}
 const parent={postMessage:message=>{events.push('NETWORK');sent.push(copy(message));}},window={parent,addEventListener:(type,fn)=>{if(type==='message')listeners.add(fn);},removeEventListener:(_type,fn)=>listeners.delete(fn)};
 const context={window,parent,document:{createElement:node,body:{appendChild(){}}},crypto:{randomUUID:()=> '22222222-2222-4222-8222-'+String(++ids).padStart(12,'0')},
  sessionStorage:{getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Quota');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}},
  setTimeout:(fn,ms)=>{const id=++ids;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-dispatch-resume.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/dispatch.js'),'utf8'),context);
 const emit=(data,source=parent)=>{for(const fn of [...listeners])fn({source,data});},api=window.warehouseDispatch;api.render(node('host'),'NCT');
 return{db,node,sent,events,gets,timers,emit,api,helper:window.warehouseCurrentDispatch,failWrite:()=>{failWrite=true;},failRemove:()=>{failRemove=true;},
  ready:(meta=true)=>{const request=sent.filter(row=>row.type==='FULFILMENT_READ_REQUEST').at(-1);emit({type:'FULFILMENT_READ_RESULT',company:'NCT',requestId:request.requestId,ok:true,result:{company:'NCT',version:'V1',staff,customers:[{id:'C',name:'Customer'}],permissions:{dispatch:true},
   shipments:[{id:'SHIP',customerId:'C',status:'INVOICED',invoice:{number:'INV'},lines:[{taskId:'T',barcode:'1',name:'Product',quantity:20}]}],...(meta?{stockCurrent:{schema:'CURRENT_STOCK_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:0}}:{})}});},
  open:()=>{dispatchButton.onclick();node('[data-reference]').value='CONTAINER';node('[data-reason]').value='Actual exit';node('[data-confirm]').checked=true;},save:()=>node('[data-save]').onclick(),
  result:result=>{const request=sent.filter(row=>row.type==='FULFILMENT_SAVE_REQUEST').at(-1);emit({type:'FULFILMENT_SAVE_RESULT',company:'NCT',requestId:request.requestId,ok:true,result});}};
}
const request=()=>({type:'FULFILMENT_SAVE_REQUEST',company:'NCT',requestId:'33333333-3333-4333-8333-333333333333',input:{action:'DISPATCH',id:'SHIP',version:'V1',reference:'CONTAINER',reason:'Actual exit'},stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
const complete=original=>({ok:true,company:'NCT',requestId:original.requestId,shipmentId:'SHIP',status:'DISPATCHED',stockGeneration:1});
test('actual original dispatch dialog retains full original identity/version/reason before first send, same UUID phases and strict confirmed cleanup',()=>{
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1);assert.equal(original.stockProtocol,1);assert.deepEqual(JSON.parse(f.db.get(key)),original);assert.deepEqual(f.events.slice(-2),['CACHE','NETWORK']);
 for(const phase of ['BEFORE','APPLY','VERIFY']){f.result({ok:false,pending:true,requestId:original.requestId,phase,completedCount:2,totalRecords:10});f.node('[data-reference]').value='CHANGED';[...f.timers.values()].filter(timer=>timer.ms===250).at(-1).fn();assert.deepEqual(f.sent.at(-1),original);}
 f.result(complete(original));assert.equal(f.db.has(key),false);assert.equal(f.node('dialog').open,false);assert.equal(f.sent.at(-1).type,'FULFILMENT_READ_REQUEST');
 assert.equal(f.node('host').innerHTML.includes('ACTUAL-CONTAINER'),false);
});
test('storage failure, malformed/stale/unknown/retryable-false receipts and obsolete timers never replace or discard dispatch',()=>{
 const blocked=fixture();blocked.ready();blocked.open();blocked.failWrite();blocked.save();assert.equal(blocked.sent.some(row=>row.type==='FULFILMENT_SAVE_REQUEST'),false);
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1),saved=f.db.get(key),oldTimer=[...f.timers.values()].at(-1);
 f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:5});[...f.timers.values()].filter(timer=>timer.ms===250).at(-1).fn();oldTimer.fn();assert.equal(f.node('[data-save]').disabled,true);
 for(const result of [{ok:false,retryable:false,error:'required'},{...complete(original),stockGeneration:0},{...complete(original),status:'INVOICED'},{...complete(original),shipmentId:'OTHER'},
   {ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:8,totalRecords:5}]){f.result(result);assert.equal(f.db.get(key),saved);assert.equal(f.node('dialog').open,true);}
 const count=f.sent.length;f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:5});[...f.timers.values()].filter(timer=>timer.ms===250).forEach(timer=>timer.fn());assert.equal(f.sent.length,count);
});
test('auth-only reload reads exact own cache behind pending barrier, no fake workspace or automatic dispatch; changed member cannot adopt it',async()=>{
 for(const memberId of ['M','OTHER']){
  const f=fixture(new Map([[key,JSON.stringify(request())]])),read=f.sent[0];assert.equal(f.gets.length,0);f.emit({type:'FULFILMENT_READ_RESULT',company:'NCT',requestId:read.requestId,ok:false,error:'Pending'});
  const auth=f.sent.at(-1);assert.equal(auth.type,'WAREHOUSE_DISPATCH_RESUME_REQUEST');assert.equal(f.gets.length,0);
  f.emit({type:'WAREHOUSE_DISPATCH_RESUME_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,company:'NCT',schema:'WAREHOUSE_DISPATCH_RESUME_V1',staff:{...staff,memberId}}});await flush();
  assert.equal(f.gets.every(id=>id===key.replace('/M','/'+memberId)),true);assert.equal(f.sent.some(row=>row.type==='FULFILMENT_SAVE_REQUEST'),false);
  if(memberId==='M'){assert.match(f.node('dialog').innerHTML,/33333333/);assert.equal(f.node('dialog').innerHTML.includes('INV'),false);f.save();assert.deepEqual(f.sent.at(-1),request());f.result(complete(request()));assert.equal(f.db.has(key),false);}else assert.equal(f.db.has(key),true);
 }
});
test('exact cache removal failure retains original confirmed request and replay uses it unchanged',()=>{
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1);f.failRemove();f.result(complete(original));assert.equal(f.db.has(key),true);assert.equal(f.node('dialog').open,true);f.save();assert.deepEqual(f.sent.at(-1),original);
 assert.throws(()=>f.helper.retain({...original,requestId:'44444444-4444-4444-8444-444444444444'},staff),/Another/);
 assert.throws(()=>f.helper.retain(original,{...staff,memberId:'OTHER'}),/session changed/);
});
test('current open confirmation cannot be silently rebound by background refresh, another open or a late read',()=>{
 const f=fixture();f.ready();f.api.refresh();const read=f.sent.at(-1);f.open();const original=f.node('dialog').innerHTML,count=f.sent.length;
 f.api.refresh();assert.equal(f.sent.length,count);f.emit({type:'FULFILMENT_READ_RESULT',company:'NCT',requestId:read.requestId,ok:true,result:{company:'NCT',version:'UNSEEN',stockCurrent:{schema:'CURRENT_STOCK_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:9},staff}});
 f.save();assert.equal(f.sent.at(-1).input.version,'V1');assert.equal(f.sent.at(-1).stockGeneration,0);const request=f.sent.at(-1);f.open();assert.equal(f.node('dialog').innerHTML,original);assert.deepEqual(f.sent.at(-1),request);
});
test('legacy dispatch keeps original send/result without introducing new cache, while current original confirmation checkbox remains required',()=>{
 const f=fixture();f.ready(false);f.open();f.save();assert.equal(f.sent.at(-1).stockProtocol,undefined);assert.equal(f.db.size,0);f.result({ok:true});assert.equal(f.node('dialog').open,false);
 const current=fixture();current.ready();current.open();current.node('[data-confirm]').checked=false;current.save();assert.equal(current.sent.some(row=>row.type==='FULFILMENT_SAVE_REQUEST'),false);
});
test('paired original Wix relay forwards dispatch metadata and auth-only recovery, generated UI is exact and cache-fresh',async()=>{
 for(const file of ['build-warehouse-dispatch-ui.cjs','build-current-stock-ui.cjs','build-warehouse-current-ui.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
 let handler;const calls=[],sent=[],room={onMessage:fn=>handler=fn,postMessage:message=>sent.push(message)},$w=()=>room;$w.onReady=fn=>fn();
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-department-page.js'),'utf8').replace(/^import .*;\r?$/gm,''),{$w,handlePackingList:async()=>false,
  saveCustomerShipment:async(...args)=>{calls.push(copy(args));return{ok:false,pending:true};},getCustomerFulfilment:async(...args)=>{calls.push(copy(args));return{ok:true};}});
 await handler({data:request()});assert.deepEqual(calls[0],['NCT',request().requestId,request().input,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}}]);
 await handler({data:{type:'WAREHOUSE_DISPATCH_RESUME_REQUEST',company:'NCT',requestId:'AUTH'}});assert.deepEqual(calls[1],['NCT',{resume:'WAREHOUSE_DISPATCH_V1'}]);assert.equal(sent.at(-1).type,'WAREHOUSE_DISPATCH_RESUME_RESULT');
 const html=fs.readFileSync(path.join(folder,'warehouse-ui/index.html'),'utf8');assert.match(html,/warehouse-dispatch-resume.js/);assert.match(html,/dispatch.js\?v=20261022-current-dispatch-v1/);
});
