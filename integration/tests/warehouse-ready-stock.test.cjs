const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),load=require('./load-master-module.cjs');
const {projectPreparation}=load('warehousePreparation.js');
const demand=(id,extra={})=>({id,orderId:'O',sourceLineId:id,customerId:'C',barcode:id,name:'ITEM '+id,packing:'12x1',ord:100,inc:0,...extra});
const physical=n=>({hasPhysicalReceipt:true,accepted:n,issue:true,stock:{availablePhysical:n}});
const context=tasks=>({company:'NCT',customers:[{id:'C',name:'CUSTOMER'}],tasks,activity:[],allocations:[]});
test('95 accepted cartons are visible before shortage resolution or customer allocation; unreceived demand stays zero',()=>{
 const c=context([demand('T',{warehouse:physical(95)}),demand('WAIT')]),before=JSON.stringify(c),rows=projectPreparation(c);
 assert.equal(rows[0].readyStock,95);assert.equal(rows[0].allocated,0);assert.equal(rows[1].readyStock,0);assert.equal(JSON.stringify(c),before);
});
test('supplier child receipts aggregate once, excluding quarantined or dispatched physical cartons and surplus',()=>{
 const c=context([demand('T',{warehouse:physical(40)}),demand('CHILD',{procurementSource:true,customerDemandTaskId:'T',warehouse:physical(55)}),demand('OTHER',{warehouse:physical(80)})]);
 c.tasks[1].warehouse.accepted=70;assert.equal(projectPreparation(c)[0].readyStock,95);
 c.tasks[1].warehouse.stock.availablePhysical=90;assert.equal(projectPreparation(c)[0].readyStock,100);
});
test('stock allocated elsewhere is not displayed twice, and external allocated stock belongs to its target only',()=>{
 const c=context([demand('T',{warehouse:physical(95)}),demand('OTHER')]);c.allocations=[{sourceTaskId:'T',targets:[{taskId:'OTHER',quantity:30}]}];
 const rows=projectPreparation(c);assert.equal(rows[0].readyStock,65);assert.equal(rows[1].readyStock,30);
 c.tasks[0].warehouse.stock.availablePhysical=20;assert.equal(projectPreparation(c)[0].readyStock,0);assert.equal(projectPreparation(c)[1].readyStock,20);
});
test('warehouse retains full demand list while showing 95 received and zero for unreceived goods',()=>{
 const elements={search:{value:''},whCompanyCaption:{}},dialog={addEventListener(){}};
 const sandbox={window:{addEventListener(){},departmentMessages:{cell:()=>''}},document:{getElementById:id=>elements[id],createElement:()=>dialog,body:{appendChild(){}}},sessionStorage:{getItem:()=>null},console};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../warehouse-room/workroom.js'),'utf8'),sandbox);
 const api=sandbox.window.warehouseWorkroom,rows=projectPreparation(context([demand('T',{warehouse:physical(95)}),demand('WAIT')]));
 api.setData({orders:[],deliveryTasks:rows},'NCT',{});
 assert.match(api.cards('customers'),/Pending Packing[\s\S]*?<strong>2<\/strong>/);
 let html=api.delivery();assert.match(html,/Delivery Tasks 发货任务 · 2/);assert.match(html,/data-label="Ready Stock"><b>95<\/b>/);assert.match(html,/ITEM WAIT/);assert.match(html,/data-label="Ready Stock"><b><\/b>/);
 api.setData({orders:[],deliveryTasks:[...rows,{...rows[1],id:'LOADED',loaded:10,stale:true}]},'NCT',{});
 html=api.delivery();assert.match(html,/Delivery Tasks 发货任务 · 3/);assert.match(html,/Task changed; review required/);
});
