const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function patchCostRead(app) {
  function replace(before, after) {
    assert.equal(app.split(before).length, 2, 'Unexpected quotation source: ' + before.slice(0, 100));
    app = app.replace(before, () => after);
  }
  replace('const publicationAttempts = new Map();', 'const publicationAttempts = new Map();\nconst costAttempts = new Map();\nconst costReaders = new Set();');
  replace('    renderQuotes(scrollPosition);', '    renderQuotes(scrollPosition);\n    costButtonState();\n    if (costAttempts.has(context)) void confirmCostRead(context);');
  replace("    $('#staff').textContent = result.staffName || '';", `    const costReads = readStorage('cost-reads:' + staffId, []);
    if (Array.isArray(costReads)) for (const entry of costReads) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [context, packet] = entry;
      if (result.customers.some(row => row.customerId === context) && /^[a-f0-9-]{36}$/i.test(packet?.requestId || '')) costAttempts.set(context, packet);
    }
    $('#staff').textContent = result.staffName || '';`);
  replace('  if (publishingRows.size) return;\n  const context = customerId();', "  if (button.id === 'catch-cost') { await confirmCostRead(customerId(), true); return; }\n  if (publishingRows.size) return;\n  const context = customerId();");
  replace(`    if (button.id === 'catch-cost') {
      const result = await api('cost', {}, context);
      message(\`Catch Cost: \${result.updated} updated · \${result.failed} failed.\`,
        result.failed > 0 && result.updated === 0, result.failed > 0 && result.updated > 0);
    } else if (action === 'draft') {`, "    if (action === 'draft') {");
  replace('function repaintPublicationRow(row, workspace) {', fs.readFileSync(path.join(__dirname, 'cost-client.js'), 'utf8') + '\n\nfunction repaintPublicationRow(row, workspace) {');
  replace("  $('#catch-cost').disabled = publishingRows.size > 0 || !workspace.canEdit || !workspace.rows.length;", '  costButtonState();');
  replace('<span class="muted">Last Cost Refresh &nbsp;', '<span class="muted" data-cost-refresh>Last Cost Refresh &nbsp;');
  return app;
}
module.exports = { patchCostRead };
