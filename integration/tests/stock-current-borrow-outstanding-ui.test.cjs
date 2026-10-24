const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), flush = () => new Promise(resolve => setImmediate(resolve)), copy = x => JSON.parse(JSON.stringify(x));
function fixture() {
  const requests = [], returnPanels = [], nodes = new Map(); let html = '';
  const container = { isConnected: true, querySelector: selector => nodes.get(selector), get innerHTML() { return html; },
    set innerHTML(value) { html = value; nodes.clear(); for (const m of value.matchAll(/data-(borrow-outstanding-[a-z]+)/g)) nodes.set('[data-'+m[1]+']', {}); } };
  const window = { purchaseBorrowReturn: { mount: args => returnPanels.push(args) } };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'purchase-ui/borrow-outstanding.js'), 'utf8'), { window });
  const workspace = { company: 'NCT', stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: 8, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 8 },
    tasks: [{ id: 'A', customerId: 'CA', archived: true, name: 'Product', barcode: '0001', packing: '24x1' },
      { id: 'B', customerId: 'CB', archived: true, stockTransferOutstanding: true }, { id: 'SA', po: 'PO-A' },{ id: 'SB', po: '<img onerror=x>' }],
    customers: [{ id: 'CA', shortName: 'Customer A' },{ id: 'CB', shortName: 'Customer B' }] };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const read = (type, args) => new Promise((resolve, reject) => requests.push({ type, args: copy(args), resolve, reject }));
  const relation = i => ({ id: 'R'+i, borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA',
    quantity: 30, repaid: 5, returned: 5, remaining: 20, revision: 11 });
  const args = { container, workspace, read, esc, rowLabel: id => id === 'A' ? 'ROW 001' : 'ROW 158', canSubmit: () => true, submitReturn() {} };
  const mount = () => window.purchaseBorrowOutstanding.mount(args);
  const reply = (total = 1, offset = 0, patch = {}) => {
    const items = Array.from({ length: Math.min(25, total - offset) }, (_, i) => relation(i+offset));
    requests.at(-1).resolve({ ok: true, schema: 'CURRENT_BORROW_RELATIONS_V1', company: 'NCT', view: 'OUTSTANDING', taskId: null,
      generation: 8, version: 'a'.repeat(32), halo: total > 0, total, offset, items,
      nextCursor: offset+items.length<total ? { version: 'a'.repeat(32), offset: offset+items.length } : null, ...patch });
  };
  return { workspace, requests, returnPanels, container, relation, args, mount, reply, button: key => nodes.get('[data-borrow-outstanding-'+key+']') };
}

test('outstanding debt remains visible when BOTH customer tasks are archived; uses company relation query rather than room rows', async () => {
  const f = fixture(); f.mount(); assert.deepEqual(copy(f.requests[0]), { type: 'PURCHASE_BORROW_RELATIONS_REQUEST', args: { input: { view: 'OUTSTANDING', pageSize: 25 } } });
  f.reply(); await flush(); const html = f.container.innerHTML;
  assert.match(html, /Customer A/); assert.match(html, /Customer B/); assert.match(html, /History 历史行/); assert.match(html, /ROW 158/);
  assert.match(html, /0001/); assert.match(html, /PO-A/); assert.equal(html.includes('<img'), false); assert.match(html, /&lt;img onerror=x&gt;/);
  assert.match(html, /borrow-outstanding-qty">20/); assert.match(html, /归档不等于调货结清/);
  assert.equal(f.returnPanels.length, 1); assert.equal(f.returnPanels[0].relations[0].id, 'R0'); assert.equal(f.returnPanels[0].isCurrent(), true);
  assert.equal(f.workspace.tasks[1].stockTransferOutstanding, true);
});

test('pages company-wide relationships completely without summing unlike products or clearing unseen debt', async () => {
  const f = fixture(); f.mount(); f.reply(26); await flush(); assert.match(f.container.innerHTML, /1–25 · 26/);
  const oldReturn = f.returnPanels[0]; f.button('next').onclick(); assert.equal(oldReturn.isCurrent(), false);
  assert.deepEqual(f.requests.at(-1).args.input.cursor, { version: 'a'.repeat(32), offset: 25 });
  f.reply(26,25); await flush(); assert.match(f.container.innerHTML, /26–26 · 26/); assert.equal(f.button('next'), undefined);
  assert.equal(f.returnPanels.at(-1).relations[0].id, 'R25'); f.button('prev').onclick(); assert.equal(f.requests.at(-1).args.input.cursor, undefined);
  f.reply(26); await flush(); assert.equal(f.workspace.tasks[1].stockTransferOutstanding, true);
});

test('unknown/incomplete/stale/foreign/corrupt pages are not shown as zero or settled', async () => {
  for (const patch of [{ ok: false },{ company: 'GHR' },{ generation: 9 },{ view: 'TASK' },{ taskId: 'A' },{ items: [] },{ halo: false },
    { total: 0, items: [], halo: false, nextCursor: null },{ items: [{ id: 'R' }] }]) {
    const f = fixture(); f.mount(); f.reply(1,0,patch); await flush(); assert.match(f.container.innerHTML, /error/);
    assert.equal(f.container.innerHTML.includes('No outstanding borrowing'), false); assert.equal(f.workspace.tasks[1].stockTransferOutstanding, true); assert.equal(f.returnPanels.length, 0);
  }
  const f = fixture(); f.mount(); f.reply(2,0,{ items: [f.relation(0),f.relation(0)] }); await flush(); assert.match(f.container.innerHTML, /error/);
});

test('empty confirmed company index is allowed, but legacy or unknown mode never queries current debt', async () => {
  const f = fixture(); f.workspace.tasks.forEach(task => { task.stockTransferOutstanding = false; }); f.mount(); f.reply(0); await flush();
  assert.match(f.container.innerHTML, /No outstanding borrowing/); assert.equal(f.returnPanels.length, 0);
  const g = fixture(); delete g.workspace.stockCurrent; g.mount(); assert.equal(g.requests.length, 0); assert.match(g.container.innerHTML, /尚未启用/);
  const h = fixture(); h.workspace.stockCurrent.stockGeneration = null; h.mount(); assert.equal(h.requests.length, 0);
});

test('navigation, replaced render and network failure invalidate old panels and preserve explicit retry', async () => {
  const f = fixture(); f.mount(); const old = f.requests[0]; f.mount(); f.reply(); await flush(); const html = f.container.innerHTML;
  old.resolve({ ok: false }); await flush(); assert.equal(f.container.innerHTML, html);
  const g = fixture(); g.mount(); g.requests[0].reject(Error('Network unavailable')); await flush(); assert.match(g.container.innerHTML, /Network unavailable/);
  g.button('retry').onclick(); g.reply(); await flush(); assert.match(g.container.innerHTML, /Customer A/);
  const h = fixture(); h.mount(); h.container.isConnected = false; h.reply(); await flush(); assert.equal(h.returnPanels.length, 0);
});

test('candidate adds only hidden-by-default navigation/view and existing return-save tracker; original legacy source stays untouched', () => {
  for (const script of ['build-purchase-current-ui.cjs','build-purchase-borrow-panel.cjs']) assert.match(execFileSync(process.execPath, [path.join(folder, script),'--check'], { encoding: 'utf8' }), /verified/);
  const index = fs.readFileSync(path.join(folder, 'purchase-ui/index.html'), 'utf8'), app = fs.readFileSync(path.join(folder, 'purchase-ui/app.js'), 'utf8');
  assert.ok(index.includes('data-view="borrowing" hidden')); assert.ok(index.includes('borrow-outstanding.js?v=20261022-stock-current-candidate-v2'));
  assert.match(app, /borrowNav.hidden=!\(data.stockCurrent\?\.schema==='PURCHASE_TRANSFERS_V2'/);
  assert.match(app, /submitReturn:input=>\{if\(modal.open\|\|savePending\|\|drafts.size/); assert.match(app, /mutate\('PURCHASE_SAVE_REQUEST',\{operation:'BORROW_RETURN',input\}\)/);
  const original = fs.readFileSync(path.join(__dirname,'../../purchase-live/app.js'), 'utf8'); assert.equal(original.includes('purchaseBorrowOutstanding'), false);
});
