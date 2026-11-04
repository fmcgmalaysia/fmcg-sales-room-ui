const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const meta={schema:'CURRENT_STOCK_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:3,stockIdentity:{staffId:'S',memberId:'SOURCE_SALES/S'}};
const order={orderId:'O',customerId:'C',companyName:'Customer',destination:'NCT',submittedAt:'2026-10-20',customerPoNumber:'PO',revision:4,estimatedShipmentDate:'2026-10-20',shipmentDateRevision:'BEFORE',shipmentDateLocked:false,masterReceipt:{submissionId:'SUB'},lines:[{lineId:'L',barcode:'1',quantityCtn:10,unitPrice:2}]};
function fixture(db=new Map()){
 const nodes=new Map(),sent=[],events=[],listeners=new Map(),timers=new Map(),gets=[];let ids=0,failWrite=false,failRemove=false,refresh=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',disabled:false,hidden:false,readOnly:false,textContent:'',dataset:{},classList:{toggle(){},contains(){return false;}},focus(){},blur(){},checkValidity:()=>true,
  querySelectorAll:()=>[...nodes.values()],set innerHTML(value){this.html=value;for(const match of value.matchAll(/id="([^"]+)"[^>]*?(?:value="([^"]*)")?[^>]*>/g)){const child=node(match[1]),tag=match[0],value=/value="([^"]*)"/.exec(tag);if(value)child.value=value[1];}},get innerHTML(){return this.html||'';}});return nodes.get(id);};
 const parent={postMessage:request=>{events.push(request.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'?'SAVE':'READ');sent.push(copy(request));}};
 const window={parent,addEventListener:(kind,handler)=>{if(!listeners.has(kind))listeners.set(kind,new Set());listeners.get(kind).add(handler);}};
 const context={window,parent,document:{getElementById:node,querySelectorAll:()=>[]},crypto:{randomUUID:()=>String(++ids).padStart(8,'0')+'-1111-4111-8111-111111111111'},
  sessionStorage:{getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Cache unavailable');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}},
  setTimeout:(fn,ms)=>{const id=++ids;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  pendingSalesPlanning:null,pendingSalesPoEdit:null,pendingSalesQtyEdit:null,pendingNctSubmit:null,lastSalesQtyFeedback:null,salesProgressCustomerId:'C',salesProgressOrderId:'',salesProgressPayload:{},
  esc:value=>String(value??''),salesEditIcon:()=>'',salesShipmentStamp:()=>'',salesProgressTime:()=>'',salesProgressMoney:value=>String(value),salesQuantityCell:()=>'',wireSalesOrderQuantity(){},
  salesNavigationAllowed:()=>true,requestSalesOrderProgress:()=>refresh++,renderSalesOrderProgress(){},salesQtyBusy(){},showView:()=>{context.pendingSalesPoEdit=null;},
 };
 for(const name of ['source-sales-current-requests.js','source-sales-dates.js'])vm.runInNewContext(fs.readFileSync(path.join(folder,name),'utf8'),context);
 const html=fs.readFileSync(path.join(folder,'source-ui/index.html'),'utf8').split('\n');
 for(const prefix of ['function salesShipmentEditable(','function salesPlanningEditable(','function wireSalesPlanning(','function wireSalesReviewPlanning(','function renderOrderDetail(']){
  const line=html.find(line=>line.startsWith(prefix));assert.ok(line,prefix);vm.runInNewContext(line,context);
 }
 for(const needle of ["message.requestId!==pendingSalesPlanning.requestId",'pending?.reviewPlanning']){const line=html.find(line=>line.startsWith("window.addEventListener('message'")&&line.includes(needle));assert.ok(line,needle);vm.runInNewContext(line,context);}
 function replyRead(result,extra={}){const request=sent.at(-1);for(const handler of [...listeners.get('message')])handler({source:parent,data:{type:'SALES_ROOM_SHIPMENT_RESULT',requestId:request.requestId,company:request.company,ok:true,result,...extra}});}
 function replyDate(result,request=sent.findLast(request=>request.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'),source=parent){for(const handler of [...listeners.get('message')])handler({source,data:{type:'SALES_ROOM_ORDER_PLANNING_RESULT',requestId:request.requestId,...result}});}
 function start(scope='PROGRESS',selected=order){
  if(scope==='PROGRESS'){context.wireSalesPlanning(selected,selected);node('editSalesShipment').onclick();node('salesPlanningDate').value='2026-11-01';node('salesPlanningDate').oninput();node('saveSalesPlanning').onclick();}
  else{context.renderOrderDetail(copy(selected));node('salesReviewShipment').value='2026-11-01';node('salesReviewShipment').oninput();node('saveReviewPlanning').onclick();}
 }
 const success=request=>({ok:true,company:request.company,orderId:request.orderId,stockGeneration:4,shipmentDateRevision:'SAVED',message:'Shipment date saved.'});
 return{window,parent,context,node,sent,events,db,gets,timers,listeners,start,replyRead,replyDate,success,refresh:()=>refresh,failWrite:()=>failWrite=true,failRemove:()=>failRemove=true,allowRemove:()=>failRemove=false};
}
function resume(f,customerId='C',staffId='S'){assert.deepEqual(f.sent.at(-1).input,{resume:'SOURCE_SALES_V1'});f.replyRead({ok:true,schema:'SOURCE_SALES_RESUME_V1',company:'NCT',customerId,staff:{staffId,memberId:'SOURCE_SALES/'+staffId}});}
test('actual original progress and review Save obtain authorized metadata, retain original full request before write, and finish through original result handlers',async()=>{
 for(const scope of ['PROGRESS','REVIEW']){const f=fixture();f.start(scope);assert.equal(f.sent.length,1);assert.equal(f.sent[0].action,'READ');assert.equal(f.db.size,0);
  f.replyRead({company:'NCT',stockCurrent:meta});await tick();assert.deepEqual(f.events,['READ','CACHE','SAVE']);const request=f.sent.at(-1);assert.deepEqual(request.stockCurrent,meta);assert.equal(request.orderId,'O');assert.equal(request.expectedRevision,4);assert.equal(request.expectedShipmentRevision,'BEFORE');assert.equal(request.estimatedShipmentDate,'2026-11-01');
  const entry=JSON.parse([...f.db.values()][0]);assert.deepEqual(entry.request,request);assert.deepEqual(entry.ui.order,order);assert.equal(entry.ui.scope,scope);
  f.replyDate(f.success(request));assert.equal(f.db.size,0);assert.equal(f.context[scope==='PROGRESS'?'pendingSalesPlanning':'pendingSalesPoEdit'].refreshRequired,true);assert.equal(f.node(scope==='PROGRESS'?'saveSalesPlanning':'saveReviewPlanning').textContent,scope==='PROGRESS'?'Save':'Save 保存');
 }
});
test('bounded date phases preserve same UUID and all original inputs; unknown/wrong final cannot unlock editing or replace cache',async()=>{
 const f=fixture();f.start();f.replyRead({company:'NCT',stockCurrent:meta});await tick();const request=copy(f.sent.at(-1)),old=[...f.timers.values()].find(timer=>timer.ms===30000).fn;
 for(const phase of ['BEFORE','APPLY','VERIFY']){f.replyDate({ok:false,pending:true,company:'NCT',orderId:'O',phase,completedCount:1,totalRecords:2},request);old();assert.equal(f.node('salesPlanningDate').disabled,true);
  const continuation=[...f.timers.entries()].find(([,timer])=>timer.ms===250);assert.ok(continuation);f.timers.delete(continuation[0]);continuation[1].fn();assert.deepEqual(f.sent.at(-1),request);}
 for(const result of [{},{...f.success(request),company:'GHR'},{...f.success(request),orderId:'OTHER'},{...f.success(request),stockGeneration:3},{ok:false,error:'Inventory changed'}]){
  f.replyDate(result,request);assert.equal(f.db.size,1);assert.equal(f.node('salesPlanningDate').disabled,true);assert.equal(f.node('cancelSalesPlanning').disabled,true);f.node('saveSalesPlanning').onclick();assert.deepEqual(f.sent.at(-1),request);
 }
 f.failRemove();f.replyDate(f.success(request),request);assert.equal(f.db.size,1);f.allowRemove();f.node('saveSalesPlanning').onclick();f.replyDate(f.success(request),request);assert.equal(f.db.size,0);
});
test('cache failure sends no date write, invalid metadata or foreign event cannot impersonate current final',async()=>{
 const f=fixture();f.failWrite();f.start();f.replyRead({company:'NCT',stockCurrent:meta});await tick();assert.equal(f.sent.filter(request=>request.type==='SALES_ROOM_ORDER_PLANNING_UPDATE').length,0);assert.equal(f.db.size,0);assert.match(f.node('salesPlanningStatus').textContent,/Cache unavailable/);
 const g=fixture();g.start('REVIEW');g.replyRead({company:'NCT',stockCurrent:meta});await tick();const request=g.sent.at(-1);g.replyDate(g.success(request),request,{});assert.equal(g.db.size,1);assert.equal(g.context.pendingSalesPoEdit.saving,true);
});
test('date reload reauthorizes cached customer then restores existing original Review read-only with explicit exact retry',async()=>{
 for(const scope of ['PROGRESS','REVIEW']){const first=fixture();first.start(scope);first.replyRead({company:'NCT',stockCurrent:meta});await tick();const request=copy(first.sent.at(-1));
  const f=fixture(first.db);f.start('REVIEW',{...order,orderId:'OTHER',customerId:'OTHER'});f.replyRead({company:'NCT',stockCurrent:meta});await tick();assert.equal(f.sent.at(-1).customerId,'C');resume(f);await tick();
  assert.equal(f.sent.filter(value=>value.type==='SALES_ROOM_ORDER_PLANNING_UPDATE').length,0);assert.equal(f.node('salesReviewShipment').value,'2026-11-01');assert.equal(f.node('salesReviewShipment').disabled,true);assert.equal(f.context.pendingSalesPoEdit.orderId,'O');
  f.node('saveReviewPlanning').onclick();assert.deepEqual(f.sent.at(-1),request);f.replyDate(f.success(request),request);assert.equal(f.db.size,0);assert.equal(f.context.pendingSalesPoEdit.refreshRequired,true);
 }
});
test('pending current READ recovers original owned date without a new save, not another employee cache',async()=>{
 const first=fixture();first.start();first.replyRead({company:'NCT',stockCurrent:meta});await tick();const request=copy(first.sent.at(-1)),f=fixture(first.db);
 f.start();f.replyRead(null,{ok:false,error:'Inventory pending'});await tick();assert.equal(f.gets.length,0);resume(f);await tick();resume(f);await tick();f.node('saveReviewPlanning').onclick();assert.deepEqual(f.sent.at(-1),request);
 const other=fixture(first.db);other.start();other.replyRead(null,{ok:false,error:'Inventory pending'});await tick();resume(other,'C','OTHER');await tick();assert.equal(other.gets.some(key=>key.includes('/S/')),false);assert.equal(other.sent.some(value=>value.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'),false);assert.equal(other.db.size,1);
});
test('late phase timer and refresh cannot wipe pending original date or send a new post-commit request',async()=>{
 const f=fixture();f.start('REVIEW');f.replyRead({company:'NCT',stockCurrent:meta});await tick();const request=f.sent.at(-1);
 f.context.renderOrderDetail({...order,orderId:'OTHER'});assert.equal(f.context.pendingSalesPoEdit.orderId,'O');
 f.replyDate({ok:false,pending:true,company:'NCT',orderId:'O',phase:'APPLY',completedCount:1,totalRecords:2},request);const old=[...f.timers.values()].find(timer=>timer.ms===250).fn;
 f.replyDate(f.success(request),request);const length=f.sent.length;old();assert.equal(f.sent.length,length);assert.equal(f.db.size,0);
});
test('original pre-transfer form sends unchanged message and routed LEGACY form remains original after read without current metadata',async()=>{
 const f=fixture();f.start('REVIEW',{...order,destination:'',submittedAt:'',status:'CONFIRMED'});assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'SALES_ROOM_ORDER_PLANNING_UPDATE');assert.equal(f.sent[0].stockCurrent,undefined);assert.equal(f.db.size,0);
 const g=fixture();g.start();g.replyRead({company:'NCT',lines:[],plans:[]});await tick();assert.equal(g.sent.at(-1).type,'SALES_ROOM_ORDER_PLANNING_UPDATE');assert.equal(g.sent.at(-1).stockCurrent,undefined);assert.equal(g.db.size,0);
});
test('date shares the employee/company cache with other Sales widgets and routes original owner, not a competing new save',async()=>{
 const f=fixture(),request={type:'SALES_ROOM_SHIPMENT_REQUEST',company:'NCT',customerId:'C',requestId:'11111111-1111-4111-8111-111111111111',action:'ADJUST',input:{orderId:'O',taskId:'T',mode:'SPLIT',quantity:4,version:'ADJ',stockCurrent:meta}};
 f.window.sourceSalesCurrent.retain(request,{kind:'ADJUST',selection:{company:'NCT',customerId:'C',orderId:'O',lineId:'L',quantity:10},data:{line:{taskId:'T',requested:10},quantity:10,version:'ADJ',stockCurrent:meta},mode:'SPLIT'});
 let restored;f.window.sourceSalesCurrent.register('ADJUST',entry=>restored=copy(entry));f.start();f.replyRead({company:'NCT',stockCurrent:meta});await tick();resume(f);await tick();
 assert.deepEqual(restored.request,request);assert.equal(f.sent.some(value=>value.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'),false);assert.equal(f.context.pendingSalesPlanning,null);assert.equal(f.db.size,1);
});
test('own date can be recovered from another widget after fresh authorization, with no date send until explicit retry',async()=>{
 const first=fixture();first.start();first.replyRead({company:'NCT',stockCurrent:meta});await tick();const request=copy(first.sent.at(-1)),f=fixture(first.db);
 const recovery=f.window.sourceSalesCurrent.recover('NCT','OTHER');resume(f,'OTHER');await tick();assert.equal(f.sent.at(-1).customerId,'C');resume(f);const entry=await recovery;
 f.window.sourceSalesCurrent.restore(entry);assert.equal(f.sent.some(value=>value.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'),false);
 assert.equal(f.node('salesReviewShipment').value,'2026-11-01');f.node('saveReviewPlanning').onclick();assert.deepEqual(f.sent.at(-1),request);
});
test('bad current READ metadata and cached customer authorization mismatch cannot send date or remove retained original request',async()=>{
 const bad=fixture();bad.start();bad.replyRead({company:'NCT',stockCurrent:{...meta,stockGeneration:-1}});await tick();resume(bad);await tick();assert.equal(bad.sent.some(value=>value.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'),false);assert.match(bad.node('salesPlanningStatus').textContent,/version required/);
 const first=fixture();first.start();first.replyRead({company:'NCT',stockCurrent:meta});await tick();const f=fixture(first.db);f.start();f.replyRead({company:'NCT',stockCurrent:meta});await tick();resume(f,'FOREIGN');await tick();
 assert.equal(f.sent.some(value=>value.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'),false);assert.equal(f.db.size,1);assert.match(f.node('salesPlanningStatus').textContent,/identity unconfirmed/);
});
