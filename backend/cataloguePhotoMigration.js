import https from 'https';
import { createHash } from 'crypto';

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
export async function migrateCataloguePhoto(product, { media, store, upload, verify, sourceNow, download = readBytes }) {
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
