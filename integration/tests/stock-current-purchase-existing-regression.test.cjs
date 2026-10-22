// Run unchanged protected supplier-dialog assertions against the CURRENT candidate.
// Only the source file loaded by each existing fixture changes; no assertion rewrite.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
for (const [file, module] of [...['purchase-allocation-action-colors.test.cjs', 'purchase-allocation-audit.test.cjs',
  'purchase-allocation-dialog.test.cjs', 'purchase-allocation-drafts.test.cjs', 'purchase-allocation-waiting.test.cjs'].map(file => [file, 'supplier-allocation.js']),
  ...['purchase-source-grid.test.cjs', 'order-adjustment-views.test.cjs', 'sales-split-rows.test.cjs'].map(file => [file, 'task-grid.js'])]) {
  const filename = path.join(__dirname, file), source = fs.readFileSync(filename, 'utf8');
  const original = '../../purchase-live/' + module;
  assert.equal(source.split(original).length, 2, 'Exact protected supplier fixture anchor required');
  new Function('require', '__dirname', '__filename', source.replace(original, '../prototypes/stock-current-state/purchase-ui/' + module))(
    createRequire(filename), __dirname, filename);
}
