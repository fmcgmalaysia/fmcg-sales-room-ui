const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto'), load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { requireWarehouseStaff } = load('warehouseReceiving.js');
const { requirePurchaseStaff } = load('purchaseProjection.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const company = 'NCT', key = stockKey({ company, barcode: '1', packing: '12', ea: 12 }), controlId = hash(company, 'STOCK_CONTROL'), calls = [], permissions = [];
  const control = { _id: controlId, company, stockCommitVersion: 'C0', generation: 0, pending: null, mode: 'ACTIVE', schemaVersion: 1 };
  const member = { _id: 'M', status: 'APPROVED', loginEmail: 'w@example.test' }, staff = { title: 'W', description: 'M', staffEmail: member.loginEmail,
    staffName: 'Warehouse', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] };
  const data = { StaffMasterAccess: [staff], NCTActivity: [control], StockProducts: [{ _id: hash(company, key), company, stockKey: key, barcode: '1', packing: '12', ea: 12,
    name: 'Item', status: 'ACTIVE', revision: 0, checkpointGeneration: 0, reviewRequired: false, onHand: 20, isolated: 0, available: 20, reservedUsable: 0,
    secretPlan: { unsafe: 'PRIVATE' }, netCostCtn: 999 }], StockPositions: [], StockClaims: [] };
  let changeDuringRead = false;
  const wixData = { query: collection => {
    let predicates = [], sort = [], offset = 0, size = 50, fields = [];
    const q = { eq(k, v) { fields.push([k, v]); predicates.push(row => Array.isArray(row[k]) ? row[k].includes(v) : row[k] === v); return q; },
      gt(k, v) { predicates.push(row => typeof row[k] === 'number' && row[k] > v); return q; }, isEmpty(k) { predicates.push(row => row[k] == null); return q; },
      contains(k, v) { predicates.push(row => String(row[k] || '').toLowerCase().includes(v.toLowerCase())); return q; },
      and(other) { predicates.push(other.matches); return q; }, or(other) { const previous = predicates; predicates = [row => previous.every(f => f(row)) || other.matches(row)]; return q; },
      matches: row => predicates.every(f => f(row)), ascending(...v) { sort = v; return q; }, skip(v) { offset = v; return q; }, limit(v) { size = v; return q; },
      async find(options) { calls.push({ collection, fields, offset, size, options });
        const selected = (data[collection] || []).filter(q.matches).sort((a, b) => { for (const k of sort) { const n = String(a[k]).localeCompare(String(b[k])); if (n) return n; } return 0; });
        const result = { items: copy(selected.slice(offset, offset + size)), totalCount: selected.length, hasNext: () => false };
        if (changeDuringRead && collection === 'StockProducts') { control.stockCommitVersion = 'C1'; control.generation = 1; changeDuringRead = false; }
        return result;
      } }; return q;
  } };
  const file = path.join(__dirname, '../prototypes/stock-current-state/stockCurrentRead.web.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^import[^\n]+\r?\n/gm, '').replace(/^export /gm, '');
  const api = vm.runInNewContext('(function(){' + source + '\nreturn {getWarehouseStockControlCurrent,getWarehouseStockSourcesCurrent,getPurchaseStockTransfersCurrent};})()', {
    wixData, currentMember: { getMember: async () => member }, requireWarehouseStaff, readCustomerShortNames: async () => [], createHash, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap,
    getPurchaseStaffContext: async () => ({ ...requirePurchaseStaff(member, [staff]), memberId: member._id }),
    webMethod: (permission, fn) => { permissions.push(permission); return fn; }, Permissions: { SiteMember: 'MEMBER' }
  });
  return { api, data, calls, control, member, staff, permissions, controlId, change: () => changeDuringRead = true };
}

test('generated gateway matches source and exposes only original staff-guarded SiteMember reads', () => {
  assert.match(execFileSync(process.execPath, [path.join(__dirname, '../prototypes/stock-current-state/build-current-stock-read-web.cjs'), '--check'], { encoding: 'utf8' }), /matches exact source/);
  const f = fixture(); assert.deepEqual(f.permissions, ['MEMBER', 'MEMBER', 'MEMBER']);
});

test('generated relation gateway retains original Purchase authorization and refuses unverified index as unknown', async () => {
  const f = fixture(); assert.equal((await f.api.getPurchaseStockTransfersCurrent('NCT', { taskId: 'A' })).ok, false); assert.equal(f.calls.length, 0);
  f.staff.departments = ['PURCHASE']; assert.equal((await f.api.getPurchaseStockTransfersCurrent('NCT', { taskId: 'A' })).ok, false);
  f.control.transferIndexVersion = 1;
  const relation = { id: 'R', borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', quantity: 30, repaid: 0 };
  f.data.NCTActivity.push({ _id: hash('NCT', 'STOCK_TRANSFER_CURRENT', 'R'), company: 'NCT', action: 'STOCK_TRANSFER_CURRENT', status: 'ACTIVE',
    participantTaskIds: ['A', 'B'], revision: 1, checkpointGeneration: 0, details: { relation }, secretPlan: 'PRIVATE' });
  const result = await f.api.getPurchaseStockTransfersCurrent('NCT', { taskId: 'A' });
  assert.equal(result.ok, true); assert.equal(result.halo, true); assert.equal(result.items[0].remaining, 30);
  assert.equal(/PRIVATE|secretPlan|stockCommitVersion/.test(JSON.stringify(result)), false);
  assert.ok(f.calls.filter(call => call.fields.some(([key]) => key === 'participantTaskIds')).every(call => call.size === 25 && call.options.consistentRead && call.options.suppressAuth));
});

test('Wix builtin read wrapper suppresses collection auth only after personal Warehouse authorization, never returns private fields', async () => {
  const f = fixture(), page = await f.api.getWarehouseStockControlCurrent('NCT', {});
  assert.equal(page.ok, true); assert.equal(page.items[0].onHand, 20); assert.equal(page.counts.availableProducts, 1);
  assert.equal(/PRIVATE|netCost|secretPlan|stockCommitVersion/.test(JSON.stringify(page)), false);
  assert.equal(f.calls[0].collection, 'StaffMasterAccess');
  const controls = f.calls.filter(c => c.collection === 'NCTActivity'); assert.equal(controls.length, 2);
  for (const call of controls) { assert.deepEqual(copy(call.fields), [['_id', f.controlId]]); assert.equal(call.size, 2); }
  assert.equal(f.calls.length, 8); assert.ok(f.calls.every(c => c.options.suppressAuth && c.options.consistentRead));
});

test('pending or wrong-department member cannot reach stock/control reads, irrespective of iframe flags', async () => {
  const f = fixture(); f.member.status = 'PENDING'; const reply = await f.api.getWarehouseStockControlCurrent('NCT', { canRead: true });
  assert.equal(reply.ok, false); assert.equal(f.calls.length, 0);
  const g = fixture(); g.staff.departments = ['SUPPORT']; assert.equal((await g.api.getWarehouseStockControlCurrent('NCT', {})).ok, false);
  assert.deepEqual(g.calls.map(c => c.collection), ['StaffMasterAccess']);
});

test('pending save, inactive mode and changed generation refuse without any legacy history fallback', async () => {
  for (const kind of ['pending', 'inactive', 'changed']) {
    const f = fixture(); if (kind === 'pending') f.control.pending = { key: 'K', digest: 'D' }; if (kind === 'inactive') f.control.mode = 'LEGACY'; if (kind === 'changed') f.change();
    assert.equal((await f.api.getWarehouseStockControlCurrent('NCT', {})).ok, false);
    assert.ok(f.calls.every(c => c.collection !== 'NCTActivity' || c.fields.some(([k, v]) => k === '_id' && v === f.controlId)));
  }
});
