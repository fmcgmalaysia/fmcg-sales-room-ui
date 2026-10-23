const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const folder = path.join(__dirname, '../prototypes/stock-current-state');
function fixture() {
  const posted = [], result = { textContent: '', hidden: true }, listeners = {};
  const window = { addEventListener: (name, callback) => { listeners[name] = callback; }, postMessage: message => posted.push(message) };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'purchase-ux-review-bridge.js'), 'utf8'), { window,
    document: { body: {}, querySelector: () => result }, structuredClone,
    MutationObserver: class { observe() {} } });
  return { posted, result, send: message => listeners.message({ source: window, data: message }) };
}
test('review mechanically packages exact existing candidate assets and parses every embedded script', () => {
  execFileSync(process.execPath, [path.join(folder, 'build-purchase-ux-review.cjs'), '--check']);
  const html = fs.readFileSync(path.join(folder, 'preview/purchase-workbench-review.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'preview/purchase-workbench-review.inputs.json'), 'utf8'));
  assert.equal(manifest.cmsWrites, false); assert.equal(manifest.inputs.length, 33);
  for (const entry of manifest.inputs) {
    const source = fs.readFileSync(path.join(folder, '../../..', entry.file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), entry.sha256);
  }
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.match(html, /connect-src 'none'/); assert.match(html, /NOT PUBLISHED/);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=/);
});
test('fixed review reads expose clearly fictional exact PO pair without mutating the workspace', () => {
  const f = fixture(); f.send({ type: 'PURCHASE_WORKSPACE_REQUEST', company: 'NCT', requestId: '1' });
  const original = JSON.stringify(f.posted.at(-1).workspace);
  f.send({ type: 'PURCHASE_BORROW_OPTIONS_REQUEST', company: 'NCT', requestId: '2', input: { borrowerTaskId: 'a'.repeat(32) } });
  const quote = f.posted.at(-1).result;
  assert.equal(quote.schema, 'CURRENT_BORROW_OPTIONS_V2'); assert.equal(quote.options[0].lenderPoId, 'EXAMPLE-PO-B');
  assert.equal(quote.options[0].replacementPoId, 'EXAMPLE-PO-A'); assert.equal(quote.options[0].maximumQuantity, 100);
  f.send({ type: 'PURCHASE_WORKSPACE_REQUEST', company: 'NCT', requestId: '3' });
  assert.equal(JSON.stringify(f.posted.at(-1).workspace), original);
  f.send({ type: 'PURCHASE_WORKSPACE_REQUEST', company: 'GHR', requestId: '4' });
  assert.equal(f.posted.at(-1).ok, false);
});
test('review cannot fake an approved save, new generation, halo, receipt or real inventory mutation', () => {
  const f = fixture(); f.send({ type: 'PURCHASE_WORKSPACE_REQUEST', company: 'NCT', requestId: '1' });
  const before = JSON.stringify(f.posted.at(-1).workspace);
  f.send({ type: 'PURCHASE_SAVE_REQUEST', company: 'NCT', requestId: '2', operation: 'BORROW_APPROVE', input: { quantity: 30 } });
  assert.equal(f.posted.at(-1).ok, false); assert.match(f.result.textContent, /NOT SAVED/);
  assert.equal(f.result.hidden, false); assert.equal(f.posted.at(-1).result, undefined);
  f.send({ type: 'PURCHASE_WORKSPACE_REQUEST', company: 'NCT', requestId: '3' });
  assert.equal(JSON.stringify(f.posted.at(-1).workspace), before);
});
