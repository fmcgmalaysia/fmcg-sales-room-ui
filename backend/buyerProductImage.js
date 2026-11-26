const buyerRoom = 'https://www.fmcgmalaysia.com/buyer-room';
const validCompany = value => typeof value === 'string' && /^CUS-[a-z\d-]{1,80}$/i.test(value);
const validItem = value => typeof value === 'string' && /^[a-z\d_-]{1,128}$/i.test(value);

// Persistent workbook links identify a selection. They never grant file access.
export function buyerImageLink(companyId, selectionId) {
  if (!validCompany(companyId) || !validItem(selectionId)) return '';
  const url = new URL(buyerRoom);
  url.searchParams.set('company', companyId);
  url.searchParams.set('imageSelection', selectionId);
  return url.toString();
}

export async function openBuyerImage({ companyId, selectionId }, services) {
  const unavailable = () => new Error('This product image is unavailable for this account.');
  if (!validCompany(companyId) || !validItem(selectionId)) throw unavailable();
  const buyer = await services.authorize(companyId);
  if (!buyer || buyer.customerId !== companyId) throw unavailable();
  const selection = await services.getSelection(selectionId);
  if (!selection || selection._id !== selectionId || selection.customerId !== companyId || selection.removed) throw unavailable();
  const payload = typeof selection.payload === 'string' ? JSON.parse(selection.payload) : selection.payload;
  if (!payload || payload.customerId !== companyId || payload.removed || !validItem(payload.productId)) throw unavailable();
  if (await services.reserveDownload(buyer, payload.productId) !== true) throw unavailable();
  const asset = await services.getPrivateAsset(payload.productId);
  const originalId = /^wix:image:\/\/v1\/([a-zA-Z0-9_.~-]+)\//.exec(asset?.fileUrl)?.[1];
  if (!asset || asset._id !== payload.productId || asset.status !== 'VERIFIED' || !originalId ||
      originalId !== asset.originalId || !asset.sourceId || asset.sourceId === originalId || !asset.originalHash) throw unavailable();
  const info = await services.media.getFileInfo(asset.fileUrl);
  if (info?.isPrivate !== true || info.fileUrl !== asset.fileUrl || info.hash !== asset.originalHash || info.opStatus !== 'READY') throw unavailable();
  const url = await services.media.getDownloadUrl(info.fileUrl, 1, null, null);
  if (!url || new URL(url).protocol !== 'https:') throw unavailable();
  return { url };
}
