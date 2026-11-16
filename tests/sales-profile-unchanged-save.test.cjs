const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replaceAll('\r\n', '\n');

test('Sales profile Save ignores equal values and sends only changed fields', () => {
  const page = read('integration/releases/sales-profile-unchanged-save-20261116/static/index.html');
  const start = page.indexOf("  const profileForm=document.getElementById('customerProfileForm');");
  const end = page.indexOf("  document.querySelectorAll('.user-save')", start);
  assert.ok(start >= 0 && end > start);
  const data = { primaryEmail: 'BUYER@example.test', destinationPortName: 'Port Klang' };
  const save = {}, status = {}, messages = [];
  const form = { addEventListener(_, listener) { this.input = listener; } };
  const elements = { customerProfileForm:form, saveCustomerProfile:save, profileSaveStatus:status };
  vm.runInNewContext(page.slice(start, end), {
    document: { getElementById:id => elements[id] }, currentCustomerId:'C1',
    FormData: class { entries() { return Object.entries(data); } },
    window: { parent: { postMessage(message) { messages.push(message); } } }
  });
  assert.equal(save.disabled, true);
  data.primaryEmail = ' buyer@example.test ';
  form.input();
  assert.equal(save.disabled, true);
  data.destinationPortName = 'Singapore';
  form.input();
  assert.equal(save.disabled, false);
  data.destinationPortName = 'Port Klang';
  form.input();
  form.onsubmit({ preventDefault() {} });
  assert.equal(save.disabled, true);
  assert.deepEqual(messages, []);
  data.destinationPortName = 'Singapore';
  form.input();
  form.onsubmit({ preventDefault() {} });
  assert.equal(JSON.stringify(messages[0].payload), '{"destinationPortName":"Singapore"}');
});

test('Sales CRM skips normalized no-ops and audits only real changes', async () => {
  const source = read('sales-room/wix/onboarding.web.js');
  const segment = (from, until) => {
    const start = source.indexOf(from), end = source.indexOf(until, start + from.length);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const code = segment('const LOCKED_CUSTOMER_FIELDS', 'export const updateSalesRoomSelectionLimit') +
    segment('export const updateSalesRoomCustomerProfile', 'export const saveSalesRoomCustomerUser').replace(/^export /gm, '') +
    segment('function normalizeEditableCustomerValue', 'async function writeAuditChanges');
  const customer = { customerId:'C1', primaryEmail:'BUYER@example.test', destinationPortName:'Port Klang' };
  const calls = [];
  const normalize = value => String(value ?? '').trim();
  let allowed = true;
  const save = vm.runInNewContext(code + '\nupdateSalesRoomCustomerProfile', {
    webMethod:(_, handler) => handler, Permissions:{SiteMember:'member'},
    requireAuthorizedStaffContext:async () => ({id:'staff'}),
    findAuthorizedCustomer:async () => { if (!allowed) throw Error('Access denied'); return customer; },
    normalize, upper:value => normalize(value).toUpperCase(), normalizeEmail:value => normalize(value).toLowerCase(),
    CUSTOMER_COLLECTION:'Customers', PROFILE_AUDIT_COLLECTION:'Audit',
    wixData:{ update:async (_, data) => calls.push(['customer', data]) },
    writeAuditChanges:async (_, __, ___, ____, changes) => calls.push(['audit', changes])
  });
  const input = {primaryEmail:' buyer@example.test ', destinationPortName:' Port Klang '};
  assert.equal((await save('C1', input)).changedFields.length, 0);
  assert.deepEqual(calls, []);
  await save('C1', {...input, destinationPortName:'Singapore'});
  assert.equal(calls[0][1].primaryEmail, 'BUYER@example.test');
  assert.equal(calls[0][1].destinationPortName, 'Singapore');
  assert.equal(calls[1][1].length, 1);
  assert.equal(calls[1][1][0].fieldId, 'destinationPortName');
  await assert.rejects(save('C1', {qdFileId:'other-qd'}), /locked/);
  allowed = false;
  await assert.rejects(save('C1', input), /Access denied/);
  assert.equal(calls.length, 2);
});
