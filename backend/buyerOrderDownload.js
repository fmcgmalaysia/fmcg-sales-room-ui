import wixData from 'wix-data';
import { buildBuyerOrderExcel } from 'backend/buyerSelectionExcel.js';

const BUYER_ORDER_COLLECTION = 'WixBuyerOrders';
const BUYER_LINE_COLLECTION = 'WixBuyerOrderLines';

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
function submittedLabel(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return normalize(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Kuala_Lumpur'
  }).format(date).replace(',', '');
}

export async function buildBuyerOrderDownload(customerId, orderId, buyerRoomUrl) {
  const customer = normalize(customerId);
  const id = normalize(orderId);
  const orders = await wixData.query(BUYER_ORDER_COLLECTION).eq('orderId', id).eq('customerId', customer).limit(2).find({ suppressAuth: true, consistentRead: true });
  if (orders.items.length !== 1) throw new Error('Order was not found.');
  const order = payloadData(orders.items[0]);
  if (!order.isComplete || upper(order.status) !== 'CONFIRMED') throw new Error('Order is not ready for download.');
  let lineResult = await wixData.query(BUYER_LINE_COLLECTION).eq('customerId', customer).eq('orderId', id).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const records = [...lineResult.items];
  while (lineResult.hasNext()) { lineResult = await lineResult.next(); records.push(...lineResult.items); }
  const lines = records.map(payloadData)
    .filter(line => normalize(line.customerId) === customer && normalize(line.orderId) === id)
    .sort((left, right) => normalize(left.lineId).localeCompare(normalize(right.lineId)));
  if (!lines.length || lines.length !== Number(order.lineCount || 0)) throw new Error('Order lines are incomplete.');
  const currency = upper(order.currency || lines[0]?.currency || 'USD');
  const rows = lines.map(line => ({
    barcode: normalize(line.barcode),
    itemName: normalize(line.itemName),
    packingSize: normalize(line.packingSize),
    eaPerCtn: numberOrBlank(line.eaPerCtn),
    unitPrice: numberOrBlank(line.lockedUnitPriceEa),
    quantityCtn: numberOrBlank(line.quantityCtn),
    cbmPerCtn: numberOrBlank(line.cbmPerCtn)
  }));
  const bytes = buildBuyerOrderExcel({
    buyerRoomUrl,
    orderId: id,
    companyName: normalize(order.companyName),
    submittedAt: submittedLabel(order.confirmedAt),
    currency,
    rows
  });
  const safeId = id.replace(/[^A-Za-z0-9_-]+/g, '-');
  return { fileName: `FMCG-Malaysia-Order-${safeId}.xlsx`, bytes: Buffer.from(bytes), rowCount: rows.length };
}
