const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../buyer-room/wix/buyer-room-login-page.member-setup.js'), 'utf8')
  .replace(/^import .+;\r?$/gm, '');

function loginPage({ clock, local = new Map(), sendResetPasswordEmail, buyer, query = {} }) {
  const messages = [];
  const destinations = [];
  let handler;
  let frame = { onMessage: callback => { handler = callback; }, postMessage: message => messages.push({ ...message }) };
  const $w = id => id === '#html1' ? frame : {};
  $w.onReady = setup => setup();
  vm.runInNewContext(source, {
    $w, console, crypto: webcrypto, TextEncoder, Date: { now: () => clock.now },
    authentication: { sendResetPasswordEmail, login: async () => {} },
    local: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) },
    session: { getItem() {}, removeItem() {} },
    getCurrentBuyerContext: async () => buyer,
    wixLocationFrontend: { query, to: path => destinations.push(path) },
    wixSeoFrontend: { setTitle() {}, setMetaTags() {} }
  });
  return {
    messages, destinations,
    async message(type, data = {}) {
      await handler({ data: { type, ...data } });
      return messages.at(-1);
    }
  };
}

test('sending starts only on request and repeat requests wait 60 seconds, including after reload', async () => {
  const clock = { now: 1000 };
  const local = new Map();
  const sent = [];
  const options = { clock, local, sendResetPasswordEmail: async address => sent.push(address), buyer: { reason: 'NOT_LOGGED_IN' } };
  const page = loginPage(options);
  await page.message('BUYER_LOGIN_READY');
  assert.equal(sent.length, 0);
  const request = data => page.message('BUYER_FORGOT_PASSWORD', data);
  const email = 'buyer@example.invalid';
  assert.equal((await request({ email: 'invalid' })).ok, false);
  const reply = await request({ email: ' Buyer@example.invalid ', firstTime: true });
  assert.deepEqual(reply, { type: 'BUYER_PASSWORD_RESET_RESULT', ok: true, retryAfter: 60 });
  assert.deepEqual(sent, [email]);
  assert.equal([...local.values()].some(value => value.includes(email)), false);
  clock.now += 18_000;
  const refreshed = loginPage(options);
  assert.equal((await refreshed.message('BUYER_FORGOT_PASSWORD', { email })).retryAfter, 42);
  assert.equal(sent.length, 1);
  clock.now += 42_000;
  assert.equal((await refreshed.message('BUYER_FORGOT_PASSWORD', { email, firstTime: true })).retryAfter, 60);
  assert.deepEqual(sent, [email, email]);
});

test('unknown accounts do not disclose membership, and service errors can be retried', async () => {
  const clock = { now: 1000 };
  const email = 'buyer@example.invalid';
  const missing = loginPage({ clock, sendResetPasswordEmail: async () => { throw { httpStatus: 404 }; } });
  const failed = loginPage({ clock, sendResetPasswordEmail: async () => { throw { httpStatus: 503 }; } });
  assert.deepEqual(await missing.message('BUYER_FORGOT_PASSWORD', { email }), {
    type: 'BUYER_PASSWORD_RESET_RESULT', ok: true, retryAfter: 60
  });
  assert.equal((await failed.message('BUYER_FORGOT_PASSWORD', { email })).ok, false);
  assert.equal((await failed.message('BUYER_FORGOT_PASSWORD', { email })).ok, false);
});

test('buyer approval remains a separate gate for both password and Google sign-in', async () => {
  const clock = { now: 1000 };
  const password = loginPage({ clock, buyer: { ok: false, reason: 'INACTIVE' } });
  await password.message('BUYER_LOGIN_EMAIL', { email: 'buyer@example.invalid', password: 'test-fixture' });
  assert.equal(password.destinations.length, 0);
  assert.match(password.messages.find(message => message.kind === 'error').message, /contact FMCG Malaysia/);
  const google = loginPage({ clock, query: { oauth: 'not_authorized' } });
  const reply = await google.message('BUYER_LOGIN_READY');
  assert.equal(google.destinations.length, 0);
  assert.match(reply.message, /contact FMCG Malaysia/);
  const active = loginPage({ clock, buyer: { ok: true } });
  await active.message('BUYER_LOGIN_EMAIL', { email: 'buyer@example.invalid', password: 'test-fixture' });
  assert.deepEqual(active.destinations, ['/catalogue']);
});
