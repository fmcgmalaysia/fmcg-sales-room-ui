const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),file='buyer-room/catalogue/wix/catalogue-page-v3.js',source=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const flush=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(staff=null){
 const ready=[],timers=[],nodes=new Map(),routes=[],calls={selection:0,rect:0,collapse:0};let read=async()=>({selectedProductIds:['A']}),rect=async()=>({scroll:{y:200}});
 const node=id=>{if(!nodes.has(id))nodes.set(id,{postMessage(){},onMessage(fn){this.message=fn;},onInput(){},expand:async()=>{},collapse:async()=>{calls.collapse++;},show(){},setPageSize(){},customClassList:{add(){}}});return nodes.get(id);};
 const w=id=>node(id);w.onReady=fn=>ready.push(fn);const storage={getItem:k=>k==='catalogueAccess'?'granted':null,setItem(){},removeItem(){}};
 const query=()=>{const q={ascending(){return q;},limit(){return q;},async find(){return{items:[],hasNext:()=>false};}};return q;};
 const api=vm.runInNewContext('(function(){'+source.replace(/^import[^\n]+\n/gm,'')+';return{setupNav};})()',{$w:w,authentication:{},wixLocationFrontend:{query:{},url:'https://example.invalid/catalogue',to:x=>routes.push(x)},local:storage,session:storage,wixWindowFrontend:{viewMode:'Site',formFactor:'Desktop',getBoundingRect:async()=>{calls.rect++;return rect();}},wixData:{query},getCurrentStaffContext:async()=>staff,getSalesRoomCustomerDetail:async()=>({customer:{customerId:'C',companyName:'Buyer'}}),getCatalogueSelectionState:async()=>{calls.selection++;return read();},setInterval:(fn,ms)=>timers.push({fn,ms}),setTimeout:()=>0,clearTimeout(){},console:{error(){},warn(){}},URL,Date,Set,Map,Promise,Number,String,Array,Object,JSON});
 return{ready,timers,node,calls,routes,api,read:fn=>{read=fn;},rect:fn=>{rect=fn;}};
}
test('slow buyer selection polling never overlaps and a completed read permits the next tick',async()=>{
 const f=fixture();await f.ready[0]();const tick=f.timers.find(t=>t.ms===15000).fn;assert.equal(f.calls.selection,1);
 const wait=deferred();f.read(()=>wait.promise);const first=tick();for(let i=0;i<20;i++)await tick();assert.equal(f.calls.selection,2);wait.resolve({selectedProductIds:['A','B']});await first;
 f.read(async()=>({selectedProductIds:['A','B']}));await tick();assert.equal(f.calls.selection,3);
});
test('selection failure retains the existing access-reset/redirect and staff preview adds no buyer timer',async()=>{
 const f=fixture();await f.ready[0]();f.read(async()=>{throw Error('Denied');});await f.timers.find(t=>t.ms===15000).fn();assert.deepEqual(f.routes,['/buyer-room']);await f.timers.find(t=>t.ms===15000).fn();assert.equal(f.calls.selection,2);
 const staff=fixture({authorized:true,staffId:'S',staffName:'Sales'});await staff.ready[0]();assert.equal(staff.timers.filter(t=>t.ms===15000).length,0);
});
test('closed menus do not request browser geometry and open-menu checks cannot overlap',async()=>{
 const f=fixture();f.api.setupNav();await flush();const tick=f.timers.find(t=>t.ms===180).fn;for(let i=0;i<20;i++)await tick();assert.equal(f.calls.rect,0);
 await f.node('#html3').message({data:{type:'catalogueMain',main:'FOOD',open:true}});await flush();const wait=deferred();f.rect(()=>wait.promise);const first=tick();for(let i=0;i<20;i++)await tick();assert.equal(f.calls.rect,1);wait.resolve({scroll:{y:200}});await first;
 f.rect(async()=>({scroll:{y:230}}));const before=f.calls.collapse;await tick();await flush();assert.equal(f.calls.collapse,before+1);await tick();assert.equal(f.calls.rect,2);
});
test('menu reopens with a fresh baseline and geometry failure releases its pending guard',async()=>{
 const f=fixture();f.api.setupNav();await flush();const tick=f.timers.find(t=>t.ms===180).fn,header=f.node('#html3');await header.message({data:{type:'catalogueMain',main:'FOOD',open:true}});await flush();
 f.rect(async()=>{throw Error('Layout unavailable');});await assert.rejects(tick(),/Layout unavailable/);f.rect(async()=>({scroll:{y:500}}));const before=f.calls.collapse;await tick();assert.equal(f.calls.collapse,before);
 await header.message({data:{type:'catalogueMain',main:'FOOD',open:false}});await flush();await tick();await header.message({data:{type:'catalogueMain',main:'FOOD',open:true}});await flush();f.rect(async()=>({scroll:{y:900}}));const closed=f.calls.collapse;await tick();assert.equal(f.calls.collapse,closed);
});
test('selection save, QD routing, product sorting and authorization blocks retain the fresh captured baseline',()=>{
 const before=cp.execFileSync('git',['show','a9019a7:'+file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
 const block=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)+start.length));
 for(const[start,end]of[['function setupCatalogueWorkspace()','function openBuyerRoom()'],['function sidebarSelectionState(','function catalogueReferenceIds('],['function sortCatalogueProducts(','async function loadCatalogueWorkspaceProducts('],['async function loadSelectionState(','$w.onReady(async () => {'],['$w.onReady(async () => {','    let selectionRefreshPending']]){
  const a=start==='$w.onReady(async () => {'?before.slice(before.indexOf(start),before.indexOf('    setInterval(async () => {',before.indexOf(start))):block(before,start,end);const b=block(source,start,end);assert.equal(b,a,start);
 }
});
