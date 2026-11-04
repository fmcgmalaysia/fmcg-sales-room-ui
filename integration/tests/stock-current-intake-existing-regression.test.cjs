// Run unchanged protected Source delivery/cross-site/browser assertions against
// isolated candidate paths. No assertion changes or test filtering.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
async function loadCurrentDelivery() {
  const { buildNctSubmission } = await import('../../backend/nctSubmissionPayload.js');
  const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/nctSubmissionDelivery.candidate.js'), 'utf8');
  return vm.runInNewContext(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + ';({createNctSubmissionDelivery});', { buildNctSubmission, Date, Map, Set, JSON, Number, Error });
}
for (const file of ['nct-delivery.test.cjs','nct-cross-site.test.cjs','nct-submit-feedback.test.cjs']) {
  const filename = path.join(__dirname, file), originalRequire = createRequire(filename);
  let source = fs.readFileSync(filename, 'utf8');
  if (file === 'nct-submit-feedback.test.cjs') {
    assert.equal(source.split('../../index.html').length, 2);
    source = source.replace('../../index.html', '../prototypes/stock-current-state/source-ui/index.html');
  } else assert.ok(source.includes("require('./load-nct-delivery.cjs')"));
  new Function('require', '__dirname', '__filename', source)(name => name === './load-nct-delivery.cjs' ? loadCurrentDelivery : originalRequire(name), __dirname, filename);
}
