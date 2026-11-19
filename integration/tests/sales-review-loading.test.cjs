const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../../index.html'),'utf8');
function fixture(){
  const requests=[],buttons=['A','B'].map(orderId=>({dataset:{orderDetail:orderId},innerHTML:'ICON',disabled:false,setAttribute(){},removeAttribute(){}}));
  let status=null;
  const document={querySelectorAll:()=>buttons,getElementById:id=>id==='salesReviewReadStatus'?status:{prepend:node=>{status=node}},createElement:()=>({textContent:'',setAttribute(){},remove(){status=null}})};
  const ctx=vm.createContext({document,window:{parent:{postMessage:m=>requests.push(m)}},salesReviewIcon:()=> 'ICON'});
  vm.runInContext(html.slice(html.indexOf('let pendingSalesReviewRead=null;'),html.indexOf('function renderConfirmedOrders(payload)')),ctx);
  return {ctx,buttons,requests,status:()=>status};
}
test('single click immediately shows bilingual loading and suppresses repeated reads',()=>{
  const f=fixture();f.ctx.requestSalesReviewRead('A');
  assert.equal(f.status().textContent,'Loading order… / 正在读取订单');
  assert.ok(f.buttons.every(b=>b.disabled));
  f.ctx.requestSalesReviewRead('A');f.ctx.requestSalesReviewRead('B');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].orderId,'A');
  f.ctx.paintSalesReviewLoading();assert.ok(f.buttons.every(b=>b.disabled));
});
test('successful read restores buttons and removes loading status',()=>{
  const f=fixture();f.ctx.requestSalesReviewRead('A');f.ctx.finishSalesReviewRead({ok:true});
  assert.equal(f.status(),null);assert.ok(f.buttons.every(b=>!b.disabled&&b.innerHTML==='ICON'));
});
test('failed read gives visible error and permits a new attempt',()=>{
  const f=fixture();f.ctx.requestSalesReviewRead('A');f.ctx.finishSalesReviewRead({ok:false,error:'Network unavailable'});
  assert.match(f.status().textContent,/Network unavailable.*读取失败/);assert.ok(f.buttons.every(b=>!b.disabled));
  f.ctx.requestSalesReviewRead('A');assert.equal(f.requests.length,2);assert.match(f.status().textContent,/Loading order/);
});
