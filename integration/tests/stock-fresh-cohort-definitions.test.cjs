'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createFreshCohortDefinitionInspector } = require('../prototypes/stock-current-state/fresh-cohort-bootstrap.cjs');
const fs = require('node:fs'), path = require('node:path');
function fixture() {
  const calls = [], metadata = { _id: 'R2StockClaims', revision: '1', fields: [{ key: 'company', type: 'TEXT' }],
    permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' } };
  const response = { indexes: [{ name: 'SC_ACTIVE_PRODUCT', fields: [{ path: 'company', order: 'ASC' }], status: 'ACTIVE', source: 'USER', unique: false }],
    pagingMetadata: { count: 1, offset: 0, total: 1, tooManyToCount: false } };
  let member = 'ACTUAL_ADMIN', authorized = true, reads = 0, drift = false;
  const api = createFreshCohortDefinitionInspector({ system: 'MASTER',
    collections: { getDataCollection: async (target, options) => { calls.push(['metadata', target, options]); reads++; const row = structuredClone(metadata); if (drift === true && reads > 1) row.revision = '2'; return row; } },
    indexes: { listIndexes: async (target, options) => { calls.push(['indexes', target, options]); return structuredClone(response); } },
    authenticateAdmin: async () => ({ isAdmin: authorized, memberId: reads > 1 && drift === 'identity' ? 'OTHER' : member }) });
  return { api, calls, metadata, response, deny: () => authorized = false, drift: value => drift = value };
}
const input = { collection: 'R2StockClaims' };
test('definition capture uses only fixed new-cohort metadata reads, marks indexes unread and keeps activation closed', async () => {
  const f = fixture(), row = await f.api.inspect(input);
  assert.equal(row.metadata._id, input.collection); assert.equal(row.indexesComplete, false);
  assert.equal(row.fieldsComplete, true); assert.equal(row.indexes, null);
  assert.equal(row.indexReadStatus, 'NOT_READ_API_PATH_STOPPED_WDE0144');
  assert.equal(row.activationAllowed, false); assert.equal(row.businessRowsRead, false); assert.equal(row.mutationCapability, false);
  assert.deepEqual(f.calls.map(x => x[0]), ['metadata', 'metadata']);
  assert.ok(f.calls.every(x => x[1] === 'R2StockClaims'));
});
test('legacy/arbitrary table and client evidence/grant flags refuse before reads', async () => {
  for (const value of [{ collection: 'StockClaims' }, { collection: 'R2WixBuyerOrders' }, { ...input, verified: true }, {}]) {
    const f = fixture(); await assert.rejects(f.api.inspect(value)); assert.equal(f.calls.length, 0);
  }
});
test('non-admin and public/incomplete/duplicate field metadata refuse', async () => {
  for (const change of [f => f.deny(), f => f.metadata.permissions.read = 'ANYONE', f => f.metadata.fields.push({ key: 'company', type: 'NUMBER' }), f => delete f.metadata.revision]) {
    const f = fixture(); change(f); await assert.rejects(f.api.inspect(input)); assert.equal(f.calls.some(x => x[0] === 'indexes'), false);
  }
});
test('index fixtures cannot manufacture index acceptance or trigger the stopped API path', async () => {
  for (const change of [f => f.response.pagingMetadata.total = 2, f => delete f.response.pagingMetadata,
    f => f.response.pagingMetadata.offset = 1, f => f.response.pagingMetadata.tooManyToCount = true]) {
    const f = fixture(); change(f); assert.equal((await f.api.inspect(input)).indexesComplete, false);
    assert.equal(f.calls.some(x => x[0] === 'indexes'), false);
  }
});
test('changed collection definition refuses instead of returning stale metadata', async () => {
  const f = fixture(); f.drift(true); await assert.rejects(f.api.inspect(input), /changed during/);
});
test('administrator identity change cannot return definition evidence', async () => {
  const f = fixture(); f.drift('identity'); await assert.rejects(f.api.inspect(input), /same administrator/);
});
test('unused elevation and stopped index capability are absent; definition method stays Admin-only', () => {
  for (const system of ['MASTER', 'FMCGMALAYSIA']) {
    const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/isolated-cohort', system, 'r2cohortBootstrap.web.js'), 'utf8');
    assert.equal((source.match(/elevate\(/g) || []).length, 0);
    assert.ok(!/indexes\.listIndexes/.test(source));
    assert.ok(source.includes('inspectFreshCollectionDefinition=webMethod(Permissions.Admin,input=>definitions.inspect(input))'));
    assert.ok(!/indexes\.(createIndex|dropIndex)/.test(source));
  }
});
