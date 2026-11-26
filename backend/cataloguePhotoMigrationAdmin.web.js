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
const operations = {
  store, media, verify:verifyCatalogueImageAsset,
  sourceNow: async id => (await wixData.get(products,id,options)).image,
  upload: (bytes,name,mimeType) => mediaManager.upload('/Protected catalogue',bytes,name,{
    mediaOptions:{mediaType:'image',mimeType}, metadataOptions:{isPrivate:true,isVisitorUpload:false}
  })
};
// A site administrator can process only catalogue-owned images. The client supplies no source
// URLs and obtains only counts and an opaque continuation product ID. No originals are removed.
export const prepareCataloguePictures = webMethod(Permissions.Admin, async (after, count) => {
  after = after ?? '';
  count = count ?? 1;
  if (typeof after !== 'string' || after.length > 128 || !Number.isSafeInteger(count) || count < 1 || count > 6) throw Error('Invalid batch.');
  let query = wixData.query(products).isNotEmpty('image');
  if (after) query=query.gt('_id',after);
  const result=await query.ascending('_id').fields('_id','image').limit(count).find(options);
  const totals={};
  const review=[];
  for (let start=0;start<result.items.length;start+=2) {
    await Promise.all(result.items.slice(start,start+2).map(async product => {
      let outcome;
      try { outcome=await migrateCataloguePhoto(product,operations); }
      catch { outcome={status:'REVIEW'}; }
      totals[outcome.status]=(totals[outcome.status]||0)+1;
      if(outcome.status!=='VERIFIED') review.push({id:product._id,status:outcome.status,stage:outcome.stage||''});
    }));
  }
  return { examined:result.items.length,totals,review,next:result.items.at(-1)?._id||'',more:result.hasNext() };
});
