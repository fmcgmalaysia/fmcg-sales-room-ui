'use strict';
// Mechanical standalone Wix module. Candidate only; no live sync or publish here.
const fs = require('node:fs'), path = require('node:path');
const root = __dirname;
function body(file, imports) {
  let source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^'use strict';\r?\n/, '');
  for (const line of imports) source = source.replace(line, '');
  source = source.replace(/module\.exports = ([^;]+);/, 'return $1;');
  if (source.includes('require(') || source.includes('module.exports')) throw Error('Unexpected recovery bundle dependency');
  return source.trim();
}
const out = [
  "import { items } from '@wix/data';", "import { webMethod, Permissions } from 'wix-web-module';",
  "import { createHash } from 'crypto';", "import { Buffer } from 'buffer';",
  "const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);",
  'const { planCollections } = (() => {\n' + body('domain-scope.cjs', []) + '\n})();',
  'const { createSdkFieldCodec } = (() => {\n' + body('sdk-field-codec.cjs', []) + '\n})();',
  'const { createRecoveryReadStore } = (() => {\n' + body('recovery-read-store.cjs', ["const { planCollections } = require('./domain-scope.cjs');", "const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');"]) + '\n})();',
  'const { createSegmentedPlanCodec, same } = (() => {\n' + body('segmented-plan.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { planCollections } = require('./domain-scope.cjs');"]) + '\n})();',
  'const { inspectSegmentedStockRecovery } = (() => {\n' + body('segmented-recovery-inspector.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { createSegmentedPlanCodec, same } = require('./segmented-plan.cjs');"]) + '\n})();',
  'const { inspectStockRecovery } = (() => {\n' + body('recovery-inspector.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { planCollections } = require('./domain-scope.cjs');", "const { inspectSegmentedStockRecovery } = require('./segmented-recovery-inspector.cjs');"]) + '\n})();',
  '// Administrator-only READ: no deletes, retries, uploads, mode changes or business saves.',
  'export const inspectStockSave = webMethod(Permissions.Admin, async request => {',
  '  try {',
  "    if (!request || Object.keys(request).some(k => !['company', 'requestId', 'memberId', 'input', 'pageSize', 'cursor'].includes(k))",
  "      || typeof request.memberId !== 'string' || request.memberId.length > 128 || !Object.hasOwn(request, 'input')",
  "      || Buffer.byteLength(JSON.stringify(request), 'utf8') > 180000) throw Error('Bounded original save identity required');",
  '    const { company, requestId, memberId, input, pageSize, cursor } = request;',
  "    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';",
  '    // Only these existing DateTime field IDs were inspected in MASTER CMS.',
  "    const store = createRecoveryReadStore({ items, company, dateTimeFields: { [journal]: ['activityTime'] } });",
  '    return { ok: true, report: await inspectStockRecovery({ store, company, requestId, memberId, input, domainWrites: true, pageSize, cursor }) };',
  '  } catch (_) {',
  "    return { ok: false, error: 'Inventory recovery inspection unavailable. No recovery performed.' };",
  '  }',
  '});', ''
].join('\n');
fs.writeFileSync(path.join(root, 'stockRecoveryRead.web.js'), out);
process.stdout.write('Built read-only Admin recovery candidate from exact inspector/query-only store\n');
