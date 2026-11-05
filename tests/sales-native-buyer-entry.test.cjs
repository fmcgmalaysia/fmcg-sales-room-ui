const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),outer=fs.readFileSync('sales-room/wix/sales-room-page.js','utf8');
function modal(customer){
 const elements={},sent=[],area={innerHTML:''};
 const context={customerAccessState:c=>c.accessStatus||'ACTIVE',document:{getElementById:id=>id==='customerDetailArea'?area:(elements[id]??={disabled:customer.accessStatus==='SUSPENDED'})},currentCustomerId:'',esc:x=>String(x),customerDisplayName:c=>c.companyName,dashboardTime:()=>({primary:''}),computerIcon:'',publishQuoteIcon:'',buyerRoomIcon:'',cartIcon:'',requestCustomerQdRoute(){},window:{parent:{postMessage:m=>sent.push(m)},open(){throw Error('Unexpected popup')}},catalogueUrl:()=>''};
 const start=html.indexOf('renderCustomerWorkspaceDrawer=function(customer){'),end=html.indexOf('\nfunction quotationPublishResultText',start);
 vm.runInNewContext(html.slice(start,end),context);context.renderCustomerWorkspaceDrawer(customer);
 return {elements,sent,area};
}
async function route(message,authorized=true){
 const start=outer.indexOf("    if (message.type === 'SALES_ROOM_OPEN_BUYER_ROOM')"),end=outer.indexOf('\n    if (',start+8);assert(start>=0&&end>start);
 const paths=[];await vm.runInNewContext('(async()=>{'+outer.slice(start,end)+'})()',{message,staffPromise:Promise.resolve({authorized}),wixLocationFrontend:{to:p=>paths.push(p)},encodeURIComponent});return paths;
}
test('two customers route once through outer page in current tab',async()=>{
 for(const id of ['CUS-261103-43C587','CUS-261103-CF0D88']){
 const m=modal({customerId:id,companyName:id});assert.equal((m.area.innerHTML.match(/id="drawerOpenBuyerRoom"/g)||[]).length,1);m.elements.drawerOpenBuyerRoom.onclick();assert.equal(m.sent.length,1);assert.deepEqual(await route(m.sent[0]),['/buyer-room?assist='+id]);
 }
});
test('suspended customer has no enabled modal entry',()=>{const m=modal({customerId:'CUS-A',companyName:'A',accessStatus:'SUSPENDED'});assert.equal(m.elements.drawerOpenBuyerRoom.onclick,undefined)});
test('denied staff and malformed customer cannot navigate',async()=>{assert.deepEqual(await route({type:'SALES_ROOM_OPEN_BUYER_ROOM',customerId:'CUS-A'},false),[]);for(const customerId of ['', 'https://wrong.example','CUS-A?other=B'])assert.deepEqual(await route({type:'SALES_ROOM_OPEN_BUYER_ROOM',customerId}),[])});
test('only modal entry remains, native bridge and button are removed',()=>{assert(!outer.includes('buyerEntryButton'));assert(!outer.includes('createNativeBuyerEntry'));assert(!html.includes('bindNativeBuyerEntryContext'));assert(!html.includes('SALES_ROOM_BUYER_ENTRY_CONTEXT'));assert(html.includes('Buyer Room 在当前标签打开'));assert(!html.includes('buyer.onclick=()=>window.open'))});
