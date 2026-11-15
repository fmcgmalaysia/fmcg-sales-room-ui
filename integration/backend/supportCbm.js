import { operationId } from 'backend/purchaseOperationJournal.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readSupportDeskLocks } from 'backend/supportDesk.js';
import { CBM_ACTION, indexWarehouseCbm, validCbm, warehouseCbm } from 'backend/warehouseCbm.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';

const companies = new Set(['NCT', 'GHR']);
const tabOrder = { FOOD: 0, NONFOOD: 1, OTHERS: 2 };
const idPattern = { FOOD: /^FO-(\d+)$/i, NONFOOD: /^NF-(\d+)$/i, OTHERS: /^OT-(\d+)$/i };

function planMissingCbm(context, taskId) {
  const { company, tasks, activity } = context;
  if (!companies.has(company)) throw Error('Select NCT or GHR.');
  const belongs = task => task.company === undefined || task.company === company;
  const anchor = tasks.find(task => task.id === taskId && belongs(task));
  if (!anchor?.barcode) throw Error('The current customer task is unavailable.');
  let shipments;
  const readShipments = () => shipments ??= readCustomerShipments(activity);
  const pending = new Set(readSupportDeskLocks(context, readShipments)
    .filter(lock => lock.status === 'PENDING')
    .flatMap(lock => lock.taskIds || []));
  const reserved = new Map();
  for (const shipment of readShipments()) {
    if (shipment.company !== company || shipment.status === 'CANCELLED') continue;
    for (const line of shipment.lines) {
      reserved.set(line.taskId, (reserved.get(line.taskId) || 0) + line.quantity);
    }
  }
  const cbmByTask = indexWarehouseCbm(activity);
  const affected = tasks.flatMap(task => {
    if (!belongs(task) || task.barcode !== anchor.barcode || task.archived ||
        task.procurementSource || task.specialPurchase || pending.has(task.id)) return [];
    if (validCbm(warehouseCbm(company, task, cbmByTask))) return [];
    const remaining = (task.requested ?? task.ord) - (reserved.get(task.id) || 0);
    if (!Number.isSafeInteger(remaining) || remaining <= 0) return [];
    return [{ taskId: task.id, customerId: task.customerId, orderId: task.orderId, sourceLineId: task.sourceLineId, remaining }];
  }).sort((a, b) => a.taskId.localeCompare(b.taskId));
  if (!affected.some(task => task.taskId === anchor.id)) throw Error('This task no longer needs CBM.');
  return { company, barcode: anchor.barcode, affected, revision: operationId(company, anchor.barcode, affected) };
}

async function previewMissingCbm(context, taskId, fetchPointbase, includeEvidence = false) {
  const plan = planMissingCbm(context, taskId);
  const source = (await fetchPointbase([plan.barcode]))?.[plan.barcode];
  if (source?.unitBarcode !== plan.barcode || !source.source ||
      !Number.isFinite(Date.parse(source.capturedAt)) ||
      !Array.isArray(source.costIssues) ||
      source.costIssues.some(issue => /BARCODE|READ_FAILED|ROW_READ|HEADER/.test(issue))) {
    throw Error('Pointbase could not confirm a unique barcode.');
  }
  if (!validCbm(source.cbmPerCtn)) throw Error('CBM is still missing in Pointbase.');
  return { ...plan, cbmPerCtn: source.cbmPerCtn,
    ...(includeEvidence ? { capturedAt: source.capturedAt, source: source.source } : {}) };
}

function verifyMissingCbmPreview(context, taskId, preview) {
  const current = planMissingCbm(context, taskId);
  if (current.revision !== preview?.revision) throw Error('Tasks changed. Fetch CBM again.');
  return current;
}

async function applyMissingCbm({ company, taskId, preview, staff, readContext, fetchPointbase, store, now = () => new Date() }) {
  if (!companies.has(company) || staff?.packingDepartment !== 'SUPPORT' ||
      !staff.memberId || !staff.staffId || !staff.staffName) throw Error('Support CBM edit access is required.');
  const collection = PURCHASE_COLLECTIONS[company].activity;
  const before = await readContext(company, staff);
  if (before.company !== company) throw Error('The company changed.');
  verifyMissingCbmPreview(before, taskId, preview);
  const sourcePreview = await previewMissingCbm(before, taskId, fetchPointbase, true);
  if (sourcePreview.cbmPerCtn !== preview.cbmPerCtn) throw Error('Pointbase CBM changed. Fetch again.');

  const fresh = await readContext(company, staff);
  if (fresh.company !== company) throw Error('The company changed.');
  const plan = verifyMissingCbmPreview(fresh, taskId, preview);
  const results = [];
  for (const target of plan.affected) {
    const id = operationId(company, target.taskId, CBM_ACTION);
    const event = {
      _id: id, title: id, description: target.orderId, imageAltText: target.taskId, action: CBM_ACTION,
      result: 'SAVED', actorType: 'STAFF', activityTime: now(), initiatedByStaffId: staff.staffId,
      initiatedByStaffName: staff.staffName, message: 'Missing CBM captured from POINTBASE',
      details: {
        company, sourceLineId: target.sourceLineId, barcode: plan.barcode, cbmPerCtn: sourcePreview.cbmPerCtn,
        capturedAt: sourcePreview.capturedAt, source: sourcePreview.source, supportRefresh: true
      }
    };
    try {
      await store.insert(collection, event);
      results.push({ taskId: target.taskId, status: 'saved' });
    } catch {
      const task = fresh.tasks.find(row => row.id === target.taskId);
      let saved;
      try {
        const existing = await store.read(collection, id);
        if (existing) saved = warehouseCbm(company, task, [existing]);
      } catch {
        // Failed acknowledgement requires explicit review, never a second insert.
      }
      results.push({ taskId: target.taskId, status: saved === sourcePreview.cbmPerCtn ? 'retained' : 'unconfirmed' });
    }
  }
  return { company, barcode: plan.barcode, cbmPerCtn: sourcePreview.cbmPerCtn, results };
}

function sortByProductOrder(rows, byBarcode) {
  const sortKey = row => {
    const product = byBarcode.get(row.barcode);
    const category = product?.category;
    if (!Object.hasOwn(idPattern, category)) return [3, 0];
    const number = Number(idPattern[category].exec(String(product.sortNo ?? '').trim())?.[1]);
    return Number.isSafeInteger(number) && number > 0 ? [tabOrder[category], number] : [3, 0];
  };
  return rows.map(row => ({ row, key: sortKey(row) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
    .map(({ row }) => row);
}

export { previewMissingCbm, applyMissingCbm, sortByProductOrder };
