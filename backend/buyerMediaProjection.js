const sourceUrl = /^(?:wix:)?image:\/\/v1\/|^https?:\/\/static\.wixstatic\.com\/media\/[^/?#]+\.(?:jpe?g|png|webp|avif|gif|svg|bmp|heic|tiff?)(?:[/?#]|$)/i;
const imageKeys = new Set(['image','imageurl','imageinfo','productimage','mainimage','wiximageurl','originalimage','originalimageurl','thumbnail','thumbnailurl','photo','photourl']);

// Strip legacy image data from selection and order responses only. Finance amounts,
// dates, audit history and authenticated business-document descriptors stay intact.
export function withoutBuyerOriginalImages(value) {
  if (Array.isArray(value)) return value.map(withoutBuyerOriginalImages);
  if (typeof value === 'string') return sourceUrl.test(value.trim()) ? '' : value;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!imageKeys.has(key.toLowerCase()))
    .map(([key,field])=>[key,withoutBuyerOriginalImages(field)]));
}

// Authorization occurs in the existing Buyer Room access resolver. Each selection
// record and its stored payload must both belong to the same authorized company.
export function buyerPreviewProducts(items, customerId, decodePayload) {
  return items.flatMap(row=>{
    if (row.customerId !== customerId) return [];
    const data=decodePayload(row);
    const productId=data?.productId;
    if (data?.customerId !== customerId || typeof productId !== 'string' || !productId) return [];
    return [{selectionId:row._id, id:productId}];
  });
}
