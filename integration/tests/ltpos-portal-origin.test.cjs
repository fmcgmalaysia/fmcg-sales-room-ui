const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '../../ltpos/managed.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]+?)<\/script>/)[1];
const current = 'https://www.ltpos.ai';
const previous = 'https://fmcg999.wixstudio.com';

function launch(referrer) {
  const sent = [];
  const nodes = new Map();
  let receive;
  const parent = { postMessage: (message, origin) => sent.push([message.type, origin]) };
  const window = { parent, addEventListener: (_, callback) => { receive = callback; } };
  const document = {
    referrer,
    body: { classList: { toggle() {} } },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        hidden: true,
        addEventListener(_, callback) { this.click = callback; },
        replaceChildren() {}
      });
      return nodes.get(id);
    }
  };
  vm.runInNewContext(script, { document, window, URL, setTimeout() {}, clearTimeout() {} });
  return {
    sent, nodes,
    session(origin, state, source = parent) {
      receive({ source, origin, data: { type: 'LTPOS_SESSION', state, name: 'Staff', nativeLinks: true } });
    }
  };
}

for (const origin of [current, 'https://ltpos.ai', previous]) {
  test(`only the correct parent receives login and logout on ${origin}`, () => {
    const portal = launch(`${origin}/ltpos`);
    assert.deepEqual(portal.sent, [['LTPOS_READY', origin]]);
    portal.session(origin, 'signed-out');
    assert.equal(portal.nodes.get('signin').hidden, false);
    portal.nodes.get('signin').click();
    portal.session(origin, 'ready');
    assert.equal(portal.nodes.get('staff').textContent, 'Staff');
    portal.nodes.get('signout').click();
    assert.deepEqual(portal.sent.slice(1), [['LTPOS_SIGN_IN', origin], ['LTPOS_SIGN_OUT', origin]]);
  });
}

test('an omitted referrer uses exact trusted targets and locks onto the parent response', () => {
  const portal = launch('');
  assert.deepEqual(portal.sent, [["LTPOS_READY", current], ["LTPOS_READY", 'https://ltpos.ai'], ["LTPOS_READY", previous]]);
  portal.session(current, 'signed-out', {});
  assert.equal(portal.nodes.get('signin').hidden, true);
  portal.session(current, 'signed-out');
  portal.session(previous, 'ready');
  assert.equal(portal.nodes.get('signin').hidden, false);
  portal.nodes.get('signin').click();
  assert.deepEqual(portal.sent.at(-1), ['LTPOS_SIGN_IN', current]);
});

test('a lookalike domain cannot receive the handshake or send an identity', () => {
  const lookalike = 'https://www.ltpos.ai.example.org';
  const portal = launch(`${lookalike}/`);
  portal.session(lookalike, 'ready');
  assert.deepEqual(portal.sent, []);
  assert.equal(portal.nodes.has('staff'), false);
});
