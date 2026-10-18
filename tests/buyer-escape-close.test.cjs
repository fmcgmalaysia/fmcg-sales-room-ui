const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'buyer-room.html'), 'utf8');
const binding = html.split('\n').find(line => line.includes("if(e.key==='Escape'){$('submitModalBg')"));
function fixture(submitting = false) {
  let handler;
  const closed = [];
  const pending = [{ itemId: 'test-item', quantityCtn: 50 }];
  const draft = { value: '0000', editing: true };
  const state = { orderSubmitting: submitting, pendingOrder: pending, quantityDrafts: new Map([['test-item', draft]]) };
  const context = { document: { addEventListener: (type, callback) => { assert.equal(type, 'keydown'); handler = callback; } }, state, $: id => ({ classList: { remove: value => { assert.equal(id, 'submitModalBg'); assert.equal(value, 'show'); closed.push('order-review'); } } }), closeReduction: () => closed.push('reduction'), closeExportMenus: () => closed.push('exports') };
  vm.runInNewContext(binding, context);
  return { handler, closed, state, pending, draft };
}
test('Escape reaches every existing close handler and clears an unsent review', () => {
  const f = fixture();
  assert.doesNotThrow(() => f.handler({ key: 'Escape' }));
  assert.deepEqual(f.closed, ['order-review', 'reduction', 'exports']);
  assert.equal(f.state.pendingOrder, null);
  assert.equal(f.state.quantityDrafts.get('test-item'), f.draft);
});
test('Escape preserves an order currently submitting and all quantity drafts', () => {
  const f = fixture(true);
  f.handler({ key: 'Escape' });
  assert.equal(f.state.pendingOrder, f.pending);
  assert.equal(f.state.pendingOrder[0].quantityCtn, 50);
  assert.equal(f.state.quantityDrafts.get('test-item'), f.draft);
});
test('Non-Escape keys leave review and quantity state alone', () => {
  const f = fixture();
  f.handler({ key: 'ArrowDown' });
  f.handler({ key: 'Enter' });
  assert.deepEqual(f.closed, []);
  assert.equal(f.state.pendingOrder, f.pending);
  assert.equal(f.state.quantityDrafts.get('test-item').value, '0000');
});
