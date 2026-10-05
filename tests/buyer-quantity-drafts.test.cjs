const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','buyer-room.html'),'utf8');
const source=html.slice(html.indexOf('function quantityEditsBlocked('),html.indexOf('function renderOrder('));
function fixture(){
  const posted=[],state={my:[{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}],pendingQuantities:new Map(),quantityDrafts:new Map(),memberName:'Tester'};
  const context={state,Map,Set,num:v=>Number.isFinite(Number(v))?Number(v):0,post:(type,payload)=>posted.push({type,...payload}),summary(){},renderOrder(){},toast(){}};
  vm.createContext(context);vm.runInContext(source,context);
  const input=value=>({value:String(value),dataset:{committedQty:'0'},checkValidity:()=>true,reportValidity(){throw Error('invalid')},closest:()=>({querySelector:()=>({textContent:''})})});
  return {state,context,posted,input,item:id=>state.my.find(x=>x.id===id),refresh:rows=>{state.my=rows;context.restoreQuantityDrafts()},reply:(id,qty,ok=true)=>context.finishQuantity({itemId:id,quantityCtn:qty,ok,qtyEditedAt:'2026-10-05T08:00:00.000Z',qtyEditedBy:'Tester',message:ok?'':'Save failed'})};
}
test('saving first row and stale full-table data cannot erase second row draft',()=>{
  const f=fixture();f.context.confirmQuantityDraft(f.item('a'),f.input(111));f.context.rememberQuantityDraft(f.item('b'),f.input('222'));
  f.reply('a',111);f.refresh([{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}]);
  assert.equal(f.item('a').orderQtyCtn,111);assert.equal(f.item('b').orderQtyCtn,222);
  assert.equal(f.state.quantityDrafts.get('b').value,'222');assert.equal(f.context.quantityEditsBlocked(),true);
});
test('parallel rows can complete out of order and only successful replies set audit time',()=>{
  const f=fixture();f.context.confirmQuantityDraft(f.item('a'),f.input(111));f.context.confirmQuantityDraft(f.item('b'),f.input(222));
  assert.equal(f.posted.length,2);assert.equal(f.item('a').qtyEditedAt,undefined);assert.equal(f.context.quantityEditsBlocked(),true);
  f.reply('b',222);assert.equal(f.state.pendingQuantities.size,1);assert.equal(f.item('a').qtyEditedAt,undefined);
  f.reply('a',111);assert.equal(f.context.quantityEditsBlocked(),false);
  f.refresh([{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}]);assert.equal(f.item('a').orderQtyCtn,111);assert.equal(f.item('b').orderQtyCtn,222);
  f.refresh([{id:'a',orderQtyCtn:111,qtyEditedAt:'2026-10-05T08:00:00.000Z'},{id:'b',orderQtyCtn:222,qtyEditedAt:'2026-10-05T08:00:00.000Z'}]);
  assert.equal(f.state.quantityDrafts.get('a').awaitingEcho,false);
  f.refresh([{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}]);assert.equal(f.item('a').orderQtyCtn,111);
  f.refresh([{id:'a',orderQtyCtn:0,qtyEditedAt:'2026-10-05T09:00:00.000Z'},{id:'b',orderQtyCtn:0,qtyEditedAt:'2026-10-05T09:00:00.000Z'}]);assert.equal(f.item('a').orderQtyCtn,0);
});
test('failed quantity stays visible, blocks submission and retries with original committed baseline',()=>{
  const f=fixture();f.context.confirmQuantityDraft(f.item('a'),f.input(333));f.reply('a',0,false);
  assert.equal(f.item('a').orderQtyCtn,333);assert.equal(f.context.quantityEditsBlocked(),true);assert.equal(f.item('a').qtyEditedAt,'');
  f.refresh([{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}]);assert.equal(f.item('a').orderQtyCtn,333);
  f.context.confirmQuantityDraft(f.item('a'),f.input(333));assert.equal(f.posted.length,2);f.reply('a',333);assert.equal(f.context.quantityEditsBlocked(),false);
});
test('unchanged Enter locks without duplicate save; invalid quantity never saves',()=>{
  const f=fixture();f.context.confirmQuantityDraft(f.item('a'),f.input(''));assert.equal(f.posted.length,0);assert.equal(f.state.quantityDrafts.get('a').editing,false);
  const bad=f.input(-1);bad.checkValidity=()=>false;let invalid=false;bad.reportValidity=()=>{invalid=true};f.context.confirmQuantityDraft(f.item('b'),bad);assert.equal(invalid,true);assert.equal(f.posted.length,0);
});
test('both review opening and final sending guard all quantity edits',()=>{
  const applyStart=html.indexOf('function applyData('),applyData=html.slice(applyStart,html.indexOf("document.querySelectorAll('.nav button')",applyStart));
  assert.match(applyData,/restoreQuantityDrafts\(\);/);
  assert.match(html,/function openOrderReview\(\)\{\s*if\(quantityEditsBlocked\(\)\)/);
  assert.match(html,/\$\('confirmSubmit'\)\.onclick=\(\)=>\{\s*if\(quantityEditsBlocked\(\)\)/);
  assert.match(html,/for\(const line of state\.pendingOrder\|\|\[\]\)state\.quantityDrafts\.delete\(String\(line\.itemId\)\)/);
});
