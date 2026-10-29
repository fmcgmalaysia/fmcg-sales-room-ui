// Dependency inventory only. Does not execute or replace a business module.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../backend');
const modules = new Map(fs.readdirSync(root).filter(name => name.endsWith('.js')).map(name => {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const imports = [...source.matchAll(/from\s+['"]backend\/([^'"]+)['"]/g)].map(m => m[1]);
  return [name, { imports, source }];
}));
const authorityConsumers = {
  'inventoryExceptions.js': 'Physical remaining stock and quarantine admission currently use Dispatch totals.',
  'stockCardProjection.js': 'Source/customer coverage currently subtracts Dispatch totals.',
  'warehousePreparation.js': 'Ready stock and batch sent quantities currently use Dispatch totals.',
  'packingListContext.js': 'Remaining demand and Packing readiness currently use Dispatch totals.',
  'plannerAllocation.js': 'Uses source stock plus shipment reservations; must retain already-consumed allocation.',
  'customerFulfilment.js': 'SELECT source assignment and Dispatch must reference confirmed Loaded consumption.',
  'supportInvoice.js': 'Main invoice readiness must consume the same Loaded identity, not a parallel preparation total.',
  'warehouseReceiving.js': 'Receipt correction must not reduce below confirmed consumed stock.',
  'purchaseProgress.js': 'Physical shipped facts and financial completion must remain distinct, with one physical authority.',
  'customerCompletionProjection.js': 'Reported physical shipped totals need the common result; invoice/payment checks remain financial.',
  'customerShipmentPlan.js': 'Version/admission must include the same consumption state across both loading entry points.'
};
function importPath(from, target, visited = new Set()) {
  if (from === target) return [from];
  if (visited.has(from)) return null;
  visited.add(from);
  for (const next of modules.get(from)?.imports || []) {
    const found = importPath(next, target, visited);
    if (found) return [from, ...found];
  }
  return null;
}
const entries = [...modules.keys()].filter(name => name.endsWith('.web.js') || name === 'http-functions.js');
const result = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  purpose: 'READ_ONLY_DEPENDENCY_SCOPE_NOT_IMPLEMENTATION_OR_LIVE_VERIFICATION',
  scannedDirectory: 'integration/backend', moduleCount: modules.size,
  requiredSingleAuthority: {
    successfulLoadedPostsPhysicalConsumption: true,
    invoiceAndDispatchMayPostPhysicalConsumption: false,
    legacyRuntimeFormulaFallbackAllowed: false,
    perPageStockFormulaAllowed: false,
    secondEditableBalanceAllowed: false,
    historicPhysicalFactsMustBeReconciled: true,
    historicOverlapMayBeGuessed: false,
    financialStateMustNotBeMechanicallyRewrittenAsStock: true
  },
  consumers: Object.entries(authorityConsumers).map(([name, reason]) => {
    const module = modules.get(name);
    if (!module) throw Error('Known consumer missing: ' + name);
    return { path: 'integration/backend/' + name, reason,
      normalizedSha256: crypto.createHash('sha256').update(module.source.replace(/\r\n/g, '\n')).digest('hex'),
      entryPaths: entries.map(entry => importPath(entry, name)).filter(Boolean) };
  }),
  productionWrites: 0, runtimeModulesChanged: process.argv.includes('--candidate')
};
// These are physical-quantity consumers, not invoice/debtor/finance status reads.
// A candidate cannot pass by merely adjusting the Stock Control display.
const physicalConsumers = ['inventoryExceptions.js', 'stockCardProjection.js',
  'warehousePreparation.js', 'packingListContext.js'];
result.legacyPhysicalFormulaSites = physicalConsumers.flatMap(name => {
  const lines = modules.get(name).source.split(/\r?\n/);
  return lines.flatMap((line, index) => /DISPATCHED/.test(line) && /\.reduce\(/.test(line) &&
    /dispatched|shipped|sent|target\s*=/.test(line)
    ? [{ path: 'integration/backend/' + name, line: index + 1,
      reason: 'Physical quantity still derives independently from commercial Dispatch status.' }] : []);
});
result.singleAuthorityGatePassed = result.legacyPhysicalFormulaSites.length === 0;
const out = process.argv.find(arg => arg.startsWith('--out='));
if (out) fs.writeFileSync(path.resolve(out.slice(6)), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ moduleCount: result.moduleCount, directConsumers: result.consumers.length,
  affectedEntries: [...new Set(result.consumers.flatMap(c => c.entryPaths.map(p => p[0])))],
  legacyPhysicalFormulaSites: result.legacyPhysicalFormulaSites,
  singleAuthorityGatePassed: result.singleAuthorityGatePassed,
  runtimeModulesChanged: process.argv.includes('--candidate') }, null, 2));
// A source inventory is only a necessary gate. Dynamic quantity and recovery
// scenarios must also pass; zero regex matches alone never proves one authority.
if (process.argv.includes('--require-single-authority') && !result.singleAuthorityGatePassed) process.exitCode = 2;
