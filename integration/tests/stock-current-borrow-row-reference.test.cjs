const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { allocationRowLabel } = require('../prototypes/stock-current-state/purchase-allocation-ui-overlay.cjs');
const checkout = path.resolve(__dirname, '../..');
function fixture() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(checkout, 'purchase-live/display-rows.js'), 'utf8'), { window });
  const workspace = { tasks: [{ id: 'A', customerId: 'C', orderId: 'O', name: 'A', ord: 100 }, { id: 'B', customerId: 'C', orderId: 'O', name: 'B', ord: 30 }],
    shipmentPlans: [{ id: 'PLAN', customerId: 'C', orderId: 'O', batches: [1, 2].map(sequence => ({ sequence, label: 'Batch ' + sequence, lines: [{ taskId: 'A', quantity: 50 }] })) }] };
  const markup = '<tr data-split-parent="A" data-split-batch="PLAN|1"><td></td><td class="row-number">001</td></tr>'
    + '<tr data-split-parent="A" data-split-batch="PLAN|2"><td></td><td class="row-number">002</td></tr>'
    + '<tr data-id="B"><td></td><td class="row-number">003</td></tr>';
  let rows = [];
  const document = { querySelectorAll(selector) { assert.equal(selector, '#taskRows tr'); return rows; } };
  function render(order, filteredMarkup = markup) {
    const html = window.purchaseDisplayRows.decorate(filteredMarkup, { ...workspace, canMove: false,
      draft: order ? { customerId: 'C', rows: order.map(([id, batch]) => window.purchaseDisplayRows.key(id, batch)) } : null });
    rows = [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map(([, attrs, body]) => ({
      dataset: { id: attrs.match(/data-id="([^"]+)"/)?.[1], splitParent: attrs.match(/data-split-parent="([^"]+)"/)?.[1] },
      querySelector(selector) { assert.equal(selector, '.row-number'); return { textContent: body.match(/class="row-number">([^<]*)/)?.[1] }; }
    }));
    return html;
  }
  return { workspace, document, render, markup, label: id => allocationRowLabel(document, workspace, id), setRows: value => { rows = value; } };
}
test('original display-row decorator resolves every current split row and follows independent moves by stable task ID', () => {
  const f = fixture(); f.render(); assert.equal(f.label('A'), 'ROWS 001, 002'); assert.equal(f.label('B'), 'ROW 003');
  f.render([['A', 'PLAN|2'], ['B', ''], ['A', 'PLAN|1']]);
  assert.equal(f.label('A'), 'ROWS 001, 003'); assert.equal(f.label('B'), 'ROW 002');
  const before = JSON.stringify(f.workspace); f.label('A'); assert.equal(JSON.stringify(f.workspace), before);
});
test('filtering or archive never borrows a stale row number from the last full view', () => {
  const f = fixture(); f.render(); assert.equal(f.label('B'), 'ROW 003');
  f.render(null, f.markup.replace(/<tr data-id="B">[\s\S]*?<\/tr>/, ''));
  assert.equal(f.label('B'), 'Not in current view 当前未显示');
  f.workspace.tasks[1].archived = true; assert.equal(f.label('B'), 'Archived 已归档');
  assert.equal(f.label('MISSING'), 'Not in current view 当前未显示');
});
test('missing or invalid visible numbers never create ROWundefined, ROWblank or duplicate references', () => {
  const f = fixture();
  f.setRows(['', '000', 'NaN', ' 102 ', '102', '105'].map(textContent => ({ dataset: { id: 'A' }, querySelector: () => ({ textContent }) })));
  assert.equal(f.label('A'), 'ROWS 102, 105');
  f.setRows([{ dataset: { splitParent: 'A' }, querySelector: () => null }]); assert.equal(f.label('A'), 'Not in current view 当前未显示');
});
test('generated ALLOC dialog embeds the exact tested resolver; all original relation submit identities remain stable IDs', () => {
  const source = fs.readFileSync(path.join(checkout, 'integration/prototypes/stock-current-state/purchase-ui/app.js'), 'utf8');
  assert.ok(source.includes('const rowLabel=id=>(' + allocationRowLabel.toString() + ')(document,data,id);'));
  assert.match(source, /operation:'BORROW_APPROVE',input/); assert.match(source, /operation:'BORROW_RETURN',input/);
  assert.doesNotMatch(allocationRowLabel.toString(), /localStorage|postMessage|\.archived\s*=|rowNumber\s*=/);
});

test('actual generated outstanding-view route supplies the same fresh row resolver instead of exposing internal task IDs', () => {
  const source=fs.readFileSync(path.join(checkout,'integration/prototypes/stock-current-state/purchase-ui/app.js'),'utf8');
  const route=source.match(/    else if\(view==='borrowing'\)\{[\s\S]*?(?=    else if\(view==='inventory'\))/)?.[0];
  assert.ok(route,'existing outstanding route required');
  let mounted,numbers=['102'];
  const data={tasks:[{id:'A'},{id:'B',archived:true}]},container={};
  const document={querySelector:()=>container,querySelectorAll:()=>numbers.map(textContent=>({dataset:{id:'A'},querySelector:()=>({textContent})}))};
  vm.runInNewContext(route.replace('else if','if'),{view:'borrowing',app:{},document,data,readOperation(){},esc:String,
    window:{purchaseBorrowOutstanding:{mount:args=>{mounted=args;}}}});
  assert.equal(typeof mounted.rowLabel,'function');assert.equal(mounted.rowLabel('A'),'ROW 102');
  numbers=['007','105'];assert.equal(mounted.rowLabel('A'),'ROWS 007, 105');
  numbers=[];assert.equal(mounted.rowLabel('A'),'Not in current view 当前未显示');assert.equal(mounted.rowLabel('B'),'Archived 已归档');
  assert.equal(mounted.rowLabel('MISSING'),'Not in current view 当前未显示');
});
