import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { normalizeStaffAccess } from 'backend/staffManagementPolicy.js';
import { readPurchasePlan } from 'backend/purchasePlan.js';

const READ = { suppressAuth: true, consistentRead: true };
const HISTORY_ACTIONS = ['PURCHASE_PO_ASSIGNED', 'PURCHASE_PLAN_SAVED', 'PURCHASE_SOURCE_ADDED'];
const productKey = (barcode, ea) => barcode + '|' + ea;
const validProduct = ({ barcode, ea } = {}) => typeof barcode === 'string' &&
  /^[0-9]{6,22}$/.test(barcode) && Number.isSafeInteger(ea) && ea > 0;

async function rows(query) {
  let page = await query.limit(1000).find(READ);
  const items = [...page.items];
  while (page.hasNext()) {
    page = await page.next();
    items.push(...page.items);
  }
  return items;
}

async function findBatches(wixData, collection, field, values, scope = query => query) {
  const items = [];
  for (let index = 0; index < values.length; index += 100) {
    const query = wixData.query(collection).hasSome(field, values.slice(index, index + 100));
    items.push(...await rows(scope(query)));
  }
  return items;
}

function by(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    const group = groups.get(value);
    if (group) group.push(item);
    else groups.set(value, [item]);
  }
  return groups;
}

function confirmedCost(task, order, events) {
  if (!task.ourPoNumber || !task.supplierId || task.specialPurchase) return null;
  const related = events.filter(event => event.result === 'SAVED' && event.description === task.description &&
    event.image === task.imageAltText && event.imageAltText === task.title && Number.isFinite(Date.parse(event.activityTime)));
  if (task.procurementSource && related.filter(event => event.action === 'PURCHASE_SOURCE_ADDED' &&
    event.details?.parentTaskId === task.customerDemandTaskId && event.details?.submissionId === order.submissionId).length !== 1) return null;

  const assignments = related.filter(event => event.action === 'PURCHASE_PO_ASSIGNED')
    .sort((a, b) => Date.parse(b.activityTime) - Date.parse(a.activityTime));
  const [assigned, prior] = assignments;
  if (assigned?.details?.after !== task.ourPoNumber || (prior && Date.parse(prior.activityTime) === Date.parse(assigned.activityTime))) return null;
  const assignedAt = Date.parse(assigned.activityTime);
  const plans = related.filter(event => event.action === 'PURCHASE_PLAN_SAVED');
  const verified = readPurchasePlan(task, plans);
  const confirmed = plans.filter(event => Date.parse(event.activityTime) >= assignedAt &&
    event.details?.supplierConfirmed === true && event.details?.draftPlan !== true &&
    event.details?.poNumber === task.ourPoNumber && event.details?.supplierId === task.supplierId)
    .sort((a, b) => Date.parse(b.activityTime) - Date.parse(a.activityTime));
  if (confirmed.length > 1 && Date.parse(confirmed[0].activityTime) === Date.parse(confirmed[1].activityTime)) return null;
  const cutoff = confirmed.length ? Date.parse(confirmed[0].activityTime) : assignedAt;
  const atPurchase = cutoff >= Date.parse(verified.updatedAt)
    ? verified
    : readPurchasePlan(task, plans.filter(event => Date.parse(event.activityTime) <= cutoff));
  const costing = atPurchase.costing;
  if (atPurchase.supplierId !== task.supplierId || costing?.schema !== 1 || costing.ea !== order.orderId ||
      costing.totalCtn !== atPurchase.totalCtn || !Number.isSafeInteger(costing.amountCents) ||
      costing.amountCents <= 0 || !Number.isSafeInteger(costing.totalCtn) || costing.totalCtn <= 0) return null;
  const netCostMyrCtn = Number((costing.amountCents / 100 / costing.totalCtn).toFixed(6));
  return { at: cutoff, netCostMyrCtn };
}

export function createLastPurchaseCosts(wixData) {
  return async function readLastPurchaseCosts({ record, customerId, products }) {
    if (!Array.isArray(products) || products.length > 1000 || products.some(product => !product || !validProduct(product))) {
      throw Error('Invalid quotation purchase history request.');
    }
    const keys = new Set(products.map(({ barcode, ea }) => productKey(barcode, ea)));
    if (!keys.size) return [];
    const barcodes = [...new Set(products.map(product => product.barcode))];
    const companyIds = String(record.role).trim().toUpperCase() === 'SUPER ADMIN'
      ? Object.keys(PURCHASE_COLLECTIONS) : normalizeStaffAccess(record.staffAccess ?? {}).companyIds;
    const batches = await Promise.all(companyIds.map(async company => {
      const source = PURCHASE_COLLECTIONS[company];
      const orders = await findBatches(wixData, source.orders, 'description', barcodes, query => query.eq('customerId', customerId));
      const matches = orders.filter(order => order.customerId === customerId && keys.has(productKey(order.description, order.orderId)));
      const byLine = by(matches, order => JSON.stringify([order.title, order.sourceLineId]));
      const orderIds = [...new Set(matches.map(order => order.title).filter(Boolean))];
      const tasks = await findBatches(wixData, source.tasks, 'description', orderIds, query => query.ne('ourPoNumber', ''));
      const taskIds = [...new Set(tasks.map(task => task.title).filter(Boolean))];
      const events = by(await findBatches(wixData, source.activity, 'imageAltText', taskIds,
        query => query.hasSome('action', HISTORY_ACTIONS).eq('result', 'SAVED')), event => event.imageAltText);
      return tasks.flatMap(task => {
        const found = byLine.get(JSON.stringify([task.description, task.imageAltText]));
        if (found?.length !== 1 || !events.has(task.title)) return [];
        const [order] = found;
        let cost;
        try { cost = confirmedCost(task, order, events.get(task.title)); } catch { return []; }
        return cost ? [{ ...cost, barcode: order.description, ea: order.orderId }] : [];
      });
    }));

    const latest = new Map();
    for (const cost of batches.flat()) {
      const key = productKey(cost.barcode, cost.ea);
      const previous = latest.get(key);
      if (!previous || cost.at > previous.at) latest.set(key, cost);
      else if (cost.at === previous.at && cost.netCostMyrCtn !== previous.netCostMyrCtn) {
        latest.set(key, { at: previous.at, netCostMyrCtn: null });
      }
    }
    return [...latest.values()].filter(cost => cost.netCostMyrCtn !== null)
      .map(({ barcode, ea, netCostMyrCtn, at }) => ({ barcode, ea, netCostMyrCtn, purchasedAt: new Date(at).toISOString() }));
  };
}
