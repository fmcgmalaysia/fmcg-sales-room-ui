const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../buyer-room/wix/buyer-room-page.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const alphaRequest = '00000000-0000-4000-8000-000000000001';
const betaRequest = '00000000-0000-4000-8000-000000000002';

async function buyerPage({ customerId, actorUserId, storage, submit }) {
  let ready, handler;
  const posted = [];
  const frame = {
    onMessage(callback) { handler = callback; },
    postMessage(message) { posted.push(message); }
  };
  const button = { disable() {}, enable() {}, show() {}, hide() {}, onClick() {} };
  const $w = id => id === '#html1' ? frame : button;
  $w.onReady = callback => { ready = callback; };
  vm.runInNewContext(page, {
    $w, URL, console, setInterval() {}, setTimeout,
    session: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    authentication: { loggedIn: () => true },
    wixWindowFrontend: { rendering: { env: 'browser' } },
    wixLocationFrontend: { query: { company: customerId }, baseUrl: 'https://buyer.example.test', to() {} },
    wixRealtimeFrontend: { subscribe: async () => {} },
    selectedBuyerCompanyId: () => customerId,
    buyerCompanyPath: () => '/catalogue',
    getBuyerCompanies: async () => ({ companies: [{ customerId }] }),
    loadBuyerCompanyAccess: async () => ({ currentId: customerId, scoped: true, companies: [{ customerId }] }),
    getBuyerWorkspace: async () => ({ ok: true, context: { customerId, actorUserId, actorType: 'CUSTOMER_USER', status: 'ACTIVE' } }),
    createBuyerSelectionDownload: async () => ({ ok: true, url: '/selection.xlsx', expiresAt: Date.now() + 60000 }),
    submitBuyerOrder: submit
  });
  await ready();
  const send = (type, details = {}) => handler({ data: { type, ...details } });
  await send('BUYER_ROOM_REQUEST_DATA');
  return {
    send,
    pending: () => posted.filter(message => message.type === 'BUYER_ROOM_DATA').at(-1)?.data.pendingOrderRequestId,
    result: () => posted.filter(message => message.type === 'BUYER_ROOM_ORDER_RESULT').at(-1)
  };
}

test('lost receipt survives a reload, stays in the original company and is cleared only after display', async () => {
  const storage = new Map();
  const orders = new Map();
  const submissions = [];
  const submit = async (lines, scope, requestId, po) => {
    const content = [scope.buyerCompanyId, requestId, lines[0].quantityCtn, po];
    submissions.push(content);
    if (orders.has(requestId)) {
      assert.deepEqual(content, orders.get(requestId));
      return { ok: true, orderId: 'ALPHA-RECEIPT' };
    }
    orders.set(requestId, content);
    throw new Error('Response timed out after commit');
  };
  const alpha = { customerId: 'ALPHA', actorUserId: 'BUYER-1', storage, submit };
  const original = await buyerPage(alpha);
  await original.send('BUYER_ROOM_SUBMIT_ORDER', {
    requestId: alphaRequest, lines: [{ itemId: 'item-a', quantityCtn: 4 }], customerPoNumber: 'ALPHA PO'
  });
  assert.equal(original.result().pendingOrderRequestId, alphaRequest);
  await original.send('BUYER_ROOM_ORDER_ACK', { requestId: alphaRequest });

  for (const other of [{ ...alpha, customerId: 'BETA' }, { ...alpha, actorUserId: 'BUYER-2' }]) {
    const otherPage = await buyerPage(other);
    assert.equal(otherPage.pending(), '');
    await otherPage.send('BUYER_ROOM_RESUME_ORDER', { requestId: alphaRequest });
    assert.equal(otherPage.result().recoveryUnavailable, true);
  }
  const reloaded = await buyerPage(alpha);
  assert.equal(reloaded.pending(), alphaRequest);
  assert.equal(submissions.length, 1);
  await reloaded.send('BUYER_ROOM_SUBMIT_ORDER', { requestId: betaRequest });
  assert.equal(reloaded.result().pendingOrderRequestId, alphaRequest);
  assert.equal(submissions.length, 1);
  await reloaded.send('BUYER_ROOM_RESUME_ORDER', { requestId: alphaRequest, lines: [{ quantityCtn: 9 }] });
  assert.equal(reloaded.result().orderId, 'ALPHA-RECEIPT');
  assert.equal(orders.size, 1);
  assert.equal(submissions.length, 2);
  await reloaded.send('BUYER_ROOM_ORDER_ACK', { requestId: betaRequest });
  assert.equal((await buyerPage(alpha)).pending(), alphaRequest);
  await reloaded.send('BUYER_ROOM_ORDER_ACK', { requestId: alphaRequest });
  assert.equal((await buyerPage(alpha)).pending(), '');
});

test('first-send input errors allow corrections and do not create a recovery prompt', async () => {
  const storage = new Map();
  const buyer = await buyerPage({
    customerId: 'ALPHA', actorUserId: 'BUYER-1', storage,
    submit: async () => { throw new Error('All ordered products must have a released V.I.P price.'); }
  });
  await buyer.send('BUYER_ROOM_SUBMIT_ORDER', { requestId: alphaRequest, lines: [{ itemId: 'item-a', quantityCtn: 4 }] });
  assert.equal(buyer.result().ok, false);
  assert.equal(buyer.result().pendingOrderRequestId, '');
  assert.equal(storage.size, 0);
});

test('Chrome restores the original company request and acknowledges the visible receipt', { timeout: 35000 }, async () => {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 390, height: 820 } });
    tab.setDefaultTimeout(8000);
    const outbound = [];
    await tab.exposeBinding('logOrderEvent', (_, message) => outbound.push(message));
    const host = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe src="/buyer-frame"></iframe>
      <script>
      const child=document.querySelector('iframe').contentWindow;
      const requestId=${JSON.stringify(alphaRequest)};
      function workspace(){
        child.postMessage({type:'BUYER_ROOM_DATA',data:{customerId:'ALPHA',companyName:'Company Alpha',myList:[],pendingOrderRequestId:requestId}},'*');
      }
      addEventListener('message',({source,data})=>{
        if(source!==child)return;
        if(data.type==='BUYER_ROOM_READY')workspace();
        if(data.type==='BUYER_ROOM_RESUME_ORDER'){
          window.logOrderEvent(data);
          child.postMessage({type:'BUYER_ROOM_ORDER_RESULT',ok:true,requestId,orderId:'ALPHA-RECEIPT'},'*');
          workspace();
        }
        if(data.type==='BUYER_ROOM_ORDER_ACK')window.logOrderEvent(data).then(()=>{window.receiptAcknowledged=true});
      });
      </script>`;
    await tab.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'buyer.example.test' && url.pathname === '/buyer-room') {
        return route.fulfill({ body: host, contentType: 'text/html' });
      }
      const assets = {
        '/buyer-frame': ['buyer-room-20261124-company-switch.html', 'text/html'],
        '/master-shared/mobile-menu.css': ['master-shared/mobile-menu.css', 'text/css'],
        '/master-shared/mobile-menu.js': ['master-shared/mobile-menu.js', 'application/javascript'],
        '/fmcg-sales-room-ui/buyer-room/company-switch.js': ['buyer-room/company-switch.js', 'application/javascript']
      };
      const asset = assets[url.pathname];
      return asset && ['buyer.example.test', 'fmcgmalaysia.github.io'].includes(url.hostname)
        ? route.fulfill({ path: path.join(__dirname, '..', asset[0]), contentType: asset[1] })
        : route.abort();
    });
    await tab.goto('https://buyer.example.test/buyer-room');
    const buyer = tab.frameLocator('iframe');
    const recovery = buyer.getByRole('dialog', { name: 'Resume order request' });
    await recovery.getByText('Company Alpha').waitFor();
    assert.deepEqual(outbound, []);
    await recovery.getByRole('button', { name: 'Later' }).click();
    await buyer.getByRole('button', { name: 'Prepare Order' }).click();
    await recovery.getByRole('button', { name: 'Check and resume request' }).click();
    await buyer.getByText('We’ve received your order!').waitFor();
    await recovery.waitFor({ state: 'hidden' });
    await tab.waitForFunction(() => window.receiptAcknowledged === true);
    assert.deepEqual(outbound, [
      { type: 'BUYER_ROOM_RESUME_ORDER', requestId: alphaRequest },
      { type: 'BUYER_ROOM_ORDER_ACK', requestId: alphaRequest }
    ]);
  } finally { await browser.close(); }
});
