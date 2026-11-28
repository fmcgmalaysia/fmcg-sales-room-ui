import { canonical, createOperationJournal, operationId } from 'backend/purchaseOperationJournal.js';
import { projectPhysicalStock } from 'backend/stockPhysicalProjection.js';
import { sourceCost } from 'backend/stockValuationService.js';
import { readStockCountGains, stockCountGainActions } from 'backend/stockCountGainState.js';

function text(value, limit) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > limit) throw Error('Enter a valid stock count reference and reason.');
  return result;
}

function countedSource(company, source) {
  const stock = source?.warehouse?.stock;
  if (!source?.po || !source.supplierId || !source.barcode || !source.warehouse?.hasPhysicalReceipt || !stock) {
    throw Error('Select the verified supplier batch found in the physical count.');
  }
  const physical = projectPhysicalStock(stock);
  if (!Number.isSafeInteger(physical.onHand) || physical.issues.length || physical.isolated || physical.awaitingDisposal) {
    throw Error('Resolve the existing stock exception before confirming a new count.');
  }
  const stockVersion = operationId(company, source.id, source.po, source.barcode,
    source.packing, source.ea, stock.received, stock.shipped, stock.replacementReceived, stock.countGain ?? 0, stock.cases);
  return { source, onHand: physical.onHand, stockVersion };
}

export function projectStockCounts(context, staff) {
  const canReport = staff.canReportStockException === true;
  const canReadCost = staff.readStockFinancial === true || staff.canCloseStockException === true;
  const reports = readStockCountGains(context.activity).filter(gain => gain.company === context.company).map(gain => {
    const source = context.tasks.find(row => row.id === gain.sourceTaskId);
    const report = { id: gain.id, sourceTaskId: gain.sourceTaskId, barcode: gain.barcode, po: gain.po,
      quantity: gain.quantity, onHand: gain.onHand, counted: gain.counted, reference: gain.reference, reason: gain.reason,
      reportedAt: gain.at, reportedBy: gain.staffName, confirmed: Boolean(gain.approval) };
    if (!canReadCost) return report;
    const cost = gain.approval?.unitCost ?? (source ? sourceCost(source).unit : null);
    return { ...report, unitCost: cost > 0 ? cost : null, confirmedBy: gain.approval?.staffName ?? '',
      confirmedAt: gain.approval?.at ?? '', valueCents: gain.approval?.valueCents ?? null };
  });
  const sources = canReport ? context.tasks.filter(row => row.warehouse?.hasPhysicalReceipt && row.po && row.supplierId)
    .flatMap(row => {
      try {
        const { onHand } = countedSource(context.company, row);
        return [{ id: row.id, barcode: row.barcode, name: row.name, packing: row.packing, po: row.po, onHand }];
      } catch (_) { return []; }
    }) : [];
  return { reports, sources, canReport, canConfirm: staff.canCloseStockException === true };
}

export function createStockCountGainOperations({ store, names, readContext, now = () => new Date() }) {
  const journal = createOperationJournal({ store, now });
  return async ({ company, staff, requestId, input }) => {
    const report = input?.action === 'REPORT_COUNT_GAIN';
    const confirm = input?.action === 'CONFIRM_COUNT_GAIN';
    if (!names[company] || !(report && staff?.canReportStockException === true || confirm && staff?.canCloseStockException === true)) {
      throw Error('Stock count action is not authorized.');
    }
    const collection = names[company].activity;
    return journal({ collection, scope: company + '/PURCHASE', requestId, staff, input: { stockCount: input },
      prepare: async () => {
        const context = await readContext(company, staff);
        if (context.company !== company) throw Error('Stock count company mismatch.');
        const gains = readStockCountGains(context.activity);
        const prior = confirm ? gains.find(gain => gain.company === company && gain.id === input.reportId) : null;
        if (confirm && (!prior || prior.approval)) throw Error('Stock count report is unavailable or already confirmed.');
        const sourceId = report ? input.sourceTaskId : prior.sourceTaskId;
        const { source, onHand, stockVersion } = countedSource(company, context.tasks.find(row => row.id === sourceId));
        const reason = text(input.reason, 2000);
        let details;
        if (report) {
          const reference = text(input.reference, 120);
          const counted = input.counted;
          if (input.onHand !== onHand) throw Error('Stock changed. Recount the original batch before reporting.');
          if (!Number.isSafeInteger(counted) || counted <= onHand || counted - onHand > 9999) {
            throw Error('Enter the physical whole-carton count above the current on-hand quantity.');
          }
          if (gains.some(gain => gain.sourceTaskId === source.id && gain.reference === reference)) {
            throw Error('Stock count reference is already recorded for this batch.');
          }
          details = { company, po: source.po, barcode: source.barcode, onHand, counted, reference, reason, stockVersion };
        } else {
          if (prior.stockVersion !== stockVersion || prior.onHand !== onHand) throw Error('Stock changed after the report. Recount the original batch.');
          if (source.warehouse.accepted < source.procurement?.totalCtn) {
            throw Error('Verify the open supplier receipt before using the Stock Take adjustment.');
          }
          const cost = sourceCost(source);
          if (cost.status !== 'CONFIRMED' || !(cost.unit > 0)) throw Error('Stock cost is pending verification.');
          const valueCents = Math.round(cost.unit * prior.quantity * 100);
          if (!Number.isSafeInteger(valueCents) || valueCents <= 0) throw Error('Stock cost is pending verification.');
          details = { company, reportId: prior.id, quantity: prior.quantity, unitCost: cost.unit, valueCents, reason };
        }
        const action = report ? stockCountGainActions.report : stockCountGainActions.confirm;
        const id = operationId(company, requestId, staff.memberId, action);
        return { stockVersion, event: { _id: id, title: id, description: source.orderId, image: source.sourceLineId,
          imageAltText: source.id, action, result: 'SAVED', actorType: 'STAFF', initiatedByStaffId: staff.staffId,
          initiatedByStaffName: staff.staffName, activityTime: now().toISOString(), details } };
      },
      apply: async plan => {
        const { event } = plan;
        const saved = await store.read(collection, event._id);
        if (!saved) {
          const context = await readContext(company, staff);
          const { stockVersion } = countedSource(company, context.tasks.find(row => row.id === event.imageAltText));
          if (context.company !== company || stockVersion !== plan.stockVersion) throw Error('Stock changed while saving. Recount the original batch.');
          if (confirm && readStockCountGains(context.activity).find(gain => gain.id === event.details.reportId)?.approval) {
            throw Error('Stock count report is already confirmed.');
          }
          await store.insert(collection, { ...event, activityTime: new Date(event.activityTime) });
        } else if (saved.action !== event.action || saved.imageAltText !== event.imageAltText || canonical(saved.details) !== canonical(event.details)) {
          throw Error('Stock count save identity requires review.');
        }
        return { ok: true, company, requestId, caseId: event.details.reportId ?? event._id, ...(confirm ? { added: event.details.quantity } : {}) };
      }
    });
  };
}
