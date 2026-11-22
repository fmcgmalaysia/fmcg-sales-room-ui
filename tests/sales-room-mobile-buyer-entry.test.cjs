const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('sales-room-20261123-workspace-entry.html', 'utf8');
const wix = fs.readFileSync('sales-room/wix/sales-room-page.js', 'utf8');
const origin = 'https://www.fmcgmalaysia.com';
const customerId = 'CUS-FAKE';
const buyerUrl = '/buyer-room?assist=' + customerId;
const catalogueUrl = '/catalogue?assist=' + customerId;
const prepare = { type: 'SALES_ROOM_OPEN_BUYER_ROOM', customerId, prepare: true, requestId: 1 };
const linkReply = { type: 'SALES_ROOM_BUYER_ENTRY_LINK', customerId, entryUrl: buyerUrl, requestId: 1 };

function createControl(type) {
  const attributes = new Map();
  return {
    type,
    id: 'drawerOpenBuyerRoom',
    className: 'workspace-command-action buyer',
    label: { textContent: 'ENTER BUYER ROOM' },
    dataset: {},
    style: {},
    childNodes: [],
    querySelector() { return this.label; },
    getAttribute(name) { return attributes.get(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    append(...children) { this.childNodes.push(...children); },
    focus() { this.focused = true; }
  };
}

function modal({ compact = true, active = true } = {}) {
  const listeners = new Map();
  const requests = [];
  const catalogueOpens = [];
  const parent = { postMessage: (message, target) => requests.push({ ...message, target }) };
  const catalogue = { disabled: !active };
  const close = {};
  const area = {
    set innerHTML(value) {
      this.markup = value;
      buyer = value ? createControl('button') : null;
      if (buyer) {
        buyer.disabled = !active;
        buyer.replaceWith = link => { buyer = link; };
        document.activeElement = buyer;
      }
    }
  };
  let buyer;
  const document = {
    createElement: createControl,
    getElementById: id => ({
      customerDetailArea: area, closeCustomerWorkspace: close,
      drawerOpenBuyerRoom: buyer, drawerAssistSelection: catalogue
    }[id])
  };
  const window = {
    parent, matchMedia: () => ({ matches: compact }),
    addEventListener: (event, listener) => listeners.set(event, listener),
    open: (...args) => catalogueOpens.push(args)
  };
  const start = html.indexOf('const buyerEntrySite =');
  const end = html.indexOf('function quotationPublishResultText', start);
  assert.ok(start >= 0 && end > start);
  const ctx = {
    window, document, currentCustomerId: '', customerAccessState: () => active ? 'ACTIVE' : 'SUSPENDED',
    customerDisplayName: c => c.companyName, esc: value => String(value), buyerRoomIcon: '', cartIcon: '',
    catalogueUrl: id => origin + '/catalogue?assist=' + id
  };
  vm.runInNewContext(html.slice(start, end), ctx);
  const render = () => ctx.renderCustomerWorkspaceDrawer({ customerId, companyName: 'Fake Customer' });
  render();
  return {
    render, requests, catalogue, catalogueOpens, close,
    markup: () => area.markup,
    buyer: () => buyer,
    reply: (data, overrides = {}) => listeners.get('message')({ data, origin, source: parent, ...overrides }),
    returnToPage: () => listeners.get('pageshow')({ persisted: true })
  };
}

async function wixEntry(message, { customerScope = { allCustomers: true }, signedIn = true, authorized = true } = {}) {
  const start = wix.indexOf("    if (message.type === 'SALES_ROOM_OPEN_BUYER_ROOM')");
  const end = wix.indexOf("    if (message.type === 'SALES_ROOM_FX_RATES_REQUEST')", start);
  assert.ok(start >= 0 && end > start);
  const result = { replies: [], paths: [], writes: [], issues: [] };
  await vm.runInNewContext('(async()=>{' + wix.slice(start, end) + '})()', {
    message, STAFF_LOGIN_URL: '/sales-room-login',
    staffPromise: Promise.resolve({ authorized, staffId: 'QA-STAFF', customerScope }),
    authentication: { loggedIn: () => signedIn },
    salesRoom: { postMessage: reply => result.replies.push({ ...reply }) },
    wixLocationFrontend: { to: path => result.paths.push(path) },
    session: { setItem: (...args) => result.writes.push(args) },
    showStaffAccessIssue: issue => result.issues.push(issue)
  });
  return result;
}

test('an authorized phone entry is a same-tab native link and shows immediate feedback without posting a second request', async () => {
  const room = modal();
  assert.deepEqual(room.requests, [{ ...prepare, target: origin }]);
  const opening = await wixEntry(prepare);
  assert.deepEqual(opening, { replies: [linkReply], paths: [], writes: [], issues: [] });
  room.reply(opening.replies[0]);
  assert.deepEqual([room.buyer().type, room.buyer().href, room.buyer().target, room.buyer().focused],
    ['a', origin + buyerUrl, '_top', true]);
  room.buyer().onclick();
  assert.equal(room.buyer().label.textContent, 'OPENING BUYER ROOM…');
  assert.equal(room.requests.length, 1);
  room.returnToPage();
  assert.equal(room.buyer().label.textContent, 'ENTER BUYER ROOM');
});

test('a tap before preparation acknowledges immediately and keeps the existing Wix route', async () => {
  const room = modal();
  room.buyer().onclick();
  assert.equal(room.buyer().label.textContent, 'OPENING BUYER ROOM…');
  const { target, ...request } = room.requests[1];
  assert.equal(target, '*');
  assert.equal(request.prepare, undefined);
  const result = await wixEntry(request);
  assert.deepEqual(result.paths, [buyerUrl]);
  assert.equal(result.writes[0][0], 'staffBuyerEntryV1');
  room.reply(linkReply);
  assert.equal(room.buyer().type, 'button');
});

test('only the active customer and correct Wix parent can install the prepared link', () => {
  const room = modal();
  room.render();
  for (const [reply, event] of [
    [linkReply, {}],
    [{ ...linkReply, requestId: 2 }, { source: {} }],
    [{ ...linkReply, requestId: 2 }, { origin: 'https://elsewhere.example' }],
    [{ ...linkReply, requestId: 2, customerId: 'CUS-OTHER' }, {}],
    [{ ...linkReply, requestId: 2, entryUrl: '/buyer-room?assist=CUS-OTHER' }, {}],
    [{ ...linkReply, requestId: 2, entryUrl: '//elsewhere.example' }, {}]
  ]) {
    room.reply(reply, event);
    assert.equal(room.buyer().type, 'button');
  }
  room.close.onclick();
  room.reply({ ...linkReply, requestId: 2 });
  assert.equal(room.buyer(), null);
});

test('known expired staff retain the customer in staff login, with the existing Catalogue-only fallback', async () => {
  const customerScope = { customerActions: { CATALOGUE_VIEW: [customerId] } };
  for (const [options, expected] of [
    [{ customerScope }, catalogueUrl],
    [{ signedIn: false }, '/sales-room-login?next=' + encodeURIComponent(buyerUrl)],
    [{ signedIn: false, customerScope }, '/sales-room-login?next=' + encodeURIComponent(catalogueUrl)]
  ]) {
    const room = modal();
    const result = await wixEntry(prepare, options);
    assert.equal(result.replies[0].entryUrl, expected);
    room.reply(result.replies[0]);
    assert.equal(room.buyer().href, origin + expected);
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.paths, []);
  }
});

test('preparation grants no link to unauthorized staff, unassigned customers, or suspended entries', async () => {
  for (const options of [{ authorized: false }, { customerScope: {} }]) {
    assert.deepEqual(await wixEntry(prepare, options), { replies: [], paths: [], writes: [], issues: [] });
  }
  const room = modal({ active: false });
  assert.deepEqual(room.requests, []);
  assert.equal(room.buyer().onclick, undefined);
});

test('desktop Buyer Room and mobile Open Catalogue keep their existing interaction', () => {
  const desktop = modal({ compact: false });
  assert.deepEqual(desktop.requests, []);
  desktop.buyer().onclick();
  assert.equal(desktop.requests[0].prepare, undefined);
  assert.equal(desktop.buyer().label.textContent, 'ENTER BUYER ROOM');
  const mobile = modal();
  mobile.catalogue.onclick();
  assert.deepEqual(mobile.catalogueOpens, [[origin + catalogueUrl, '_blank', 'noopener']]);
});

test('the workspace drawer only shows the customer and entries, with an explanation when unavailable', () => {
  for (const compact of [true, false]) {
    const markup = modal({ compact }).markup();
    assert.match(markup, /Fake Customer/);
    assert.match(markup, /ENTER BUYER ROOM/);
    assert.match(markup, /OPEN CATALOGUE/);
    assert.match(markup, /Close Customer Workspace/);
    assert.doesNotMatch(markup, /已发布商品|等待发布报价|最近发布|LTPOS Quotations|客户权限|CUSTOMER WORKSPACE|CUS-FAKE|客户入口暂不可用/);
  }
  const unavailable = modal({ active: false }).markup();
  assert.match(unavailable, /Customer access unavailable/);
  assert.equal((unavailable.match(/ disabled>/g) || []).length, 2);
});
