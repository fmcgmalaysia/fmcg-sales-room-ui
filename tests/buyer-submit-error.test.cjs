const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','buyer-room.html'),'utf8').replace(/\r\n/g,'\n');
function fixture(){
  const elements=new Map(),posted=[],notifications=[],toasts=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',disabled:false,focused:false,classList:{add(){},remove(){}},focus(){this.focused=true}});return elements.get(id)};
  const state={orderSubmitting:true,pendingOrder:[{itemId:'demo',quantityCtn:150}],orderAttempt:{signature:'same',requestId:'original-request'},quantityDrafts:new Map([['demo',{value:'150'}]])};
  const context={state,$:element,String,post:(...args)=>posted.push(args),quantityEditsBlocked:()=>false,showOrderWait(){},hideOrderWait(){},addOrderNotification:id=>notifications.push(id),toast:msg=>toasts.push(msg)};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function clearOrderSubmitError('),html.indexOf('function openOrderReview(')),context);
  const result=html.slice(html.indexOf("  if(m.type==='BUYER_ROOM_ORDER_RESULT'){"),html.indexOf("\n});\npost('BUYER_ROOM_READY'",html.indexOf("  if(m.type==='BUYER_ROOM_ORDER_RESULT'){")));
  const confirm=html.slice(html.indexOf("$('confirmSubmit').onclick=()=>{"),html.indexOf("$('trackMore').onclick"));
  vm.runInContext(confirm,context);
  return {context,state,element,posted,notifications,toasts,result:m=>{context.m=m;vm.runInContext(result,context)}};
}
test('failure remains in modal and preserves quantities, drafts and original request identity',()=>{
  const f=fixture(),order=f.state.pendingOrder,attempt=f.state.orderAttempt;
  f.result({type:'BUYER_ROOM_ORDER_RESULT',ok:false,message:'Quoted price is no longer available.'});
  assert.equal(f.element('orderSubmitError').hidden,false);
  assert.match(f.element('orderSubmitError').textContent,/Quoted price is no longer available/);
  assert.equal(f.element('orderSubmitError').focused,true);
  assert.equal(f.state.pendingOrder,order);assert.equal(f.state.orderAttempt,attempt);
  assert.equal(f.state.quantityDrafts.get('demo').value,'150');assert.equal(f.toasts.length,0);
  f.element('confirmSubmit').onclick();
  assert.equal(f.posted.length,1);assert.equal(f.posted[0][1].requestId,'original-request');
  assert.equal(f.posted[0][1].lines,order);assert.equal(f.element('orderSubmitError').hidden,true);
});
test('timeout and server errors communicate an unknown outcome rather than a failed order',()=>{
  for(const message of ['Request failed with status code 504','Request failed with status code 500','Network error','Request timed out']){
    const f=fixture();f.result({type:'BUYER_ROOM_ORDER_RESULT',ok:false,message});
    assert.match(f.element('orderSubmitError').textContent,/may already have been received/);
    assert.match(f.element('orderSubmitError').textContent,/Check Track Orders/);
    assert.equal(f.posted.length,0);
  }
});
test('error text is literal, has accessible alert semantics and no toast timer',()=>{
  const f=fixture();f.result({type:'BUYER_ROOM_ORDER_RESULT',ok:false,message:'<img src=x onerror=alert(1)>'});
  assert.match(f.element('orderSubmitError').textContent,/<img src=x/);
  assert.match(html,/id="orderSubmitError"[^>]*role="alert"[^>]*tabindex="-1" hidden/);
  assert.doesNotMatch(html.slice(html.indexOf('function showOrderSubmitError('),html.indexOf('function openOrderReview(')),/setTimeout|innerHTML/);
});
test('success keeps existing notification, draft cleanup and request reset behavior',()=>{
  const f=fixture();f.result({type:'BUYER_ROOM_ORDER_RESULT',ok:true,orderId:'demo-order'});
  assert.equal(f.state.orderAttempt,null);assert.equal(f.state.pendingOrder,null);
  assert.equal(f.state.quantityDrafts.size,0);assert.deepEqual(f.notifications,['demo-order']);
  assert.deepEqual(f.toasts,['Order received. View its progress in Track Orders.']);
});
