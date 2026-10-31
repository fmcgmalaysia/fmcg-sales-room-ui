import { projectStockControlPage, validateStockListInput } from 'backend/stockControlService.js';
import { requireAccountStaff } from 'backend/accountPurchaseReview.js';
import { calculatePlanCosting } from 'backend/purchasePlan.js';

// Finance-only enrichment of the existing quantity projection. No stock writes,
// new balances, reference prices, payment amounts or alternative outflow rules.
function sourceCost(task) {
  // PO assignment confirms the source without rewriting the earlier plan event's draft flag.
  if (!task?.po || task.costCurrency !== 'MYR') return { status: 'COST_UNCONFIRMED', unit: null };
  const plan = task.procurement, saved = plan?.costing;
  if (!saved) return { status: 'COST_UNCONFIRMED', unit: null };
  try {
    const cost = calculatePlanCosting(saved, plan.totalCtn, task.ea);
    if (cost.amountCents !== saved.amountCents || !Number.isFinite(saved.averageCostCtn)
      || Math.abs(cost.averageCostCtn - saved.averageCostCtn) > 0.000001) return { status: 'COST_REQUIRES_REVIEW', unit: null };
    // Receipts do not yet identify the paid/free composition of partial FOC lots.
    if (cost.freeCtn > 0 && task.warehouse.accepted < plan.totalCtn) return { status: 'FOC_RECEIPT_UNCONFIRMED', unit: null };
    return { status: 'CONFIRMED', unit: cost.averageCostCtn };
  } catch (_) { return { status: 'COST_REQUIRES_REVIEW', unit: null }; }
}
const cents = value => Math.round(value * 100);
function totals(rows) {
  const sources = rows.flatMap(row => row.sources);
  return { currency: 'MYR', basis: 'REMAINING_SOURCE_NET_PURCHASE_COST',
    knownValueCents: sources.reduce((sum, source) => sum + (source.valuation.valueCents ?? 0), 0),
    knownIsolatedValueCents: sources.reduce((sum, source) => sum + (source.valuation.isolatedValueCents ?? 0), 0),
    valuedQuantity: sources.reduce((sum, source) => sum + (source.valuation.valueCents === null ? 0 : source.onHand), 0),
    unvaluedQuantity: sources.reduce((sum, source) => sum + (source.valuation.valueCents === null ? source.onHand ?? 0 : 0), 0),
    unknownQuantitySources: sources.filter(source => source.onHand === null).length,
    unvaluedProducts: rows.filter(row => row.valuation.status !== 'CONFIRMED').length,
    complete: sources.every(source => source.valuation.valueCents !== null) };
}
export function projectStockValuationPage(context, input = {}, readAt = new Date().toISOString()) {
  const tasks = new Map(context.tasks.map(task => [task.id, task]));
  return projectStockControlPage(context, input, readAt, {
    item(row) {
      const sources = row.sources.map(source => {
        const cost = sourceCost(tasks.get(source.sourceTaskId));
        const known = source.onHand !== null && (source.onHand === 0 || cost.unit !== null);
        return { ...source, valuation: { status: source.onHand === null ? 'QUANTITY_UNCONFIRMED' : source.onHand === 0 ? 'CONFIRMED' : cost.status,
          unitCost: cost.unit, valueCents: known ? cents(source.onHand * (cost.unit ?? 0)) : null,
          isolatedValueCents: source.isolated !== null && (source.isolated === 0 || cost.unit !== null) ? cents(source.isolated * (cost.unit ?? 0)) : null } };
      });
      const complete = sources.every(source => source.valuation.valueCents !== null);
      const knownValueCents = sources.reduce((sum, source) => sum + (source.valuation.valueCents ?? 0), 0);
      return { ...row, sources, valuation: { status: complete ? 'CONFIRMED' : 'REQUIRES_REVIEW', currency: 'MYR',
        averageCost: complete && row.onHand > 0 ? sources.reduce((sum, source) => sum + source.onHand * (source.valuation.unitCost ?? 0), 0) / row.onHand : null,
        valueCents: complete ? knownValueCents : null, knownValueCents } };
    },
    summary: rows => ({ valuation: totals(rows) })
  });
}
export function createStockValuationReader({ readMember, readStaffRecords, readContext, now = () => new Date() }) {
  return async (company, input = {}) => {
    if (!['NCT', 'GHR'].includes(company)) throw Error('Select NCT or GHR.');
    validateStockListInput(input);
    const staff = requireAccountStaff(await readMember(), await readStaffRecords());
    const context = await readContext(company, staff);
    if (context.company !== company) throw Error('Stock company mismatch.');
    return { ...projectStockValuationPage(context, input, now().toISOString()), staff: { staffName: staff.staffName } };
  };
}
