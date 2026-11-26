import { Permissions, webMethod } from 'wix-web-module';
import { createHash } from 'crypto';
import wixData from 'wix-data';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { mediaManager } from 'wix-media-backend';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';
import { createVerifiedCatalogueMedia, verifyCatalogueImageAsset } from './catalogueImageAssets.js';
import { fileId, migrateCataloguePhoto, readBytes, sourceReference } from './cataloguePhotoMigration.js';

const registry = 'CatalogueImageAssets';
const products = 'FMCGMALAYSIA';
const options = { suppressAuth:true, consistentRead:true };
const patch = auth.elevate(items.patch);
const media = createVerifiedCatalogueMedia(mediaManager, elevate(files.getFileDescriptor));
const store = {
  async get(id) {
    const result = await wixData.query(registry).eq('_id',id).limit(1).find(options);
    return result.items[0];
  },
  async create(id, sourceId) {
    try {
      return await wixData.insert(registry, { _id:id, title:id, sourceId, version:1, status:'NEW' }, options);
    } catch (error) {
      const existing = await store.get(id);
      if (existing) return existing;
      throw error;
    }
  },
  async move(row, status, fields) {
    if (!Number.isSafeInteger(row.version) || row.version < 1) throw Error('Invalid migration state.');
    const update = { ...fields, status, version:row.version+1 };
    const actions = Object.entries(update).map(([fieldPath,value]) => ({ fieldPath, value, action:'SET_FIELD' }));
    try {
      const saved = await patch(registry,row._id,actions,{condition:{version:{$eq:row.version}}});
      return saved?.version === update.version && saved.status === status ? saved : null;
    } catch (error) {
      const existing = await store.get(row._id);
      if (existing && existing.version !== row.version) return null;
      throw error;
    }
  }
};
// Counts let the owner distinguish missing artwork from outstanding privacy checks.
export const cataloguePictureProgress = webMethod(Permissions.Admin, async () => {
  const [catalogueCount, withImage, activeWithImage, started, verified] = await Promise.all([
    wixData.query(products).count(options),
    wixData.query(products).isNotEmpty('image').count(options),
    wixData.query(products).eq('pointBaseStatus','ACTIVE').isNotEmpty('image').count(options),
    wixData.query(registry).ne('_id','catalogue-picture-migration-v1').count(options),
    wixData.query(registry).eq('status','VERIFIED').count(options)
  ]);
  return { catalogueCount, withImage, activeWithImage, started, verified };
});
const operations = {
  store, media, verify:verifyCatalogueImageAsset,
  sourceNow: async id => (await wixData.get(products,id,options)).image,
  upload: (bytes,name,mimeType) => mediaManager.upload('/Protected catalogue',bytes,name,{
    mediaOptions:{mediaType:'image',mimeType}, metadataOptions:{isPrivate:true,isVisitorUpload:false}
  })
};
// A site administrator can process only catalogue-owned images. The client supplies no source
// URLs and obtains only counts and an opaque continuation product ID. No originals are removed.
async function runCataloguePictureBatch(after, count) {
  after = after ?? '';
  count = count ?? 1;
  if (typeof after !== 'string' || after.length > 128 || !Number.isSafeInteger(count) || count < 1 || count > 12) throw Error('Invalid batch.');
  let query = wixData.query(products).isNotEmpty('image');
  if (after) query=query.gt('_id',after);
  const result=await query.ascending('_id').fields('_id','image').limit(count).find(options);
  const totals={};
  const review=[];
  for (let start=0;start<result.items.length;start+=4) {
    await Promise.all(result.items.slice(start,start+4).map(async product => {
      let outcome;
      try { outcome=await migrateCataloguePhoto(product,operations); }
      catch { outcome={status:'REVIEW'}; }
      totals[outcome.status]=(totals[outcome.status]||0)+1;
      if(outcome.status!=='VERIFIED') review.push({id:product._id,status:outcome.status,stage:outcome.stage||''});
    }));
  }
  return { examined:result.items.length,totals,review,next:result.items.at(-1)?._id||'',more:result.hasNext() };
}
export const prepareCataloguePictures = webMethod(Permissions.Admin, (after, count) => runCataloguePictureBatch(after, count));

// The cutover uses a dedicated durable cursor. An interrupted worker releases its
// lease after 45 seconds. Each photo's upload claim still prevents duplicate copies.
const checkpoint = 'catalogue-picture-migration-v1';
async function continueCataloguePictureBatch() {
  let state = await store.get(checkpoint);
  if (!state) state = await store.create(checkpoint, checkpoint);
  if (state.sourceId !== checkpoint || !['NEW','MIGRATING','FINISHED'].includes(state.status))
    throw Error('Cannot resume catalogue migration.');
  const totals = state.progress || {};
  if (state.status === 'FINISHED') return { status:'FINISHED', totals };
  if ((state.leaseEnds || 0) > Date.now()) return { status:'BUSY', totals };
  const active = await store.move(state,'MIGRATING',{leaseEnds:Date.now()+45000});
  if (!active) return { status:'BUSY', totals };
  const result = await runCataloguePictureBatch(active.afterId || '',4);
  const progress = {...totals};
  for (const [key,count] of Object.entries(result.totals)) progress[key] = (progress[key] || 0)+count;
  const status = result.more ? 'MIGRATING' : 'FINISHED';
  const stored = await store.move(active,status,{afterId:result.next||active.afterId||'',progress,leaseEnds:0});
  if (!stored) return { status:'BUSY', totals };
  return { status, totals:progress, examined:result.examined };
}
export const continueCataloguePictures = webMethod(Permissions.Admin, () => continueCataloguePictureBatch());

// Inspect incomplete steps before deciding whether a private upload needs recovery.
export const cataloguePictureReview = webMethod(Permissions.Admin, async () => {
  const { items, totalCount } = await wixData.query(registry).ne('_id', checkpoint)
    .ne('status', 'VERIFIED').ascending('_id')
    .fields('_id', 'status', 'fileUrl', 'previewFileUrl').limit(20).find(options);
  return { total: totalCount, items: items.map(row => ({
    productId: row._id, stage: row.status,
    originalRecorded: Boolean(row.fileUrl), previewRecorded: Boolean(row.previewFileUrl)
  })) };
});

// Retry only the existing pre-upload exceptions, after validating the source independently.
function recoveryJpegDimensions(bytes) {
  if (bytes.length < 16 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return null;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8) return null;
      const height = bytes.readUInt16BE(offset + 5), width = bytes.readUInt16BE(offset + 7);
      return width && height ? { width, height } : null;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    offset += length + 2;
  }
  return null;
}

const catalogueJpegReviewIds = [
  'pb_4800214061219', 'pb_8935001709015', 'pb_8990800010083',
  'pb_8990800010090', 'pb_8990800010113', 'pb_f8d3fe7e39b12f82ee7cef0e8eba7ffbcf70aa96535e01becd00758eb28de0c5'
];

export const retryCatalogueReviewJpeg = webMethod(Permissions.Admin, async (id) => {
  if (!catalogueJpegReviewIds.includes(id) || (await store.get(checkpoint))?.status !== 'FINISHED') return { status:'OUT_OF_SCOPE' };
  const row = await store.get(id);
  if (row?.status !== 'NEW' || row.fileUrl || row.previewFileUrl) return { status:row?.status || 'MISSING' };
  let phase = 'SOURCE';
  try {
    const product = await wixData.get(products,id,options);
    const source = sourceReference(product.image), fid = fileId(source);
    if (!fid || row.sourceId !== fid) return { status:'SOURCE_CHANGED' };
    phase = 'DESCRIPTOR';
    const descriptor = await elevate(files.getFileDescriptor)(fid);
    const sizeInBytes = Number(descriptor.sizeInBytes);
    if (descriptor._id !== fid || descriptor.private !== false || descriptor.operationStatus !== 'READY' ||
        descriptor.mediaType !== 'IMAGE' || descriptor.mimeType !== 'image/jpeg' ||
        !/^[a-f0-9]{32}$/i.test(descriptor.hash || '') || !Number.isSafeInteger(sizeInBytes) ||
        sizeInBytes < 16 || sizeInBytes > 24 * 1024 * 1024) return { status:'DESCRIPTOR_REVIEW' };
    phase = 'SOURCE_BYTES';
    const url = 'https://static.wixstatic.com/media/' + fid;
    const bytes = await readBytes(url, sizeInBytes);
    const dimensions = recoveryJpegDimensions(bytes);
    if (!dimensions || bytes.length !== sizeInBytes || createHash('md5').update(bytes).digest('hex') !== descriptor.hash.toLowerCase()) {
      return { status:'SOURCE_CHECKSUM_REVIEW' };
    }
    phase = 'PRIVATE_COPY';
    const metadata = { ...dimensions, fileUrl:source, sizeInBytes, hash:descriptor.hash.toLowerCase(),
      isPrivate:false, opStatus:'READY', mediaType:'image', mimeType:'image/jpeg' };
    return await migrateCataloguePhoto(product, { ...operations,
      media:{ ...media, getFileInfo: ref => fileId(ref) === fid ? Promise.resolve(metadata) : media.getFileInfo(ref) },
      download:(address,limit) => address === url ? Promise.resolve(bytes) : readBytes(address,limit)
    });
  } catch (_) {
    const current = await store.get(id);
    return { status:'REVIEW', phase, recordedStage:current?.status || '' };
  }
});

// Site-owned scheduler entry point. The browser still uses the Admin web method,
// and this temporary job expires at 7:00 a.m. Malaysia time.
export async function processCatalogueMigrationWindow() {
  const expires = Date.parse('2026-11-26T23:00:00Z');
  const end = Math.min(Date.now() + 250000, expires);
  let last;
  let batches = 0;
  while (batches < 64 && Date.now() + 12000 < end) {
    last = await continueCataloguePictureBatch();
    if (last.status !== 'MIGRATING') break;
    batches++;
  }
  if (last) console.info('Catalogue picture migration window', {
    status: last.status, batches, verified: last.totals.VERIFIED || 0
  });
}

export async function processCatalogueMigrationWindow16() { await processCatalogueMigrationWindow(); }
export async function processCatalogueMigrationWindow27() { await processCatalogueMigrationWindow(); }
export async function processCatalogueMigrationWindow38() { await processCatalogueMigrationWindow(); }
export async function processCatalogueMigrationWindow49() { await processCatalogueMigrationWindow(); }
