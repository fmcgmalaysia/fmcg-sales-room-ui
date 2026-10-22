const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), flush = () => new Promise(resolve => setImmediate(resolve)), copy = x => JSON.parse(JSON.stringify(x));
function fixture() {
  const window = {}, requests = [], submitted = [], container = { children: [], appendChild(n) { this.children.push(n); n.isConnected = true; } };
  function node() { let html = ''; const nodes = new Map(); return { isConnected: false, value: '', textContent: '', disabled: false,
    setAttribute() {}, remove() { this.isConnected = false; container.children = container.children.filter(n => n !== this); },
    querySelector: selector => nodes.get(selector), get innerHTML() { return html; }, set innerHTML(value) { html = value; nodes.clear();
      for (const m of value.matchAll(/data-(borrow-return-[a-z]+)/g)) nodes.set('[data-'+m[1]+']', node()); } }; }
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'purchase-ui/borrow-return.js'), 'utf8'), { window, document: { createElement: node } });
  const relation = { id: 'R', borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', remaining: 30 };
  const workspace = { company: 'NCT', stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: 8, stockGeneration: 8, stockProtocol: 1, stockBuild: 'TEST' },
    tasks: [{ id: 'A', customerId: 'CA' },{ id: 'B', customerId: 'CB' }], customers: [{ id: 'CA', name: '<img onerror=x>' },{ id: 'CB', shortName: 'Customer B' }] };
  let ready = true, current = true, submitError;
  const args = { container, workspace, relations: [relation], rowLabel: id => id === 'A' ? 'ROW 001' : 'ROW 158', isCurrent: () => current,
    canSubmit: () => ready, esc: s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
    read: (type, data) => new Promise((resolve, reject) => requests.push({ type, data: copy(data), resolve, reject })),
    submit: input => { if (submitError) throw Error(submitError); submitted.push(copy(input)); } };
  const mount = () => window.purchaseBorrowReturn.mount(args), section = () => container.children.at(-1), element = name => section().querySelector('[data-borrow-return-'+name+']');
  const reply = patch => requests.at(-1).resolve({ ok: true, schema: 'CURRENT_BORROW_RETURN_OPTIONS_V2', company: 'NCT', relationId: relation.id,
    borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', expectedRevision: 15, remaining: 30, maximumQuantity: 12,
    stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 8 }, ...patch });
  const check = () => { element('choice').value = '0'; return element('check').onclick(); };
  return { args, workspace, requests, submitted, mount, section, element, reply, check, container,
    ready: value => { ready = value; }, current: value => { current = value; }, failSubmit: value => { submitError = value; } };
}

test('unused return checks exact relation/current ownership before showing bounded approval, never debt-as-stock', async () => {
  const f = fixture(); f.mount(); assert.equal(f.requests.length, 0); assert.equal(f.element('approve'), undefined);
  assert.equal(f.section().innerHTML.includes('<img'), false); assert.match(f.section().innerHTML, /不代替到货自动补回/);
  f.check(); assert.deepEqual(f.requests[0].data, { input: { relationId: 'R' } }); assert.equal(f.requests[0].type, 'PURCHASE_BORROW_RETURN_OPTIONS_REQUEST');
  f.reply(); await flush(); assert.match(f.section().innerHTML, /Max 最多 12/); assert.match(f.section().innerHTML, /借出采购单 SB.*补回采购单 SA/);
  // The actual HTML maximum, not the outstanding30, bounds the quantity.
  assert.match(f.section().innerHTML, /max="12"/); f.element('quantity').value = '10'; f.element('reason').value = ' Unused cartons ';
  f.element('approve').onclick(); f.element('approve').onclick(); assert.equal(f.submitted.length, 1);
  assert.deepEqual(f.submitted[0], { relationId: 'R', expectedRevision: 15, quantity: 10, reason: 'Unused cartons' });
  assert.equal('approvedBy' in f.submitted[0], false); assert.match(f.element('error').textContent, /原保存进度/);
});

test('zero returnable qty preserves outstanding debt; malformed/unknown quote never produces an approval', async () => {
  const zero = fixture(); zero.mount(); zero.check(); zero.reply({ maximumQuantity: 0 }); await flush();
  assert.match(zero.element('status').textContent, /欠补关系仍保留/); assert.equal(zero.element('approve'), undefined); assert.equal(zero.submitted.length, 0);
  for (const patch of [{ company: 'GHR' },{ ok: false },{ relationId: 'OTHER' },{ expectedRevision: undefined },{ maximumQuantity: null },
    { maximumQuantity: 31 },{ remaining: 29 },{ lenderSourceId: 'OTHER' },{ stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 9 } }]) {
    const f = fixture(); f.mount(); f.check(); f.reply(patch); await flush(); assert.equal(f.element('approve'), undefined);
    assert.match(f.element('status').textContent, /尚未确认/); assert.equal(f.submitted.length, 0);
  }
});

test('edits/pending save, invalid quantities, absent reason and duplicate click cannot release reserved goods', async () => {
  const f = fixture(); f.mount(); f.ready(false); await f.check(); assert.equal(f.requests.length, 0);
  f.ready(true); f.check(); f.reply(); await flush();
  for (const bad of ['0','13','1.2','1e1','-1','']) { f.element('quantity').value = bad; f.element('reason').value = 'Reason'; f.element('approve').onclick(); }
  f.element('quantity').value = '10'; f.element('reason').value = ' '; f.element('approve').onclick();
  f.element('reason').value = 'Unused'; f.ready(false); f.element('approve').onclick(); assert.equal(f.submitted.length, 0);
  f.ready(true); f.failSubmit('Existing request pending'); f.element('approve').onclick(); assert.equal(f.element('approve').disabled, false);
  f.failSubmit(null); f.element('approve').onclick(); assert.equal(f.submitted.length, 1);
});

test('late quote after paging/closed dialog is ignored; network retry keeps original relation selection', async () => {
  const f = fixture(); f.mount(); f.check(); f.current(false); f.reply(); await flush(); assert.equal(f.element('approve'), undefined);
  const g = fixture(); g.mount(); g.check(); g.requests[0].reject(Error('Network unavailable')); await flush();
  assert.match(g.element('status').textContent, /Network unavailable/); assert.equal(g.element('check').disabled, false);
  g.check(); g.reply(); await flush(); assert.ok(g.element('approve'));
  const h = fixture(); delete h.args.submit; h.mount(); assert.equal(h.container.children.length, 0);
});

test('return UI uses existing saved workflow, has no stock mutation/halo clear shortcut and is present in candidate only', () => {
  const index = fs.readFileSync(path.join(folder, 'purchase-ui/index.html'), 'utf8'), supplier = fs.readFileSync(path.join(folder, 'purchase-ui/supplier-allocation.js'), 'utf8');
  assert.ok(index.includes('borrow-return.js?v=20261022-stock-current-candidate-v2'));
  assert.match(supplier, /api.mutate\('PURCHASE_SAVE_REQUEST',\{operation:'BORROW_RETURN',input\}\)/);
  const ui = fs.readFileSync(path.join(folder, 'purchase-ui/borrow-return.js'), 'utf8'); assert.equal(/postMessage|localStorage|stockTransferOutstanding\s*=|repaid\s*=/.test(ui), false);
});
