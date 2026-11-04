const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const window={};for(const file of ['display-rows.js','task-grid.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live',file),'utf8'),{window});
 const root={id:'R',orderId:'O',customerId:'C',barcode:'7622210629968',name:'CHIPSMORE MINI - ORIGINAL',packing:'72G x 48',ord:300,inc:0,supplierId:'S',sourceGp:.1189,gp:null,lpCtn:82.4688,disc1:0,disc2:0,disc3:0,po:'PO-200',history:[],procurement:{revision:'P',totalCtn:200,customerCtn:200,expectedExtra:0,costing:{mode:'NORMAL',paidCtn:200,freeCtn:0,amountCents:1649376,averageCostCtn:82.4688}}};
 const plan={id:'P',customerId:'C',orderId:'O',batches:[{sequence:1,label:'Now',lines:[{taskId:'R',quantity:200}]},{sequence:2,label:'Later',lines:[{taskId:'R',quantity:100}]}]};
 root.batchEntitlements=[{id:'P|1',sources:[{id:'R',quantity:200}],metrics:{received:0}},{id:'P|2',sources:[],metrics:{received:0}}];
 const args={rows:[root],tasks:[root],customers:[{id:'C',shortName:'TESTING 02'}],suppliers:[{id:'S',name:'HONG LEA'},{id:'B',name:'OTHER'}],selected:new Set(),selectedSources:new Set(),expanded:new Set(),active:true,canMove:true,orders:[],age:()=>'',quantityCells:row=>'<td class="order-quantity">'+row.ord+'</td><td class="received-quantity"><span class="quantity-reference">'+(row.warehouse?.accepted??0)+'</span>'+(row.quantityCases?.[0]?'<button data-quantity-case="'+row.quantityCases[0].id+'">Issue</button>':'')+'</td>',drafts:new Map(),riskDeal:()=>false,shipmentPlans:[plan],purchaseDisplayOrder:{C:{version:'V',rows:['["R","P|1"]','["R","P|2"]']}}};
 const render=()=>window.purchaseTaskGrid.render(args),rows=()=>render().match(/<tr\b[\s\S]*?<\/tr>/g),cells=row=>row.match(/<td\b[\s\S]*?<\/td>/g);
 return {root,plan,args,render,rows,cells};
}
test('300 split200+100 places its complete single200source on the main shipment row without changing facts',()=>{
 const f=fixture(),before=JSON.stringify(f.args.tasks),rows=f.rows();assert.equal(rows.length,2);assert.match(rows[0],/200 \| 200/);assert.match(rows[0],/HONG LEA/);assert.match(rows[0],/82\.47/);assert.match(rows[0],/16,493\.76/);assert.match(rows[0],/data-source-po-task="R"/);assert.match(rows[0],/GP 11\.89%/);assert.match(rows[0],/data-receipt-source-id="R"/);assert.doesNotMatch(f.render(),/data-source-id=|1 Sources/);
 assert.match(rows[1],/100 \| 0/);for(const index of [7,9,10])assert.doesNotMatch(f.cells(rows[1])[index],/82\.47|16,493|PO-200|Sources/);assert.equal(JSON.stringify(f.args.tasks),before);assert.match(rows[0],/data-display-key="\[&quot;R&quot;,&quot;P\|1&quot;\]"/);
});
test('separate complete sources for two batches each keep their own supplier and PO on the correct main row',()=>{
 const f=fixture(),second={...f.root,id:'R2',procurementSource:true,customerDemandTaskId:'R',supplierId:'B',po:'PO-100',procurement:{revision:'B',totalCtn:100,customerCtn:100,expectedExtra:0},lpCtn:10};f.args.tasks.push(second);f.root.batchEntitlements[1].sources=[{id:'R2',quantity:100}];const rows=f.rows();assert.equal(rows.length,2);assert.match(rows[0],/PO-200/);assert.doesNotMatch(rows[0],/PO-100/);assert.match(rows[1],/OTHER/);assert.match(rows[1],/PO-100/);assert.match(rows[1],/1,000\.00/);assert.doesNotMatch(rows[1],/PO-200|16,493/);
});
test('multiple procurement sources stay visible only below the batch they cover',()=>{
 const f=fixture();f.root.procurement={revision:'A',totalCtn:60,customerCtn:60,expectedExtra:0};const second={...f.root,id:'R2',procurementSource:true,customerDemandTaskId:'R',supplierId:'B',po:'PO-B',procurement:{revision:'B',totalCtn:140,customerCtn:140,expectedExtra:0}};f.args.tasks.push(second);f.root.batchEntitlements[0].sources=[{id:'R',quantity:60},{id:'R2',quantity:140}];const rows=f.rows();assert.equal(rows.length,4);assert.match(rows[1],/data-source-id="R"/);assert.match(rows[2],/data-source-id="R2"/);assert.match(rows[3],/100 \| 0/);assert.doesNotMatch(rows[3],/PO-B|PO-200|Sources/);
});
test('a source spanning both batches remains a single source detail with its whole saved amount',()=>{
 const f=fixture();f.root.procurement={revision:'A',totalCtn:300,customerCtn:300,expectedExtra:0};f.root.batchEntitlements[1].sources=[{id:'R',quantity:100}];const rows=f.rows();assert.equal(rows.length,3);assert.equal((f.render().match(/data-source-id="R"/g)||[]).length,1);assert.match(rows[1],/24,740\.64/);
});
test('surplus procurement remains a source detail rather than hiding its extra stock or whole cost',()=>{
 const f=fixture();f.root.procurement={revision:'A',totalCtn:210,customerCtn:200,expectedExtra:10};const rows=f.rows();assert.equal(rows.length,3);assert.match(rows[1],/data-source-id="R"/);assert.match(rows[1],/17,318\.45/);assert.equal(f.root.procurement.expectedExtra,10);
});
test('an inline source retains the original receipt issue identity and partial received quantity',()=>{
 const f=fixture();f.root.warehouse={accepted:180,hasPhysicalReceipt:true,issue:true};f.root.quantityCases=[{id:'QC'}];const rows=f.rows();assert.equal(rows.length,2);assert.match(rows[0],/data-receipt-source-id="R"/);assert.match(rows[0],/data-quantity-case="QC"/);assert.match(f.cells(rows[0])[8],/>180</);assert.equal(f.root.warehouse.accepted,180);
});
