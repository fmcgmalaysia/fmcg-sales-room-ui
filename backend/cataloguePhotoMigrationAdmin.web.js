import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { mediaManager } from 'wix-media-backend';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';
import { createVerifiedCatalogueMedia, verifyCatalogueImageAsset } from './catalogueImageAssets.js';
import { migrateCataloguePhoto } from './cataloguePhotoMigration.js';

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
export const continueCataloguePictures = webMethod(Permissions.Admin, async () => {
  let state = await store.get(checkpoint);
  if (!state) state = await store.create(checkpoint, checkpoint);
  if (state.sourceId !== checkpoint || !['NEW','MIGRATING','FINISHED'].includes(state.status))
    throw Error('Cannot resume catalogue migration.');
  const totals = state.progress || {};
  if (state.status === 'FINISHED') return { status:'FINISHED', totals };
  if ((state.leaseEnds || 0) > Date.now()) return { status:'BUSY', totals };
  const active = await store.move(state,'MIGRATING',{leaseEnds:Date.now()+45000});
  if (!active) return { status:'BUSY', totals };
  const result = await runCataloguePictureBatch(active.afterId || '',8);
  const progress = {...totals};
  for (const [key,count] of Object.entries(result.totals)) progress[key] = (progress[key] || 0)+count;
  const status = result.more ? 'MIGRATING' : 'FINISHED';
  const stored = await store.move(active,status,{afterId:result.next||active.afterId||'',progress,leaseEnds:0});
  if (!stored) return { status:'BUSY', totals };
  return { status, totals:progress, examined:result.examined };
});
