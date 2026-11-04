const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../prototypes/stock-current-state'), flush = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const window = {}, requests = [], submissions = [], container = { children: [], appendChild(n) { this.children.push(n); n.isConnected = true; } };
  function node() { const nodes = new Map(); let html = '';
    return { isConnected: false, value: '', checked: false, textContent: '', setAttribute() {}, children: [], appendChild(n) { this.children.push(n); },
      remove() { this.isConnected = false; container.children = container.children.filter(n => n !== this); }, querySelector: selector => nodes.get(selector),
      get innerHTML() { return html; }, set innerHTML(value) { html = value; nodes.clear(); for (const m of value.matchAll(/data-(borrow-[a-z-]+)/g)) nodes.set('[data-'+m[1]+']', node()); } };
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'purchase-ui/borrow-approval.js'), 'utf8'), { window, document: { createElement: node } });
  const workspace = { company: 'NCT', stockCurrent: { schema: 'PURCHASE_TRANSFERS_V2', generation: 8, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 8 },
    tasks: [{ id: 'A' }, { id: 'B', customerId: 'CB' }], customers: [{ id: 'CB', name: '<img src=x>' }] };
  const option = { borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', lenderPoId: 'POB', replacementPoId: 'POA', maximumQuantity: 20 };
  let ready = true, submissionError;
  const args = { container, workspace, rootId: 'A', rowLabel: () => 'ROW 158', canSubmit: () => ready,
    esc: v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
    read: (type, data) => new Promise((resolve, reject) => requests.push({ type, data, resolve, reject })),
    submit: input => { if (submissionError) throw Error(submissionError); submissions.push(copy(input)); } };
  const mount = () => window.purchaseBorrowApproval.mount(args), section = () => container.children.at(-1);
  const element = name => section().querySelector('[data-borrow-'+name+']');
  const reply = patch => requests.at(-1).resolve({ ok: true, schema: 'CURRENT_BORROW_OPTIONS_V2', company: 'NCT', borrowerTaskId: 'A', expectedRevision: 11,
    options: [copy(option)], stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 8 }, ...patch });
  const complete = () => { element('pair').value = '0'; element('quantity').value = '12'; element('reason').value = ' Fill this container '; element('consent').checked = true; };
  return { args, workspace, option, requests, submissions, mount, section, element, reply, complete, container, batch: openRoot => window.purchaseBorrowApproval.mountBatchEntry({ ...args, openRoot }),
    setReady: value => { ready = value; }, submitError: value => { submissionError = value; } };
}

test('Purchase approval quotes exact task, displays both POs safely and submits selected future commitment once through original save tracker', async () => {
  const f = fixture(); f.mount(); assert.equal(f.requests.length, 0); f.element('options').onclick();
  assert.equal(f.requests[0].type, 'PURCHASE_BORROW_OPTIONS_REQUEST'); assert.deepEqual(copy(f.requests[0].data), { input: { borrowerTaskId: 'A' } });
  f.reply(); await flush(); assert.match(f.section().innerHTML, /ROW 158/); assert.match(f.section().innerHTML, /POB.*POA/);
  assert.equal(f.section().innerHTML.includes('<img'), false); assert.match(f.section().innerHTML, /&lt;img/);
  f.complete(); f.element('pair').onchange(); assert.equal(f.element('quantity').max, '20');
  assert.equal(f.element('consent').checked, false); f.element('consent').checked = true;
  assert.match(f.element('detail').innerHTML, /Borrow from.*POB.*Repay from.*POA/);
  assert.equal(f.element('detail').innerHTML.includes('<img'), false);
  assert.match(f.element('limit').textContent, /20 CTN/);
  f.element('approve').onclick(); f.element('approve').onclick(); assert.equal(f.submissions.length, 1);
  assert.deepEqual(f.submissions[0], { borrowerTaskId: 'A', lenderSourceId: 'SB', replacementSourceId: 'SA', expectedRevision: 11, quantity: 12, reason: 'Fill this container' });
  assert.equal('approvedBy' in f.submissions[0], false); assert.equal('requestId' in f.submissions[0], false);
  assert.match(f.element('error').textContent, /原保存进度/);
});

test('unconfirmed/stale/mixed-company/invalid/duplicate quote never exposes approval action', async () => {
  for (const patch of [{ ok: false }, { company: 'GHR' }, { borrowerTaskId: 'B' }, { expectedRevision: null },
    { stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 9 } },
    { options: [{ borrowerTaskId: 'A', lenderTaskId: 'B', maximumQuantity: 20 }] },
    { options: [{ borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', lenderPoId: 'B', replacementPoId: 'A', maximumQuantity: 0 }] }]) {
    const f = fixture(); f.mount(); f.element('options').onclick(); f.reply(patch); await flush();
    assert.equal(f.element('approve'), undefined); assert.match(f.section().innerHTML, /error/); assert.equal(f.submissions.length, 0);
  }
  const f = fixture(); f.mount(); f.element('options').onclick(); f.reply({ options: [f.option, f.option] }); await flush(); assert.equal(f.element('approve'), undefined);
});

test('quantity/reason/explicit repayment consent and unchanged edits/pending state are mandatory at submission', async () => {
  const f = fixture(); f.mount(); f.element('options').onclick(); f.reply(); await flush();
  for (const bad of ['0', '21', '1.5', '1e1', '-1', '']) { f.complete(); f.element('quantity').value = bad; f.element('approve').onclick(); }
  f.complete(); f.element('consent').checked = false; f.element('approve').onclick();
  f.complete(); f.element('reason').value = ' '; f.element('approve').onclick();
  f.complete(); f.setReady(false); f.element('approve').onclick(); assert.equal(f.submissions.length, 0);
  f.setReady(true); f.submitError('Existing request pending'); f.element('approve').onclick(); assert.equal(f.element('approve').disabled, false);
  assert.match(f.element('error').textContent, /Existing request/); f.submitError(null); f.element('approve').onclick(); assert.equal(f.submissions.length, 1);
});

test('no PO pair is a known empty result, not zero stock; replaced dialogs and legacy contexts cannot approve', async () => {
  const f = fixture(); f.mount(); f.element('options').onclick(); f.reply({ options: [] }); await flush();
  assert.match(f.section().innerHTML, /No eligible P.O. pair/); assert.equal(f.element('approve'), undefined);
  const g = fixture(); g.mount(); g.element('options').onclick(); const old = g.requests[0]; g.mount(); const fresh = g.section();
  old.resolve({ ok: false }); await flush(); assert.equal(g.section(), fresh); assert.ok(g.element('options')); assert.equal(g.container.children.length, 1);
  delete g.workspace.stockCurrent; g.mount(); assert.equal(g.container.children.length, 1);
  assert.equal(g.element('options'), undefined); assert.equal(g.element('approve'), undefined);
  const priorRequests = g.requests.length; g.element('availability').onclick();
  assert.match(g.element('closed').innerHTML, /not enabled yet/); assert.match(g.element('closed').innerHTML, /disabled/);
  assert.equal(g.requests.length, priorRequests); assert.equal(g.submissions.length, 0);
  const h = fixture(); h.setReady(false); h.mount(); h.element('options').onclick(); assert.equal(h.requests.length, 0);
});

test('changing the selected pair clears repayment consent and empty selection never preserves a previous obligation summary', async () => {
  const f = fixture(); f.mount(); f.element('options').onclick(); f.reply(); await flush();
  f.complete(); f.element('pair').onchange(); f.element('consent').checked = true;
  f.element('quantity').value = '12'; f.element('pair').value = ''; f.element('pair').onchange();
  assert.equal(f.element('consent').checked, false); assert.equal(f.element('quantity').value, '12');
  assert.equal(f.element('limit').textContent, ''); assert.match(f.element('detail').textContent, /Select the P.O. pair/);
  f.element('approve').onclick(); assert.equal(f.submissions.length, 0);
});

test('installed interface remains display-only for every missing or malformed CURRENT capability, without querying or saving stock', () => {
  for (const patch of [null, {}, { schema: 'LEGACY' }, { stockProtocol: 0 }, { stockBuild: '' }, { stockGeneration: -1 }, { stockGeneration: 9 }]) {
    const f = fixture(); f.workspace.stockCurrent = patch === null ? undefined : { ...f.workspace.stockCurrent, ...patch };
    if (patch && Object.keys(patch).length === 0) f.workspace.stockCurrent = {};
    f.mount(); assert.ok(f.element('availability')); f.element('availability').onclick();
    assert.equal(f.element('options'), undefined); assert.equal(f.element('approve'), undefined);
    assert.equal(f.requests.length, 0); assert.equal(f.submissions.length, 0);
    assert.match(f.element('closed').innerHTML, /Not checked/);
    assert.match(f.element('closed').innerHTML, /input type="number" disabled/);
  }
});

test('split batch navigation retains customer product identity, blocks pending edits, and reaches normal approval without saving or quoting in batch context', async () => {
  const f = fixture(), opened = [];
  f.batch(id => { opened.push(id); f.mount(); });
  assert.match(f.section().innerHTML, /分批不会增加订单/);
  const oldButton = f.element('open-root');
  f.setReady(false); oldButton.onclick(); assert.deepEqual(opened, []);
  assert.match(f.element('navigation-status').textContent, /Save or cancel/);
  assert.equal(f.requests.length, 0); assert.equal(f.submissions.length, 0);
  f.setReady(true); oldButton.onclick(); assert.deepEqual(opened, ['A']);
  assert.equal(f.requests.length, 0); assert.ok(f.element('options'));
  oldButton.onclick(); assert.deepEqual(opened, ['A']);
  f.element('options').onclick(); f.reply(); await flush(); f.complete(); f.element('approve').onclick();
  assert.equal(f.submissions.length, 1); assert.equal(f.submissions[0].borrowerTaskId, 'A');
  assert.equal('batchId' in f.submissions[0], false);
});

test('candidate original overlays include approval assets and existing save mechanism without reworking the original dialog', () => {
  for (const file of ['build-purchase-borrow-panel.cjs', 'build-transfer-person-overlays.cjs', 'build-purchase-current-ui.cjs']) {
    assert.match(execFileSync(process.execPath, [path.join(root, file), '--check'], { encoding: 'utf8' }), /verified/);
  }
  const supplier = fs.readFileSync(path.join(root, 'purchase-ui/supplier-allocation.js'), 'utf8'), index = fs.readFileSync(path.join(root, 'purchase-ui/index.html'), 'utf8');
  assert.doesNotMatch(supplier, /purchaseBorrowApproval|allocationBorrowApproval/);
  const app=fs.readFileSync(path.join(root,'purchase-ui/app.js'),'utf8');
  assert.match(app,/data-current-allocation|dataset.currentAllocation/);
  assert.match(app,/mutate\('PURCHASE_SAVE_REQUEST',\{operation:'BORROW_APPROVE',input\}\)/);
  for (const file of ['borrow-approval.css', 'borrow-approval.js']) assert.ok(index.includes(file+'?v=20261024-alloc-entry-v1'));
});

test('actual generated supplier dialog no longer mounts borrowing in either split or root procurement editing', () => {
  const nodes = new Map(), node = key => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', value: '', insertAdjacentHTML(_, html) { this.innerHTML += html; }, querySelector: selector => node(key + selector) });
    return nodes.get(key);
  };
  const batches = [], roots = [], document = { activeElement: null, querySelector: selector => selector.includes('data-allocation-extra=') ? null : node(selector) };
  const window = { purchaseBorrowApproval: { mountBatchEntry: args => batches.push(args), mount: args => roots.push(args) } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'purchase-ui/supplier-allocation.js'), 'utf8'), { window, document });
  const task = { id: 'A', customerId: 'C', barcode: 'BAR-A', ord: 100, ea: 24, supplierId: 'S', editVersion: 'V1',
    lpPc: 2, lpCtn: 48, disc1: 0, disc2: 0, disc3: 0,
    procurement: { totalCtn: 100, revision: 'P1', transportMode: 'SUPPLIER_DELIVER' },
    batchAllocationVersion: 'BV', batchEntitlements: [{ id: 'PLAN|1', label: 'This shipment', quantity: 40, metrics: { committed: 40 }, sources: [{ id: 'A', quantity: 40 }] }] };
  const workspace = { company: 'NCT', customers: [{ id: 'C', shortName: 'Customer' }], suppliers: [{ id: 'S', shortName: 'Supplier' }], tasks: [task] };
  let pending = false;
  const ui = window.purchaseSupplierAllocation.create({ workspace: () => workspace, company: () => 'NCT', esc: String,
    num: String, dialog() {}, modal: () => ({ classList: { add() {}, contains: () => true } }), cache() {}, status() {},
    savePending: () => pending, stockActionReady: () => !pending, handIcon: () => '' });
  const before = JSON.stringify(workspace);
  ui.open('A', 'PLAN|1'); assert.equal(batches.length, 0); assert.equal(roots.length, 0);
  ui.edit({ target: { id: 'allocationReason', value: 'Unsaved reason' } });
  // Reopen a fresh independent dialog to verify the clean navigation path.
  const clean = window.purchaseSupplierAllocation.create({ workspace: () => workspace, company: () => 'NCT', esc: String,
    num: String, dialog() {}, modal: () => ({ classList: { add() {}, contains: () => true } }), cache() {}, status() {},
    savePending: () => false, stockActionReady: () => true, handIcon: () => '' });
  clean.open('A');
  assert.equal(roots.length, 0);assert.equal(batches.length,0);
  assert.equal(JSON.stringify(workspace), before);
});
