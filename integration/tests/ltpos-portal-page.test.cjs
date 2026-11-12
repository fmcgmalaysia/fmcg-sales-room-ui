const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../wix/ltpos-staff-portal-page.js'), 'utf8')
  .replace(/^import .*$/gm, '');

function openPortal(workspaceIds, initiallyLoggedIn = true) {
  let loggedIn = initiallyLoggedIn;
  let receive;
  const links = {
    visible: false,
    html: '',
    hide() { this.visible = false; },
    show() { this.visible = true; }
  };
  const messages = [];
  const frame = {
    onMessage(handler) { receive = handler; },
    postMessage(message) { messages.push(message); }
  };
  const $w = id => ({ '#html1': frame, '#text4': links })[id];
  $w.onReady = callback => callback();
  const authentication = {
    loggedIn: () => loggedIn,
    logout: () => { loggedIn = false; }
  };
  vm.runInNewContext(source, { $w, authentication, getLtposWorkspaces: async () => ({ name: 'LAW', workspaceIds }) });
  return { links, frame, messages, receive: type => receive({ data: { type } }) };
}

test('only granted workspaces get real links with a new-tab target', async () => {
  const portal = openPortal(['purchase', 'support', 'unrecognized']);
  await portal.receive('LTPOS_READY');
  assert.equal(portal.links.visible, true);
  assert.match(portal.links.html, /href="https:\/\/fmcg999\.wixstudio\.com\/master" target="_blank"/);
  assert.match(portal.links.html, /href="https:\/\/fmcg999\.wixstudio\.com\/master\/support-department" target="_blank"/);
  assert.equal((portal.links.html.match(/<a /g) || []).length, 2);
  assert.equal(portal.messages.at(-1).nativeLinks, true);
  assert.match(portal.frame.src, /v=ltpos-staff-portal-v2$/);
});

test('sign-out, missing grants, and an existing signed-out session hide all links', async () => {
  const portal = openPortal(['purchase']);
  await portal.receive('LTPOS_READY');
  await portal.receive('LTPOS_SIGN_OUT');
  assert.equal(portal.messages.at(-1).state, 'signed-out');
  for (const candidate of [portal, openPortal([]), openPortal(['purchase'], false)]) {
    await candidate.receive('LTPOS_READY');
    assert.equal(candidate.links.visible, false);
    assert.doesNotMatch(candidate.links.html, /<a /);
  }
});
