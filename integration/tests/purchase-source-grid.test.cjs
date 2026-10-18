const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const window={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../purchase-live/task-grid.js'),'utf8'),{window});
 const root={id:'R',customerId:'C',barcode:'BAR',name:'ITEM',packing:'24EA',ord:100,supplierId:'S1',gp:.2,procurement:{totalCtn:60,revision:'P1'},lpCtn:10,disc1:0,disc2:0,disc3:0,history:[],masterReceivedAt:'original-intake'};
 const child={...root,id:'B',procurementSource:true,customerDemandTaskId:'R',supplierId:'S2',procurement:{totalCtn:40,revision:'P2'},po:'PO-B'};
 const args={rows:[root,child],tasks:[root,child],customers:[{id:'C',shortName:'BUYER'}],suppliers:[{id:'S1',name:'SUPPLIER A'},{id:'S2',name:'SUPPLIER B'}],selected:new Set(['R']),selectedSources:new Set(['R']),expanded:new Set(),active:false,canMove:true,orders:[],age:value=>value||'',quantityCells:row=>'<td>'+row.procurement.totalCtn+'</td><td>0</td>',drafts:new Map(),costError:()=>false,riskDeal:()=>false};
 return {root,child,args,grid:window.purchaseTaskGrid,render:()=>window.purchaseTaskGrid.render(args)};
}
test('multiple sources always show both children; disabled mother does not consume the first source selection',()=>{
 for(const active of [false,true]){
  const f=fixture();f.args.active=active;const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.equal(rows.length,3);
  assert.match(rows[0],/data-select-kind="demand" disabled/);assert.doesNotMatch(rows[0],/ checked/);assert.match(rows[1],/data-select-kind="source"[^>]*checked/);
  assert.match(rows[1],/class="row-number"><input[^>]*data-select-kind="source"/);assert.match(rows[0],/class="received-age">original-intake<\/td>/);for(const sourceRow of rows.slice(1))assert.match(sourceRow,active?/class="received-age"><\/td>/:/class="received-age">original-intake<\/td>/);assert.doesNotMatch(rows[1],/class="supplier-cell">[\s\S]*?<input/);
  assert.doesNotMatch(rows[0],/progress-node|data-progress-task/);assert.equal((rows[1].match(/class="progress-node /g)||[]).length,active?0:7);assert.equal((rows[2].match(/class="progress-node /g)||[]).length,active?0:7);if(active){assert.match(rows[0],/class="barcode">BAR<span class="gp gp-badge gp-good"[^>]*>20\.00%/);assert.doesNotMatch(rows[1],/gp-badge/);}else{assert.match(rows[0],/class="gp">20.00%/);assert.match(rows[1],/class="gp"><\/b>/);}assert.match(rows[2],/data-source-po-task="B"/);assert.doesNotMatch(rows[0],/data-expand-task|data-po-task/);
  assert.ok(rows.every(row=>(row.match(/<td\b/g)||[]).length===(active?11:12)));
 }
});
test('two saved supplier heads plus one remainder head do not invent a third source, amount or PO',()=>{
 for(const active of [false,true]){
  const f=fixture();f.root.ord=120;f.args.active=active;const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.equal(rows.length,4);
  assert.equal((rows[0].match(/supplier-head complete/g)||[]).length,2);assert.equal((rows[0].match(/supplier-head pending/g)||[]).length,1);assert.doesNotMatch(rows[0],/2 Suppliers|SUPPLIER A|SUPPLIER B/);
  assert.match(rows[1],/SUPPLIER A/);assert.match(rows[2],/SUPPLIER B/);assert.match(rows[3],/data-waiting-for="R"/);assert.match(rows[3],/class="order-quantity">20<\/td>/);assert.match(rows[3],/data-plan-task="R"/);assert.doesNotMatch(rows[3],/data-select|data-source-id|data-po-task|data-source-po-task|1,000|600/);assert.equal(f.args.tasks.length,2);
  assert.ok(rows.every(row=>(row.match(/<td\b/g)||[]).length===(active?11:12)));
 }
});
test('unconfirmed and unsaved supplier choices stay orange; PO color follows saved association only',()=>{
 const f=fixture();f.args.rows=f.args.tasks=[f.root];f.root.procurement={totalCtn:null,revision:''};let html=f.render();assert.match(html,/supplier-head pending/);assert.doesNotMatch(html,/supplier-head complete|SUPPLIER A/);assert.match(html,/po-reference pending/);
 f.root.procurement={totalCtn:60,revision:'P1'};f.root.po='PO-1';html=f.render();assert.match(html,/SUPPLIER A/);assert.match(html,/po-reference complete/);
 f.args.drafts.set('R',{changes:{supplierId:'S2'}});html=f.render();assert.match(html,/supplier-head pending/);assert.doesNotMatch(html,/SUPPLIER B/);
});
test('ordinary partial receipt stays waiting; explicit review problems override a completed check',()=>{
 const f=fixture();f.root.po='PO-A';f.root.warehouse={accepted:10,hasPhysicalReceipt:true,issue:false};let states=f.grid.progressStates([f.root],[]);assert.equal(states[0],'complete');assert.equal(states[3],'pending');
 states=f.grid.progressStates([f.root],[{taskIds:['R'],invoiceChecked:true,reviewRequired:true}]);assert.equal(states[1],'problem');
 f.root.warehouse.issue=true;assert.equal(f.grid.progressStates([f.root],[])[3],'problem');
});

test('mother progress waits for every source and unplaced demand while preserving source completion and problem priority',()=>{
 const f=fixture();f.root.po='PO-A';assert.equal(f.grid.summaryProgressStates(f.root,[f.root,f.child],[])[0],'complete');
 f.child.po='';assert.equal(f.grid.summaryProgressStates(f.root,[f.root,f.child],[])[0],'pending');assert.equal(f.grid.progressStates([f.root],[])[0],'complete');
 f.child.po='PO-B';f.root.ord=120;assert.equal(f.grid.summaryProgressStates(f.root,[f.root,f.child],[])[0],'pending');assert.equal(f.grid.progressStates([f.child],[])[0],'complete');
 f.child.warehouse={issue:true};assert.equal(f.grid.summaryProgressStates(f.root,[f.root,f.child],[])[3],'problem');
 const waiting=f.render().match(/<tr class="source-row waiting-row"[\s\S]*?<\/tr>/)[0];assert.doesNotMatch(waiting,/progress-node|data-progress-task/);
 const g=fixture();for(const row of [g.root,g.child]){row.po='PO';row.procurement.availableCtn=0;row.warehouse={accepted:row.procurement.totalCtn,hasPhysicalReceipt:true};row.salesInvoiceLocked=true;row.archived=true;}const orders=[{taskIds:['R','B'],invoiceChecked:true,paymentCompleted:true}];assert.deepEqual(Array.from(g.grid.summaryProgressStates(g.root,[g.root,g.child],orders)),Array(7).fill('complete'));g.root.ord=120;assert.deepEqual(Array.from(g.grid.summaryProgressStates(g.root,[g.root,g.child],orders)),Array(7).fill('pending'));orders[0].reviewRequired=true;assert.equal(g.grid.summaryProgressStates(g.root,[g.root,g.child],orders)[1],'problem');
});
test('one supplier has no duplicate child and keeps the normal checkbox and PO entry',()=>{
 const f=fixture();f.args.rows=f.args.tasks=[f.root];f.args.selectedSources.clear();const html=f.render();assert.equal((html.match(/<tr\b/g)||[]).length,1);assert.match(html,/data-select-kind="demand"[^>]*checked/);assert.doesNotMatch(html,/data-select-kind="demand" disabled/);assert.match(html,/data-po-task="R"/);assert.equal((html.match(/class="progress-node /g)||[]).length,7);
});

test('Active GP uses a red capsule only below six percent and has no Progress column',()=>{
 const f=fixture();f.args.active=true;
 for(const [gp,low]of [[.059,true],[.06,false],[.061,false],[0,true],[-.1,true],[NaN,false]]){f.root.gp=gp;const html=f.render(),rows=html.match(/<tr\b[\s\S]*?<\/tr>/g);assert.equal(rows[0].includes('class="gp gp-badge gp-low"'),low);assert.doesNotMatch(rows[1],/gp-low/);assert.doesNotMatch(rows[0],/progress-node/);assert.doesNotMatch(rows[1],/progress-node|data-progress-task/);}
 f.root.gp=.059;f.args.drafts.set('R',{changes:{lpCtn:12}});assert.doesNotMatch(f.render(),/gp-low/);
 f.args.active=false;f.args.drafts.clear();f.root.gp=.01;const room=f.render();assert.doesNotMatch(room,/gp-low|aria-hidden="true">[1-7]<\/span>/);
});

test('active single supplier saved35 against demand50 shows mother, supplier child35 and waiting15 without creating a new source',()=>{
 const f=fixture();f.args.active=true;f.root.ord=50;f.root.procurement={revision:'P35',totalCtn:35,customerCtn:35};f.args.rows=f.args.tasks=[f.root];const html=f.render(),rows=html.match(/<tr\b[\s\S]*?<\/tr>/g);assert.equal(rows.length,3);assert.match(rows[0],/data-select-kind="demand" disabled/);assert.match(rows[1],/data-source-id="R"/);assert.match(rows[1],/data-source-po-task="R"/);assert.match(rows[2],/data-waiting-for="R"/);assert.match(rows[2],/order-quantity">15</);assert.equal(f.args.tasks.length,1);
});

test('partial allocation shows GP on saved children only and switches to mother aggregate once fully allocated',()=>{
 const f=fixture();f.args.active=true;f.root.ord=120;f.root.sourceGp=.25;f.child.sourceGp=.1;
 let rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.doesNotMatch(rows[0],/gp-badge/);assert.match(rows[1],/aria-label="GP 25\.00%"/);assert.match(rows[2],/aria-label="GP 10\.00%"/);assert.doesNotMatch(rows[3],/gp-badge/);
 f.child.procurement.revision='';f.child.po='';rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.match(rows[1],/aria-label="GP 25\.00%"/);assert.doesNotMatch(rows[2],/gp-badge/);
 f.child.procurement.revision='P2';f.root.ord=100;rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.match(rows[0],/aria-label="GP 20\.00%"/);for(const row of rows.slice(1))assert.doesNotMatch(row,/gp-badge/);
});

test('a single partially assigned supplier uses its own GP despite sharing the mother record ID',()=>{
 const f=fixture();f.args.active=true;f.args.rows=f.args.tasks=[f.root];f.root.procurement.totalCtn=35;f.root.sourceGp=.125;
 const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.doesNotMatch(rows[0],/gp-badge/);assert.match(rows[1],/aria-label="GP 12.50%"/);assert.doesNotMatch(rows[2],/gp-badge/);
 f.args.drafts.set('R',{changes:{lpCtn:20}});assert.doesNotMatch(f.render(),/gp-badge/);
});

test('GP capsules keep two decimals on mother and source rows including whole, fractional, zero and negative percentages',()=>{
 for(const [gp,formatted]of [[.12,'12.00%'],[.123456,'12.35%'],[0,'0.00%'],[-.0014,'-0.14%']]){
  const f=fixture();f.args.active=true;f.root.gp=gp;assert.ok(f.render().includes('aria-label="GP '+formatted+'"'));
  f.root.ord=120;f.root.sourceGp=gp;f.child.sourceGp=gp;const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.doesNotMatch(rows[0],/gp-badge/);for(const row of rows.slice(1,3))assert.ok(row.includes('aria-label="GP '+formatted+'"'));assert.doesNotMatch(rows[3],/gp-badge/);
 }
});

function financialCells(html,active=false){const cells=html.match(/<td\b[\s\S]*?<\/td>/g);return {cost:cells[active?7:7].replace(/<[^>]*>/g,''),amount:cells[active?9:8].replace(/<[^>]*>/g,'')};}
test('task costs use whole saved procurement including surplus, preserving customer quantity and source amounts',()=>{
 for(const active of [false,true]){const f=fixture();f.args.active=active;f.root.procurement.expectedExtra=0;f.child.procurement={revision:'P2',totalCtn:50,expectedExtra:10};f.child.lpCtn=20;
 const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.deepEqual(financialCells(rows[0],active),{cost:'14.55',amount:'1,600.00'});assert.deepEqual(financialCells(rows[1],active),{cost:'10.00',amount:'600.00'});assert.deepEqual(financialCells(rows[2],active),{cost:'20.00',amount:'1,000.00'});assert.match(rows[0],/已保存采购 110 CTN/);assert.equal(f.grid.totals([f.root,f.child]).customerQty,100);assert.equal(f.root.ord,100);
 }
});
test('FOC average derives from saved cents and all cartons without multiplying rounded display values',()=>{
 const f=fixture();f.args.rows=f.args.tasks=[f.root];f.root.lpCtn=90.909090909;f.root.procurement={revision:'FOC',totalCtn:110,expectedExtra:10,costing:{mode:'FOC',paidCtn:100,freeCtn:10,amountCents:1000000,averageCostCtn:90.909090909}};assert.deepEqual(financialCells(f.render()),{cost:'90.91',amount:'10,000.00'});assert.equal(f.grid.totals([f.root]).customerQty,100);
});
test('unplaced demand shows no reference or unsaved prices as procurement costs',()=>{
 for(const procurement of [{totalCtn:null,revision:''},{totalCtn:60,revision:''}]){const f=fixture();f.args.rows=f.args.tasks=[f.root];f.root.procurement=procurement;f.root.netCostCtn=88;assert.deepEqual(financialCells(f.render()),{cost:'—',amount:'—'});}
 const f=fixture();f.args.rows=f.args.tasks=[f.root];f.root.lpCtn=null;f.root.netCostCtn=88;assert.deepEqual(financialCells(f.render()),{cost:'—',amount:'—'});
});
test('partial35 against demand50 keeps saved costs and leaves remainder without an invented amount',()=>{
 const f=fixture();f.args.active=true;f.args.rows=f.args.tasks=[f.root];f.root.ord=50;f.root.procurement={revision:'P35',totalCtn:35,expectedExtra:0};const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.deepEqual(financialCells(rows[0],true),{cost:'10.00',amount:'350.00'});assert.deepEqual(financialCells(rows[1],true),{cost:'10.00',amount:'350.00'});assert.match(rows[2],/order-quantity">15</);assert.doesNotMatch(rows[2],/350.00|10.00/);
});
test('price drafts do not alter saved task-list costs and legacy assigned PO retains its amount',()=>{
 const f=fixture();f.args.rows=f.args.tasks=[f.root];f.root.procurement={totalCtn:60};f.root.po='LEGACY-PO';f.args.drafts.set('R',{changes:{lpCtn:999,disc1:.5}});assert.deepEqual(financialCells(f.render()),{cost:'10.00',amount:'600.00'});assert.equal(f.args.drafts.get('R').changes.lpCtn,999);assert.equal(f.root.lpCtn,10);
});

test('active order quantities omit unplaced chips while receipt issues and legacy room remain actionable',()=>{
 const f=fixture(); f.root.ord=120;
 f.args.quantityCells=()=>'<td class="order-quantity">120 | 100<button class="quantity-case pending" data-quantity-case="U" aria-label="Unplaced / 未采购 20" title="Purchase">−20</button></td><td class="received-quantity">90<button class="quantity-case pending" data-quantity-case="R" aria-label="Receiving issue / 收货异常 10" title="Warehouse">−10</button></td>';
 const before=JSON.stringify(f.args.tasks);f.args.active=true;let html=f.render();
 assert.doesNotMatch(html,/data-quantity-case="U"/);assert.equal((html.match(/data-quantity-case="R"/g)||[]).length,3);
 assert.match(html,/data-waiting-for="R"/);assert.match(html,/class="order-quantity">20<\/td>/);assert.equal(JSON.stringify(f.args.tasks),before);
 f.args.active=false;html=f.render();assert.equal((html.match(/data-quantity-case="U"/g)||[]).length,3);
});
test('unknown or unconfirmed procurement never displays a GP capsule even when an upstream GP is present',()=>{
 for(const active of [false,true])for(const kind of ['unplanned','reference-only','missing-source-cost','partial']){
  const f=fixture();f.args.active=active;
  if(kind==='unplanned')for(const row of [f.root,f.child])row.procurement={totalCtn:null,revision:''};
  if(kind==='reference-only')for(const row of [f.root,f.child])row.procurement.revision='';
  if(kind==='missing-source-cost')f.child.disc3=null;
  if(kind==='partial')f.root.ord=120;
  const html=f.render();assert.doesNotMatch(html,/gp-badge/);if(!active)assert.match(html,/<b class="gp">—<\/b>/);
 }
});
