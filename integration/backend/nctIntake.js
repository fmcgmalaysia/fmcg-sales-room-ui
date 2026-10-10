/** Internal receiver core. Not exposed or deployed; adapters must authenticate server requests. */
import { createHash } from 'crypto';

const SOURCE_SITE = '5292b63a-30e5-4c0e-8762-a1b127bbc651';
const COLLECTIONS = Object.freeze({ orders: 'NCTOrders', tasks: 'NCTTasks', activity: 'NCTActivity' });
const clone = value => JSON.parse(JSON.stringify(value));
const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' &&
  !Array.isArray(item) ? Object.keys(item).sort().reduce((out, key) => ({ ...out, [key]: item[key] }), {}) : item);
const digest = value => createHash('sha256').update(stableJson(value)).digest('hex');
const recordId = (...parts) => digest(parts).slice(0, 32);
function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing ' + label);
  return value.trim();
}
function date(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid ' + label);
  return new Date(value);
}
function validate(body) {
  if (!body || body.sourceSiteId !== SOURCE_SITE || body.destination !== 'NCT') throw new Error('Invalid source or receiving company');
  ['orderId', 'customerId', 'customerCompanyName', 'submissionId', 'submittedByStaffId', 'submittedByStaffName'].forEach(key => requireText(body[key], key));
  if (!/^[A-Z]{3}$/.test(body.transactionCurrency || '') || !Number.isFinite(body.fxRate) || body.fxRate <= 0) throw new Error('Current Admin FX and transaction currency are required');
  date(body.submittedAt, 'Sales submission time');
  if (body.estimatedShipmentDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.estimatedShipmentDate) ||
        date(body.estimatedShipmentDate, 'shipment date').toISOString().slice(0, 10) !== body.estimatedShipmentDate) throw new Error('Invalid shipment date');
  }
  if (!Array.isArray(body.lines) || !body.lines.length) throw new Error('Order has no lines');
  const ids = new Set();
  body.lines.forEach(line => {
    ['sourceLineId', 'unitBarcode', 'itemName', 'packingSize'].forEach(key => requireText(line[key], key));
    if (ids.has(line.sourceLineId)) throw new Error('Duplicate source line ID');
    ids.add(line.sourceLineId);
    if (!Number.isFinite(line.qtyCtn) || line.qtyCtn <= 0 || !Number.isSafeInteger(line.eaPerCtn) || line.eaPerCtn <= 0 ||
        !Number.isFinite(line.sellingPricePc) || line.sellingPricePc < 0) throw new Error('Invalid locked quote, EA or quantity');
  });
}

/** store.read must return null only for genuine absence; all other errors must propagate. */
export function createNctIntake({ store, captureCosts, now = () => new Date() }) {
  async function insertOnce(collection, proposed, check) {
    let current = await store.read(collection, proposed._id);
    if (!current) {
      try { current = await store.insert(collection, proposed); }
      catch (error) {
        current = await store.read(collection, proposed._id);
        if (!current) throw error;
      }
    }
    if (!check(current)) throw new Error('Master record identity conflict');
    return current;
  }
  return async function receiveNctOrder(input) {
    validate(input);
    const body = clone(input), payloadHash = digest(body);
    const base = [SOURCE_SITE, body.orderId];
    const prepareId = recordId(...base, 'PREPARED');
    let prepared = await store.read(COLLECTIONS.activity, prepareId);
    if (prepared && prepared.details?.payloadHash !== payloadHash) throw new Error('This order already has a different submission');
    if (!prepared) {
      const at = now().toISOString();
      let costs;
      try { costs = await captureCosts(body.lines.map(line => line.unitBarcode)); }
      catch (error) {
        costs = Object.fromEntries(body.lines.map(line => [line.unitBarcode, {
          unitBarcode: line.unitBarcode, capturedAt: at, costCurrency: 'MYR', costStatus: 'ERROR',
          costIssues: [/^POINTBASE_[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code : 'POINTBASE_SERVICE_UNAVAILABLE'], lpPc: null, lpCtn: null,
          disc1: null, disc2: null, disc3: null, netCostCtn: null, cbmPerCtn: null
        }]));
      }
      costs = costs && typeof costs === 'object' ? { ...costs } : {};
      for (const line of body.lines) {
        const cost = costs?.[line.unitBarcode];
        if (!cost || cost.unitBarcode !== line.unitBarcode || cost.costCurrency !== 'MYR' ||
            !['CAPTURED', 'ERROR'].includes(cost.costStatus) || !Array.isArray(cost.costIssues) ||
            !Number.isFinite(Date.parse(cost.capturedAt))) {
          costs[line.unitBarcode] = {
            unitBarcode: line.unitBarcode, capturedAt: at, costCurrency: 'MYR', costStatus: 'ERROR',
            costIssues: ['POINTBASE_RESULT_INCOMPLETE'], lpPc: null, lpCtn: null,
            disc1: null, disc2: null, disc3: null, netCostCtn: null, cbmPerCtn: null
          };
        }
      }
      prepared = await insertOnce(COLLECTIONS.activity, {
        _id: prepareId, title: prepareId, description: body.orderId,
        action: 'INTAKE_PREPARED', activityTime: date(at, 'receipt time'), actorType: 'SYSTEM',
        initiatedByStaffId: body.submittedByStaffId, initiatedByStaffName: body.submittedByStaffName,
        result: 'PREPARED', message: 'Accepted intake snapshot; row persistence pending',
        details: { payloadHash, submissionId: body.submissionId, receivedAt: at, sourceSnapshot: body, costs: clone(costs) }
      }, row => row.details?.payloadHash === payloadHash);
    }
    const receivedAt = prepared.details.receivedAt, costs = prepared.details.costs;
    const taskIds = [];
    for (const [position, line] of body.lines.entries()) {
      const rowId = recordId(...base, line.sourceLineId, 'ORDER');
      const taskId = recordId(...base, line.sourceLineId, 'TASK');
      const cost = costs[line.unitBarcode];
      taskIds.push(taskId);
      // IDs below are actual Wix field keys, including legacy keys repurposed by the user.
      await insertOnce(COLLECTIONS.orders, {
        _id: rowId, title: body.orderId, description: line.unitBarcode, image: line.itemName,
        imageAltText: line.packingSize, orderId: line.eaPerCtn, customerId: body.customerId,
        customerCompanyName: body.customerCompanyName, customerPoNumber: body.customerPoNumber || '',
        transactionCurrency: body.transactionCurrency, buyerReceivedBy: body.buyerReceivedBy || '',
        submittedByStaffId: body.submittedByStaffId, submittedByStaffName: body.submittedByStaffName,
        submissionId: body.submissionId, intakeStatus: 'RECEIVED', sourceSiteId: SOURCE_SITE,
        adminFxSource: body.fxRate, salesInvoiceNumber: '', financialLockedBy: '',
        estimatedShipmentDate: body.estimatedShipmentDate ? date(body.estimatedShipmentDate, 'shipment date') : null,
        cbmCtn: cost.cbmPerCtn, masterReceivedTime: date(receivedAt, 'receipt time'),
        sellingPricePc: line.sellingPricePc, orderQtyInCtn: line.qtyCtn,
        salesSubmissionTime: date(body.submittedAt, 'Sales submission time'), sourceLineId: line.sourceLineId
      }, row => row.title === body.orderId && row.sourceLineId === line.sourceLineId &&
        row.sourceSiteId === SOURCE_SITE && row.submissionId === body.submissionId);
      await insertOnce(COLLECTIONS.tasks, {
        _id: taskId, title: taskId, description: body.orderId, imageAltText: line.sourceLineId,
        rowPosition: position + 1, supplierId: '', ourPoNumber: '', purchaseQtyInCtn: line.qtyCtn,
        receivedQtyInCtn: null, lpPc: cost.lpPc, lpCtn: cost.lpCtn,
        disc1: cost.disc1, disc2: cost.disc2, disc3: cost.disc3,
        originalCostSnapshot: cost, latestCostReference: cost, costStatus: cost.costStatus,
        costErrorReason: cost.costIssues.join('; '), lastCostCaptureTime: date(cost.capturedAt, 'cost capture time'),
        manualCostField: [], purchaseStage: 'NEW_INCOMING', risk: false, riskReason: '',
        specialPurchase: false, specialPurchaseReason: ''
      }, row => row.title === taskId && row.description === body.orderId && row.imageAltText === line.sourceLineId &&
        digest(row.originalCostSnapshot) === digest(cost));
      const eventId = recordId(...base, line.sourceLineId, 'INITIAL_COST');
      await insertOnce(COLLECTIONS.activity, {
        _id: eventId, title: eventId, description: body.orderId, image: line.sourceLineId, imageAltText: taskId,
        action: 'COST_CAPTURE', activityTime: date(cost.capturedAt, 'cost capture time'), actorType: 'SYSTEM',
        initiatedByStaffId: body.submittedByStaffId, initiatedByStaffName: body.submittedByStaffName,
        message: cost.costIssues.length ? cost.costIssues.join('; ') : 'POINTBASE cost captured',
        result: cost.costStatus, details: { submissionId: body.submissionId, snapshot: cost }
      }, row => row.description === body.orderId && row.imageAltText === taskId && row.details?.submissionId === body.submissionId);
    }
    // This immutable event is the receipt commit marker. Readers must require it.
    const acceptedId = recordId(...base, 'ACCEPTED');
    await insertOnce(COLLECTIONS.activity, {
      _id: acceptedId, title: acceptedId, description: body.orderId,
      action: 'ORDER_RECEIVED', activityTime: date(receivedAt, 'receipt time'), actorType: 'SYSTEM',
      initiatedByStaffId: body.submittedByStaffId, initiatedByStaffName: body.submittedByStaffName,
      message: 'All order lines, tasks and initial cost history persisted', result: 'ACCEPTED',
      details: { payloadHash, submissionId: body.submissionId, taskIds }
    }, row => row.details?.payloadHash === payloadHash);
    return { ok: true, destination: 'NCT', orderId: body.orderId, submissionId: body.submissionId,
      receiptId: acceptedId, masterReceivedAt: receivedAt, taskIds,
      costErrorTaskCount: body.lines.filter(line => costs[line.unitBarcode].costStatus === 'ERROR').length };
  };
}
