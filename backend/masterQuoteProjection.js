import { createHash } from 'crypto';
import { isWebQuotationReady } from 'backend/webQuotationCustomer.js';

const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fields = ['customerId', 'selectionId', 'barcode', 'requestId', 'version', 'enabled', 'currency', 'priceEa', 'priceCtn'];
const validMoney = value => Number.isFinite(value) && value > 0;

function priceInstruction(command) {
  const keys = Object.hasOwn(command || {}, 'selectionEpoch') ? [...fields, 'selectionEpoch'] : fields;
  if (!command || Object.keys(command).length !== keys.length || keys.some(key => !Object.hasOwn(command, key)) ||
      typeof command.customerId !== 'string' || !idPattern.test(command.customerId) ||
      typeof command.selectionId !== 'string' || !idPattern.test(command.selectionId) ||
      typeof command.barcode !== 'string' || !/^[0-9]{6,22}$/.test(command.barcode) ||
      typeof command.requestId !== 'string' || !uuid.test(command.requestId) ||
      !Number.isSafeInteger(command.version) || command.version < 1 || typeof command.enabled !== 'boolean' ||
      typeof command.currency !== 'string' || !/^[A-Z]{3}$/.test(command.currency) ||
      !validMoney(command.priceEa) || !validMoney(command.priceCtn) ||
      (command.selectionEpoch !== undefined && (typeof command.selectionEpoch !== 'string' || command.selectionEpoch.length > 30 ||
        (command.selectionEpoch && !Number.isFinite(Date.parse(command.selectionEpoch)))))) throw Error('Invalid quotation projection.');
  return Object.fromEntries(keys.map(key => [key, command[key]]));
}

// Called only after authenticating MASTER at the server endpoint. Keep the
// quote versions separate from selections so retries cannot overwrite a more
// recent price or a buyer's independent selection edit.
export function createMasterQuoteProjection({ readContext, latest, read, insert }) {
  return async function receive(command) {
    const quote = priceInstruction(command);
    const { customerId, selectionId, version, requestId } = quote;
    const context = await readContext(customerId, selectionId);
    const { customer, selection } = context || {};
    const _id = createHash('sha256').update(JSON.stringify([customerId, selectionId, version])).digest('hex').slice(0, 32);
    const fingerprint = createHash('sha256').update(JSON.stringify(quote)).digest('hex');
    const row = { _id, ...quote, fingerprint };
    let stored = await read(_id);
    if (!stored && (customer?.customerId !== customerId || !isWebQuotationReady(customer) ||
        selection?.id !== selectionId || selection.customerId !== customerId || selection.removed || selection.barcode !== quote.barcode ||
        (selection.selectionEpoch || '') !== (quote.selectionEpoch || '') ||
        (quote.enabled && (customer.preferredCurrency !== quote.currency || !Number.isSafeInteger(selection.ea) || selection.ea < 1 ||
          Number((quote.priceEa * selection.ea).toFixed(6)) !== quote.priceCtn)))) throw Error('Quotation selection is unavailable.');

    if (!stored) {
      const current = await latest(customerId, selectionId);
      if ((current?.version ?? 0) + 1 !== version) throw Error('Quotation version is out of order.');
      try { stored = await insert(row); }
      catch (error) {
        stored = await read(_id);
        if (!stored) throw error;
      }
    }
    if (stored._id !== _id || stored.fingerprint !== fingerprint || fields.some(key => stored[key] !== row[key]) ||
        (stored.selectionEpoch || '') !== (quote.selectionEpoch || '')) {
      throw Error('Quotation version conflicts with its receipt.');
    }
    return { ok: true, customerId, selectionId, version, requestId };
  };
}

export function presentMasterQuote(selection, quote) {
  if (!quote || selection.removed || selection.customerId !== quote.customerId || selection.id !== quote.selectionId ||
      (selection.unitBarcode || selection.barcode) !== quote.barcode || (selection.selectionEpoch || '') !== (quote.selectionEpoch || '')) return selection;
  const vipPriceEa = quote.enabled ? quote.priceEa : 0;
  const vipPriceCtn = quote.enabled ? quote.priceCtn : 0;
  return { ...selection, quoteActive: quote.enabled, quoteStatus: quote.enabled ? 'VIEW QUOTE' : 'RFQ',
    vipPriceEa, vipPriceCtn, vipPrice: vipPriceCtn, quotePerPc: vipPriceEa, quotePerCtn: vipPriceCtn,
    vipCurrency: quote.enabled ? quote.currency : '' };
}
