const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'quotation-desk', 'QuotationDeskToolsV3.gs'),
  'utf8'
);
const context = vm.createContext({ console });
vm.runInContext(source, context);

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

test('QD risk priority puts red and low-GP rows before normal rows', () => {
  assert.equal(evaluate('qdRiskPriority_("🔴", 0.04)'), 0);
  assert.equal(evaluate('qdRiskPriority_("🔴", 0.12)'), 1);
  assert.equal(evaluate('qdRiskPriority_("🟢", 0.0599)'), 2);
  assert.equal(evaluate('qdRiskPriority_("🟢", 0.06)'), 3);
  assert.equal(evaluate('qdRiskPriority_("🟢", "5.4%")'), 2);
  assert.equal(evaluate('qdRiskPriority_("🟢", "")'), 3);
});

test('QD open hook silently sorts the formal quotation sheet', () => {
  assert.match(source, /getSheetByName\(QD_CFG\.FORMAL_SHEET_NAME\)/);
  assert.match(source, /sortQuotationSheet_\(formalSheet, false\)/);
});

test('COST HEALTH and its note move with the product row', () => {
  assert.match(source, /SORT_MOVABLE_HEADERS:[\s\S]*?"COST HEALTH"[\s\S]*?"QUOTE STATUS"/);
  assert.match(source, /\.setNotes\(rows\.map\(item => \[item\.notes\[sourceIndex\] \|\| null\]\)\)/);
});
