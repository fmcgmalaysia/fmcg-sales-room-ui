const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function harness() {
  const source = fs.readFileSync(path.join(root, 'sales-room/wix/sales-room-page.js'), 'utf8');
  const start = source.indexOf('function createNativeBuyerEntry(');
  const end = source.indexOf('\nasync function getSalesRoomCustomersWithQuoteSignals', start);
  assert(start >= 0 && end > start, 'native entry controller exists');
  const button = { link: '', visible: false, enabled: false,
    hide() { this.visible = false; }, show() { this.visible = true; },
    disable() { this.enabled = false; }, enable() { this.enabled = true; } };
  const context = { URL, Map, encodeURIComponent };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { button, entry: context.createNativeBuyerEntry(button, 'https://fmcg999.wixstudio.com/fmcgmalaysia') };
}
const customers = [
  { customerId: 'CUS-A', customerShortName: 'Customer A', catalogueAccessStatus: 'ACTIVE' },
  { customerId: 'CUS-B', companyName: 'Customer B', catalogueAccessStatus: 'ACTIVE' }
];

test('two authorized customers get independent native new-tab links', () => {
  const { button, entry } = harness();
  entry.setStaff({ authorized: true }); entry.setCustomers(customers);
  for (const c of customers) {
    entry.setWorkspace(c.customerId);
    assert.equal(button.target, '_blank');
    assert.equal(button.link, 'https://fmcg999.wixstudio.com/fmcgmalaysia/buyer-room?assist=' + c.customerId);
    assert.equal(button.visible, true); assert.equal(button.enabled, true);
    assert(button.label.includes(c.customerShortName || c.companyName));
  }
});
test('closed, unknown and malformed workspace cannot retain a previous customer link', () => {
  const { button, entry } = harness(); entry.setStaff({ authorized: true }); entry.setCustomers(customers);
  for (const id of ['', 'CUS-OTHER', 'https://other.example/']) {
    entry.setWorkspace('CUS-A'); entry.setWorkspace(id);
    assert.equal(button.link, ''); assert.equal(button.enabled, false); assert.equal(button.visible, false);
  }
});
test('staff denial, customer removal and suspension immediately disable the entry', () => {
  const { button, entry } = harness(); entry.setCustomers(customers); entry.setWorkspace('CUS-A');
  assert.equal(button.link, ''); entry.setStaff({ authorized: true }); assert(button.link);
  entry.setStaff({ authorized: false }); assert.equal(button.link, '');
  entry.setStaff({ authorized: true }); entry.setCustomers([customers[1]]); assert.equal(button.link, '');
  for (const state of [{catalogueAccessStatus:'SUSPENDED'}, {accessStatus:'BLOCKED',catalogueAccessStatus:''}, {customerStatus:'SUSPENDED'}, {lifecycleStatus:'ARCHIVED'}, {reactivationStatus:'REQUESTED'}]) {
    entry.setCustomers([{...customers[0],...state}]); assert.equal(button.link, '');
  }
});
test('late staff/customer responses after closing do not resurrect the entry', () => {
  const { button, entry } = harness(); entry.setWorkspace('CUS-A'); entry.setWorkspace('');
  entry.setStaff({ authorized: true }); entry.setCustomers(customers);
  assert.equal(button.link, ''); assert.equal(button.visible, false);
});

test('workspace context clears on navigation, close and replacement without a second click handler', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const start = html.indexOf('(function bindNativeBuyerEntryContext(){');
  const end = html.indexOf('})();', start) + 5;
  let active = true, modal = { dataset: { buyerCustomer: 'CUS-A' } }, notify;
  const sent = [];
  const area = { querySelector: () => modal };
  const view = { classList: { contains: () => active } };
  vm.runInNewContext(html.slice(start, end), {
    document: { getElementById: id => id === 'customers' ? view : area },
    window: { parent: { postMessage: message => sent.push(message.customerId) } },
    MutationObserver: class { constructor(fn) { notify = fn; } observe() {} }
  });
  notify(); assert.deepEqual(sent, ['CUS-A']);
  modal.dataset.buyerCustomer = 'CUS-B'; notify();
  active = false; notify(); active = true; notify();
  modal = null; notify();
  assert.deepEqual(sent, ['CUS-A', 'CUS-B', '', 'CUS-B', '']);
  assert(!html.includes("buyer.onclick=()=>window.open(buyerRoomAdminUrlV27"));
});
