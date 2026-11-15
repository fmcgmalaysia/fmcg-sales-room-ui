const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scope = {window:{}};
for (const file of ['display-rows.js','task-grid.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live',file),'utf8'),scope);
}
const grid = scope.window.purchaseTaskGrid;
const task = (id, overrides = {}) => ({id, customerId:id, orderId:'O'+id, name:'Biscuit '+id,
  barcode:'0955123456789', packing:'24 x 1', ord:150, history:[], warehouse:{}, ...overrides});
const qtyCells = () => '<td class="order-quantity">150</td><td class="received-quantity">0</td>';

function render(tasks, inquiry = null, options = {}) {
  return grid.render({rows:tasks,tasks,customers:[],suppliers:[],orders:[],
    active:true,canMove:!inquiry,expanded:new Set(),selected:new Set(),selectedSources:new Set(),
    age:()=>'',quantityCells:qtyCells,drafts:new Map(),riskDeal:()=>'',supplierIcon:'',inquiry,...options});
}
const selection = () => ({rows:new Map(),selected:new Set()});

test('normal PO selection still obeys the existing guard, while inquiry supports multiple customers', () => {
  const rows = [task('A'),task('B')];
  const normal = render(rows,null,{selectionIssue:r=>r.id==='B'?'Only the same supplier':''});
  assert.match(normal,/data-select="B"[^>]+disabled/);
  assert.doesNotMatch(normal,/data-inquiry-select/);
  const inquiry = selection();inquiry.selected.add('A');inquiry.selected.add('B');
  const html = render(rows,inquiry);
  assert.match(html,/data-inquiry-select="A"[^>]+checked/);
  assert.match(html,/data-inquiry-select="B"[^>]+checked/);
  assert.doesNotMatch(html,/data-select=|data-select-batch=/);
  assert.equal(inquiry.rows.size,2);
});

test('partially arranged demand is selectable once on its waiting row', () => {
  const root=task('A',{supplierId:'S',procurement:{revision:'R',totalCtn:100}});
  const inquiry=selection(),html=render([root],inquiry);
  assert.equal(inquiry.rows.get('A').qty,50);
  assert.equal((html.match(/data-inquiry-select="A"/g)||[]).length,1);
  assert.match(html,/data-waiting-for="A"><td><input[^>]+50 CTN/);
});

test('stock coverage, fully placed, pending and locked demand are excluded', () => {
  const inquiry=selection();
  const rows=[task('STOCK'),task('PLACED',{supplyAllocation:{unplaced:0}}),task('LOCK',{salesInvoiceLocked:true}),
    task('DRAFT',{procurementSavePending:true}),task('DONE',{archived:true}),task('AVAILABLE')];
  render(rows,inquiry,{allocations:[{sourceTaskId:'STORAGE',targets:[{taskId:'STOCK',quantity:150}]}]});
  assert.deepEqual([...inquiry.rows.keys()],['AVAILABLE']);
});

test('shipment display splits keep a single inquiry checkbox for the demand', () => {
  const root=task('A'), inquiry=selection();
  const html=render([root],inquiry,{shipmentPlans:[{id:'P',customerId:'A',orderId:'OA',batches:[
    {sequence:1,label:'First',lines:[{taskId:'A',quantity:100}]},
    {sequence:2,label:'Second',lines:[{taskId:'A',quantity:50}]}
  ]}]});
  assert.equal((html.match(/data-inquiry-select="A"/g)||[]).length,1);
  assert.equal(inquiry.rows.get('A').qty,150);
  assert.doesNotMatch(html,/data-select-batch=/);
});

test('clipboard text keeps the leading zero and omits all commercial and customer fields', () => {
  const result=grid.inquiryText([{...task('A',{customerId:'PRIVATE',cost:99}),qty:50}]);
  assert.equal(result,'Biscuit A · 24 x 1\n0955123456789 · 50 CTN');
});

test('copy includes only selected rows and provides a selectable fallback if clipboard is blocked', async () => {
  const app=fs.readFileSync(path.join(__dirname,'../../purchase-live/app.js'),'utf8');
  const start=app.indexOf('  async function copySupplierInquiry()');
  const end=app.indexOf('  function compactTaskHeading()',start);
  async function run(blocked) {
    const writes=[],dialogs=[],statuses=[];
    const scope={view:'active',inquiry:{selected:new Set(['A']),rows:new Map([
      ['A',{...task('A'),qty:50}], ['B',{...task('B'),qty:100}]
    ])},window:{purchaseTaskGrid:grid},navigator:{clipboard:{async writeText(text){
      if(blocked)throw Error('Clipboard blocked');writes.push(text);
    }}},showStatus:text=>statuses.push(text),formDialog:(...args)=>dialogs.push(args),
    esc:String,document:{getElementById:()=>({focus(){},select(){}})}};
    const copy=vm.runInNewContext(app.slice(start,end)+'\ncopySupplierInquiry',scope);
    await copy();return {writes,dialogs,statuses};
  }
  const success=await run(false);
  assert.deepEqual(success.writes,['Biscuit A · 24 x 1\n0955123456789 · 50 CTN']);
  assert.deepEqual(success.statuses,['Copied · 1 item.']);
  const fallback=await run(true);
  assert.match(fallback.dialogs[0][2],/textarea[^>]+readonly/);
  assert.doesNotMatch(fallback.dialogs[0][2],/Biscuit B/);
});
