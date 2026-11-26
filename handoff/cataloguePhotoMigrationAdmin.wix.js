import https from 'https';
import { createHash } from 'crypto';
import { Permissions, webMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { mediaManager } from 'wix-media-backend';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';
// Only independent, low-resolution private files may be delivered as catalogue previews.
// Asset verification is an internal migration step. It never deletes a source file.
const mediaId = uri => typeof uri === 'string' && /^wix:image:\/\/v1\/([a-zA-Z0-9_.~-]+)\//.exec(uri)?.[1];
const withinPreviewBounds = info => Number.isSafeInteger(info?.width) && Number.isSafeInteger(info?.height)
  && Math.min(info.width, info.height) > 0 && Math.max(info.width, info.height) <= 320;
const readyImage = (info, id) => info?.opStatus === 'READY' && info.mediaType === 'image' && mediaId(info.fileUrl) === id;
// The legacy FileInfo returned by this Wix site omits opStatus, even on ready files.
// Read processing status from the matching v2 descriptor before accepting an image.
function createVerifiedCatalogueMedia(manager, describeFile) {
  return {
    getDownloadUrl: (...args) => manager.getDownloadUrl(...args),
    async getFileInfo(uri) {
      const id = mediaId(uri);
      if (!id) throw Error('Invalid image reference.');
      const [info, descriptor] = await Promise.all([manager.getFileInfo(uri), describeFile(id)]);
      if (descriptor?._id !== id || descriptor.mediaType !== 'IMAGE' || descriptor.private !== info.isPrivate ||
          mediaId(info.fileUrl) !== id) throw Error('Inconsistent image metadata.');
      return { ...info, opStatus: descriptor.operationStatus };
    }
  };
}
async function verifyCatalogueImageAsset({ productId, source, original, preview }, media) {
  const ids = [source, original, preview].map(mediaId);
  if (typeof productId !== 'string' || !productId || ids.some(id => !id) || new Set(ids).size !== 3) throw Error('Three independent image files are required.');
  const [base, hd, small] = await Promise.all([source, original, preview].map(uri => media.getFileInfo(uri)));
  if (!readyImage(base, ids[0]) || !readyImage(hd, ids[1]) || hd.isPrivate !== true ||
      !base.hash || base.hash !== hd.hash || !base.sizeInBytes || base.sizeInBytes !== hd.sizeInBytes ||
      !(base.width > 0 && base.height > 0) || base.width !== hd.width || base.height !== hd.height) {
    throw Error('Private original could not be verified.');
  }
  if (!readyImage(small, ids[2]) || small.isPrivate !== true || !withinPreviewBounds(small) ||
      !small.hash || small.hash === hd.hash || !Number.isSafeInteger(small.sizeInBytes) ||
      small.sizeInBytes < 1 || small.sizeInBytes > 100000) throw Error('Private preview could not be verified.');
  return { _id: productId, status: 'VERIFIED', fileUrl: hd.fileUrl, previewFileUrl: small.fileUrl,
    sourceId: ids[0], originalId: ids[1], previewWidth: small.width, previewHeight: small.height,
    originalHash: hd.hash, previewHash: small.hash };
}



const mimeExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const fileId = uri => typeof uri === 'string' && /^wix:image:\/\/v1\/([A-Za-z0-9_~-]+\.(?:jpe?g|png|webp))\//i.exec(uri)?.[1];
function sourceReference(value) {
  if (fileId(value)) return value;
  const id = typeof value === 'string' && /^https:\/\/static\.wixstatic\.com\/media\/([A-Za-z0-9_~-]+\.(?:jpe?g|png|webp))$/i.exec(value)?.[1];
  return id ? 'wix:image://v1/' + id + '/original' : '';
}

// The input to this transport is constructed solely from an authenticated Wix media descriptor.
// The server never follows redirects, nor returns this legacy source URL to a buyer.
function readBytes(url, limit) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200 || !String(res.headers['content-type'] || '').startsWith('image/')) {
        res.resume();
        reject(Error('Image source unavailable.'));
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('error', reject);
      res.on('aborted', () => reject(Error('Image transfer interrupted.')));
      res.on('data', chunk => {
        size += chunk.length;
        if (size > limit) res.destroy(Error('Image exceeds size limit.'));
        else chunks.push(chunk);
      });
      res.on('end', () => size ? resolve(Buffer.concat(chunks, size)) : reject(Error('Empty image.')));
    });
    req.setTimeout(8000, () => req.destroy(Error('Image transfer timed out.')));
    req.on('error', reject);
  });
}

// Each irreversible upload has a durable, separately claimed step. An ambiguous upload is held
// for reconciliation by its deterministic filename. No automatic retry can create a duplicate.
async function migrateCataloguePhoto(product, { media, store, upload, verify, sourceNow, download = readBytes }) {
  const id = product?._id;
  if (!id || typeof id !== 'string') throw Error('Product identity required.');
  const source = sourceReference(product.image);
  if (!source) return { status: product.image ? 'UNSUPPORTED_SOURCE' : 'NO_IMAGE' };
  const sourceId = fileId(source);
  let row = await store.get(id);
  if (!row) row = await store.create(id, sourceId);
  if (row.sourceId !== sourceId) return { status: 'SOURCE_CHANGED' };
  if (row.status === 'VERIFIED') return { status: 'VERIFIED' };
  if (!['NEW','ORIGINAL_STORED','PREVIEW_STORED'].includes(row.status)) return { status: 'REVIEW', stage: row.status };
  const current = await media.getFileInfo(source);
  const ext = mimeExtensions[current.mimeType];
  if (!ext || current.isPrivate !== false || current.opStatus !== 'READY' || !current.hash ||
      current.mediaType !== 'image' || fileId(current.fileUrl) !== sourceId ||
      !Number.isSafeInteger(current.sizeInBytes) || current.sizeInBytes < 1 || current.sizeInBytes > 24 * 1024 * 1024 ||
      !Number.isSafeInteger(current.width) || !Number.isSafeInteger(current.height) ||
      Math.min(current.width,current.height) < 1) return { status: 'SOURCE_REVIEW' };
  const base = 'https://static.wixstatic.com/media/' + sourceId;
  const edge = Math.max(1, Math.min(256, Math.floor(Math.max(current.width, current.height) / 2)));
  const name = createHash('sha256').update(id + ':' + sourceId).digest('hex').slice(0,32);
  for (const step of [
    { from:'NEW', busy:'COPYING_ORIGINAL', done:'ORIGINAL_STORED', field:'fileUrl', url:base, limit:current.sizeInBytes, mime:current.mimeType, filename:name+'-hd.'+ext },
    { from:'ORIGINAL_STORED', busy:'COPYING_PREVIEW', done:'PREVIEW_STORED', field:'previewFileUrl', url:base+'/v1/fit/w_'+edge+',h_'+edge+'/file.jpg', limit:100000, mime:'image/jpeg', filename:name+'-preview.jpg' }
  ]) {
    if (row.status !== step.from) continue;
    const bytes = await download(step.url, step.limit);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > step.limit ||
        (step.field === 'fileUrl' && bytes.length !== current.sizeInBytes)) throw Error('Unexpected image size.');
    row = await store.move(row, step.busy, {});
    if (!row) return { status:'BUSY' };
    const copy = await upload(bytes, step.filename, step.mime);
    if (!fileId(copy?.fileUrl) || copy.isPrivate !== true) return { status:'REVIEW', stage:step.busy };
    row = await store.move(row, step.done, { [step.field]:copy.fileUrl });
    if (!row) return { status:'BUSY' };
  }
  const validated = await verify({ productId:id, source, original:row.fileUrl, preview:row.previewFileUrl }, media);
  if (fileId(sourceReference(await sourceNow(id))) !== sourceId) return { status:'SOURCE_CHANGED' };
  const { _id: verifiedId, status, ...fields } = validated;
  if (verifiedId !== id || status !== 'VERIFIED') throw Error('Asset verification failed.');
  return await store.move(row, status, fields) ? { status, previewWidth:fields.previewWidth, previewHeight:fields.previewHeight } : { status:'BUSY' };
}


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
  const result = await runCataloguePictureBatch(active.afterId || '',4);
  const progress = {...totals};
  for (const [key,count] of Object.entries(result.totals)) progress[key] = (progress[key] || 0)+count;
  const status = result.more ? 'MIGRATING' : 'FINISHED';
  const stored = await store.move(active,status,{afterId:result.next||active.afterId||'',progress,leaseEnds:0});
  if (!stored) return { status:'BUSY', totals };
  return { status, totals:progress, examined:result.examined };
});
