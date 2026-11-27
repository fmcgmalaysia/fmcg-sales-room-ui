import { openBuyerImage, buyerImageLink } from '../backend/buyerProductImage.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCatalogueImageAsset, createCataloguePreviewReader, createVerifiedCatalogueMedia } from '../backend/catalogueImageAssets.js';

const uri = id => 'wix:image://v1/' + id + '/test.jpg';
const refs = { productId: 'qa-001', source: uri('old'), original: uri('hd'), preview: uri('small') };
function fixture() {
  const records = new Map([['old', false, 900], ['hd', true, 900], ['small', true, 160]].map(([id, priv, width]) =>
    [uri(id), { fileUrl: uri(id), isPrivate: priv, width, height: width, mimeType: 'image/jpeg', mediaType: 'image',
      hash: 'hash-' + width, sizeInBytes: width * 20, opStatus: 'READY' }]));
  return { records, getFileInfo: async url => records.get(url) };
}
test('Wix FileInfo without opStatus must match the ready v2 descriptor for the same private file', async () => {
  const manager = fixture();
  const original = manager.records.get(refs.original);
  delete original.opStatus;
  let descriptor = {_id:'hd',private:true,mediaType:'IMAGE',operationStatus:'READY'};
  const media = createVerifiedCatalogueMedia(manager, async () => descriptor);
  assert.equal((await media.getFileInfo(refs.original)).opStatus,'READY');
  descriptor.operationStatus = 'PENDING';
  assert.equal((await media.getFileInfo(refs.original)).opStatus,'PENDING');
  descriptor.private = false;
  await assert.rejects(media.getFileInfo(refs.original));
  descriptor = {...descriptor,private:true,_id:'other'};
  await assert.rejects(media.getFileInfo(refs.original));
});
test('migration matches original checksum, dimensions, size, privacy and processing status', async () => {
  const media = fixture();
  const verified = await verifyCatalogueImageAsset(refs, media);
  assert.equal(verified.fileUrl, refs.original);
  assert.equal(verified.previewFileUrl, refs.preview);
  for (const [target, field, value] of [
    ['original', 'hash', 'changed'], ['original', 'isPrivate', false], ['original', 'opStatus', 'IN-DOWNLOAD-QUEUE'],
    ['original', 'width', 890], ['original', 'sizeInBytes', 1], ['preview', 'width', 1024], ['preview', 'isPrivate', false]
  ]) {
    const copy = fixture();
    copy.records.get(refs[target])[field] = value;
    await assert.rejects(verifyCatalogueImageAsset(refs, copy));
  }
  await assert.rejects(verifyCatalogueImageAsset({ ...refs, preview: refs.original }, media));
});

test('a Buyer Room link checks the company, live selection, quota and verified original every time', async () => {
  const media = fixture(), asset = await verifyCatalogueImageAsset(refs, media);
  const signed = [];
  media.getDownloadUrl = async (file, minutes) => { signed.push([file, minutes]); return 'https://qa.invalid/download'; };
  const companyId = 'CUS-QA-ALPHA', selectionId = 'selection-a';
  const request = {companyId, selectionId};
  const selection = { _id: selectionId, customerId: companyId, payload: { customerId: companyId, productId: refs.productId } };
  const services = { media, authorize: async () => ({customerId:companyId}), getSelection: async () => selection,
    reserveDownload: async () => true, getPrivateAsset: async () => asset };
  assert.equal(new URL(buyerImageLink(companyId, selectionId)).searchParams.get('imageSelection'), selectionId);
  assert.equal((await openBuyerImage(request, services)).url, 'https://qa.invalid/download');
  for (const change of [
    { authorize: async () => ({customerId:'CUS-QA-BETA'}) },
    { getSelection: async () => ({...selection, removed:true}) },
    { getSelection: async () => ({...selection, payload:{ ...selection.payload, customerId:'CUS-QA-BETA' }}) },
    { reserveDownload: async () => false },
    { getPrivateAsset: async () => ({ ...asset, status:'PENDING' }) },
    { getPrivateAsset: async () => ({ ...asset, originalHash:'changed' }) },
    { getPrivateAsset: async () => ({ ...asset, fileUrl:refs.source }) }
  ]) await assert.rejects(openBuyerImage(request, {...services, ...change}));
  media.records.get(refs.original).isPrivate = false;
  await assert.rejects(openBuyerImage(request, services));
  assert.deepEqual(signed, [[refs.original, 1]]);
});

test('only independent private previews are signed; expired cache, missing and rejected assets are handled', async () => {
  const verified = await verifyCatalogueImageAsset(refs, fixture());
  const rows = [verified, { ...verified, _id: 'invalid', previewFileUrl: refs.source }];
  const signed = [], fields = [];
  const data = { query(collection) {
    assert.equal(collection, 'CatalogueImageAssets');
    return { hasSome(){return this;}, eq(){return this;}, fields(...keys){fields.push(...keys);return this;},
      limit(){return this;}, async find(){return {items: rows};} };
  } };
  let time = 1;
  const read = createCataloguePreviewReader({ data, now: () => time, media: {
    async getDownloadUrl(file, minutes){signed.push([file,minutes]);return 'https://qa.invalid/temporary-preview';}
  }});
  const products = [{id:refs.productId}, {id:'invalid'}, {id:'missing'}];
  const result = await read(products);
  assert.equal(result[0].image, 'https://qa.invalid/temporary-preview');
  assert.ok(!JSON.stringify(result).includes('wix:image'));
  assert.equal(result[1].image, '');
  assert.equal(result[2].image, '');
  await read(products);
  assert.deepEqual(signed, [[refs.preview,2]]);
  time += 61000;
  await read(products);
  assert.equal(signed.length, 2);
  assert.ok(!fields.includes('fileUrl'));
  const missingRegistry = createCataloguePreviewReader({ data: { query() { throw Error('offline'); } } });
  assert.deepEqual(await missingRegistry([{id:'qa', image:refs.source}]), [{id:'qa',image:''}]);
});

test('only the requested detail receives a verified private original in the image batch', async () => {
  const verified = await verifyCatalogueImageAsset(refs, fixture());
  const rows = [verified, { ...verified, _id: 'source', fileUrl: refs.source }];
  const signed = [];
  const read = createCataloguePreviewReader({ data: { query() { return {
    hasSome() { return this; }, eq() { return this; }, fields() { return this; },
    limit() { return this; }, async find() { return { items: rows }; }
  }; } }, media: { async getDownloadUrl(file) { signed.push(file); return 'https://qa.invalid/' + (file === refs.original ? 'hd' : 'small'); } } });
  const result = await read([{ id: refs.productId }, { id: 'source' }], { detailId: refs.productId });
  assert.equal(result[0].detailImage, 'https://qa.invalid/hd');
  assert.equal(result[0].image, 'https://qa.invalid/small');
  assert.equal(result[1].detailImage, undefined);
  assert.deepEqual(signed, [refs.original, refs.preview]);
  assert.deepEqual(await read([{ id: 'source' }], { detailId: 'source', detailOnly: true }), [{ id: 'source', image: '' }]);
  assert.deepEqual(await read([{ id: refs.productId }], { detailId: refs.productId, detailOnly: true }),
    [{ id: refs.productId, image: '', detailImage: 'https://qa.invalid/hd' }]);
});
