const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { createHash } = require('node:crypto');

test('only the administrator can list bounded incomplete image steps without receiving file references', async () => {
  const bundled = readFileSync(join(__dirname, '..', 'handoff', 'cataloguePhotoMigrationAdmin.wix.js'), 'utf8');
  const method = bundled.slice(bundled.indexOf('export const cataloguePictureReview'), bundled.indexOf('// Retry only the existing pre-upload exceptions'));
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

test('a one-record retry requires matching Wix descriptor size, checksum and valid JPEG dimensions', async () => {
  const bundle = readFileSync(join(__dirname, '..', 'handoff', 'cataloguePhotoMigrationAdmin.wix.js'), 'utf8');
  const source = bundle.slice(bundle.indexOf('function recoveryJpegDimensions'), bundle.indexOf('// Site-owned scheduler entry point'));
  const id = 'pb_4800214061219';
  const file = 'owner.jpg';
  const bytes = Buffer.from('ffd8ffc00008080002000301ffd9', 'hex');
  const jpeg = Buffer.concat([bytes.subarray(0, 2), Buffer.from('ffe000020000', 'hex').subarray(0, 4), bytes.subarray(2)]);
  const hash = createHash('md5').update(jpeg).digest('hex');
  let currentHash = '0'.repeat(32), calls = 0;
  const repair = runInNewContext(source.replace(/^export /m, '') + '\nretryCatalogueReviewJpeg', {
    Buffer, createHash, Permissions: { Admin: 'admin' }, webMethod: (permission, handler) => { assert.equal(permission, 'admin'); return handler; },
    checkpoint: 'cursor', store: { get: async key => key === 'cursor' ? { status: 'FINISHED' } : { status: 'NEW', sourceId: file } },
    wixData: { get: async () => ({ _id: id, image: file }) }, products: 'products', options: {},
    fileId: value => value, sourceReference: value => value,
    elevate: adapter => adapter, files: { getFileDescriptor: async () => ({ _id: file, private: false,
      operationStatus: 'READY', mediaType: 'IMAGE', mimeType: 'image/jpeg', sizeInBytes: jpeg.length, hash: currentHash }) },
    readBytes: async () => jpeg, operations: {}, media: {},
    migrateCataloguePhoto: async (product, services) => {
      calls++;
      const info = await services.media.getFileInfo(product.image);
      assert.equal(info.width, 3); assert.equal(info.height, 2); assert.equal(info.hash, hash);
      return { status: 'VERIFIED' };
    }
  });
  assert.equal((await repair('unlisted')).status, 'OUT_OF_SCOPE');
  assert.equal((await repair(id)).status, 'SOURCE_CHECKSUM_REVIEW');
  assert.equal(calls, 0);
  currentHash = hash;
  assert.equal((await repair(id)).status, 'VERIFIED');
  assert.equal(calls, 1);
});
