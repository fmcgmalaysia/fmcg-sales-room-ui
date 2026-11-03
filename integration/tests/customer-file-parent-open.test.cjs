const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function fixture(room){
 const source=fs.readFileSync(path.join(root,room+'-room/wix/'+room+'-room-page.js'),'utf8').replace(/\r\n/g,'\n');
 const marker=room==='buyer'?'  let historyCustomerId':'  let currentDevice',bridge=source.slice(source.indexOf('  // Only files returned'),source.indexOf(marker));
 const frameName=room==='buyer'?'frame':'salesRoom',start=source.indexOf('  '+frameName+'.onMessage(async (event) => {'),end=room==='buyer'?source.indexOf('\n  wixRealtimeFrontend.subscribe',start):source.lastIndexOf('\n});');
 let listener,reads=0,response;const opened=[],sent=[],frame={onMessage:fn=>listener=fn,postMessage:m=>sent.push(m)};
 const read=async(customer,company,action)=>{reads++;return typeof response==='function'?response(customer,company,action):response;};
 const context={Map,console,frame,salesRoom:frame,wixLocationFrontend:{to:url=>opened.push(url)},assistCustomerId:'A',getBuyerTransactionHistory:company=>read('A',company,'HISTORY'),salesRoomShipment:read};
 vm.runInNewContext(bridge+(room==='buyer'?"let historyCustomerId='A';\n":'')+source.slice(start,end),context);
 return {opened,sent,set:result=>response=result,reads:()=>reads,send:message=>listener({data:message}),request:(company='NCT',customerId='A',requestId='r1')=>listener({data:room==='buyer'?{type:'BUYER_TRANSACTION_HISTORY_REQUEST',company,requestId}:{type:'SALES_ROOM_SHIPMENT_REQUEST',action:'HISTORY',company,customerId,requestId}})};
}
const fileId='customer-original-123',url='https://drive.google.com/file/d/'+fileId+'/view',model=(company='NCT',customerId='A')=>({company,customerId,documents:[{fileId,ready:true,url}]}),click=(extra={})=>({type:'CUSTOMER_HISTORY_FILE_OPEN',company:'NCT',customerId:'A',requestId:'r1',fileId,...extra});
for(const room of ['buyer','sales']){
 test(room+' opens the authorized original in the parent without a new CMS read',async()=>{const f=fixture(room);f.set(model());await f.request();await f.send(click());assert.deepEqual(f.opened,[url]);assert.equal(f.reads(),1);assert.equal(f.sent.length,1);});
 test(room+' rejects unknown files, customer/company changes and arbitrary URL requests',async()=>{for(const extra of [{fileId:'supplier-internal-123'},{customerId:'B'},{company:'GHR'},{requestId:'old'}]){const f=fixture(room);f.set(model());await f.request();await f.send(click(extra));assert.equal(f.opened.length,0);assert.equal(f.reads(),1);}for(const doc of [{fileId,ready:false,url:null},{fileId,ready:true,url:'https://attacker.invalid'}]){const f=fixture(room);f.set({...model(),documents:[doc]});await f.request();await f.send(click());assert.equal(f.opened.length,0);}});
 test(room+' failed refresh invalidates old authorization without reading on click',async()=>{const f=fixture(room);f.set(model());await f.request();f.set(()=>{throw Error('Unavailable');});await f.request('NCT','A','r2');await f.send(click());await f.send(click({requestId:'r2'}));assert.equal(f.opened.length,0);assert.equal(f.reads(),2);});
 test(room+' a late response cannot replace a newer history read',async()=>{const f=fixture(room);let resolve;f.set(()=>new Promise(r=>resolve=r));const old=f.request();f.set(model());await f.request('NCT','A','r2');resolve(model());await old;await f.send(click());assert.equal(f.opened.length,0);await f.send(click({requestId:'r2'}));assert.deepEqual(f.opened,[url]);});
 test(room+' preserves GHR isolation and refuses a mismatched server context',async()=>{const f=fixture(room);f.set(model('GHR'));await f.request('GHR');await f.send(click());assert.equal(f.opened.length,0);await f.send(click({company:'GHR'}));assert.deepEqual(f.opened,[url]);const bad=fixture(room);bad.set(model('NCT','B'));await bad.request();await bad.send(click());assert.equal(bad.opened.length,0);});
}
