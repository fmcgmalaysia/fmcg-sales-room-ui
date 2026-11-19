const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process'),folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const staff={staffId:'W',memberId:'M',staffName:'Warehouse'},key='fmcg-warehouse-preparation-v1/NCT/W/M',flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(db=new Map()){
 const sent=[],gets=[],events=[],nodes=new Map(),listeners=new Set(),timers=new Map();let failWrite=false,failRemove=false,ids=0,refreshes=0,packButton,loadButton,cbmButton;
 const storage={getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Unavailable');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}};
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,hidden:false,disabled:false,dataset:{},classList:{remove(){},add(){}},addEventListener(){},after(){},prepend(){},
   querySelectorAll:()=>[],querySelector:()=>node('footerClose'),showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);}
 const parent={postMessage:value=>{events.push('NETWORK');sent.push(copy(value));}},window={parent,warehouseDispatch:{render(){}},addEventListener:(type,fn)=>{if(type==='message')listeners.add(fn);},removeEventListener:(_type,fn)=>listeners.delete(fn)};
 const document={body:{appendChild(){}},getElementById:node,createElement:tag=>node(tag),querySelector:node,querySelectorAll:selector=>selector==='[data-wh-pack]'?[packButton]:selector==='[data-wh-load]'?[loadButton]:selector==='[data-wh-cbm]'?[cbmButton]:[]};
 packButton={dataset:{whPack:'BATCH'}},loadButton={dataset:{whLoad:'BATCH'}},cbmButton={dataset:{whCbm:'BATCH'}};
 const context={window,parent,document,sessionStorage:storage,crypto:{randomUUID:()=> '11111111-1111-4111-8111-'+String(++ids).padStart(12,'0')},Intl,Date,Map,
  setTimeout:(fn,ms)=>{const id=++ids;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-preparation-resume.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-cbm-resume.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/workroom.js'),'utf8'),context);
 const emit=(data,source=parent)=>{for(const fn of [...listeners])fn({source,data});},api=window.warehouseWorkroom,handlers={render(){},refresh(){refreshes++;}};
 const task={id:'BATCH',taskId:'a'.repeat(32),version:'V1',customerId:'C',customerName:'Customer',name:'Product',barcode:'1',packing:'12',quantity:100,loaded:0,prepared:false,photos:[]};
 function ready(meta=true,generation=0){api.setData({orders:[],deliveryTasks:[copy(task)],...(meta?{stockCurrent:{schema:'CURRENT_WAREHOUSE_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:generation,generation},staff}:{})},'NCT',handlers);api.hydrate();}
 return{db,sent,gets,events,timers,node,emit,api,helper:window.warehouseCurrentPreparation,cbmHelper:window.warehouseCurrentCbm,handlers,task,ready,
  openCbm:()=>cbmButton.onclick(),cbmResult:(result,extra={})=>{const request=sent.filter(row=>row.type==='WAREHOUSE_CBM_REQUEST').at(-1);emit({type:'WAREHOUSE_CBM_RESULT',company:'NCT',requestId:request.requestId,ok:true,result,...extra});},
  open:(action='PACK')=>(action==='PACK'?packButton:loadButton).onclick(),save:()=>node('whSave').onclick(),
  failWrite:()=>{failWrite=true;},failRemove:()=>{failRemove=true;},refreshes:()=>refreshes,
  result:(result,extra={})=>{const request=sent.filter(row=>row.type==='WAREHOUSE_PREPARATION_REQUEST').at(-1);emit({type:'WAREHOUSE_PREPARATION_RESULT',company:'NCT',requestId:request.requestId,ok:true,result,...extra});}};
}
const request=()=>({type:'WAREHOUSE_PREPARATION_REQUEST',company:'NCT',requestId:'22222222-2222-4222-8222-222222222222',input:{action:'PACK',id:'BATCH',version:'V1',note:'',loaded:0,photos:[],photoStage:'PACKING'},stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
const complete=original=>({ok:true,requestId:original.requestId,company:'NCT',id:'BATCH',savedAt:'2026-10-22T10:00:00Z',stockGeneration:1});
const cbmKey='fmcg-warehouse-cbm-v1/NCT/W/M',cbmRequest=()=>({type:'WAREHOUSE_CBM_REQUEST',company:'NCT',requestId:'33333333-3333-4333-8333-333333333333',taskId:'a'.repeat(32),stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
const cbmComplete=original=>({ok:true,company:'NCT',requestId:original.requestId,taskId:original.taskId,cbmPerCtn:.025,stockGeneration:1});
test('original CBM dialog retains entire same-version own request before network; bounded phases and final original receipt alone clear it',()=>{
 const f=fixture();f.ready();f.openCbm();f.save();const original=f.sent.at(-1);
 assert.equal(original.type,'WAREHOUSE_CBM_REQUEST');assert.equal(original.stockProtocol,1);assert.deepEqual(JSON.parse(f.db.get(cbmKey)),original);assert.deepEqual(f.events.slice(-2),['CACHE','NETWORK']);
 for(const phase of ['BEFORE','APPLY','VERIFY']){
  f.cbmResult({ok:false,pending:true,requestId:original.requestId,phase,completedCount:1,totalRecords:2});
  [...f.timers.values()].filter(t=>t.ms===250).at(-1).fn();assert.deepEqual(f.sent.at(-1),original);assert.equal(f.db.has(cbmKey),true);
 }
 f.cbmResult(cbmComplete(original));assert.equal(f.db.has(cbmKey),false);assert.equal(f.node('whCbmValue').textContent,'CBM: 0.025');assert.equal(f.refreshes(),1);
 f.node('dialog').close();f.open();assert.match(f.node('dialog').innerHTML,/Refresh required/);
});
test('CBM cache refuses another request, failed durable write, actor changes and cleanup failure without unsafe retry replacement',()=>{
 const f=fixture(),original=cbmRequest();f.cbmHelper.retain(original,staff);
 assert.throws(()=>f.cbmHelper.retain({...original,taskId:'b'.repeat(32)},staff),/Another/);
 assert.throws(()=>f.cbmHelper.retain(original,{...staff,memberId:'OTHER'}),/session changed/);
 assert.throws(()=>f.cbmHelper.retain({...original,approved:true},staff),/bounded/);
 const blocked=fixture();blocked.ready();blocked.openCbm();blocked.failWrite();blocked.save();assert.equal(blocked.sent.length,0);assert.equal(blocked.db.size,0);
 const cleanup=fixture();cleanup.ready();cleanup.openCbm();cleanup.save();const command=cleanup.sent.at(-1);cleanup.failRemove();cleanup.cbmResult(cbmComplete(command));
 assert.equal(cleanup.db.has(cbmKey),true);assert.equal(cleanup.refreshes(),0);cleanup.save();assert.deepEqual(cleanup.sent.at(-1),command);
});
test('unknown CBM results, late timers and foreign/malformed receipts cannot release retained request or start another action',()=>{
 const f=fixture();f.ready();f.openCbm();f.save();const original=f.sent.at(-1),saved=f.db.get(cbmKey),timer=[...f.timers.values()].at(-1);
 f.cbmResult({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:3});[...f.timers.values()].filter(t=>t.ms===250).at(-1).fn();
 timer.fn();assert.equal(f.node('whInfo').textContent,'Fetching… 抓取中…');
 for(const result of [{ok:false,retryable:false},{...cbmComplete(original),taskId:'OTHER'},{...cbmComplete(original),stockGeneration:0},
  {...cbmComplete(original),requestId:'OTHER'},{...cbmComplete(original),cbmPerCtn:0},{ok:false,pending:true,requestId:original.requestId,phase:'VERIFY',completedCount:4,totalRecords:3}]){
  f.cbmResult(result);assert.equal(f.db.get(cbmKey),saved);
 }
 const before=f.node('dialog').innerHTML;f.open();assert.equal(f.node('dialog').innerHTML,before,'pending CBM cannot be replaced by PACK');
 f.emit({type:'WAREHOUSE_CBM_RESULT',company:'NCT',requestId:original.requestId,ok:true,result:cbmComplete(original)},{});assert.equal(f.db.has(cbmKey),true);
 const count=f.sent.length;[...f.timers.values()].filter(t=>t.ms===250).forEach(t=>t.fn());assert.equal(f.sent.length,count);
});
test('CBM reload authenticates once before exact own lookup, even while stock reads are pending; sends only on explicit retry',async()=>{
 for(const memberId of ['M','OTHER']){
  const original=cbmRequest(),f=fixture(new Map([[cbmKey,JSON.stringify(original)]]));assert.equal(f.gets.length,0);f.api.recoverCurrent('NCT',f.handlers);const auth=f.sent.at(-1);
  assert.equal(auth.type,'WAREHOUSE_RESUME_CONTEXT_REQUEST');assert.equal(f.gets.length,0);
  f.emit({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company:'NCT',staff:{...staff,memberId}}});await flush();
  assert.equal(f.sent.length,1);assert.equal(f.gets.every(id=>[key.replace('/M','/'+memberId),cbmKey.replace('/M','/'+memberId)].includes(id)),true);
  if(memberId==='M'){f.save();assert.deepEqual(f.sent.at(-1),original);f.cbmResult(cbmComplete(original));assert.equal(f.db.has(cbmKey),false);}
  else assert.equal(f.db.has(cbmKey),true);
 }
});
test('already-known current CBM receipt accepts unchanged generation without manufacturing a save; legacy CBM remains original unversioned path',()=>{
 const f=fixture();f.ready();f.openCbm();f.save();const original=f.sent.at(-1);f.cbmResult({...cbmComplete(original),stockGeneration:0,retained:true});assert.equal(f.db.has(cbmKey),false);assert.equal(f.refreshes(),1);
 const legacy=fixture();legacy.ready(false);legacy.openCbm();legacy.save();assert.equal(legacy.sent.at(-1).stockProtocol,undefined);assert.equal(legacy.db.size,0);
 legacy.cbmResult({ok:true,cbmPerCtn:.02});assert.equal(legacy.node('whCbmValue').textContent,'CBM: 0.02');assert.equal(legacy.refreshes(),0);
});
test('paired original CBM relay carries exact fourth version/identity argument and candidate helper is cache-fresh before workroom',async()=>{
 let handler;const calls=[],room={onMessage:fn=>handler=fn,postMessage(){}},$w=()=>room;$w.onReady=fn=>fn();
 const source=fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-department-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 vm.runInNewContext(source,{$w,handlePackingList:async()=>false,captureWarehouseCbm:async(...args)=>{calls.push(copy(args));return{ok:false,pending:true};}});
 const request=cbmRequest();await handler({data:request});assert.deepEqual(calls[0],['NCT',request.requestId,request.taskId,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:request.stockIdentity}]);
 const html=fs.readFileSync(path.join(folder,'warehouse-ui/index.html'),'utf8');assert.ok(html.indexOf('warehouse-cbm-resume.js')<html.indexOf('workroom.js?'));assert.match(html,/warehouse-cbm-resume.js\?v=20261022-current-cbm-v1/);
});
test('preparation own-session cache retains exact original before send and refuses replacement, files, changed actor and failed durable writes',()=>{
 const f=fixture(),original=request();f.helper.retain(original,staff);assert.deepEqual(copy(f.helper.pending('NCT',staff)),original);
 assert.throws(()=>f.helper.retain({...original,requestId:'33333333-3333-4333-8333-333333333333'},staff),/Another/);
 assert.throws(()=>f.helper.retain(original,{...staff,memberId:'OTHER'}),/session changed/);
 assert.throws(()=>f.helper.retain({...original,input:{...original.input,photos:[{base64:'x'}]}},staff),/bounded/);
 assert.throws(()=>f.helper.clear({...original,input:{changed:true}},staff),/changed/);
 assert.equal(f.gets.every(id=>id===key),true);assert.equal(f.sent.length,0);f.helper.clear(original,staff);assert.equal(f.db.has(key),false);
 const blocked=fixture();blocked.ready();blocked.open();blocked.failWrite();blocked.save();assert.equal(blocked.sent.length,0);assert.equal(blocked.db.size,0);
});
test('actual original PACK dialog carries paired version/identity, all bounded phases use same complete request, final receipt alone clears cache',()=>{
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1);assert.equal(original.stockProtocol,1);assert.deepEqual(JSON.parse(f.db.get(key)),original);assert.deepEqual(f.events.slice(-2),['CACHE','NETWORK']);
 for(const phase of ['BEFORE','APPLY','VERIFY']){
  f.result({ok:false,pending:true,requestId:original.requestId,phase,completedCount:2,totalRecords:8});assert.equal(f.db.has(key),true);
  f.node('whNote').value='changed';[...f.timers.values()].filter(timer=>timer.ms===250).at(-1).fn();assert.deepEqual(f.sent.at(-1),original);
 }
 f.result(complete(original));assert.equal(f.db.has(key),false);assert.equal(f.node('dialog').open,false);assert.equal(f.refreshes(),1);
 f.open();assert.match(f.node('dialog').innerHTML,/Refresh required/);f.node('dialog').close();f.ready(true,1);f.open();assert.match(f.node('dialog').innerHTML,/Confirm Packing/);
});
test('unknown/retryable-false, malformed, stale or foreign results never clear current request; old timers/progress cannot restart it',()=>{
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1),saved=f.db.get(key),oldTimer=[...f.timers.values()].at(-1);
 f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:4});[...f.timers.values()].filter(t=>t.ms===250).at(-1).fn();oldTimer.fn();assert.equal(f.node('whInfo').textContent,'Saving… 保存中…');
 for(const result of [{ok:false,retryable:false},{...complete(original),stockGeneration:0},{...complete(original),id:'OTHER'},
   {...complete(original),requestId:'OTHER'},{ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:5,totalRecords:4}]){
  f.result(result);assert.equal(f.db.get(key),saved);assert.equal(f.node('dialog').open,true);
 }
 const count=f.sent.length;f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:4});
 [...f.timers.values()].filter(t=>t.ms===250).forEach(t=>t.fn());assert.equal(f.sent.length,count);
 f.emit({type:'WAREHOUSE_PREPARATION_RESULT',company:'NCT',requestId:original.requestId,ok:true,result:complete(original)},{});assert.equal(f.db.get(key),saved);
});
test('failed cache removal retains confirmed original and replay uses same UUID, not a replacement',()=>{
 const f=fixture();f.ready();f.open();f.save();const original=f.sent.at(-1);f.failRemove();f.result(complete(original));assert.equal(f.db.has(key),true);assert.equal(f.refreshes(),0);f.save();assert.deepEqual(f.sent.at(-1),original);
});
test('original LOAD reason/whole-carton checks remain and current PHOTOS retains exact original request',()=>{
 const f=fixture();f.ready();f.open('LOAD');f.node('whLoaded').value='40';f.save();assert.equal(f.sent.length,0);assert.match(f.node('whError').textContent,/reason/);
 f.node('whNote').value='Container full';f.save();assert.equal(f.sent.at(-1).input.loaded,40);assert.equal(f.sent.at(-1).input.action,'LOAD');assert.equal(f.sent.at(-1).input.photoStage,'LOADING');
 const invalid=fixture();invalid.ready();invalid.open('LOAD');invalid.node('whLoaded').value='4.5';invalid.node('whNote').value='Reason';invalid.save();assert.equal(invalid.sent.length,0);
 const photos=fixture();photos.task.prepared=true;photos.ready();photos.open();photos.save();assert.equal(photos.sent.at(-1).input.action,'PHOTOS');assert.equal(photos.db.has(key),true);
});
test('reload retains full original photo bytes/hash/stage and sends same UUID rather than recompressing or reallocating',()=>{
 const original=request();original.input.photos=[{mimeType:'image/jpeg',base64:'original-compressed-bytes',sha256:'a'.repeat(64)}];
 const f=fixture(new Map([[key,JSON.stringify(original)]]));f.ready();assert.equal(f.sent.length,0);f.save();assert.deepEqual(f.sent.at(-1),original);
 f.result({ok:false,pending:true,requestId:original.requestId,phase:'APPLY',completedCount:1,totalRecords:5});[...f.timers.values()].filter(timer=>timer.ms===250).at(-1).fn();assert.deepEqual(f.sent.at(-1),original);
});
test('reload behind stock barrier authenticates before exact own-cache lookup and explicit replay; other member never sees original cache',async()=>{
 for(const memberId of ['M','OTHER']){
  const f=fixture(new Map([[key,JSON.stringify(request())]]));assert.equal(f.gets.length,0);f.api.recoverCurrent('NCT',f.handlers);const auth=f.sent.at(-1);assert.equal(auth.type,'WAREHOUSE_RESUME_CONTEXT_REQUEST');assert.equal(f.gets.length,0);
  f.emit({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company:'NCT',staff:{...staff,memberId}}});await flush();
  assert.equal(f.gets.every(id=>[key.replace('/M','/'+memberId),key.replace('preparation','cbm').replace('/M','/'+memberId)].includes(id)),true);assert.equal(f.sent.some(row=>row.type==='WAREHOUSE_PREPARATION_REQUEST'),false);
  if(memberId==='M'){f.save();assert.deepEqual(f.sent.at(-1),request());f.result(complete(request()));assert.equal(f.db.has(key),false);assert.equal(f.refreshes(),1);}
  else assert.equal(f.db.has(key),true);
 }
});
test('legacy original preparation send/result/cache and non-current photo capability remain untouched',()=>{
 const f=fixture();f.ready(false);f.open();f.save();assert.equal(f.sent.at(-1).stockProtocol,undefined);assert.equal(f.db.has('warehousePending/NCT'),true);
 f.result({ok:true});assert.equal(f.db.has('warehousePending/NCT'),false);assert.equal(f.refreshes(),1);
 const original=fs.readFileSync(path.join(__dirname,'../../warehouse-room/workroom.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'warehouse-ui/workroom.js'),'utf8');
 const start=original.indexOf('async function compress('),end=original.indexOf('function setBusy()',start);assert.equal(candidate.includes(original.slice(start,end)),true,'original compression/photo painting bytes preserved');
});
test('paired generators include current preparation transport and forward only original metadata argument',async()=>{
 for(const file of ['build-warehouse-preparation-ui.cjs','build-warehouse-current-ui.cjs','build-current-stock-ui.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
 let handler;const calls=[],room={onMessage:fn=>handler=fn,postMessage(){}},$w=()=>room;$w.onReady=fn=>fn();
 const source=fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-department-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 vm.runInNewContext(source,{$w,handlePackingList:async()=>false,saveWarehousePreparation:async(...args)=>{calls.push(copy(args));return{ok:false,pending:true};}});
 await handler({data:request()});assert.deepEqual(calls[0],['NCT',request().requestId,request().input,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:staffIds()}]);
 const html=fs.readFileSync(path.join(folder,'warehouse-ui/index.html'),'utf8');assert.match(html,/warehouse-preparation-resume.js/);assert.match(html,/workroom.js\?v=20261022-current-cbm-v1/);
 assert.match(fs.readFileSync(path.join(folder,'warehouse-ui/app.js'),'utf8'),/stockCurrent:currentWarehouse,staff:currentReceiptStaff/);
 function staffIds(){return{staffId:'W',memberId:'M'};}
});
