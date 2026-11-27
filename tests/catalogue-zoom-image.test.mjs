import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueZoomReader } from '../backend/catalogueZoomImage.js';

function jpeg(edge) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0, 0xff, 0xd9]);
  bytes.writeUInt16BE(edge, 7);
  bytes.writeUInt16BE(edge, 9);
  return bytes;
}

test('zoom delivers bounded JPEG bytes from the verified CMS source and discards a full-size or mismatched asset', async () => {
  const asset = { sourceId: 'source~mv2.jpg', originalId: 'private.jpg', originalHash: 'verified' };
  const query = { eq() { return this; }, fields() { return this; }, limit() { return this; }, async find() { return { items: [asset] }; } };
  const calls = [];
  let image = jpeg(512);
  const read = createCatalogueZoomReader({
    data: { query(name) { assert.equal(name, 'CatalogueImageAssets'); return query; } },
    download: async url => { calls.push(url); return image; }
  });
  const product = { _id: 'QA', image: 'wix:image://v1/source~mv2.jpg/original.jpg' };
  assert.equal(await read(product), image.toString('base64'));
  assert.deepEqual(calls, ['https://static.wixstatic.com/media/source~mv2.jpg/v1/fit/w_512,h_512,q_85/file.jpg']);
  image = jpeg(1024);
  assert.equal(await read(product), null);
  image = Buffer.alloc(170 * 1024, 1);
  assert.equal(await read(product), null);
  assert.equal(await read({ ...product, image: 'https://elsewhere.example/reference.jpg' }), null);
  asset.sourceId = 'different.jpg';
  assert.equal(await read(product), null);
  assert.equal(calls.length, 3);
});
