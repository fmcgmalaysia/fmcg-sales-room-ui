const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',open:false,classList:{toggle(){}},addEventListener(){},querySelectorAll:()=>[]});return nodes.get(id);};
 const buttons=['receiving','customers','history','stock'].map(view=>({dataset:{view},classList:{toggle(){}}})),sent=[],renders=[];
 const state={busy:false},window={addEventListener(){},warehouseStockTab:{render:(container,company)=>renders.push(company),refresh:()=>renders.push('REFRESH'),isBusy:()=>state.busy}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../warehouse-room/app.js'),'utf8'),{document:{getElementById:node,querySelector:node,querySelectorAll:q=>q==='[data-view]'?buttons:[]},window,parent:{postMessage:m=>sent.push(m)},crypto:{randomUUID:()=> 'READ'},setTimeout(){},setInterval(){},clearTimeout(){},Intl,Date});
 return {node,sent,renders,state,choose:view=>buttons.find(b=>b.dataset.view===view).onclick()};
}
test('stock view mounts in existing tables, hides duplicate controls and returning restores old views',()=>{
 const f=fixture();f.choose('stock');assert.deepEqual(f.renders,['NCT']);assert.equal(f.node('.filters').hidden,true);assert.equal(f.node('.title-row').hidden,true);
 f.choose('customers');assert.equal(f.node('.filters').hidden,false);assert.equal(f.node('.title-row').hidden,false);assert.equal(f.sent.some(m=>/SAVE|RECEIPT_REQUEST/.test(m.type)),false);
});
test('open receiving and stock detail protect same-window tab/company transitions',()=>{
 const f=fixture();f.node('entry').open=true;f.choose('stock');assert.equal(f.renders.length,0);f.node('entry').open=false;f.choose('stock');f.state.busy=true;
 f.node('company').value='GHR';f.node('company').onchange();assert.equal(f.node('company').value,'NCT');f.choose('history');assert.equal(f.node('.filters').hidden,true);
});
test('company changes while on stock select the new pane and never post a receipt',()=>{
 const f=fixture();f.choose('stock');f.node('company').value='GHR';f.node('company').onchange();assert.equal(f.renders.at(-2),'GHR');assert.equal(f.renders.at(-1),'REFRESH');
 assert.equal(f.sent.some(m=>m.type!=='WAREHOUSE_ORDERS_REQUEST'),false);
 f.choose('receiving');assert.equal(f.sent.at(-1).company,'GHR');assert.equal(f.sent.at(-1).type,'WAREHOUSE_ORDERS_REQUEST');
});
