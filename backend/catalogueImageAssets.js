// Only independent, low-resolution private files may be delivered as catalogue previews.
// Asset verification is an internal migration step. It never deletes a source file.
const mediaId = uri => typeof uri === 'string' && /^wix:image:\/\/v1\/([a-zA-Z0-9_.~-]+)\//.exec(uri)?.[1];
const withinPreviewBounds = info => Number.isSafeInteger(info?.width) && Number.isSafeInteger(info?.height)
  && Math.min(info.width, info.height) > 0 && Math.max(info.width, info.height) <= 320;
const readyImage = (info, id) => info?.opStatus === 'READY' && info.mediaType === 'image' && mediaId(info.fileUrl) === id;
// The legacy FileInfo returned by this Wix site omits opStatus, even on ready files.
// Read processing status from the matching v2 descriptor before accepting an image.
export function createVerifiedCatalogueMedia(manager, describeFile) {
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
export async function verifyCatalogueImageAsset({ productId, source, original, preview }, media) {
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

export function createCataloguePreviewReader({ data, media, now = Date.now }) {
  const cache = new Map();
  async function sign(uri) {
    const hit = cache.get(uri);
    if (hit && hit.until > now()) return hit.url;
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    const entry = { until: now() + 60000 };
    entry.url = media.getDownloadUrl(uri, 2, null, null)
      .then(url => typeof url === 'string' && url.startsWith('https://') ? url : '')
      .catch(() => '')
      .then(url => {
        if (!url && cache.get(uri) === entry) cache.delete(uri);
        return url;
      });
    cache.set(uri, entry);
    return entry.url;
  }

  async function signPreview(row) {
    const id = mediaId(row.previewFileUrl);
    if (row.status !== 'VERIFIED' || !id || !row.sourceId || !row.originalId ||
        row.sourceId === row.originalId || id === row.sourceId || id === row.originalId ||
        !withinPreviewBounds({ width: row.previewWidth, height: row.previewHeight })) return '';
    return sign(row.previewFileUrl);
  }

  async function signDetail(row) {
    const id = mediaId(row.fileUrl);
    if (row.status !== 'VERIFIED' || !id || id !== row.originalId || !row.sourceId ||
        id === row.sourceId || id === mediaId(row.previewFileUrl) || !row.originalHash) return '';
    return sign(row.fileUrl);
  }

  return async (products, { detailId = '', detailOnly = false } = {}) => {
    if (!products.length) return products;
    if (products.length > 50) throw Error('Too many catalogue previews.');
    let rows;
    try {
      const result = await data.query('CatalogueImageAssets').hasSome('_id', products.map(p => p.id))
        .eq('status', 'VERIFIED').fields('_id', 'status', 'sourceId', 'originalId', 'previewFileUrl', 'previewWidth', 'previewHeight',
          ...(detailId ? ['fileUrl', 'originalHash'] : []))
        .limit(products.length).find({ suppressAuth: true, consistentRead: true });
      rows = result.items;
    } catch {
      console.warn('Catalogue preview lookup unavailable.');
      return products.map(p => ({ ...p, image: '' }));
    }
    const images = new Map();
    const detailRow = detailId && rows.find(row => row._id === detailId && products.some(product => product.id === detailId));
    const detailPending = detailRow ? signDetail(detailRow).catch(() => '') : '';
    for (let i = 0; !detailOnly && i < rows.length; i += 5) {
      await Promise.all(rows.slice(i, i + 5).map(async row => {
        try { images.set(row._id, await signPreview(row)); }
        catch { /* Keep other images available if one signature fails. */ }
      }));
    }
    const detailImage = await detailPending;
    return products.map(p => ({ ...p, image: images.get(p.id) || '',
      ...(detailImage && p.id === detailId ? { detailImage } : {}) }));
  };
}
