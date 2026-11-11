const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
  '../prototypes/warehouse-desk-workflow-20261111/support-split.js'), 'utf8');

function open(parts, { held = 0, locked = false } = {}) {
  const inputs = parts.filter(part => part.desk && part.quantity > (part.invoiced || 0)).map(part => ({
    dataset: { part: String(part.desk) },
    value: String(part.quantity - (part.invoiced || 0)),
  }));
  const pending = {};
  const confirm = {};
  const assign = { value: '0', addEventListener(_, fn) { this.update = fn; }, setAttribute() {} };
  const destination = { ...assign };
  const form = {
    querySelectorAll(selector) { return selector === '[data-part]' ? inputs : []; },
    querySelector(selector) {
      return ({
        '[type=submit]': confirm, '#split-pending-qty': pending,
        '[data-assign-qty]': assign, '[data-assign-desk]': destination,
      })[selector] || inputs.find(input => selector === `[data-part="${input.dataset.part}"]`);
    },
  };
  const dialog = { setAttribute() {}, querySelector: () => form, showModal() {}, close() {} };
  const requests = [];
  const taskId = 'product-1';
  vm.runInNewContext(source + '\nopenDeskSplit("product-1");', {
    data: {
      orders: [{ lines: [{ taskId, deskPortions: parts, name: 'Product' }] }],
      deskLocks: locked ? [{ customerId: 'customer', desk: 1, status: 'LOCKED' }] : [],
      delivery: { lists: [{ desk: { number: 1 }, status: 'SENT', lines: [{ taskId, quantity: held }] }] },
    },
    selectedCustomer: 'customer',
    deskState: () => ({ assignments: [{ taskId, desk: 1 }], revision: 'rev' }),
    deskPending: () => null, deskBusy: false, deskSplitDialog: null,
    document: { createElement: () => dialog, body: { append() {} } },
    esc: String, number: String,
    saveDeskChange: async input => { requests.push(JSON.parse(JSON.stringify(input))); return true; },
    load: async () => {},
  });
  return { inputs, confirm, pending, assign, destination, requests, dialog,
    submit: () => form.onsubmit({ preventDefault() {} }) };
}

test('entering 50 keeps 50 of the original 70 and sends the other 20 to Pending Desk', async () => {
  const ui = open([{ desk: 1, quantity: 70 }]);
  assert.match(ui.dialog.innerHTML, /Current Qty[\s\S]+Keep in Desk[\s\S]+70 CTN[\s\S]+Pending after split/);
  assert.equal(ui.confirm.disabled, true);
  ui.inputs[0].value = '50';
  ui.inputs[0].oninput();
  assert.equal(ui.pending.textContent, '20 CTN');
  await ui.submit();
  assert.deepEqual(ui.requests[0].parts, [{ desk: 1, quantity: 50 }, { desk: 0, quantity: 20 }]);
});

test('kept quantities respect dispatched and invoiced floors; invalid input shows no misleading pending total', async () => {
  const ui = open([{ desk: 1, quantity: 70, invoiced: 10 }], { held: 30 });
  const [input] = ui.inputs;
  assert.deepEqual([input.min, input.max, input.value], ['20', '60', '60']);
  for (const invalid of ['', '19', '21.5', '61']) {
    input.value = invalid;
    input.oninput();
    assert.equal(ui.confirm.disabled, true);
    assert.equal(ui.pending.textContent, '—');
  }
  input.value = '20';
  input.oninput();
  assert.equal(ui.pending.textContent, '40 CTN');
  await ui.submit();
  assert.deepEqual(ui.requests[0].parts, [{ desk: 1, quantity: 30 }, { desk: 0, quantity: 40 }]);
  assert.equal(open([{ desk: 1, quantity: 70 }], { locked: true }).inputs[0].disabled, true);
});

test('existing Pending Desk cartons and a separate reassignment remain in the same save', async () => {
  const ui = open([{ desk: 1, quantity: 70 }, { desk: 0, quantity: 15 }]);
  ui.inputs[0].value = '50';
  ui.assign.value = '10';
  ui.destination.value = '2';
  ui.destination.update();
  assert.equal(ui.pending.textContent, '25 CTN');
  await ui.submit();
  assert.deepEqual(ui.requests[0].parts, [
    { desk: 1, quantity: 50 }, { desk: 2, quantity: 10 }, { desk: 0, quantity: 25 },
  ]);
});
