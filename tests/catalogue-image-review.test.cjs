const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

test('only the administrator can list bounded incomplete image steps without receiving file references', async () => {
  const bundled = readFileSync(join(__dirname, '..', 'handoff', 'cataloguePhotoMigrationAdmin.wix.js'), 'utf8');
  const method = bundled.slice(bundled.indexOf('export const cataloguePictureReview'), bundled.indexOf('// Site-owned scheduler entry point'));
  const calls = [];
  const query = {};
  for (const step of ['ne', 'ascending', 'fields', 'limit']) {
    query[step] = (...args) => { calls.push([step, ...args]); return query; };
  }
  query.find = async () => ({ totalCount: 1, items: [
    { _id: 'qa-record', status: 'COPYING_PREVIEW', fileUrl: 'private-reference' }
  ] });
  const review = runInNewContext(method.replace(/^export /, '') + '\ncataloguePictureReview', {
    wixData: { query: name => { assert.equal(name, 'CatalogueImageAssets'); return query; } },
    registry: 'CatalogueImageAssets', checkpoint: 'catalogue-picture-migration-v1', options: {},
    Permissions: { Admin: 'admin' },
    webMethod: (permission, handler) => { assert.equal(permission, 'admin'); return handler; }
  });
  const response = JSON.parse(JSON.stringify(await review()));
  assert.deepEqual(response, { total: 1, items: [
    { productId: 'qa-record', stage: 'COPYING_PREVIEW', originalRecorded: true, previewRecorded: false }
  ] });
  assert.deepEqual(calls.filter(([operation]) => operation === 'ne' || operation === 'limit'), [
    ['ne', '_id', 'catalogue-picture-migration-v1'], ['ne', 'status', 'VERIFIED'], ['limit', 20]
  ]);
});
