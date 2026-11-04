const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\r?\n/gm,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function pageFixture(){
 let ready,handler,failRead=false,popupThrow=false;const submission=deferred(),popup=deferred(),posted=[],calls=[],dialogs=[],errors=[];
 const button={disable(){},hide(){},show(){},enable(){},onClick(){}},frame={postMessage:m=>posted.push(m),onMessage:fn=>handler=fn};
 const $w=id=>id==='#html1'?frame:button;$w.onReady=fn=>ready=fn;
 const context={$w,console:{error:(...args)=>errors.push(args),warn(){}},Date,Promise,URL,encodeURIComponent,setTimeout(){},setInterval(){},session:{setItem(){}},
  wixLocationFrontend:{query:{assist:'CUS-TEST'},baseUrl:'https://example.test/',to(){}},wixRealtimeFrontend:{subscribe:()=>Promise.resolve()},
  wixWindowFrontend:{rendering:{env:'browser'},openLightbox:(...args)=>{dialogs.push(args);if(popupThrow)throw Error('Popup unavailable');return popup.promise}},
  getBuyerWorkspace:async()=>{if(failRead)throw Error('Read unavailable');return {ok:true,context:{customerId:'CUS-TEST',status:'ACTIVE'},myList:[]}},
  createBuyerSelectionDownload:async()=>({ok:true,url:'https://example.test/selection.xlsx',expiresAt:Date.now()+3600000}),
  submitBuyerOrder:(...args)=>{calls.push(args);return submission.promise}};
 vm.runInNewContext(source('buyer-room/wix/buyer-room-page.js'),context);
 return {ready:()=>ready(),send:(data={type:'BUYER_ROOM_SUBMIT_ORDER',lines:[{itemId:'a',quantityCtn:100}],requestId:'same-request',customerPoNumber:'CUSTOMER-PO'})=>handler({data}),submission,popup,posted,calls,dialogs,errors,setReadFailure:v=>failRead=v,setPopupFailure:v=>popupThrow=v};
}
test('confirmed order acknowledges and opens its existing popup without waiting for Excel or popup closure',async()=>{
 const f=pageFixture();await f.ready();const sending=f.send();await flush();assert.equal(f.posted.filter(m=>m.type==='BUYER_ROOM_ORDER_RESULT').length,0);
 f.submission.resolve({ok:true,orderId:'ORD-1',warning:'Keep original warning'});await sending;await flush();
 assert.deepEqual(f.calls[0].slice(1),['CUS-TEST','same-request','CUSTOMER-PO']);assert.equal(f.calls.length,1);
 const receipts=f.posted.filter(m=>m.type==='BUYER_ROOM_ORDER_RESULT');assert.equal(receipts.length,1);assert.equal(receipts[0].ok,true);assert.equal(receipts[0].message,'Keep original warning');
 assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0][0],'Order Received');assert.deepEqual(JSON.parse(JSON.stringify(f.dialogs[0][1])),{orderId:'ORD-1',assistCustomerId:'CUS-TEST',buyerRoomUrl:'https://example.test/buyer-room'});
 assert.equal(f.posted.some(m=>m.type==='BUYER_ROOM_DOWNLOAD_ORDER_EXCEL'),false);
});
test('failed or unconfirmed submission keeps one failure receipt and never opens the success popup',async()=>{
 for(const mode of ['reject','invalid']){const f=pageFixture();await f.ready();const sending=f.send();mode==='reject'?f.submission.reject(Error('Save not confirmed')):f.submission.resolve({ok:false,message:'Save not confirmed'});await sending;await flush();
 const receipts=f.posted.filter(m=>m.type==='BUYER_ROOM_ORDER_RESULT');assert.equal(receipts.length,1);assert.equal(receipts[0].ok,false);assert.equal(f.dialogs.length,0)}
});
test('readback failure after confirmation cannot become a failed order or repeat submission',async()=>{
 const f=pageFixture();await f.ready();f.setReadFailure(true);const sending=f.send();f.submission.resolve({ok:true,orderId:'ORD-1'});await sending;await flush();
 assert.deepEqual(f.posted.filter(m=>m.type==='BUYER_ROOM_ORDER_RESULT').map(m=>m.ok),[true]);assert.equal(f.calls.length,1);assert(f.errors.some(args=>args[0]==='Order confirmed; workspace readback failed'));
 f.setReadFailure(false);await f.send({type:'BUYER_ROOM_REQUEST_DATA'});assert.equal(f.calls.length,1);assert.equal(f.posted.at(-1).type,'BUYER_ROOM_DATA');
});
test('popup failure is separate from an already confirmed order',async()=>{
 const f=pageFixture();await f.ready();f.setPopupFailure(true);const sending=f.send();f.submission.resolve({ok:true,orderId:'ORD-1'});await sending;await flush();
 assert.deepEqual(f.posted.filter(m=>m.type==='BUYER_ROOM_ORDER_RESULT').map(m=>m.ok),[true]);assert(f.errors.some(args=>args[0].includes('lightbox could not be opened')));
});
test('popup close does not download; a result from another order cannot deliver a file',async()=>{
 for(const result of [undefined,{action:'download',orderId:'OTHER',fileName:'x.xlsx',base64:'eA=='},{action:'download',orderId:'ORD-1',fileName:'',base64:'eA=='}]){
  const f=pageFixture();await f.ready();const sending=f.send();f.submission.resolve({ok:true,orderId:'ORD-1'});await sending;await flush();f.popup.resolve(result);await flush();
  assert.equal(f.posted.some(m=>m.type==='BUYER_ROOM_DOWNLOAD_ORDER_EXCEL'),false);assert.equal(f.calls.length,1);
 }
});
test('the original Buyer downloader receives the same file bytes once from the matching popup',async()=>{
 const f=pageFixture();await f.ready();const sending=f.send();f.submission.resolve({ok:true,orderId:'ORD-1'});await sending;await flush();f.popup.resolve({action:'download',orderId:'ORD-1',fileName:'order.xlsx',base64:'eA=='});await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(f.posted.filter(m=>m.type==='BUYER_ROOM_DOWNLOAD_ORDER_EXCEL'))),[{type:'BUYER_ROOM_DOWNLOAD_ORDER_EXCEL',fileName:'order.xlsx',base64:'eA=='}]);assert.equal(f.calls.length,1);
});
function popupFixture(context={orderId:'ORD-1',assistCustomerId:'CUS-TEST',buyerRoomUrl:'https://example.test/buyer-room'}){
 let ready,click,closeClick;const downloads=[],closes=[],errors=[];const button={disabled:true,label:'',enable(){this.disabled=false},disable(){this.disabled=true},onClick:fn=>click=fn};
 const close={hide(){},onClick:fn=>closeClick=fn},$w=id=>id==='#closeButton'?close:button;$w.onReady=fn=>ready=fn;
 vm.runInNewContext(source('buyer-room/wix/order-received-lightbox.js'),{$w,console:{error:(...args)=>errors.push(args)},wixWindowFrontend:{lightbox:{getContext:()=>context,close:data=>closes.push(data)}},createBuyerOrderDownload:(...args)=>{const d=deferred();downloads.push({...d,args});return d.promise}});
 return {ready:()=>ready(),click:()=>click(),close:()=>closeClick(),button,downloads,closes,errors};
}
test('Excel is created only on click and a slow preparation cannot start duplicate downloads',async()=>{
 const f=popupFixture();f.ready();assert.equal(f.downloads.length,0);assert.equal(f.button.label,'Download Order Excel');assert.equal(f.button.disabled,false);
 const preparing=f.click();await f.click();assert.equal(f.downloads.length,1);assert.equal(f.button.disabled,true);assert.equal(f.button.label,'Preparing Download…');assert.equal(f.closes.length,0);
 assert.deepEqual(f.downloads[0].args,['ORD-1','CUS-TEST','https://example.test/buyer-room']);f.downloads[0].resolve({ok:true,orderId:'ORD-1',fileName:'order.xlsx',base64:'eA=='});await preparing;
 assert.deepEqual(JSON.parse(JSON.stringify(f.closes)),[{action:'download',orderId:'ORD-1',fileName:'order.xlsx',base64:'eA=='}]);
});
test('Excel failure permits retry in the same popup without invoking order submission',async()=>{
 const f=popupFixture();f.ready();const first=f.click();f.downloads[0].reject(Error('Excel unavailable'));await first;
 assert.equal(f.button.label,'Retry Excel Download');assert.equal(f.button.disabled,false);assert.equal(f.closes.length,0);
 const retry=f.click();assert.equal(f.downloads.length,2);f.downloads[1].resolve({ok:true,orderId:'ORD-1',fileName:'order.xlsx',base64:'eA=='});await retry;assert.equal(f.closes.length,1);
});
test('missing or mismatched Excel identity does not close the confirmed-order popup',async()=>{
 for(const result of [{ok:true,orderId:'OTHER',fileName:'x.xlsx',base64:'eA=='},{ok:true,orderId:'ORD-1',fileName:'x.xlsx',base64:''},undefined]){
  const f=popupFixture();f.ready();const click=f.click();f.downloads[0].resolve(result);await click;assert.equal(f.closes.length,0);assert.equal(f.button.label,'Retry Excel Download');
 }
});
test('closing without downloading performs no Excel work; missing order context remains disabled',()=>{
 const f=popupFixture();f.ready();f.close();assert.equal(f.downloads.length,0);assert.equal(f.closes.length,1);
 const missing=popupFixture({});missing.ready();assert.equal(missing.button.disabled,true);assert.equal(missing.button.label,'Excel Unavailable');assert.equal(missing.downloads.length,0);
});
