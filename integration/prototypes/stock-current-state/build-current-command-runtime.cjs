'use strict';
// Mechanical backend bundle. No production imports/install, no CMS/permission edits.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const entries = {
  createCurrentStockSave: 'current-stock-save.cjs', createCurrentWarehouseReceiptSave: 'current-department-saves.cjs',
  createCurrentBorrowingSave: 'current-department-saves.cjs', createCurrentAllocationSave: 'current-department-saves.cjs', createSdkConditionalStore: 'sdk-conditional-store.cjs',
  createCurrentPurchaseSave: 'current-department-saves.cjs',
  createCurrentQuantityCaseSave: 'current-department-saves.cjs',
  createCurrentShortageSave: 'current-department-saves.cjs',
  createCurrentStockExceptionSave: 'current-stock-exception-save.cjs',
  createCurrentStockResolutionSave: 'current-stock-resolution-save.cjs',
  createCurrentCostReferenceSave: 'current-cost-reference-save.cjs',
  createCurrentPurchaseOrderRecordSave: 'current-order-record-save.cjs',
  createCurrentAccountOrderRecordSave: 'current-order-record-save.cjs',
  createFencedProof: 'fenced-proof.cjs', createSegmentedFencedProof: 'segmented-fenced-proof.cjs', planCollections: 'domain-scope.cjs',
  createPurchaseTransferWorkspace: 'purchase-transfer-workspace.cjs', createBorrowCurrentQuery: 'borrow-current-query.cjs',
  createPurchaseBorrowOptions: 'purchase-borrow-options.cjs',
  createCurrentPackingService: 'current-packing-service.cjs',
  projectCurrentWarehouseReady: 'current-warehouse-ready-context.cjs',
  createCurrentSalesDemandSave: 'current-sales-save.cjs', createCurrentSalesRead: 'current-sales-read.cjs',
  createCurrentSalesShipmentSave: 'current-sales-shipment-save.cjs',
  createCurrentSalesArrangementSave: 'current-sales-arrangement-save.cjs',
  createCurrentWarehouseDispatchSave: 'current-warehouse-dispatch-save.cjs', createCurrentWarehouseShipmentRead: 'current-warehouse-dispatch-save.cjs',
  dispatchCurrentSalesGateway: 'sales-gateway-current.cjs'
};
const sources = new Map();
function collect(name) {
  if (sources.has(name)) return;
  if (!/^[a-z][a-z0-9-]*\.cjs$/.test(name)) throw Error('Explicit local runtime module required');
  let source;
  if (name === 'commit-proof.cjs') {
    // Only the shared deterministic hash is consumed. Do NOT bundle the superseded
    // unsafe overwrite protocol alongside its fenced replacement.
    source = "module.exports = { hash: (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32) };";
  } else source = fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
  sources.set(name, source);
  for (const match of source.matchAll(/require\('([^']+)'\)/g)) {
    if (match[1] === 'node:crypto') continue;
    if (!match[1].startsWith('./')) throw Error('Unsupported backend runtime dependency: ' + match[1]);
    collect(match[1].slice(2));
  }
}
for (const name of Object.values(entries)) collect(name);
const factories = [...sources.entries()].map(([name, source]) => {
  const digest = createHash('sha256').update(source).digest('hex');
  source = source.replace("const { randomUUID } = require('node:crypto');", "const randomUUID = () => randomBytes(16).toString('hex');")
    .replace(/require\('\.\/([^']+)'\)/g, (_, target) => 'load(' + JSON.stringify(target) + ')');
  if (/require\(/.test(source)) throw Error('Unbundled backend runtime dependency');
  return '// ' + name + ' sha256:' + digest + '\n' + JSON.stringify(name) + ': (load, module) => {\n' + source + '\n}';
});
const out = ["import { createHash, randomBytes } from 'crypto';",
  '// Candidate-only backend runtime. Original gateway authentication and verified',
  '// all-writer coverage are mandatory. No webMethods, SDK elevation or mode switch.',
  'const factories = {\n' + factories.join(',\n') + '\n};',
  'const modules = new Map();',
  'function load(name) {',
  "  if (!Object.hasOwn(factories, name)) throw Error('Runtime module scope violation');",
  '  if (!modules.has(name)) { const module = { exports: {} }; modules.set(name, module); factories[name](load, module); }',
  '  return modules.get(name).exports;', '}',
  ...Object.entries(entries).map(([name, module]) => 'export const ' + name + ' = load(' + JSON.stringify(module) + ').' + name + ';'), ''
].join('\n');
const target = path.join(__dirname, 'stockCurrentCommands.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== out) throw Error('Current command runtime differs from tested source');
} else fs.writeFileSync(target, out);
process.stdout.write('Current command backend runtime ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; ' + sources.size + ' scoped modules; no deployment\n');
