const assert=require('node:assert/strict');
function patchPublishSwitch(app){
  function replace(before,after){assert.equal(app.split(before).length,2,'Unexpected quotation source: '+before.slice(0,70));app=app.replace(before,after);}
  replace('const publishingRows = new Set();','const publishingRows = new Set();\nconst publicationIndicators = new Map();');
  replace('  publishingRows.add(row.id);\n  repaintPublicationRow(row, workspace);',"  publicationIndicators.set(rowKey, publicationAttempts.get(rowKey)?.enabled ?? (action === 'publish' || !row.published?.enabled));\n  publishingRows.add(row.id);\n  repaintPublicationRow(row, workspace);");
  replace("    if (current === workspace) message(error.message, true);\n  } finally {\n    publishingRows.delete(row.id);", "    publicationIndicators.delete(rowKey);\n    if (current === workspace) message(error.message, true);\n  } finally {\n    if (!row.pending) publicationIndicators.delete(rowKey);\n    publishingRows.delete(row.id);");
  replace('  const visible = Boolean(row.published?.enabled);\n  const publishing = publishingRows.has(row.id);','  const visible = Boolean(row.published?.enabled);\n  const publishing = publishingRows.has(row.id);\n  const switchOn = publishing || row.pending ? publicationIndicators.get(key(row.id)) ?? visible : visible;');
  replace('aria-checked="${visible}" class="switch" data-action="toggle"','aria-checked="${switchOn}" class="switch" data-action="toggle"');
  return app;
}
module.exports={patchPublishSwitch};
