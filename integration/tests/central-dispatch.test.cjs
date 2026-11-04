const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = fs.readFileSync(path.join(__dirname, '../apps-script/verified-central-v16/Code.gs'), 'utf8');
const candidate = fs.readFileSync(path.join(__dirname, '../apps-script/Code-master-cost-candidate.gs'), 'utf8');
const actions = { ADD_SELECTION: 'WIX_addCatalogueSelection', REMOVE_SELECTION: 'WIX_removeCatalogueSelection',
  VERIFY_QD: 'WIX_verifyCustomerQuotationDesk', GET_QUOTE_RISK_COUNTS: 'WIX_getQuoteRiskCounts',
  SYNC_FX_RATES: 'WIX_syncFxRates', PUBLISH_QUOTATIONS: 'WIX_publishCustomerQuotations', CREATE_QD: 'WIX_createCustomerQuotationDesk',
  MASTER_CAPTURE_COST: 'WIX_masterCaptureCost' };
function run(source, action, secret = 'LOCAL-TEST-ONLY') {
  const calls = [];
  const context = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'LOCAL-TEST-ONLY' }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) } });
  vm.runInContext(source, context);
  for (const name of Object.values(actions)) context[name] = payload => {
    calls.push({ name, payload: JSON.parse(JSON.stringify(payload)) }); return { marker: name };
  };
  const result = context.doPost({ postData: { contents: JSON.stringify({ action, sharedSecret: secret, barcodes: ['0012345678901'] }) } });
  return { result, calls };
}
test('central patch changes only the new authenticated dispatcher branch', () => {
  const needle = "const result = action === 'ADD_SELECTION'";
  assert.equal(base.split(needle).length, 2);
  assert.equal(candidate, base.replace(needle, "const result = action === 'MASTER_CAPTURE_COST'\n      ? WIX_masterCaptureCost(payload)\n      : action === 'ADD_SELECTION'"));
});
test('all protected central actions preserve their exact version16 dispatch and payload', () => {
  for (const action of Object.keys(actions).filter(action => action !== 'MASTER_CAPTURE_COST')) {
    assert.deepEqual(run(candidate, action), run(base, action), action);
  }
});
test('unauthorized cost requests cannot reach POINTBASE; authorized requests use only the new module', () => {
  const denied = run(candidate, 'MASTER_CAPTURE_COST', 'wrong'); assert.equal(denied.result.ok, false);
  assert.deepEqual(denied.calls, []);
  const accepted = run(candidate, 'MASTER_CAPTURE_COST'); assert.equal(accepted.result.ok, true);
  assert.equal(accepted.calls[0].name, 'WIX_masterCaptureCost'); assert.equal(accepted.calls.length, 1);
  assert.equal(Object.hasOwn(accepted.calls[0].payload, 'sharedSecret'), false);
});
