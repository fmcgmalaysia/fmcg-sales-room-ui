const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../releases/supplier-unchanged-save-20261116/static/purchase-live/app.js'), 'utf8');
const source = app.slice(app.indexOf('  const supplierFields='), app.indexOf("  window.addEventListener('beforeunload'"));

function fixture({ existing = true } = {}) {
  const elements = new Map(), requests = [], contacts = [];
  const element = key => {
    if (!elements.has(key)) elements.set(key, { value: '', disabled: false, checked: false, dataset: {} });
    return elements.get(key);
  };
  const supplierContext = { id: existing ? 'SUP-123' : '', version: 'confirmed-version', selected: new Set(['CADBURY', 'MAGGI']) };
  const api = vm.runInNewContext(`${source}\n({ supplierFormValues, supplierFormFingerprint, updateSupplierSaveButton, saveSupplier })`, {
    supplierContext, dialogContext: { kind: 'supplier' }, savePending: null, data: { staff: { memberId: 'employee' } },
    document: { querySelector: element, querySelectorAll: () => contacts },
    mutate: (type, payload) => requests.push({ type, payload })
  });
  element('#supplierName').value = existing ? 'SAMPLE SUPPLIER' : '';
  element('#supplierAddress').value = 'OLD OFFICE';
  if (existing) supplierContext.baseline = api.supplierFormFingerprint(api.supplierFormValues());
  return { ...api, element, requests, contacts, supplierContext };
}

test('the edit Save stays disabled until real supplier fields change and disables again on revert', () => {
  const f = fixture();
  f.updateSupplierSaveButton();
  assert.equal(f.element('#saveSupplier').disabled, true);
  assert.equal(f.element('#saveSupplier').dataset.noChanges, 'true');
  f.saveSupplier();
  assert.equal(f.requests.length, 0);
  f.element('#supplierAddress').value = 'NEW OFFICE';
  f.updateSupplierSaveButton();
  assert.equal(f.element('#saveSupplier').disabled, false);
  f.element('#supplierAddress').value = ' old office ';
  f.updateSupplierSaveButton();
  assert.equal(f.element('#saveSupplier').disabled, true);
  assert.match(f.element('#supplierChangeStatus').textContent, /No changes/);
});

test('brand edits affect Save but selecting the original brands in another order does not', () => {
  const f = fixture();
  f.supplierContext.selected.delete('CADBURY');
  f.updateSupplierSaveButton();
  assert.equal(f.element('#saveSupplier').disabled, false);
  f.supplierContext.selected.add('CADBURY');
  f.saveSupplier();
  assert.equal(f.requests.length, 0);
  assert.equal(f.element('#saveSupplier').disabled, true);
  f.element('#supplierBankAccountNo').value = '000341';
  f.saveSupplier();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].payload.values.bankAccountNo, '000341');
  assert.equal(f.requests[0].payload.expectedVersion, 'confirmed-version');
});

test('contact and linked address comparisons follow the effective fields', () => {
  const f = fixture();
  const base = { address: 'OFFICE', warehouseSameAsOffice: true, warehouseAddress: 'OLD', salesContacts: [{name:'ALICE', role:'WAREHOUSE', email:'Alice@example.com'}] };
  assert.equal(f.supplierFormFingerprint(base), f.supplierFormFingerprint({...base, warehouseAddress:'OFFICE'}));
  assert.notEqual(f.supplierFormFingerprint(base), f.supplierFormFingerprint({...base, salesContacts:[{...base.salesContacts[0], email:'alice@example.com'}]}));
});

test('the existing-record rule does not disable creation', () => {
  const f = fixture({ existing: false });
  f.element('#supplierName').value = 'NEW SUPPLIER';
  f.updateSupplierSaveButton();
  assert.equal(f.element('#saveSupplier').disabled, false);
  f.saveSupplier();
  assert.equal(f.requests[0].payload.supplierId, '');
});
