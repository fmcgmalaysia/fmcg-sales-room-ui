const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','buyer-room.html'),'utf8');
function fixture(){
  const state={orders:[],orderDetails:{}},context={state,num:v=>Number.isFinite(Number(v))?Number(v):0,esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),compactTime:v=>v};
  vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function orderEditEntries('),html.indexOf('function renderEditHistory(')),context);
  function row(orderId,lineId,original,changes){const order={orderId},line={lineId,quantityCtn:original,barcode:'123',itemName:'Product',packingSize:'100G x 12'};state.orders.push(order);state.orderDetails[orderId]={lines:[...(state.orderDetails[orderId]?.lines||[]),line],editHistory:[...(state.orderDetails[orderId]?.editHistory||[]),...changes.map(([previous,next,at],index)=>({at:at||`2026-10-07T0${index}:00:00Z`,actorName:'LAW',detail:{lineId,previousQuantityCtn:previous,newQuantityCtn:next,originalQuantityCtn:original}}))]};return{order,line}}
  return{state,context,row};
}
test('one task shows chronological increases and reductions, preserving every audit',()=>{
  const f=fixture(),row=f.row('a','x',50,[[60,40,'2026-10-07T02:00:00Z'],[50,60,'2026-10-07T01:00:00Z']]),before=JSON.stringify(f.state),groups=f.context.orderEditGroups([row]);
  assert.equal(groups.length,1);assert.deepEqual(Array.from(groups[0].path),[50,60,40]);assert.equal(groups[0].originalQty,50);assert.equal(groups[0].currentQty,40);assert.equal(groups[0].at,'2026-10-07T02:00:00Z');assert.equal(f.context.orderEditEntries([row]).length,2);assert.equal(JSON.stringify(f.state),before);
});
test('identical barcodes remain separate across order tasks and follow row order',()=>{
  const f=fixture(),a=f.row('a','x',20,[[20,30]]),b=f.row('b','x',10,[[10,15]]);const groups=f.context.orderEditGroups([b,a]);assert.equal(groups.length,2);assert.deepEqual(Array.from(groups,g=>g.orderId),['b','a']);
});
test('separate lines in one order stay distinct and cancellation retains zero',()=>{
  const f=fixture(),a=f.row('a','x',20,[[20,0]]),b=f.row('a','y',10,[[10,15]]);f.state.orders=[a.order];const groups=f.context.orderEditGroups([a,b]);assert.equal(groups.length,2);assert.equal(groups[0].currentQty,0);assert.deepEqual(Array.from(groups[0].path),[20,0]);
});
test('history markup hides request IDs, leaves reason blank and escapes customer text',()=>{
  const f=fixture(),row=f.row('PRIVATE-ORDER-ID','x',50,[[50,40]]);row.line.itemName='<script>alert(1)</script>';const markup=f.context.editHistoryHtml([row]);assert.doesNotMatch(markup,/PRIVATE-ORDER-ID|<script>/);assert.match(markup,/&lt;script&gt;/);assert.match(markup,/<th>Reason<\/th>/);assert.match(markup,/<td><\/td><td class="history-changed-on">/);assert.match(markup,/50 → 40 CTN/);assert.match(markup,/<small>by LAW<\/small>/);
});
test('long paths expand on click without a hover tooltip or losing transitions',()=>{
  const f=fixture(),markup=f.context.historyPathHtml([1,2,3,4,5,6]);assert.match(markup,/<details/);assert.match(markup,/1 → … → 6 CTN/);assert.match(markup,/1 → 2 → 3 → 4 → 5 → 6 CTN/);assert.doesNotMatch(markup,/title=/);
});
test('unchanged tasks do not fabricate history',()=>{
  const f=fixture(),row=f.row('a','x',50,[]);assert.equal(f.context.orderEditGroups([row]).length,0);assert.match(f.context.editHistoryHtml([row]),/No quantity changes recorded/);
});
