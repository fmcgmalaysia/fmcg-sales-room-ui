'use strict';
const fs = require('node:fs'), path = require('node:path');
const { WRITERS } = require('./stock-admission.cjs');
function body(file, imports = []) {
  let source = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^'use strict';\r?\n/, '');
  for (const line of imports) source = source.replace(line, '');
  source = source.replace(/module\.exports = ([^;]+);/, 'return $1;');
  if (source.includes('require(') || source.includes('module.exports')) throw Error('Unexpected current-read dependency');
  return source.trim();
}
const out = [
  "import wixData from 'wix-data';", "import { webMethod, Permissions } from 'wix-web-module';",
  "import { currentMember } from 'wix-members-backend';", "import { requireWarehouseStaff } from 'backend/warehouseReceiving.js';",
  "import { readCustomerShortNames } from 'backend/customerNamesClient.js';",
  "import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';",
  "import { requirePurchaseStaff } from 'backend/purchaseProjection.js';",
  "import { createHash } from 'crypto';",
  "const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);",
  'const WRITERS = Object.freeze(' + JSON.stringify(WRITERS) + ');',
  '// CLOSED until all native writer/cutover acceptance gates pass; no browser grant.',
  'const writerCoverage = Object.freeze({});',
  'const { stockKey } = (() => {\n' + body('current-model.cjs', ["const { hash } = require('./commit-proof.cjs');"]) + '\n})();',
  'const { createCurrentQuery } = (() => {\n' + body('current-query.cjs') + '\n})();',
  'const { createCurrentReadBarrier } = (() => {\n' + body('current-read-barrier.cjs', ["const { hash } = require('./commit-proof.cjs');", "const { WRITERS } = require('./stock-admission.cjs');"]) + '\n})();',
  'const { createCurrentStockControlService } = (() => {\n' + body('stock-control-current-service.cjs', ["const { hash } = require('./commit-proof.cjs');",
    "const { stockKey } = require('./current-model.cjs');", "const { createCurrentQuery } = require('./current-query.cjs');"]) + '\n})();',
  "const transferId = (company, id) => hash(company, 'STOCK_TRANSFER_CURRENT', id);",
  'const { createBorrowCurrentQuery } = (() => {\n' + body('borrow-current-query.cjs', ["const { hash } = require('./commit-proof.cjs');",
    "const { transferId } = require('./borrowing-stock-plan.cjs');"]) + '\n})();',
  '// Existing builtin Wix Data read context, original staff checks BEFORE data reads.',
  '// Only read builders exposed: no SDK dependency addition or mutation capability.',
  'function privateItems(company) {',
  "  if (!['NCT', 'GHR'].includes(company)) throw Error('Known company required');",
  "  const allowed = new Set(['StockProducts', 'StockPositions', 'StockClaims', company === 'NCT' ? 'NCTActivity' : 'NCTActivity1']);",
  '  const inner = new WeakMap();',
  '  function wrap(query) {',
  '    const wrapped = {}; inner.set(wrapped, query);',
  "    for (const method of ['eq','gt','isEmpty','contains','and','or','ascending','skip','limit']) wrapped[method] = (...args) => wrap(query[method](...args.map(arg => inner.get(arg) || arg)));",
  '    wrapped.find = async () => query.find({ suppressAuth: true, consistentRead: true });',
  '    return wrapped;',
  '  }',
  "  return { query: collection => { if (!allowed.has(collection)) throw Error('Stock read scope violation'); return wrap(wixData.query(collection)); } };",
  '}',
  'async function staffRecords() {',
  "  let page = await wixData.query('StaffMasterAccess').limit(1000).find({ suppressAuth: true, consistentRead: true }), rows = [...page.items];",
  '  while (page.hasNext()) { page = await page.next(); rows.push(...page.items); } return rows;',
  '}',
  'async function read(company, input, detail, authorize = requireWarehouseStaff) {',
  '  try {',
  "    if (JSON.stringify(input || {}).length > 6000) throw Error('Bounded stock request required');",
  '    const items = privateItems(company), protocol = createCurrentReadBarrier({ company, items, coverage: writerCoverage });',
  '    const service = createCurrentStockControlService({ company, items, protocol, requireWarehouseStaff: authorize,',
  "      readMember: () => currentMember.getMember({ fieldsets: ['FULL'] }), readStaffRecords: staffRecords, now: () => new Date() });",
  '    const result = await service[detail ? \'detail\' : \'read\'](company, input);',
  "    if (detail && input?.kind === 'claims') {",
  '      let names = [];',
  '      try { names = await readCustomerShortNames([...new Set(result.items.map(row => row.customerId))]); } catch (_) { result.customerNamesUnavailable = true; }',
  "      result.items = result.items.map(row => ({ ...row, customerName: names.find(name => name.customerId === row.customerId)?.shortName || row.customerId }));",
  '    }',
  '    return { ok: true, ...result };',
  '  } catch (error) {',
  "    return { ok: false, error: /^Stock changed while paging/.test(String(error?.message || '')) ? 'Stock changed. Refresh the stock list. 库存已变动，请刷新列表。' : 'Current inventory unavailable. 库存暂不可读取。' };",
  '  }',
  '}',
  'export const getWarehouseStockControlCurrent = webMethod(Permissions.SiteMember, (company, input) => read(company, input, false));',
  'export const getWarehouseStockSourcesCurrent = webMethod(Permissions.SiteMember, (company, input) => read(company, input, true));',
  'export const getPurchaseStockControlCurrent = webMethod(Permissions.SiteMember, (company, input) => read(company, input, false, requirePurchaseStaff));',
  'export const getPurchaseStockSourcesCurrent = webMethod(Permissions.SiteMember, (company, input) => read(company, input, true, requirePurchaseStaff));',
  'export const getPurchaseStockTransfersCurrent = webMethod(Permissions.SiteMember, async (company, input) => {',
  '  try {',
  "    if (JSON.stringify(input || {}).length > 6000) throw Error('Bounded relation request required');",
  '    const items = privateItems(company), protocol = createCurrentReadBarrier({ company, items, coverage: writerCoverage });',
  '    const query = createBorrowCurrentQuery({ company, items, protocol, authenticate: getPurchaseStaffContext });',
  '    return { ok: true, ...await query(company, input) };',
  "  } catch (_) { return { ok: false, error: 'Borrowing relationships unconfirmed. Refresh and review. 借货关系尚未确认，请刷新核对。' }; }",
  '});', ''
].join('\n');
const target = path.join(__dirname, 'stockCurrentRead.web.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== out) throw Error('Current read bundle differs from source');
  process.stdout.write('Current stock read bundle matches exact source\n');
} else {
  fs.writeFileSync(target, out);
  process.stdout.write('Built exact current-stock read gateway candidate; no live synchronization\n');
}
