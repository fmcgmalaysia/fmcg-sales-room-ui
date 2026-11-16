const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../master-staff/index.html'), 'utf8')
  .match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const pendingKey = 'master.staff.save.pending';
const employee = { staffId: 'employee', name: 'Example', email: 'employee@example.com', status: 'PENDING' };

async function start(reply, storage = new Map(), editExisting = false) {
  const actions = [], nodes = new Map();
  const makeNode = () => ({
    value: '', hidden: false, disabled: false, dataset: {}, handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    append() {}, add() {}, replaceChildren() {}, setAttribute() {},
    querySelector() { return {}; }, querySelectorAll() { return []; }, reset() {}, focus() {},
    elements: { namedItem(name) { return element('field-' + name); } }
  });
  const element = name => {
    if (!nodes.has(name)) nodes.set(name, makeNode());
    return nodes.get(name);
  };
  const form = element('add-form');
  const document = { getElementById: element, createElement: makeNode, visibilityState: 'visible' };
  let handle;
  const scheduled = [];
  const parent = { postMessage(message, origin) {
    actions.push(message);
    const payload = message.action === 'LIST_STAFF' ? { rows: [], saveStatus: { state: 'CLEAR' } } : reply(message);
    queueMicrotask(() => handle({ origin, source: parent, data: {
      type: 'MASTER_STAFF_RESULT', requestId: message.requestId, ok: true, ...payload
    }}));
  }};
  const open = await vm.runInNewContext(`(async()=>{${source}\nreturn openEmployee;})()`, {
    document, window: { parent, addEventListener(_, fn) { handle = fn; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crypto: { randomUUID }, Option: function () {}, FormData: class {
      get(name) {
        if (editExisting) return element('field-' + name).value;
        return ({ name: employee.name, email: employee.email })[name] || '';
      }
      getAll() { return []; }
      has() { return false; }
    },
    setTimeout(fn, delay) {
      if (delay === 15000 || delay === 30000 || delay === 0) scheduled.push({ fn, delay });
      else return setTimeout(fn, 0);
    },
    clearTimeout
  });
  return { actions, element, storage, scheduled, open, input: () => form.handlers.input(),
    submit: () => form.handlers.submit({ preventDefault() {} }) };
}

test('existing staff Save is visible and disabled until changed and disables again when restored', async () => {
  const ui = await start(() => ({customers: []}), new Map(), true);
  await ui.open(employee);
  const save = ui.element('save');
  assert.equal(save.hidden, false);
  assert.equal(save.disabled, true);
  assert.equal(save.dataset.unchanged, 'true');
  ui.element('field-email').value = '  EMPLOYEE@example.com  ';
  ui.input();
  assert.equal(save.disabled, true);
  ui.element('field-status').value = 'DISABLED';
  ui.input();
  assert.equal(save.disabled, false);
  ui.element('field-status').value = employee.status;
  ui.input();
  assert.equal(save.disabled, true);
  await ui.submit();
  assert.equal(ui.actions.some(message => message.action === 'UPDATE_STAFF'), false);
});

test('lost response automatically reads the exact original receipt and completes the form', async () => {
  const ui = await start(message => message.action === 'REGISTER_STAFF'
    ? { ok: false, error: 'Connection lost' }
    : { saveStatus: { state: 'CONFIRMED', requestId: message.saveRequestId, employee } });
  await ui.submit();
  const saves = ui.actions.filter(message => message.action === 'REGISTER_STAFF');
  const checks = ui.actions.filter(message => message.action === 'CHECK_STAFF_SAVE');
  assert.equal(saves.length, 1);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].saveRequestId, saves[0].saveRequestId);
  assert.match(ui.element('save-status').textContent, /Saved successfully/);
  assert.equal(ui.element('save').hidden, true);
  assert.equal(ui.storage.has(pendingKey), false);
});

test('an unconfirmed save survives reload and resumes read-only checks with no employee retry', async () => {
  const ui = await start(message => message.action === 'REGISTER_STAFF'
    ? { ok: false, error: 'Connection lost' }
    : { saveStatus: { state: 'PENDING', requestId: message.saveRequestId } });
  await ui.submit();
  const requestId = ui.storage.get(pendingKey);
  assert.ok(requestId);
  assert.equal(ui.element('save').hidden, true);
  assert.equal(ui.element('cancel').disabled, false);
  await ui.submit();
  assert.equal(ui.actions.filter(message => message.action === 'REGISTER_STAFF').length, 1);
  const reopened = await start(message => ({ saveStatus: { state: 'CONFIRMED', requestId: message.saveRequestId, employee } }), ui.storage);
  await reopened.scheduled.find(timer => timer.delay === 0).fn();
  assert.deepEqual(reopened.actions.map(message => message.action), ['LIST_STAFF', 'CHECK_STAFF_SAVE']);
  assert.equal(reopened.actions[1].saveRequestId, requestId);
  assert.equal(ui.storage.has(pendingKey), false);
});

test('an authoritative validation rejection leaves the form editable', async () => {
  const ui = await start(() => ({ ok: false, saveRejected: true, error: 'This email is already registered.' }));
  await ui.submit();
  assert.equal(ui.element('save').hidden, false);
  assert.match(ui.element('save-status').textContent, /already registered/);
  assert.deepEqual(ui.actions.map(message => message.action), ['LIST_STAFF', 'REGISTER_STAFF']);
  assert.equal(ui.storage.has(pendingKey), false);
});
