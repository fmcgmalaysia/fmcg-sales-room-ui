const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('Purchase shows pending new50 only on first mother, blue supplier name on both, original source once',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/task-grid.js'),'utf8'),{window});
 const row={id:'T',orderId:'O',customerId:'C',barcode:'001',name:'ITEM',packing:'24EA',ord:550,supplierId:'S',lpCtn:10,disc1:0,disc2:0,disc3:0,history:[],procurement:{totalCtn:500,revision:'V'},batchEntitlements:[{id:'P|1',metrics:{committed:300,received:300},sources:[{id:'T',quantity:300}]},{id:'P|2',metrics:{committed:200,received:200},sources:[{id:'T',quantity:200}]}]};
 const html=window.purchaseTaskGrid.render({rows:[row],tasks:[row],customers:[{id:'C',name:'CUSTOMER'}],suppliers:[{id:'S',name:'SUPPLIER'}],selected:new Set(),selectedSources:new Set(),active:true,canMove:true,orders:[],age:()=> 'Today',quantityCells:()=>'<td>550</td><td>0</td>',drafts:new Map(),riskDeal:()=>false,shipmentPlans:[{id:'P',orderId:'O',customerId:'C',batches:[{sequence:1,label:'This shipment',lines:[{taskId:'T',quantity:350}]},{sequence:2,label:'Next shipment',lines:[{taskId:'T',quantity:200}]}]}]});
 const rows=html.match(/<tr class="split-demand-row"[\s\S]*?<\/tr>/g);assert.equal(rows.length,2);assert.match(rows[0],/350 \| 300/);assert.match(rows[1],/200 \| 200/);assert.match(rows[0],/supplier-head pending/);assert.doesNotMatch(rows[1],/supplier-head pending/);for(const r of rows){assert.match(r,/supplier-head complete/);assert.match(r,/SUPPLIER/);}assert.equal((html.match(/data-source-id="T"/g)||[]).length,1);
});
test('Sales and Buyer use checked per-batch metrics instead of borrowing later-batch quantity',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../master-shared/shipment-batches.js'),'utf8'),{window});
 const result=window.customerShipmentBatches.lines({quantityCtn:550,committedQtyCtn:500,receivedQtyCtn:500,shipmentBatches:[{id:'P|1',quantity:350,metrics:{committed:300,received:300}},{id:'P|2',quantity:200,metrics:{committed:200,received:200}}]});
 assert.deepEqual(JSON.parse(JSON.stringify(result.map(row=>[row.quantityCtn,row.committedQtyCtn,row.receivedQtyCtn]))),[[350,300,300],[200,200,200]]);
});
