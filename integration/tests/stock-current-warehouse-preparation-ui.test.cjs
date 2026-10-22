const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process'),folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
const staff={staffId:'W',memberId:'M',staffName:'Warehouse'},key='fmcg-warehouse-preparation-v1/NCT/W/M',flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(db=new Map()){
 const sent=[],gets=[],events=[],nodes=new Map(),listeners=new Set(),timers=new Map();let failWrite=false,failRemove=false,ids=0,refreshes=0,packButton,loadButton;
 const storage={getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Unavailable');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}};
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',open:false,hidden:false,disabled:false,dataset:{},classList:{remove(){},add(){}},addEventListener(){},after(){},prepend(){},
   querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);}
 const parent={postMessage:value=>{events.push('NETWORK');sent.push(copy(value));}},window={parent,warehouseDispatch:{render(){}},addEventListener:(type,fn)=>{if(type==='message')listeners.add(fn);},removeEventListener:(_type,fn)=>listeners.delete(fn)};
 const document={body:{appendChild(){}},getElementById:node,createElement:tag=>node(tag),querySelector:node,querySelectorAll:selector=>selector==='[data-wh-pack]'?[packButton]:selector==='[data-wh-load]'?[loadButton]:[]};
 packButton={dataset:{whPack:'BATCH'}},loadButton={dataset:{whLoad:'BATCH'}};
 const context={window,parent,document,sessionStorage:storage,crypto:{randomUUID:()=> '11111111-1111-4111-8111-'+String(++ids).padStart(12,'0')},Intl,Date,Map,
  setTimeout:(fn,ms)=>{const id=++ids;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-preparation-resume.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(path.join(folder,'warehouse-ui/workroom.js'),'utf8'),context);
 const emit=(data,source=parent)=>{for(const fn of [...listeners])fn({source,data});},api=window.warehouseWorkroom,handlers={render(){},refresh(){refreshes++;}};
 const task={id:'BATCH',taskId:'TASK',version:'V1',customerId:'C',customerName:'Customer',name:'Product',barcode:'1',packing:'12',quantity:100,loaded:0,prepared:false,photos:[]};
 function ready(meta=true,generation=0){api.setData({orders:[],deliveryTasks:[copy(task)],...(meta?{stockCurrent:{schema:'CURRENT_WAREHOUSE_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:generation,generation},staff}:{})},'NCT',handlers);api.hydrate();}
 return{db,sent,gets,events,timers,node,emit,api,helper:window.warehouseCurrentPreparation,handlers,task,ready,
  open:(action='PACK')=>(action==='PACK'?packButton:loadButton).onclick(),save:()=>node('whSave').onclick(),
  failWrite:()=>{failWrite=true;},failRemove:()=>{failRemove=true;},refreshes:()=>refreshes,
  result:(result,extra={})=>{const request=sent.filter(row=>row.type==='WAREHOUSE_PREPARATION_REQUEST').at(-1);emit({type:'WAREHOUSE_PREPARATION_RESULT',company:'NCT',requestId:request.requestId,ok:true,result,...extra});}};
}
const request=()=>({type:'WAREHOUSE_PREPARATION_REQUEST',company:'NCT',requestId:'22222222-2222-4222-8222-222222222222',input:{action:'PACK',id:'BATCH',version:'V1',note:'',loaded:0,photos:[],photoStage:'PACKING'},stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'W',memberId:'M'}});
const complete=original=>({ok:true,requestId:original.requestId,company:'NCT',id:'BATCH',savedAt:'2026-10-22T10:00:00Z',stockGeneration:1});
test('preparation own-session cache retains exact original before send and refuses replacement, files, changed actor and failed durable writes',()=>{
 const f=fixture(),original=request();f.helper.retain(original,staff);assert.deepEqual(copy(f.helper.pending('NCT',staff)),original);
 assert.throws(()=>f.helper.retain({...original,requestId:'33333333-3333-4333-8333-333333333333'},staff),/Another/);
 assert.throws(()=>f.helper.retain(original,{...staff,memberId:'OTHER'}),/session changed/);
 assert.throws(()=>f.helper.retain({...original,input:{...original.input,photos:[{base64:'x'}]}},staff),/non-file/);
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
test('original LOAD reason/whole-carton checks remain and current PHOTOS blocks before pending/cache/network',()=>{
 const f=fixture();f.ready();f.open('LOAD');f.node('whLoaded').value='40';f.save();assert.equal(f.sent.length,0);assert.match(f.node('whError').textContent,/reason/);
 f.node('whNote').value='Container full';f.save();assert.equal(f.sent.at(-1).input.loaded,40);assert.equal(f.sent.at(-1).input.action,'LOAD');assert.equal(f.sent.at(-1).input.photoStage,'LOADING');
 const invalid=fixture();invalid.ready();invalid.open('LOAD');invalid.node('whLoaded').value='4.5';invalid.node('whNote').value='Reason';invalid.save();assert.equal(invalid.sent.length,0);
 const photos=fixture();photos.task.prepared=true;photos.ready();photos.open();photos.save();assert.equal(photos.sent.length,0);assert.equal(photos.db.size,0);assert.match(photos.node('whError').textContent,/No save was sent/);
});
test('reload behind stock barrier authenticates before exact own-cache lookup and explicit replay; other member never sees original cache',async()=>{
 for(const memberId of ['M','OTHER']){
  const f=fixture(new Map([[key,JSON.stringify(request())]]));assert.equal(f.gets.length,0);f.api.recoverCurrent('NCT',f.handlers);const auth=f.sent.at(-1);assert.equal(auth.type,'WAREHOUSE_RESUME_CONTEXT_REQUEST');assert.equal(f.gets.length,0);
  f.emit({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,result:{ok:true,schema:'WAREHOUSE_RESUME_CONTEXT_V1',company:'NCT',staff:{...staff,memberId}}});await flush();
  assert.equal(f.gets.every(id=>id===key.replace('/M','/'+memberId)),true);assert.equal(f.sent.some(row=>row.type==='WAREHOUSE_PREPARATION_REQUEST'),false);
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
test('paired generators include current preparation transport without modifying CBM and forward only original metadata argument',async()=>{
 for(const file of ['build-warehouse-preparation-ui.cjs','build-warehouse-current-ui.cjs','build-current-stock-ui.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
 let handler;const calls=[],room={onMessage:fn=>handler=fn,postMessage(){}},$w=()=>room;$w.onReady=fn=>fn();
 const source=fs.readFileSync(path.join(folder,'warehouse-ui/warehouse-department-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 vm.runInNewContext(source,{$w,handlePackingList:async()=>false,saveWarehousePreparation:async(...args)=>{calls.push(copy(args));return{ok:false,pending:true};}});
 await handler({data:request()});assert.deepEqual(calls[0],['NCT',request().requestId,request().input,{stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:staffIds()}]);
 const html=fs.readFileSync(path.join(folder,'warehouse-ui/index.html'),'utf8');assert.match(html,/warehouse-preparation-resume.js/);assert.match(html,/workroom.js\?v=20261022-current-preparation-v1/);
 assert.match(fs.readFileSync(path.join(folder,'warehouse-ui/app.js'),'utf8'),/stockCurrent:currentWarehouse,staff:currentReceiptStaff/);
 function staffIds(){return{staffId:'W',memberId:'M'};}
});
