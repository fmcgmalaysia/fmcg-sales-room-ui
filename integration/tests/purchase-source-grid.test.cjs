const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const window={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../purchase-live/task-grid.js'),'utf8'),{window});
 const root={id:'R',customerId:'C',barcode:'BAR',name:'ITEM',packing:'24EA',ord:100,supplierId:'S1',gp:.2,procurement:{totalCtn:60},lpCtn:10,disc1:0,disc2:0,disc3:0,history:[]};
 const child={...root,id:'B',procurementSource:true,customerDemandTaskId:'R',supplierId:'S2',procurement:{totalCtn:40},po:'PO-B'};
 const args={rows:[root,child],tasks:[root,child],customers:[{id:'C',shortName:'BUYER'}],suppliers:[{id:'S1',name:'SUPPLIER A'},{id:'S2',name:'SUPPLIER B'}],selected:new Set(['R']),selectedSources:new Set(['R']),expanded:new Set(),active:false,canMove:true,orders:[],age:()=>'',quantityCells:row=>'<td>'+row.procurement.totalCtn+'</td><td>0</td>',drafts:new Map(),costError:()=>false,riskDeal:()=>false};
 return {root,child,args,render:()=>window.purchaseTaskGrid.render(args)};
}
test('multiple sources always show both children; disabled mother does not consume the first source selection',()=>{
 for(const active of [false,true]){
  const f=fixture();f.args.active=active;const rows=f.render().match(/<tr\b[\s\S]*?<\/tr>/g);assert.equal(rows.length,3);
  assert.match(rows[0],/data-select-kind="demand" disabled/);assert.doesNotMatch(rows[0],/ checked/);assert.match(rows[1],/data-select-kind="source"[^>]*checked/);
  assert.doesNotMatch(rows[1],/class="row-number">[^<]/);assert.match(rows[1],/<td><input[^>]*data-select-kind="source"[\s\S]*?supplier-plan-link/);
  assert.match(rows[0],/class="gp">20.00%/);assert.match(rows[1],/class="gp"><\/b>/);assert.match(rows[2],/data-source-po-task="B"/);assert.doesNotMatch(rows[0],/data-expand-task|data-po-task/);
  assert.ok(rows.every(row=>(row.match(/<td\b/g)||[]).length===(active?13:12)));
 }
});
test('one supplier has no duplicate child and keeps the normal checkbox and PO entry',()=>{
 const f=fixture();f.args.rows=f.args.tasks=[f.root];f.args.selectedSources.clear();const html=f.render();assert.equal((html.match(/<tr\b/g)||[]).length,1);assert.match(html,/data-select-kind="demand"[^>]*checked/);assert.doesNotMatch(html,/data-select-kind="demand" disabled/);assert.match(html,/data-po-task="R"/);
});
