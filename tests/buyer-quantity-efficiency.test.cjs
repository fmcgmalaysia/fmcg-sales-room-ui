const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../buyer-room/wix/buyer-room-page.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let ready,message,reads=0,exports=0;const writes=new Map(),posted=[],readQueue=[],errors=[];
 let items=[{id:'a',orderQtyCtn:0,qtyEditedAt:'',qtyEditedBy:'',updatedAt:'old',lastEditedBy:'Tester',itemName:'A',vipPriceEa:2,quoteStatus:'VIEW QUOTE',imageUrl:'image'}];
 const button={disable(){},hide(){},show(){},enable(){},onClick(){}};
 const frame={onMessage(fn){message=fn},postMessage(m){posted.push(m)}};
 const $w=id=>id==='#html1'?frame:button;$w.onReady=fn=>ready=fn;
 const context={$w,console:{error(...args){errors.push(args)},warn(){}},URL,Date,encodeURIComponent,setInterval(){},setTimeout(){},session:{setItem(){}},
 wixLocationFrontend:{query:{assist:'CUS-T'},baseUrl:'https://example.test',to(){}},wixWindowFrontend:{rendering:{env:'browser'}},wixRealtimeFrontend:{subscribe:()=>Promise.resolve()},
 getBuyerWorkspace:async()=>{reads++;const queued=readQueue.shift();if(queued)return queued.promise;return {ok:true,context:{customerId:'CUS-T',status:'ACTIVE'},myList:structuredClone(items)}},
 createBuyerSelectionDownload:async()=>{exports++;return {ok:true,url:'https://example.test/file.xlsx',expiresAt:Date.now()+3600000}},
 saveBuyerQuantity:(id,qty)=>{const d=deferred();writes.set(id,{...d,qty});return d.promise}};
 vm.runInNewContext(source,context);
 return {ready:()=>ready(),send:data=>message({data}),posted,writes,readQueue,errors,button,counts:()=>({reads,exports}),setItems:rows=>items=rows,
 complete:(id,ok=true)=>{const w=writes.get(id);if(ok)w.resolve({ok:true,itemId:id,quantityCtn:w.qty,qtyEditedAt:'new',qtyEditedBy:'Tester'});else w.reject(Error('Save failed'))}};
}
test('overlapping saves acknowledge each row and share one fresh workspace read',async()=>{
 const f=fixture();await f.ready();await flush();const before=f.counts();
 const a=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'a',quantityCtn:100});
 const b=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'b',quantityCtn:100});
 f.complete('b');await b;assert.equal(f.counts().reads,before.reads);
 f.complete('a');await a;assert.equal(f.counts().reads,before.reads+1);
 assert.deepEqual(f.posted.filter(m=>m.action==='quantity').map(m=>[m.itemId,m.ok]),[['b',true],['a',true]]);
});
test('write during a pending periodic read suppresses stale data and forces a new read',async()=>{
 const f=fixture();await f.ready();await flush();const old=deferred();f.readQueue.push(old);
 const reading=f.send({type:'BUYER_ROOM_REQUEST_DATA'});const count=f.posted.filter(m=>m.type==='BUYER_ROOM_DATA').length;
 const saving=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'a',quantityCtn:100});f.complete('a');await flush();
 f.setItems([{id:'a',orderQtyCtn:100}]);old.resolve({ok:true,context:{customerId:'CUS-T',status:'ACTIVE'},myList:[{id:'a',orderQtyCtn:0}]});
 await Promise.all([reading,saving]);const data=f.posted.filter(m=>m.type==='BUYER_ROOM_DATA').slice(count);
 assert.equal(data.length,1);assert.equal(data[0].data.myList[0].orderQtyCtn,100);
});
test('a later write during readback gets one follow-up instead of disappearing in a coalesced request',async()=>{
 const f=fixture();await f.ready();await flush();const read=deferred();f.readQueue.push(read);const before=f.counts().reads;
 const a=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'a',quantityCtn:100});f.complete('a');await flush();
 const b=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'b',quantityCtn:200});f.complete('b');await flush();
 f.setItems([{id:'a',orderQtyCtn:100},{id:'b',orderQtyCtn:200}]);read.resolve({ok:true,context:{customerId:'CUS-T',status:'ACTIVE'},myList:[]});
 await Promise.all([a,b]);assert.equal(f.counts().reads,before+2);
 assert.equal(f.posted.filter(m=>m.type==='BUYER_ROOM_DATA').at(-1).data.myList[1].orderQtyCtn,200);
});
test('readback failure after success does not fabricate a failed quantity save; next refresh recovers',async()=>{
 const f=fixture();await f.ready();await flush();const d=deferred();f.readQueue.push(d);
 const a=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'a',quantityCtn:100});f.complete('a');await flush();d.reject(Error('Read timed out'));await a;
 assert.deepEqual(f.posted.filter(m=>m.action==='quantity').map(m=>m.ok),[true]);assert.equal(f.errors.length,1);
 await f.send({type:'BUYER_ROOM_REQUEST_DATA'});assert.equal(f.posted.at(-1).type,'BUYER_ROOM_DATA');
});
test('failed save preserves its failure receipt without an unnecessary read, and other successful rows still read back',async()=>{
 const f=fixture();await f.ready();await flush();const before=f.counts().reads;
 const a=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'a',quantityCtn:100});f.complete('a',false);await a;
 assert.equal(f.counts().reads,before);assert.equal(f.posted.at(-1).ok,false);
 const b=f.send({type:'BUYER_ROOM_SAVE_QTY',itemId:'b',quantityCtn:100});f.complete('b');await b;assert.equal(f.counts().reads,before+1);
});
test('quantity/audit edits reuse selection export; quote, product and membership changes invalidate it',async()=>{
 const f=fixture();await f.ready();await flush();assert.equal(f.counts().exports,1);
 const base={id:'a',orderQtyCtn:100,qtyEditedAt:'new',qtyEditedBy:'Another',updatedAt:'new',lastEditedBy:'Another',itemName:'A',vipPriceEa:2,quoteStatus:'VIEW QUOTE',imageUrl:'image'};
 f.setItems([base]);await f.send({type:'BUYER_ROOM_REQUEST_DATA'});await flush();assert.equal(f.counts().exports,1);
 f.setItems([{...base,vipPriceEa:3}]);await f.send({type:'BUYER_ROOM_REQUEST_DATA'});await flush();assert.equal(f.counts().exports,2);
 f.setItems([{...base,imageUrl:'new-image'}]);await f.send({type:'BUYER_ROOM_REQUEST_DATA'});await flush();assert.equal(f.counts().exports,3);
 f.setItems([{...base},{id:'b'}]);await f.send({type:'BUYER_ROOM_REQUEST_DATA'});await flush();assert.equal(f.counts().exports,4);
});
