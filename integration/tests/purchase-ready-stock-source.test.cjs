const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const release=require('../prototypes/purchase-ready-stock-20261031/stage.cjs').plan();
function fixture(purchase=90,stock=10){
 const window={};vm.runInNewContext(release.assets.get('purchase-live/task-grid.js').toString(),{window});
 const row={id:'A',company:'NCT',orderId:'OA',customerId:'CA',barcode:'SKU',name:'Item',packing:'24',ord:100,supplierId:'S',po:purchase?'PO-A':'',lpCtn:10,disc1:0,disc2:0,disc3:0,procurement:{totalCtn:purchase,expectedExtra:0,revision:purchase?'P1':''}};
 const source={...row,id:'FREE',customerId:'CB',po:'STOCK-PO',warehouse:{hasPhysicalReceipt:true,accepted:500,updatedAt:'2026-10-31T01:00:00Z'},procurement:{totalCtn:500,expectedExtra:500,revision:'P2'}};
 const allocations=[{sourceTaskId:'A',targets:[{taskId:'A',quantity:purchase}],at:'2026-10-31T02:00:00Z',by:'LAW'},{sourceTaskId:'FREE',targets:[{taskId:'A',quantity:stock}],at:'2026-10-31T02:05:00Z',by:'LAW'}];
 const args={rows:[row],tasks:[row,source],allocations,allocationContext:{sources:[{id:'FREE',quarantined:false}],loans:[],tasks:[{id:'A',customerId:'CA'},{id:'B',customerId:'CB'}]},customers:[{id:'CA',name:'Buyer A'},{id:'CB',name:'Buyer B'}],suppliers:[{id:'S',name:'Supplier'}],selected:new Set(),selectedSources:new Set(),expanded:new Set(),active:true,canMove:true,orders:[],age:()=>'',quantityCells:r=>'<td class="order-quantity">'+r.ord+' | '+r.sourcing?.orderedCtn+'</td><td class="received-quantity">0</td>',drafts:new Map(),riskDeal:()=>false};
 return {window,row,source,args,coverage:()=>window.purchaseTaskGrid.stockCoverage(row,args.tasks,args.allocations),render:()=>window.purchaseTaskGrid.render(args)};
}
test('purchase90 plus confirmed stock10 covers100 without duplicate source or orange waiting',()=>{
 const f=fixture(),before=JSON.stringify(f.args);const html=f.render();assert.equal(f.coverage().covered,100);assert.equal(f.coverage().stock,10);assert.doesNotMatch(html,/supplier-head pending|data-waiting-for/);assert.match(html,/Ready Stock 现有库存/);assert.match(html,/100 \| 100/);assert.match(html,/data-stock-detail="A"/);assert.equal((html.match(/data-stock-for=/g)||[]).length,1);assert.equal(JSON.stringify(f.args),before);
 const blue=html.match(/<tr class="source-row ready-stock-row"[\s\S]*?<\/tr>/)[0];assert.equal((blue.match(/<td\b/g)||[]).length,11);assert.doesNotMatch(blue,/data-select|data-po-task|data-source-po-task|900\.00/);
});
test('partial stock6 retains only unmet4; failed or unsaved allocation retains10',()=>{
 const f=fixture(90,6);assert.equal(f.coverage().remaining,4);assert.match(f.render(),/order-quantity">4<\/td>/);f.args.allocations.pop();assert.equal(f.coverage().remaining,10);assert.doesNotMatch(f.render(),/ready-stock-row/);f.args.drafts.set('FREE',{changes:{allocated:10}});assert.equal(f.coverage().remaining,10);
});
test('return changes same source projection; own90 allocation is not an extra90',()=>{
 const f=fixture();f.args.allocations[1].targets[0].quantity=0;assert.equal(f.coverage().covered,90);assert.doesNotMatch(f.render(),/ready-stock-row/);assert.match(f.render(),/order-quantity">10<\/td>/);
});
test('own procurement extra10 can cover demand but only10 is stock, not all100',()=>{
 const f=fixture(100,0);f.row.procurement.expectedExtra=10;f.args.allocations[0].targets[0].quantity=100;assert.equal(f.coverage().stock,10);assert.equal(f.coverage().covered,100);assert.match(f.render(),/data-stock-source="A"/);
});
test('stock-only coverage removes supplier waiting and artificial new PO; partial stock keeps remainder',()=>{
 const f=fixture(0,100);assert.equal(f.coverage().remaining,0);const html=f.render();assert.doesNotMatch(html,/supplier-head pending|data-po-task=|data-source-id=|data-waiting-for/);assert.match(html,/Stock supplied 库存供货/);
 f.args.allocations[1].targets[0].quantity=20;const partial=f.render();assert.match(partial,/order-quantity">80<\/td>/);assert.match(partial,/supplier-head pending/);assert.doesNotMatch(partial,/data-source-id=/);
});
test('borrowed ownership labels lender debt separately and remains traceable after repayment',()=>{
 const f=fixture();f.args.allocationContext.loans=[{borrowerTaskId:'A',lenderTaskId:'B',outstanding:10,sources:[{sourceTaskId:'FREE',quantity:10}]}];assert.match(f.render(),/Borrowed Stock 借入库存/);f.args.allocationContext.loans[0].outstanding=0;assert.match(f.render(),/Borrowed Stock 借入库存/);assert.equal(f.coverage().stock,10);
});
test('quarantined assignment is labelled review, not ready; loaded ownership is not silently released',()=>{
 const f=fixture();f.args.allocationContext.sources[0].quarantined=true;assert.match(f.render(),/Stock review 库存待核对/);assert.doesNotMatch(f.render(),/Ready Stock/);f.row.salesInvoiceLocked=true;f.row.customerAllocation={allocated:100};assert.equal(f.coverage().stock,10);
});
test('split batch allocation follows saved binding and never fills the other batch',()=>{
 const f=fixture(90,10);f.row.ord=200;f.row.batchEntitlements=[{id:'P|1',quantity:100,sources:[{id:'A',quantity:90}],metrics:{received:90}},{id:'P|2',quantity:100,sources:[],metrics:{received:0}}];f.args.shipmentPlans=[{id:'P',customerId:'CA',orderId:'OA',batches:[{sequence:1,label:'Now',lines:[{taskId:'A',quantity:100}]},{sequence:2,label:'Later',lines:[{taskId:'A',quantity:100}]}]}];f.args.allocations[0].targets[0].batches=[{id:'P|1',quantity:90}];f.args.allocations[1].targets[0].batches=[{id:'P|1',quantity:10}];
 const html=f.render(),parts=html.split('data-split-parent="A"');assert.match(parts[1],/100 \| 100/);assert.match(parts[1],/data-stock-batch="P\|1"/);assert.doesNotMatch(parts[1],/supplier-head pending/);assert.match(parts[2],/100 \| 0/);assert.match(parts[2],/supplier-head pending/);assert.doesNotMatch(parts[2],/data-stock-for/);assert.equal((html.match(/data-stock-for=/g)||[]).length,1);
});
test('read-only box opens existing details and performs no mutations or saves',()=>{
 const f=fixture(),dialogs=[],saves=[];vm.runInNewContext(release.assets.get('purchase-live/customer-allocation.js').toString(),{window:f.window});
 const ui=f.window.purchaseCustomerAllocation.create({workspace:()=>f.args,dialog:(...a)=>dialogs.push(a),esc:s=>String(s??''),quantity:String,mutate:(...a)=>saves.push(a),status:()=>{},blocked:()=>false});
 assert.equal(ui.handle({dataset:{stockDetail:'A',stockSource:'FREE'}}),true);assert.match(dialogs[0][2],/STOCK-PO/);assert.match(dialogs[0][2],/Supplier/);assert.match(dialogs[0][2],/LAW/);assert.match(dialogs[0][2],/Read only/);assert.equal(dialogs[0][3],'');assert.equal(saves.length,0);
});
test('rebinding an owned source to another batch does not invent additional stock coverage',()=>{
 const f=fixture(100,0);f.row.ord=200;f.row.batchEntitlements=[{id:'P|1',quantity:100,sources:[{id:'A',quantity:100}]},{id:'P|2',quantity:100,sources:[]}];f.args.allocations[0].targets[0].batches=[{id:'P|2',quantity:100}];
 assert.equal(f.window.purchaseTaskGrid.stockCoverage(f.row,f.args.tasks,f.args.allocations,'P|2').stock,0);assert.equal(f.coverage().stock,0);
});
test('patch leaves other89 production resources exact and no backend artifact',()=>{assert.equal(release.assets.size,94);assert.equal(release.changed.length,5);for(const[file,bytes]of release.assets)if(!release.changed.includes(file))assert.ok(bytes.equals(release.baseline.get(file)),file);});
test('release dispatch excludes the general upload and Wix changes only the version marker',()=>{
 const fs=require('fs'),path=require('path'),cp=require('child_process'),root=path.resolve(__dirname,'../..');
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/pages-v64-same-origin.yml'),'utf8');assert.match(workflow,/inputs.static_ui != 'purchase-ready-stock-only'/);assert.equal((workflow.match(/inputs.static_ui == 'purchase-ready-stock-only'/g)||[]).length,2);
 const current=fs.readFileSync(path.join(root,'integration/wix/purchase-room-page.js'),'utf8').replace(/\r\n/g,'\n'),before=cp.execFileSync('git',['show','cb33884:integration/wix/purchase-room-page.js'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');assert.equal(current,before.replace('20261031-support-shortload-v1',release.build));
});
