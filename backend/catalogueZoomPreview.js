import { createHash } from 'crypto';
import { cleanCatalogueJpeg, previewBytes } from './catalogueLegacyPreview.js';

const mediaId = uri => typeof uri === 'string' && /^wix:image:\/\/v1\/([a-zA-Z0-9_.~-]+)\//.exec(uri)?.[1];
const maxBytes = 180000;

export function signedCatalogueZoomUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return '';
    const signed = url.origin === 'https://download-files.wixmp.com' &&
      /^\/media\/[A-Za-z0-9_.~-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname) && url.searchParams.get('token');
    const wixDownload = url.origin === 'https://download-files.wix.com' &&
      url.pathname === '/_api/download/file' && url.searchParams.get('downloadToken');
    return signed || wixDownload ? url.href : '';
  } catch { return ''; }
}

function matchingPreview(row) {
  const preview = row?.zoomPreview;
  const id = mediaId(preview?.uri);
  if (row?.status !== 'VERIFIED' || !id || !row.originalHash || !row.originalId || !row.sourceId ||
      preview.status !== 'READY' || preview.originalHash !== row.originalHash || !preview.hash ||
      preview.hash === row.originalHash || [row.originalId, row.sourceId, mediaId(row.previewFileUrl)].includes(id)) return null;
  return preview;
}

function sourceMatches(row, image) {
  return Boolean(row?.sourceId) && (mediaId(image) === row.sourceId || image === 'https://static.wixstatic.com/media/' + row.sourceId);
}

export async function readCatalogueZoomPreview(row, media, source) {
  const preview = matchingPreview(row);
  if (!preview || !sourceMatches(row, source)) return '';
  const info = await media.getFileInfo(preview.uri);
  if (info.fileUrl !== preview.uri || info.hash !== preview.hash || info.isPrivate !== true || info.opStatus !== 'READY' ||
      info.mediaType !== 'image' || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) ||
      Math.min(info.width, info.height) < 1 || Math.max(info.width, info.height) > 512 ||
      !Number.isSafeInteger(info.sizeInBytes) || info.sizeInBytes < 1 || info.sizeInBytes > maxBytes) return '';
  return signedCatalogueZoomUrl(await media.getDownloadUrl(preview.uri, 1, null, null));
}

// The owner prepares a separate private image before the customer can request it.
// The CDN is used only on the server for existing, already verified legacy media.
export async function prepareCatalogueZoomPreview(row, { media, readSource, save, upload, download = previewBytes }) {
  if (row?.status !== 'VERIFIED' || !Number.isSafeInteger(row.version) || !row.originalHash ||
      mediaId(row.fileUrl) !== row.originalId || !/^[\w~-]+\.(?:jpe?g|png|webp)$/i.test(row.sourceId || '')) return { status: 'UNAVAILABLE' };
  const productImage = await readSource(row._id);
  const expectedSource = 'https://static.wixstatic.com/media/' + row.sourceId;
  if (!sourceMatches(row, productImage)) return { status: 'SOURCE_CHANGED' };
  if (matchingPreview(row)) return { status: 'READY' };
  if (row.zoomPreview?.status === 'COPYING') return { status: 'REVIEW' };
  const original = await media.getFileInfo(row.fileUrl);
  if (original.fileUrl !== row.fileUrl || original.isPrivate !== true || original.opStatus !== 'READY' || original.hash !== row.originalHash ||
      !Number.isSafeInteger(original.width) || !Number.isSafeInteger(original.height) ||
      Math.min(original.width, original.height) < 1) return { status: 'UNAVAILABLE' };
  const edge = Math.min(512, Math.max(original.width, original.height));
  if (row.zoomPreview?.status === 'STORED') {
    return finishPreview(row, row.zoomPreview.uri, edge, productImage, { media, save, readSource });
  }
  const imageUrl = expectedSource + '/v1/fit/w_' + edge + ',h_' + edge + '/file.jpg';
  const clean = cleanCatalogueJpeg(await download(imageUrl, maxBytes, 4000), edge, maxBytes);
  if (!clean) return { status: 'UNAVAILABLE' };
  const claim = { status: 'COPYING', originalHash: row.originalHash };
  if (!await save(row, claim)) return { status: 'BUSY' };
  const name = createHash('sha256').update(row._id + ':' + row.originalHash).digest('hex').slice(0, 32);
  const file = await upload(Buffer.from(clean.split(',')[1], 'base64'), name + '-zoom-512.jpg');
  if (!mediaId(file?.fileUrl)) return { status: 'REVIEW' };
  const stored = { status: 'STORED', uri: file.fileUrl, originalHash: row.originalHash };
  const claimed = { ...row, version: row.version + 1 };
  if (!await save(claimed, stored)) return { status: 'REVIEW' };
  return finishPreview({ ...row, version: row.version + 2, zoomPreview: stored }, stored.uri, edge, productImage, { media, save, readSource });
}

async function finishPreview(row, uri, edge, productImage, { media, save, readSource }) {
  if (!mediaId(uri) || row.zoomPreview?.originalHash !== row.originalHash) return { status: 'REVIEW' };
  let info;
  try { info = await media.getFileInfo(uri); } catch { return { status: 'PROCESSING' }; }
  if (info.opStatus === 'PENDING' || info.opStatus === 'PROCESSING') return { status: 'PROCESSING' };
  const preview = { status: 'READY', uri, hash: info.hash, originalHash: row.originalHash };
  if (!matchingPreview({ ...row, zoomPreview: preview }) || info.fileUrl !== preview.uri || info.isPrivate !== true || info.opStatus !== 'READY' ||
      info.mediaType !== 'image' || !Number.isSafeInteger(info.sizeInBytes) || info.sizeInBytes < 1 || info.sizeInBytes > maxBytes ||
      !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) ||
      Math.min(info.width, info.height) < 1 || Math.max(info.width, info.height) !== edge ||
      await readSource(row._id) !== productImage) return { status: 'REVIEW' };
  const saved = await save(row, preview);
  return saved ? { status: 'READY', width: info.width, height: info.height } : { status: 'REVIEW' };
}
