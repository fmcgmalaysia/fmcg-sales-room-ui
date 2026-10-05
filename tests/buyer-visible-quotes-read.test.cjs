const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'buyer-room.html'), 'utf8');
const helper = html.slice(html.indexOf('function markDisplayedQuotesSeen('), html.indexOf('function markQuotesSeen('));
function fixture(active = 'my', mode = 'current') {
  let saved = JSON.stringify({a:'old-a', b:'old-b'}), badge = 0;
  const state = {listMode:mode, quoteStorageKey:'customer', quoteSnapshot:{a:'new-a',b:'new-b'}, newQuoteItems:[{id:'a'},{id:'b'}], notifications:[{read:false}], orderNotifications:[{read:false}]};
  const context = {state, Set, JSON, localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value}}, $:id=>id==='quoteNotifications'?{hidden:true}:{classList:{contains:()=>id===active+'View'}}, updateNotificationBadge:()=>{badge=state.newQuoteItems.length+state.notifications.length+state.orderNotifications.length}, renderNotificationPanel:()=>{}};
  vm.createContext(context); vm.runInContext(helper, context);
  return {state, read:(view,items)=>context.markDisplayedQuotesSeen(view,items), stored:()=>JSON.parse(saved), badge:()=>badge};
}
test('direct My Selection reads displayed quotes while retaining filtered quotes and other alerts',()=>{
  const f=fixture(); f.read('my',[{id:'a'}]);
  assert.deepEqual(f.stored(),{a:'new-a',b:'old-b'});
  assert.equal(f.state.newQuoteItems.length,1); assert.equal(f.state.newQuoteItems[0].id,'b'); assert.equal(f.badge(),3);
  assert.equal(f.state.notifications[0].read,false); assert.equal(f.state.orderNotifications[0].read,false);
  f.read('my',[{id:'a'},{id:'b'}]); assert.equal(f.state.newQuoteItems.length,0); assert.equal(f.badge(),2);
});
test('background renders, Removed History, and empty searches do not consume quotes',()=>{
  const hidden=fixture('account'); hidden.read('my',[{id:'a'},{id:'b'}]); assert.equal(hidden.state.newQuoteItems.length,2);
  const removed=fixture('my','removed'); removed.read('my',[{id:'a'},{id:'b'}]); assert.equal(removed.state.newQuoteItems.length,2);
  const empty=fixture(); empty.read('my',[]); assert.equal(empty.state.newQuoteItems.length,2);
});
test('direct Order Form reads only its displayed quoted products',()=>{
  const f=fixture('order'); f.read('order',[{id:'b'}]); assert.deepEqual(f.stored(),{a:'old-a',b:'new-b'}); assert.equal(f.state.newQuoteItems[0].id,'a');
});
