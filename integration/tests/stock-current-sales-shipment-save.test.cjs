const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { createCurrentSalesShipmentSave } = require('../prototypes/stock-current-state/current-sales-shipment-save.cjs');
const { readCurrentSalesWorkspace } = require('../prototypes/stock-current-state/sales-current-workspace.cjs');
const filename = require.resolve('./stock-current-sales-save.test.cjs');
const fixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\nfixture;', { require: createRequire(filename), Map, Buffer });
function fulfilment() {
  const bindings = {}; let source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/customerFulfilment.candidate.js'), 'utf8');
  source = source.replace(/^import \{([^}]+)\} from 'backend\/([^']+)';$/gm, (_, names, file) => { const exports = load(file);
    for (const name of names.split(',').map(s => s.trim())) bindings[name] = exports[name]; return ''; }).replace(/^export /gm, '');
  return vm.runInNewContext('(function(){' + source + '\nreturn {createCustomerFulfilmentOperations,shipmentVersion};})()', { ...bindings, JSON, Date, Error, Map, Set });
}
const api = fulfilment();
async function current(f) {
  const staff = await f.deps.authenticateOriginalDelegation();
  const context = await f.deps.readContext('NCT', staff);
  return (await f.deps.protocol.readSnapshot(control => readCurrentSalesWorkspace({ ...f.deps, control, staff, context }))).rows;
}
test('source Sales SELECT/CANCEL uses current source claims and one hold checkpoint, never dispatches or creates invoice', async () => {
  const f = await fixture(true), before = JSON.stringify([...f.db].filter(([key]) => /^(StockPositions|StockClaims)\//.test(key)));
  const readContext = f.deps.readContext;
  f.deps.readContext = async (...args) => { const context = await readContext(...args); return { ...context, tasks: context.tasks.map(t => ({ ...t, transactionCurrency: 'USD' })) }; };
  const save = createCurrentSalesShipmentSave({ ...f.deps, createCustomerFulfilmentOperations: api.createCustomerFulfilmentOperations, currentAllocationVersion: 2 });
  let workspace = await current(f);
  const request = { requestId: '55555555-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 1,
    input: { action: 'SELECT', customerId: 'C', lines: [{ taskId: 'U', quantity: 5 }], reason: 'Partial shipment', version: api.shipmentVersion(workspace.context) } };
  const result = await save(request); assert.equal(result.status, 'REQUESTED'); assert.equal(result.stockGeneration, 2); await save(request);
  workspace = await current(f); assert.equal([...workspace.products.values()].find(p => p.state.barcode === '2').state.packingHolds.heldByTask.U, 5);
  const cancelled = await save({ requestId: '66666666-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 2,
    input: { action: 'CANCEL', customerId: 'C', id: result.shipmentId, reason: 'Rearrange shipment only', version: api.shipmentVersion(workspace.context) } });
  assert.equal(cancelled.status, 'CANCELLED'); workspace = await current(f);
  assert.equal([...workspace.products.values()].find(p => p.state.barcode === '2').state.packingHolds.heldByTask.U, 0);
  assert.equal(JSON.stringify([...f.db].filter(([key]) => /^(StockPositions|StockClaims)\//.test(key))), before);
  assert.equal(f.context().tasks.find(t => t.id === 'U').requested, 10);
  assert.equal([...f.db.values()].filter(r => r.action === 'CUSTOMER_SHIPMENT_CHANGED').length, 2);
  assert.equal([...f.db.values()].some(r => ['INVOICED', 'DISPATCHED'].includes(r.details?.shipment?.status)), false);
});
