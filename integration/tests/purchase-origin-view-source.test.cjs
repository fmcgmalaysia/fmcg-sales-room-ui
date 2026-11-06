const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const plan=require('../prototypes/purchase-origin-view-source-20261031/stage.cjs').plan();
const oldTest=fs.readFileSync(path.join(__dirname,'purchase-ready-stock-source.test.cjs'),'utf8').replace(/\r\n/g,'\n'),fixtureText=oldTest.slice(oldTest.indexOf('function fixture('),oldTest.indexOf("test('purchase90")).trim();
function fixture(stock=80,borrowed=60,outstanding=borrowed,release=plan){
 const create=vm.runInNewContext('('+fixtureText+')',{vm,release}),f=create(20,stock);
 vm.runInNewContext(release.assets.get('purchase-live/task-info.js').toString(),{window:f.window,document:{getElementById:()=>null}});
 f.row.inc=20+stock;f.row.warehouse={hasPhysicalReceipt:true,accepted:20};
 f.args.allocationContext.loans=[{id:'L',borrowerTaskId:'A',lenderTaskId:'B',borrowerBatchId:'WHOLE',quantity:60,outstanding,sources:[{sourceTaskId:'FREE',quantity:60}]}];
 f.args.allocationOrigins={known:true,loans:[{loanId:'L',borrowerTaskId:'A',borrowerBatchId:'WHOLE',known:true,batchKnown:true,repaid:outstanding===0,sources:[{sourceTaskId:'FREE',quantity:borrowed}]}]};
 const dialogs=[],saves=[];vm.runInNewContext(release.assets.get('purchase-live/customer-allocation.js').toString(),{window:f.window});
 const ui=f.window.purchaseCustomerAllocation.create({workspace:()=>f.args,dialog:(...a)=>dialogs.push(a),esc:String,quantity:String,mutate:(...a)=>saves.push(a),status(){},blocked:()=>false});
 return {...f,dialogs,saves,detail:()=>ui.handle({dataset:{stockDetail:'A',stockSource:'FREE'}}),model:()=>f.window.purchaseTaskInfo.model('A')};
}
test('real task-grid consumer reproduces the lost origin evidence before the fix, then forwards it',()=>{
 const before=fixture(80,60,60,{assets:plan.baseline});before.render();assert.equal(before.model().sources.find(row=>row.id==='FREE').kind,'Source');
 const after=fixture();after.render();assert.deepEqual(Array.from(after.model().sources.filter(row=>row.id==='FREE'),row=>[row.kind,row.quantity]),[['Stock',20],['Borrowed',60]]);
 const app=plan.assets.get('purchase-live/app.js').toString();assert.match(app,/allocationContext:data\.allocationContext,allocationOrigins:data\.allocationOrigins,shipmentPlans:/);
});
test('one mixed-source row keeps total60 while the existing View source details show Stock20 plus Borrowed40',()=>{
 const f=fixture(60,40,0),before=JSON.stringify(f.args),html=f.render();assert.equal((html.match(/data-stock-for=/g)||[]).length,1);assert.match(html,/Mixed Stock 混合来源/);assert.doesNotMatch(html,/Borrowed · Repaid 借入已补回/);
 f.detail();const detail=f.dialogs[0][2];assert.match(detail,/<td>Stock<\/td><td>20 CTN/);assert.match(detail,/<td>Borrowed · Repaid<\/td><td>40 CTN/);assert.match(detail,/Outstanding 尚欠 0 CTN/);assert.match(detail,/STOCK-PO/);assert.match(detail,/Read only/);assert.equal(f.dialogs[0][3],'');assert.equal(f.saves.length,0);assert.equal(JSON.stringify(f.args),before);
});
test('unsettled mixed-source Info and View source use the same saved quantities',()=>{const f=fixture();f.render();assert.equal(f.window.purchaseTaskInfo.allocationView(f.model()).info,true);f.detail();assert.match(f.dialogs[0][2],/<td>Stock<\/td><td>20 CTN/);assert.match(f.dialogs[0][2],/<td>Borrowed<\/td><td>60 CTN/);assert.match(f.dialogs[0][2],/Outstanding 尚欠 60 CTN/);});
test('pure borrowed stock retains the prior label; a full return leaves ordinary stock',()=>{
 const borrowed=fixture(40,40,0);assert.match(borrowed.render(),/Borrowed · Repaid 借入已补回/);borrowed.detail();assert.doesNotMatch(borrowed.dialogs[0][2],/<td>Stock<\/td>/);
 const returned=fixture(20,0,0);assert.match(returned.render(),/Ready Stock 现有库存/);assert.doesNotMatch(returned.render(),/Borrowed · Repaid/);returned.detail();assert.match(returned.dialogs[0][2],/<td>Stock<\/td><td>20 CTN/);
});
test('missing evidence stays neutral in both actual consumers, without inventing borrowed80',()=>{const f=fixture();delete f.args.allocationOrigins;assert.match(f.render(),/Stock source 库存来源/);assert.doesNotMatch(f.render(),/Borrowed Stock 借入库存/);f.detail();assert.match(f.dialogs[0][2],/<td>Source<\/td><td>80 CTN/);assert.doesNotMatch(f.dialogs[0][2],/<td>Borrowed<\/td>/);});
test('quarantine stays red and a closed or unresolved Loaded state is never rewritten',()=>{const f=fixture(60,40,0);f.args.allocationContext.sources[0].quarantined=true;f.args.deskDeliveries=[{taskId:'A',confirmed:true,loadedQty:70,issue:true,pending:false}];const before=JSON.stringify(f.args);assert.match(f.render(),/Stock review 库存待核对/);assert.equal(f.window.purchaseTaskInfo.allocationView(f.model()).settled,false);assert.equal(JSON.stringify(f.args),before);});
test('no-loan source details preserve original behavior and perform no save',()=>{const f=fixture();f.args.allocationContext.loans=[];f.render();f.detail();assert.doesNotMatch(f.dialogs[0][2],/<td>Stock<\/td>|Borrowed from/);assert.match(f.dialogs[0][2],/Customer source 本客户来源/);assert.equal(f.saves.length,0);});
test('normal, partial and no-stock task tables remain byte-identical to the deployed version',()=>{for(const stock of [0,10,80]){const current=fixture(stock,0,0),before=fixture(stock,0,0,{assets:plan.baseline});current.args.allocationContext.loans=[];before.args.allocationContext.loans=[];assert.equal(current.render(),before.render());}});
test('a split Desk forwards origin evidence without lending cartons to another batch',()=>{const f=fixture();f.row.ord=200;f.row.batchEntitlements=[{id:'P|1',quantity:100,sources:[{id:'A',quantity:20}],metrics:{received:100}},{id:'P|2',quantity:100,sources:[],metrics:{received:0}}];f.args.shipmentPlans=[{id:'P',customerId:'CA',orderId:'OA',batches:[{sequence:1,label:'Now',lines:[{taskId:'A',quantity:100}]},{sequence:2,label:'Later',lines:[{taskId:'A',quantity:100}]}]}];f.args.allocations[0].targets[0].batches=[{id:'P|1',quantity:20}];f.args.allocations[1].targets[0].batches=[{id:'P|1',quantity:80}];f.args.allocationContext.loans[0].borrowerBatchId='P|1';f.args.allocationOrigins.loans[0].borrowerBatchId='P|1';const html=f.render();assert.equal((html.match(/data-stock-for=/g)||[]).length,1);assert.match(html,/Mixed Stock 混合来源/);assert.match(html,/data-stock-batch="P\|1"/);assert.doesNotMatch(html,/data-stock-batch="P\|2"/);});
test('only four Purchase display assets change; every other asset and all existing write handlers remain exact',()=>{
 assert.equal(plan.assets.size,99);assert.deepEqual(plan.changed.sort(),['purchase-live/app.js','purchase-live/customer-allocation.js','purchase-live/index.html','purchase-live/task-grid.js']);
 for(const[file,bytes]of plan.assets)if(!plan.changed.includes(file))assert(bytes.equals(plan.baseline.get(file)),file);
 const code=plan.assets.get('purchase-live/customer-allocation.js').toString(),before=plan.baseline.get('purchase-live/customer-allocation.js').toString();assert.equal(code.slice(0,code.indexOf('  function stockDetail(')),before.slice(0,before.indexOf('  function stockDetail(')));assert.equal(code.slice(code.indexOf('  function handle(')),before.slice(before.indexOf('  function handle(')));
 for(const[file,bytes]of plan.assets)if(file.endsWith('.js'))new vm.Script(bytes.toString(),{filename:file});
 const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/pages-v64-same-origin.yml'),'utf8');assert(workflow.includes("inputs.static_ui != 'purchase-origin-view-source-only'"));assert.equal((workflow.match(/inputs.static_ui == 'purchase-origin-view-source-only'/g)||[]).length,2);
});
