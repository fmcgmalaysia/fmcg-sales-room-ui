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

test('QD menus expose only the requested Chinese actions', () => {
  const onOpen = source.slice(source.indexOf('function onOpen'), source.indexOf('/**', source.indexOf('function onOpen')));
  assert.match(onOpen, /createMenu\("工具"\)/);
  assert.match(onOpen, /addItem\("抓成本", "catchCostCurrentQuotationDesk"\)/);
  assert.match(onOpen, /addItem\("排列产品顺序", "sortQuotationByCatalogueOrder"\)/);
  assert.doesNotMatch(onOpen, /CHECK QD SETUP|checkQuotationDeskSetup/);
  assert.match(onOpen, /createMenu\("PUBLISH QUOTATIONS"\)/);
  assert.match(onOpen, /addItem\("对客户公开报价", "syncQuotationToWix"\)/);
});

test('QD sorting moves each complete row in one native Sheets operation', () => {
  const sorter = source.slice(source.indexOf('function sortQuotationSheet_'), source.indexOf('function qdRiskPriority_'));
  assert.match(sorter, /lastCol \+ helperCount\)\.sort\(/);
  assert.match(sorter, /helperRange\.setValues\(helperValues\)/);
  assert.match(sorter, /helperRange\.clearContent\(\)\.clearNote\(\)/);
  assert.match(sorter, /sheet\.deleteColumns\(originalMaxColumns \+ 1, insertedHelperColumns\)/);
  assert.doesNotMatch(source, /SORT_MOVABLE_HEADERS/);
});

test('QD work queue keeps every pending row at the top', () => {
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.PENDING, 1)'), 0);
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.PENDING, 3)'), 1);
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.VIEW, 0)'), 2);
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.RFQ, 1)'), 3);
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.RFQ, 3)'), 4);
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.FAILED, 3)'), 5);
  assert.equal(evaluate('qdWorkflowPriority_(QD_CFG.STATUS.VIEW, 3)'), 6);
});

test('price edits become system-owned PENDING without sorting during the edit', () => {
  const onEdit = source.slice(source.indexOf('function onEdit'), source.indexOf('function sortQuotationByCatalogueOrder'));
  assert.match(onEdit, /touchesQuote/);
  assert.match(onEdit, /QD_CFG\.STATUS\.PENDING/);
  assert.doesNotMatch(onEdit, /sortQuotationSheet_/);
  assert.match(source, /status === QD_CFG\.STATUS\.PENDING[\s\S]*?e\.oldValue/);
});

test('system-owned PENDING never rebuilds the coloured salesperson dropdown', () => {
  const onEdit = source.slice(source.indexOf('function onEdit'), source.indexOf('function sortQuotationByCatalogueOrder'));
  assert.doesNotMatch(onEdit, /getDataValidations\(\)/);
  assert.doesNotMatch(onEdit, /clearDataValidations\(\)/);
  assert.doesNotMatch(onEdit, /setDataValidations\(/);
  assert.match(onEdit, /\.setValues\(output\)\s*\.setNotes\(notes\)/);
});

test('copied QDs publish with Google staff identity when no script secret exists', () => {
  const publisher = source.slice(source.indexOf('function syncQuotationToWix'), source.indexOf('function checkQuotationDeskSetup'));
  const config = source.slice(source.indexOf('function getSyncConfig_'), source.indexOf('function getMetadataValue_'));
  assert.match(publisher, /config\.token \|\| ScriptApp\.getOAuthToken\(\)/);
  assert.doesNotMatch(config, /!url \|\| !token/);
});

test('QD release marker identifies the Google-identity publication build', () => {
  assert.match(source, /VERSION:\s*["']3\.2\.0["']/);
});

test('cost risk warns but does not block a confirmed quotation', () => {
  const validation = source.slice(source.indexOf('function validateQuoteRow_'), source.indexOf('function markSyncFailures_'));
  assert.match(validation, /QUOTE \$\/PC must be greater than 0/);
  assert.match(validation, /QUOTE \$\/CTN must be greater than 0/);
  assert.doesNotMatch(validation, /COST HEALTH must be green or orange/);
  assert.doesNotMatch(validation, /NET COST \/CTN must be greater than 0/);
});
