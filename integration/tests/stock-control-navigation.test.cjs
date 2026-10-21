const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../..');
function pane(){
 const sent=[],received=[],origin='https://example.test',parent={postMessage:m=>sent.push(m)},window={addEventListener:(type,fn)=>window.receive=fn};let frame;
 const container={replaceChildren:f=>{if(frame)frame.isConnected=false;frame=f;frame.isConnected=true;}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'warehouse-room/stock-control-link.js'),'utf8'),{window,parent,location:{origin},document:{createElement:()=>({isConnected:false,style:{},contentWindow:{postMessage:m=>received.push(m)}})}});
 const emit=(message,source=frame.contentWindow,eventOrigin=origin)=>window.receive({data:message,source,origin:eventOrigin});
 return {ui:window.warehouseStockTab,container,parent,sent,received,emit,get frame(){return frame;}};
}
test('stock belongs to a Warehouse tab and creates no separate window',()=>{
 const f=pane();f.ui.render(f.container,'GHR');assert.match(f.frame.src,/embedded=warehouse&company=GHR$/);const first=f.frame;
 f.ui.render(f.container,'GHR');assert.equal(f.frame,first);f.ui.render(f.container,'OTHER');assert.equal(f.frame,first);
 const html=fs.readFileSync(path.join(root,'warehouse-room/index.html'),'utf8');assert.match(html,/id="openStockControl" data-view="stock"/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'warehouse-room/stock-control-link.js'),'utf8'),/window\.open/);
});
test('only matching pane reads reach parent and matching results return to child',()=>{
 const f=pane();f.ui.render(f.container,'NCT');
 const request={type:'STOCK_CONTROL_READ_REQUEST',company:'NCT',requestId:'R',input:{filter:'ON_HAND'}};
 f.emit(request,{});f.emit(request,f.frame.contentWindow,'https://foreign.test');f.emit({...request,company:'GHR'});f.emit({...request,type:'STOCK_SAVE_REQUEST'});
 assert.equal(f.sent.length,0);f.emit(request);assert.equal(f.sent.length,1);
 const result={type:'STOCK_CONTROL_READ_RESULT',company:'NCT',requestId:'R',ok:true};
 f.emit({...result,requestId:'STALE'},f.parent);f.emit({...result,company:'GHR'},f.parent);assert.equal(f.received.length,0);
 f.emit(result,f.parent);assert.equal(f.received.length,1);f.emit(result,f.parent);assert.equal(f.received.length,1);
});
test('company changes and detached panes cannot receive prior stock results',()=>{
 const f=pane();f.ui.render(f.container,'NCT');const old=f.frame;
 f.emit({type:'STOCK_CONTROL_READ_REQUEST',company:'NCT',requestId:'R'});f.ui.render(f.container,'GHR');
 f.emit({type:'STOCK_CONTROL_READ_RESULT',company:'NCT',requestId:'R'},f.parent);assert.equal(f.received.length,0);
 f.emit({type:'STOCK_CONTROL_READ_REQUEST',company:'NCT',requestId:'OLD'},old.contentWindow);assert.equal(f.sent.length,1);
 f.frame.isConnected=false;f.ui.refresh();assert.equal(f.received.length,0);
});
test('pane layout is bounded and open detail blocks refresh without creating writes',()=>{
 const f=pane();f.ui.render(f.container,'NCT');f.emit({type:'STOCK_CONTROL_LAYOUT',company:'NCT',height:999999,busy:true});
 assert.equal(f.frame.style.height,'20000px');assert.equal(f.ui.isBusy(),true);f.ui.refresh();assert.equal(f.received.length,0);
 f.emit({type:'STOCK_CONTROL_LAYOUT',company:'NCT',height:1,busy:false});assert.equal(f.frame.style.height,'560px');f.ui.refresh();assert.equal(f.received[0].type,'STOCK_CONTROL_REFRESH');
 f.emit({type:'WAREHOUSE_LOGIN_REQUEST',company:'NCT'});assert.equal(f.sent[0].type,'WAREHOUSE_LOGIN_REQUEST');
});
test('new Wix entry validates company before selecting its stock iframe; requests retain existing site-member service',()=>{
 const source=fs.readFileSync(path.join(root,'integration/wix/stock-control-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 for(const [input,wanted] of [['GHR','GHR'],['NCT','NCT'],['OTHER','NCT'],[undefined,'NCT']]){
  const room={onMessage(){}},$w=()=>room;$w.onReady=fn=>fn();
  vm.runInNewContext(source,{$w,wixLocationFrontend:{query:{company:input}},authentication:{},getWarehouseStockControl(){throw Error('No business calls during entry setup.');}});
  assert.match(room.src,new RegExp('&company='+wanted+'$'));
 }
});

test('Warehouse Wix bridge adds only bounded stock reads and preserves original order routing',async()=>{
 const source=fs.readFileSync(path.join(root,'integration/wix/warehouse-department-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 let handler;const sent=[],calls=[],room={onMessage:fn=>handler=fn,postMessage:m=>sent.push(m)},$w=()=>room;$w.onReady=fn=>fn();
 vm.runInNewContext(source,{$w,handlePackingList:async()=>false,getWarehouseStockControl:async(company,input)=>{calls.push([company,input]);return {company,items:[]};},getWarehouseOrders:async company=>({company,orders:[]})});
 const message={type:'STOCK_CONTROL_READ_REQUEST',company:'GHR',requestId:'READ',input:{filter:'ON_HAND'}};
 for(const invalid of [{...message,company:'OTHER'},{...message,requestId:''},{...message,input:{search:'x'.repeat(2000)}}])await handler({data:invalid});
 assert.equal(calls.length,0);await handler({data:message});assert.equal(calls.length,1);assert.equal(sent[0].type,'STOCK_CONTROL_READ_RESULT');assert.equal(sent[0].company,'GHR');assert.equal(sent[0].ok,true);
 await handler({data:{type:'WAREHOUSE_ORDERS_REQUEST',company:'NCT',requestId:'OLD'}});assert.equal(sent[1].type,'WAREHOUSE_ORDERS_RESULT');assert.equal(sent[1].ok,true);
});
