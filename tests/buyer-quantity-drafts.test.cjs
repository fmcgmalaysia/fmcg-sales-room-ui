const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','buyer-room.html'),'utf8');
const source=html.slice(html.indexOf('function quantityEditsBlocked('),html.indexOf('function renderOrder('));
function fixture(){
  const posted=[],state={my:[{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}],pendingQuantities:new Map(),quantityDrafts:new Map(),memberName:'Tester'};
  const inputs=[],reviews=[],messages=[];
  const context={state,Map,Set,document:{querySelectorAll:()=>inputs},isOrderable:()=>true,$:()=>({classList:{contains:()=>true}}),openOrderReview:()=>reviews.push(true),num:v=>Number.isFinite(Number(v))?Number(v):0,post:(type,payload)=>posted.push({type,...payload}),summary(){},renderOrder(){},toast:message=>messages.push(message)};
  vm.createContext(context);vm.runInContext(source,context);
  const input=(value,id='a')=>({value:String(value),dataset:{qty:id,committedQty:'0'},readOnly:false,parentElement:{querySelector:()=>({hidden:true,disabled:false})},checkValidity:()=>true,reportValidity(){throw Error('invalid')},closest:()=>({querySelector:()=>({textContent:''})})});
  return {state,context,posted,input,inputs,reviews,messages,item:id=>state.my.find(x=>x.id===id),refresh:rows=>{state.my=rows;context.restoreQuantityDrafts()},reply:(id,qty,ok=true)=>context.finishQuantity({itemId:id,quantityCtn:qty,ok,qtyEditedAt:'2026-10-05T08:00:00.000Z',qtyEditedBy:'Tester',message:ok?'':'Save failed'})};
}

test('blur locks only its input and concurrent rows keep their drafts',()=>{
  const f=fixture(),a=f.input(9999),b=f.input(650,'b');
  f.context.rememberQuantityDraft(f.item('a'),a);f.context.confirmQuantityDraft(f.item('a'),a,false);
  assert.equal(a.readOnly,true);assert.equal(f.posted.length,1);
  f.context.rememberQuantityDraft(f.item('b'),b);f.context.confirmQuantityDraft(f.item('b'),b,false);
  f.context.confirmQuantityDraft(f.item('a'),a,false);assert.equal(f.posted.length,2);
  f.reply('b',650);f.refresh([{id:'a',orderQtyCtn:0},{id:'b',orderQtyCtn:0}]);
  assert.equal(f.item('a').orderQtyCtn,9999);assert.equal(f.item('b').orderQtyCtn,650);
  f.reply('a',9999);assert.equal(f.context.quantityEditsBlocked(),false);
});
test('direct review click saves the last draft and waits for all replies',()=>{
  const f=fixture(),a=f.input(111),b=f.input(650,'b');f.inputs.push(a,b);
  f.context.confirmQuantityDraft(f.item('a'),a,false);f.context.rememberQuantityDraft(f.item('b'),b);
  f.context.requestQuantityReview();assert.equal(f.posted.length,2);assert.equal(f.reviews.length,0);
  f.reply('b',650);assert.equal(f.reviews.length,0);f.reply('a',111);assert.equal(f.reviews.length,1);
  f.reply('a',111);assert.equal(f.reviews.length,1);
});
test('save failure cancels queued review and retry does not open it unexpectedly',()=>{
  const f=fixture(),a=f.input(333);f.inputs.push(a);f.context.rememberQuantityDraft(f.item('a'),a);
  f.context.requestQuantityReview();f.reply('a',0,false);
  assert.equal(f.reviews.length,0);assert.equal(f.state.quantityReviewRequested,false);assert.equal(f.item('a').orderQtyCtn,333);
  f.context.confirmQuantityDraft(f.item('a'),f.input(333),false);f.reply('a',333);assert.equal(f.reviews.length,0);
  f.context.requestQuantityReview();assert.equal(f.reviews.length,1);
});
test('invalid last quantity cannot save or open review',()=>{
  const f=fixture(),a=f.input(-1);a.checkValidity=()=>false;a.reportValidity=()=>{};
  f.inputs.push(a);f.context.rememberQuantityDraft(f.item('a'),a);f.context.requestQuantityReview();
  assert.equal(f.posted.length,0);assert.equal(f.reviews.length,0);assert.equal(f.context.quantityEditsBlocked(),true);
});
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
