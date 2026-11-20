const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../buyer-login-20261121.html'), 'utf8');

function loginPage() {
  const nodes = new Map();
  const events = new Map();
  const messages = [];
  let focused;
  function element(id) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        value: '',
        hidden: false,
        disabled: false,
        textContent: '',
        setAttribute() {},
        addEventListener() {},
        reportValidity() { return true; },
        focus() { focused = id; },
        closest() { return { after() {} }; },
      });
    }
    return nodes.get(id);
  }
  const parent = { postMessage(message) { messages.push({ ...message }); } };
  const context = {
    parent,
    window: {
      parent,
      addEventListener(name, fn) {
        events.set(name, [...(events.get(name) || []), fn]);
      },
    },
    document: {
      getElementById(id) {
        if (id === 'forgot' && !nodes.has('row')) return null;
        return element(id);
      },
      createElement: () => element('row'),
      querySelector: element,
    },
  };
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    vm.runInNewContext(script, context);
  }
  events.get('DOMContentLoaded').forEach(fn => fn());
  const submit = id => element(id).onsubmit({ preventDefault() {} });
  const respond = (data, source = parent) => events.get('message').forEach(fn => fn({ data, source }));
  return { element, messages, submit, respond, focused: () => focused };
}

test('first-time buyers use a labelled setup form and the existing email request', () => {
  const { element, messages, submit, respond, focused } = loginPage();
  assert.match(element('row').innerHTML, /First Time Login/);
  element('email').value = 'buyer@example.test';
  element('first-time-login').onclick();
  assert.equal(element('reset-title').textContent, 'Set your password');
  assert.equal(element('reset-email').value, 'buyer@example.test');
  assert.equal(element('reset-email').placeholder, 'Company email');
  assert.equal(element('reset-send').textContent, 'Email me a setup link');
  assert.equal(element('form').hidden, true);
  assert.equal(focused(), 'reset-email');

  submit('password-reset');
  submit('password-reset');
  assert.deepEqual(messages.filter(message => message.type === 'BUYER_FORGOT_PASSWORD'), [
    { type: 'BUYER_FORGOT_PASSWORD', email: 'buyer@example.test' },
  ]);
  respond({ type: 'BUYER_PASSWORD_RESET_RESULT', ok: true }, {});
  assert.equal(element('reset-status').textContent, 'Sending setup link…');
  respond({ type: 'BUYER_PASSWORD_RESET_RESULT', ok: true });
  assert.match(element('reset-status').textContent, /If your account is ready/);
  element('reset-cancel').onclick();
  assert.equal(element('form').hidden, false);
  assert.equal(focused(), 'first-time-login');
});

test('forgot password stays separate, and Google and existing sign-in send the same messages', () => {
  const { element, messages, submit, respond, focused } = loginPage();
  element('forgot').onclick();
  assert.equal(element('reset-title').textContent, 'Reset password');
  assert.equal(element('reset-send').textContent, 'Send reset link');
  element('reset-email').value = 'buyer@example.test';
  submit('password-reset');
  respond({ type: 'BUYER_PASSWORD_RESET_RESULT', ok: false });
  assert.equal(element('reset-send').disabled, false);
  assert.match(element('reset-status').textContent, /try again/i);
  element('reset-cancel').onclick();
  assert.equal(focused(), 'forgot');

  element('google').onclick();
  assert.equal(messages.at(-1).type, 'BUYER_LOGIN_GOOGLE');
  element('email').value = 'buyer@example.test';
  submit('form');
  assert.equal(messages.at(-1).type, 'BUYER_LOGIN_EMAIL');
  element('apply').onclick();
  assert.equal(messages.at(-1).type, 'BUYER_APPLY_ACCESS');
});
