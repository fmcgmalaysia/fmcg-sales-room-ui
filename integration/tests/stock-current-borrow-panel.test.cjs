const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const window = {}, requests = [], container = { children: [], appendChild(node) { this.children.push(node); node.isConnected = true; } };
  const document = { createElement: () => {
    const nodes = new Map(); let html = '';
    return { isConnected: false, setAttribute() {}, remove() { this.isConnected = false; container.children = container.children.filter(n => n !== this); },
      querySelector: selector => nodes.get(selector), get innerHTML() { return html; }, set innerHTML(value) { html = value; nodes.clear();
        for (const match of value.matchAll(/data-(borrow-link-[a-z]+)/g)) nodes.set('[data-' + match[1] + ']', {}); } };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'purchase-ui/borrow-relations.js'), 'utf8'), { window, document });
  const workspace = { company: 'NCT', stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: 8 },
    tasks: [{ id: 'A', customerId: 'CA', po: 'PO-A', stockTransferOutstanding: true }, { id: 'B', customerId: 'CB', po: 'PO-B' }],
    customers: [{ id: 'CA', shortName: 'Customer A' }, { id: 'CB', shortName: '<img onerror=bad>' }] };
  const read = (type, args) => new Promise((resolve, reject) => requests.push({ type, args, resolve, reject }));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mount = rootId => window.purchaseBorrowRelations.mount({ container, workspace, rootId, read, esc, rowLabel: id => id === 'B' ? 'ROW 158' : 'ROW 001' });
  const relation = i => ({ id: 'R' + i, borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 30, repaid: 10, returned: 5, remaining: 15 });
  function reply(total = 1, offset = 0, patch = {}) {
    const req = requests.at(-1), items = Array.from({ length: Math.min(5, total - offset) }, (_, i) => relation(i + offset));
    req.resolve({ ok: true, schema: 'CURRENT_BORROW_RELATIONS_V1', company: 'NCT', view: 'TASK', taskId: req.args.input.taskId,
      generation: 8, version: 'a'.repeat(32), offset, total, items,
      nextCursor: total > offset + items.length ? { version: 'a'.repeat(32), offset: offset + items.length } : null, ...patch });
  }
  return { workspace, requests, mount, reply, relation, section: () => container.children.at(-1), container };
}

test('existing supplier dialog relation panel describes both loan directions, row reference, outstanding and safe customer labels', async () => {
  const f = fixture(); f.mount('A'); assert.equal(f.requests[0].type, 'PURCHASE_BORROW_RELATIONS_REQUEST');
  assert.deepEqual({ ...f.requests[0].args.input }, { view: 'TASK', taskId: 'A', pageSize: 5 }); f.reply(); await flush();
  const html = f.section().innerHTML; assert.match(html, /Borrowed from 借入自/); assert.match(html, /ROW 158/); assert.match(html, /PO-B/);
  assert.equal(html.includes('<img'), false); assert.match(html, /&lt;img onerror=bad&gt;/);
  assert.match(html, /待补回 <b>15/); assert.match(html, /已发货不会清除待补回/);
  assert.equal(/data-borrow-(approve|save|return)|<input/.test(html), false);
  f.workspace.tasks[1].stockTransferOutstanding = true; f.mount('B'); f.reply(); await flush(); assert.match(f.section().innerHTML, /Lent to 借出给/);
});

test('relation panel pages all links without treating first page as a complete total', async () => {
  const f = fixture(); f.mount('A'); f.reply(6); await flush();
  assert.match(f.section().innerHTML, /1–5 · 6/); f.section().querySelector('[data-borrow-link-next]').onclick();
  assert.equal(f.requests.at(-1).args.input.cursor.offset, 5); assert.equal(f.requests.at(-1).args.input.cursor.version, 'a'.repeat(32));
  f.reply(6, 5); await flush(); assert.match(f.section().innerHTML, /6–6 · 6/); assert.equal(f.section().querySelector('[data-borrow-link-next]'), undefined);
  f.section().querySelector('[data-borrow-link-prev]').onclick(); assert.equal(f.requests.at(-1).args.input.cursor, undefined);
  f.reply(6); await flush(); assert.match(f.section().innerHTML, /1–5 · 6/);
});

test('generation mismatch, incomplete links or read failure do not clear halo or fabricate settled relationship', async () => {
  for (const patch of [{ generation: 9 }, { total: 0, items: [], nextCursor: null }, { items: [] }, { ok: false },
    { company: 'GHR' }, { items: [{ id: 'R', borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'B', replacementSourceId: 'A', quantity: 20, repaid: 0, returned: 0, remaining: 21 }] }]) {
    const f = fixture(); f.mount('A'); f.reply(1, 0, patch); await flush(); assert.match(f.section().innerHTML, /error/);
    assert.equal(f.workspace.tasks[0].stockTransferOutstanding, true); assert.ok(f.section().querySelector('[data-borrow-link-retry]'));
  }
  const f = fixture(); f.mount('A'); f.requests[0].reject(Error('Network unavailable')); await flush();
  assert.match(f.section().innerHTML, /Network unavailable/); f.section().querySelector('[data-borrow-link-retry]').onclick();
  assert.equal(f.requests.length, 2); f.reply(); await flush(); assert.match(f.section().innerHTML, /ROW 158/);
});

test('stale async response cannot replace another supplier dialog; ordinary/legacy heads never fetch new relation data', async () => {
  const f = fixture(); f.mount('A'); const old = f.requests[0];
  f.workspace.tasks[1].stockTransferOutstanding = true; f.mount('B'); f.reply(); await flush(); const html = f.section().innerHTML;
  old.resolve({ ok: false }); await flush(); assert.equal(f.section().innerHTML, html); assert.equal(f.container.children.length, 1);
  f.workspace.tasks[1].stockTransferOutstanding = false; f.mount('B'); assert.equal(f.container.children.length, 0); assert.equal(f.requests.length, 2);
  delete f.workspace.stockCurrent; f.mount('A'); assert.equal(f.requests.length, 2);
});

test('panel resource/relay builds are exact original overlays, preserve original source click handlers and isolate borrowing routes', () => {
  for (const file of ['build-purchase-borrow-panel.cjs', 'build-transfer-person-overlays.cjs', 'build-purchase-current-ui.cjs']) {
    assert.match(execFileSync(process.execPath, [path.join(root, file), '--check'], { encoding: 'utf8' }), /verified/);
  }
  const bridge = fs.readFileSync(path.join(root, 'purchase-room-page.candidate.js'), 'utf8'), originalBridge = fs.readFileSync(path.join(__dirname, '../wix/purchase-room-page.js'), 'utf8').replace(/\r\n/g, '\n');
  const stripped = bridge.replace("import { getPurchaseStockTransfersCurrent } from 'backend/stockCurrentRead.web';\n", '')
    .replace("import { getPurchaseBorrowOptionsCurrent, getPurchaseBorrowReturnOptionsCurrent, savePurchaseBorrowingCurrent } from 'backend/stockCurrentBorrow.web';\n", '')
    .replace(/\n    if\(message.type==='PURCHASE_BORROW_RETURN_OPTIONS_REQUEST'\)\{[\s\S]*?\n    \}/, '')
    .replace(/\n    if\(message.type==='PURCHASE_BORROW_OPTIONS_REQUEST'\)\{[\s\S]*?\n    \}/, '')
    .replace(/\n    if\(message.type==='PURCHASE_SAVE_REQUEST'&&\['BORROW_APPROVE','BORROW_RETURN'\].includes\(message.operation\)\)\{[\s\S]*?\n    \}/, '')
    .replace(/\n    if\(message.type==='PURCHASE_BORROW_RELATIONS_REQUEST'\)\{[\s\S]*?\n    \}/, '');
  assert.equal(stripped, originalBridge);
  const index = fs.readFileSync(path.join(root, 'purchase-ui/index.html'), 'utf8');
  for (const file of ['borrow-relations.js', 'borrow-relations.css', 'task-grid.js', 'supplier-allocation.js', 'app.js']) assert.ok(index.includes(file + '?v=20261022-stock-current-candidate-v2'));
  const candidate = fs.readFileSync(path.join(root, 'purchase-ui/app.js'), 'utf8'), originalApp = fs.readFileSync(path.join(__dirname, '../../purchase-live/app.js'), 'utf8');
  for (const marker of ['if(control.dataset.planSource)', 'if(control.dataset.planTask)']) {
    const line = originalApp.split('\n').find(line => line.includes(marker)); assert.ok(candidate.includes(line.trim()));
  }
});
