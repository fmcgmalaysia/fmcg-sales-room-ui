import wixData from 'wix-data';
import { mediaManager } from 'wix-media-backend';
import { createHash } from 'crypto';
import { buildBuyerSelectionExcel } from 'backend/buyerSelectionExcel.js';

const CUSTOMER_COLLECTION = 'WixCustomers';
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const BUYER_LIST_COLLECTION = 'WixBuyerListItems';

function normalize(value) { return String(value ?? '').trim(); }
function upper(value) { return normalize(value).toUpperCase(); }
function numberOrBlank(value) {
  if (value === null || value === undefined || normalize(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function payloadData(record) {
  if (record?.payload && typeof record.payload === 'object') return record.payload;
  try { return JSON.parse(String(record?.payload || '{}')); } catch (_) { return {}; }
}
function imageUrl(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'object') {
    for (const candidate of [value.url, value.id, value.src, value.fileName, value.image, value.imageInfo?.url, value.imageInfo?.id, value.media?.url, value.media?.id]) {
      const resolved = imageUrl(candidate, depth + 1);
      if (resolved) return resolved;
    }
    return '';
  }
  const raw = normalize(value);
  if (!raw) return '';
  if (raw.startsWith('{')) {
    try { return imageUrl(JSON.parse(raw), depth + 1); } catch (_) { /* Continue with string parsing. */ }
  }
  const wixImage = /^(?:wix:)?image:\/\/v1\/([^/#?]+)/i.exec(raw);
  if (wixImage) return `https://static.wixstatic.com/media/${encodeURIComponent(decodeURIComponent(wixImage[1]))}`;
  const wixCdn = /^https?:\/\/static\.wixstatic\.com\/media\/([^/#?]+)/i.exec(raw);
  if (wixCdn) return `https://static.wixstatic.com/media/${encodeURIComponent(decodeURIComponent(wixCdn[1]))}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[A-Za-z0-9_.~-]+\.(?:avif|bmp|gif|heic|jpeg|jpg|png|svg|tif|tiff|webp)$/i.test(raw)) return `https://static.wixstatic.com/media/${encodeURIComponent(raw)}`;
  return '';
}

async function allSelectionRecords(customerId) {
  let result = await wixData.query(BUYER_LIST_COLLECTION).eq('customerId', customerId).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const records = [...result.items];
  while (result.hasNext()) { result = await result.next(); records.push(...result.items); }
  return records.map(record => ({ record, data: payloadData(record) }))
    .filter(({ record, data }) => normalize(data.customerId) === customerId && !Boolean(record.removed || data.removed));
}

async function productsByIds(ids) {
  const products = [];
  for (let index = 0; index < ids.length; index += 100) {
    const result = await wixData.query(PRODUCT_COLLECTION).hasSome('_id', ids.slice(index, index + 100)).limit(100).find({ suppressAuth: true, consistentRead: true });
    products.push(...result.items);
  }
  return products;
}

async function productByBarcode(barcode) {
  try {
    const text = await wixData.query(PRODUCT_COLLECTION).eq('barcode', barcode).limit(1).find({ suppressAuth: true, consistentRead: true });
    if (text.items[0]) return text.items[0];
  } catch (_) { /* Retry a numeric barcode. */ }
  const numericBarcode = Number(barcode);
  if (!Number.isFinite(numericBarcode)) return null;
  try {
    const numeric = await wixData.query(PRODUCT_COLLECTION).eq('barcode', numericBarcode).limit(1).find({ suppressAuth: true, consistentRead: true });
    return numeric.items[0] || null;
  } catch (_) { return null; }
}

export async function buildBuyerSelectionDownload(customerId, buyerRoomUrl) {
  const id = normalize(customerId);
  const customers = await wixData.query(CUSTOMER_COLLECTION).eq('customerId', id).limit(2).find({ suppressAuth: true, consistentRead: true });
  if (customers.items.length !== 1) throw new Error('Customer account was not found.');
  const customer = customers.items[0];
  const lifecycle = upper(customer.lifecycleStatus || customer.customerStatus);
  const access = upper(customer.catalogueAccessStatus || customer.accessStatus || customer.customerStatus);
  if (lifecycle === 'ARCHIVED' || ['SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(access)) throw new Error('This customer account is suspended.');
  const currency = upper(customer.preferredCurrency || customer.tradingCurrency || 'USD');
  const selections = await allSelectionRecords(id);
  if (!selections.length) throw new Error('There are no products to export.');

  const productIds = [...new Set(selections.map(({ data }) => normalize(data.productId)).filter(Boolean))];
  const products = await productsByIds(productIds);
  const byId = new Map(products.map(product => [normalize(product._id), product]));
  const byBarcode = new Map(products.map(product => [normalize(product.barcode), product]).filter(([barcode]) => barcode));
  const missingBarcodes = [...new Set(selections.map(({ data }) => normalize(data.barcode || data.unitBarcode)).filter(barcode => barcode && !byBarcode.has(barcode)))];
  for (let index = 0; index < missingBarcodes.length; index += 20) {
    const matches = await Promise.all(missingBarcodes.slice(index, index + 20).map(productByBarcode));
    matches.filter(Boolean).forEach(product => {
      byId.set(normalize(product._id), product);
      byBarcode.set(normalize(product.barcode), product);
    });
  }

  const rows = selections.map(({ data }) => {
    const storedBarcode = normalize(data.barcode || data.unitBarcode);
    const product = byId.get(normalize(data.productId)) || byBarcode.get(storedBarcode) || {};
    const quoteActive = upper(data.quoteStatus || 'RFQ') === 'VIEW QUOTE';
    const quoteCurrency = upper(data.vipCurrency || data.currency || currency);
    const unitPrice = quoteActive && quoteCurrency === currency
      ? numberOrBlank(data.vipPriceEa ?? data.quotePerPc)
      : null;
    const catalogueEa = numberOrBlank(product.ea ?? product.price);
    const cbm = numberOrBlank(product.m3Ctn ?? product.cbmPerCtn ?? product.cbm ?? data.cbmPerCtn);
    return {
      imageUrl: imageUrl(product.image || product.productImage || product.mainImage || product.wixImageUrl || data.imageUrl || data.image),
      unitBarcode: normalize(product.barcode || storedBarcode),
      itemName: normalize(product.name || product.title || data.itemName),
      packingSize: normalize(product.description || data.packingSize),
      ea: catalogueEa && catalogueEa > 0 ? catalogueEa : null,
      unitPrice: unitPrice && unitPrice > 0 ? unitPrice : null,
      cbmPerCtn: cbm
    };
  });
  const bytes = buildBuyerSelectionExcel({ buyerRoomUrl, currency, rows });
  const fileName = `fmcgmalaysia.com-My-Selection-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const versionKey = createHash('sha256').update(JSON.stringify({ id, buyerRoomUrl, currency, rows, quoteVersions: selections.map(({ data }) => data.quoteEffectiveAt || data.quoteSyncedAt || '') })).digest('hex');
  return { fileName, bytes: Buffer.from(bytes), rowCount: rows.length, versionKey };
}

async function selectionExportFolder(safeCustomerId) {
  const roots = await mediaManager.listFolders(null, null, null);
  const root = roots.find(folder => folder.folderName === 'buyer-selection-exports');
  if (!root) return '';
  const customers = await mediaManager.listFolders({ parentFolderId: root.folderId }, null, null);
  return customers.find(folder => folder.folderName === safeCustomerId)?.folderId || '';
}

export async function createBuyerSelectionMediaDownload(customerId, buyerRoomUrl) {
  const id = normalize(customerId);
  const file = await buildBuyerSelectionDownload(id, buyerRoomUrl);
  const safeCustomerId = id.replace(/[^A-Za-z0-9_-]/g, '_') || 'buyer';
  const storedName = 'fmcgmalaysia.com-My-Selection-' + file.versionKey + '.xlsx';
  const folderId = await selectionExportFolder(safeCustomerId);
  const existingFiles = folderId ? await mediaManager.listFiles({ parentFolderId: folderId }, null, null) : [];
  let uploaded = existingFiles.find(candidate => candidate.originalFileName === storedName && candidate.isPrivate === true);
  const reused = Boolean(uploaded);
  if (!uploaded) uploaded = await mediaManager.upload(
    `/buyer-selection-exports/${safeCustomerId}`,
    file.bytes,
    storedName,
    {
      mediaOptions: {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        mediaType: 'document'
      },
      metadataOptions: {
        isPrivate: true,
        isVisitorUpload: false,
        context: { purpose: 'buyer-selection-export', customerId: id }
      }
    }
  );
  if (!uploaded?.fileUrl) throw new Error('Excel file could not be prepared for download.');
  const info = await mediaManager.getFileInfo(uploaded.fileUrl);
  if (info.isPrivate !== true) throw new Error('Excel export must remain private.');
  const downloadUrl = await mediaManager.getDownloadUrl(info.fileUrl, 10, file.fileName, null);
  if (!downloadUrl) throw new Error('Excel download URL is unavailable.');

  // Keep only the current export in this customer's dedicated folder.
  try {
    const files = uploaded.parentFolderId
      ? await mediaManager.listFiles({ parentFolderId: uploaded.parentFolderId })
      : [];
    const stale = files
      .filter(candidate => candidate?.fileUrl && candidate.fileUrl !== uploaded.fileUrl && String(candidate.originalFileName || '').startsWith('fmcgmalaysia.com-My-Selection-'))
      .map(candidate => candidate.fileUrl);
    if (stale.length) await mediaManager.moveFilesToTrash(stale);
  } catch (error) {
    console.warn('Old Buyer Room exports could not be cleaned up', error);
  }
  return {
    ok: true,
    url: downloadUrl,
    expiresAt: Date.now() + (10 * 60 * 1000),
    fileName: file.fileName,
    rowCount: file.rowCount,
    reused,
    versionKey: file.versionKey
  };
}
