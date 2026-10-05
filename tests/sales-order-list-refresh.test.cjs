const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fixture(){
  const messages=[], elements=new Map(['dashboard','orders','order-progress'].map(id=>[id,{id,active:false,classList:{toggle(_name,on){elements.get(id).active=on},contains(){return elements.get(id).active}}}]));
  let tick;
  const context={document:{hidden:false,body:{classList:{toggle(){}}},querySelectorAll:selector=>selector==='.view'?[...elements.values()]:[],getElementById:id=>elements.get(id)},window:{parent:{postMessage:m=>messages.push(m)}},salesProgressCustomerId:'',salesRoomHandshakeComplete:true,requestSalesOrderProgress(){},requestCustomerRefresh(){},setInterval:fn=>{tick=fn;return 1}};
  vm.createContext(context);
  vm.runInContext(html.match(/function showView\(id\)\{[^\n]+/)[0],context);
  vm.runInContext(html.match(/const salesRoomCustomerAutoRefreshTimer=[^\n]+/)[0],context);
  return {context,messages,tick:()=>tick()};
}
test('opening Order Management refreshes the existing order read endpoint',()=>{
  const f=fixture(); f.context.showView('dashboard'); assert.equal(f.messages.length,0);
  f.context.showView('orders'); assert.equal(f.messages.length,1);assert.equal(f.messages[0].type,'SALES_ROOM_CONFIRMED_ORDERS_REQUEST');
});
test('open order list refreshes periodically without polling hidden or unrelated views',()=>{
  const f=fixture();f.context.showView('orders');f.messages.length=0;f.tick();assert.equal(f.messages.length,1);
  f.messages.length=0;f.context.document.hidden=true;f.tick();assert.equal(f.messages.length,0);
  f.context.document.hidden=false;f.context.showView('dashboard');f.tick();assert.equal(f.messages.length,0);
  f.context.showView('orders');f.messages.length=0;f.context.salesRoomHandshakeComplete=false;f.tick();assert.equal(f.messages.length,0);
});
