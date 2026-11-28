import { canonical, createOperationJournal, operationId } from 'backend/purchaseOperationJournal.js';
import { projectStockCard } from 'backend/stockCardProjection.js';
import {
  OPENING_STOCK_POSTED, OPENING_STOCK_COST_CONFIRMED, openingStockId,
  isOpeningBarcode, isOpeningQuantity, isOpeningAddition, isOpeningCost, readOpeningStock
} from 'backend/openingStockState.js';

const text = value => typeof value === 'string' ? value.trim() : '';
function rejectOpeningStock(message) {
  const error = Error(message);
  error.code = 'OPENING_STOCK_INPUT';
  throw error;
}

function productIdentity(context, barcode, fallback) {
  const rows = context.tasks.filter(row => row.barcode === barcode);
  const products = rows.length ? rows : [fallback];
  const product = products[0];
  if (!product?.packing || !isOpeningQuantity(product.ea) || !product.ea || !text(product.name) ||
      products.some(row => row.packing !== product.packing || row.ea !== product.ea)) {
    rejectOpeningStock('Check the barcode and carton packing before posting opening stock.');
  }
  return { barcode, name: text(product.name), packing: product.packing, ea: product.ea };
}

function calculate(context, barcode, fallback) {
  const opening = readOpeningStock(context.company, context.activity).get(barcode);
  const product = productIdentity(context, barcode, fallback);
  const rows = projectStockCard({
    ...context, tasks: context.tasks.filter(row => row.barcode === barcode)
  }).items;
  const row = rows[0];
  if (rows.length > 1 || !opening && row && (row.onHand === null || row.reviewRequired || row.awaitingDisposal > 0)) {
    rejectOpeningStock('Resolve the current stock review before posting an opening count.');
  }
  const version = operationId(context.company, barcode, product.packing, product.ea, rows, opening ?? null);
  return {
    ...product, onHand: row ? row.onHand : 0, reserved: row ? row.reservedUsable : 0,
    available: row ? row.available : 0, isolated: row ? row.isolated : 0, incoming: row?.incoming ?? 0,
    opening: opening ? { added: opening.added, counted: opening.counted, costPending: opening.added > 0 &&
      opening.unitCostScaled === null, reference: opening.reference, countedAt: opening.countedAt } : null,
    version
  };
}

export function createOpeningStockOperations({ store, names, readContext, resolveProduct, now = () => new Date() }) {
  const journal = createOperationJournal({ store, now });
  async function contextFor(company, staff) {
    if (!['NCT', 'GHR'].includes(company) || !names[company]?.activity || staff?.canPostOpeningStock !== true) {
      throw Error('Finance stock editing permission is required.');
    }
    const context = await readContext(company, staff);
    if (context?.company !== company) throw Error('Stock company mismatch.');
    return context;
  }
  async function preparePreview(company, staff, barcode, savedProduct) {
    if (!isOpeningBarcode(barcode)) rejectOpeningStock('Enter a valid unit barcode.');
    const context = await contextFor(company, staff);
    const fallback = savedProduct || (context.tasks.some(row => row.barcode === barcode) ? null : await resolveProduct(barcode));
    return calculate(context, barcode, fallback);
  }
  async function save({ company, staff, requestId, input }) {
    if (!['NCT', 'GHR'].includes(company) || !names[company]?.activity || staff?.canPostOpeningStock !== true) {
      throw Error('Finance stock editing permission is required.');
    }
    const { barcode, version, counted, unitCostScaled = null } = input || {};
    const mode = input?.mode;
    const reference = text(input?.reference);
    const countedAt = Date.parse(input?.countedAt);
    if (!isOpeningBarcode(barcode) || !/^[a-f0-9]{32}$/.test(version || '') ||
        !['POST', 'CONFIRM_COST'].includes(mode) || !reference || reference.length > 120 ||
        (unitCostScaled !== null && !isOpeningCost(unitCostScaled))) rejectOpeningStock('Check opening stock inputs.');
    const isCost = mode === 'CONFIRM_COST';
    if (isCost ? unitCostScaled === null : !isOpeningQuantity(counted) ||
        !Number.isFinite(countedAt) || countedAt > now().getTime() || input?.countConfirmed !== true) {
      rejectOpeningStock(isCost ? 'Enter the verified cost in MYR per carton.' : 'Enter and confirm the physical carton count and count date.');
    }
    const collection = names[company].activity;
    const sourceId = openingStockId(company, barcode);
    const action = isCost ? OPENING_STOCK_COST_CONFIRMED : OPENING_STOCK_POSTED;
    return journal({
      collection, scope: company + '/PURCHASE', entityId: sourceId, requestId, staff,
      input: { openingStock: input },
      prepare: async () => {
        const preview = await preparePreview(company, staff, barcode);
        if (preview.version !== version) rejectOpeningStock('Stock changed. Review the current quantity and count again.');
        if (isCost ? !preview.opening?.costPending : preview.opening) rejectOpeningStock('Opening stock is already recorded or is unavailable for this action.');
        if (!isCost && counted < preview.onHand) rejectOpeningStock('The count is below recorded stock. Use Stock Take to review the shortage.');
        const product = { barcode, name: preview.name, packing: preview.packing, ea: preview.ea };
        const added = isCost ? 0 : counted - preview.onHand;
        if (!isOpeningAddition(added)) rejectOpeningStock('The opening difference exceeds the supported stock lot size of 9,999 cartons.');
        const details = isCost ? { company, barcode, reference, unitCostScaled } : {
          ...product, company, counted, before: preview.onHand, added, reference,
          countedAt: new Date(countedAt).toISOString(), unitCostScaled: added ? unitCostScaled : null
        };
        const id = operationId(company, requestId, staff.memberId, action);
        return { product, event: { _id: id, title: id, imageAltText: sourceId, action, result: 'SAVED',
          actorType: 'STAFF', initiatedByStaffId: staff.staffId, initiatedByStaffName: staff.staffName,
          activityTime: now().toISOString(), details } };
      },
      apply: async ({ product, event }) => {
        const existing = await store.read(collection, event._id);
        if (!existing) {
          const current = await preparePreview(company, staff, barcode, product);
          if (current.version !== version) rejectOpeningStock('Stock changed while saving. Review the current quantity and count again.');
          await store.insert(collection, { ...event, activityTime: new Date(event.activityTime) });
        } else if (existing.action !== action || existing.imageAltText !== sourceId ||
            canonical(existing.details) !== canonical(event.details)) throw Error('Opening stock save identity requires review.');
        return { ok: true, company, requestId, sourceId, added: event.details.added ?? 0,
          counted: event.details.counted ?? null, costConfirmed: event.details.unitCostScaled !== null };
      }
    });
  }
  return { preview: (company, staff, barcode) => preparePreview(company, staff, barcode), save };
}
