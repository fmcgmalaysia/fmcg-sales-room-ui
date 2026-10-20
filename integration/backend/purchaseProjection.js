// Explicit procurement projection. Never return original order rows or intake snapshots.
import { readSalesShipmentDate } from 'backend/customerShipmentPlan.js';
import { taskEditVersion, acceptedSpecialTask } from 'backend/purchaseTaskIdentity.js';
import { readPurchasePlan, readPurchaseShares } from 'backend/purchasePlan.js';
import { readWarehouseTask } from 'backend/warehouseReceiving.js';
import { readAllocations, allocationVersion } from 'backend/plannerAllocation.js';
import { readShortage, shortageVersion } from 'backend/purchaseShortage.js';
import { projectQuantityCases, quantityCasesVersion, customerCaseFeedback } from 'backend/purchaseQuantityCases.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readShipmentPlans } from 'backend/customerShipmentPlan.js';
import { readCreditTransfers } from 'backend/supplierCredit.js';
import { acceptedPurchaseSource, attachPurchaseSourceTotals, purchaseSourcesVersion } from 'backend/purchaseSources.js';
const text = value => String(value ?? '').trim();
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stamp = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
export const PURCHASE_COLLECTIONS = Object.freeze({
  NCT: { orders: 'NCTOrders', tasks: 'NCTTasks', activity: 'NCTActivity' },
  GHR: { orders: 'NCTOrders1', tasks: 'NCTTasks1', activity: 'NCTActivity1' }
});
export function requirePurchaseStaff(member, records) {
  const email = text(member?.loginEmail).toLowerCase();
  if (!member?._id || !email || member.status !== 'APPROVED') throw Error('Please sign in with your approved Master staff account.');
  const matches = records.filter(row => text(row.staffEmail).toLowerCase() === email);
  if (matches.length !== 1) throw Error('Master staff access is not configured.');
  const row = matches[0], role = text(row.role).toUpperCase();
  const departments = Array.isArray(row.departments) ? row.departments.map(value => text(value).toUpperCase()) : [];
  if (!text(row.title) || text(row.description) !== member._id || !text(row.staffName) || text(row.staffStatus).toUpperCase() !== 'ACTIVE' ||
      !(departments.includes('PURCHASE') || role === 'SUPER ADMIN' || role === 'TOP MANAGEMENT')) throw Error('Purchase access is not authorized.');
  return { staffId: text(row.title), staffName: text(row.staffName), role };
}
export function projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff }) {
  if (!PURCHASE_COLLECTIONS[company]) throw Error('Select NCT or GHR.');
  const accepted = new Map();
  for (const event of activity) {
    if (event.action !== 'ORDER_RECEIVED' || event.result !== 'ACCEPTED') continue;
    const orderId = text(event.description), submissionId = text(event.details?.submissionId), ids = event.details?.taskIds;
    if (!orderId || !submissionId || !Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw Error('Master receipt requires review.');
    if (accepted.has(orderId)) throw Error('Duplicate Master receipt requires review.');
    accepted.set(orderId, { submissionId, ids: new Set(ids), receivedAt: stamp(event.activityTime) });
  }
  const rows = [], seen = new Set(), customers = new Map(), allocations=readAllocations(activity);
  for (const task of tasks) {
    const receipt = accepted.get(text(task.description));
    if (!receipt) continue;
    const specialEvent=activity.filter(event=>event.action==='SPECIAL_PURCHASE_ADDED'&&event.imageAltText===task.title&&event.result==='SAVED');
    const sourceEvent=activity.filter(event=>event.action==='PURCHASE_SOURCE_ADDED'&&event.imageAltText===task.title&&event.result==='SAVED');
    if(!receipt.ids.has(text(task.title)) && specialEvent.length!==1 && sourceEvent.length!==1) continue;
    if (seen.has(task.title)) throw Error('Duplicate task identity requires review.');
    const matched = orders.filter(row => row.title === task.description && row.sourceLineId === task.imageAltText && row.submissionId === receipt.submissionId);
    if (matched.length !== 1) throw Error('Accepted task has no unique order line.');
    const order = matched[0];
    if(!receipt.ids.has(text(task.title)) && !acceptedSpecialTask(task,order,receipt,specialEvent[0],tasks.find(row=>row.title===specialEvent[0]?.details?.parentTaskId)) && !acceptedPurchaseSource(task,order,receipt,sourceEvent[0],tasks.find(row=>row.title===task.customerDemandTaskId))) continue;
    if (!text(order.customerId) || !text(order.customerCompanyName) || !text(order.description) || !text(order.image)) throw Error('Accepted product identity is incomplete.');
    seen.add(task.title);
    customers.set(order.customerId, { id: order.customerId, name: order.customerCompanyName });
    const snapshot = task.latestCostReference || task.originalCostSnapshot || {};
    const procurement=readPurchasePlan(task,activity),warehouse=readWarehouseTask(task,activity);
    const shipmentDate=readSalesShipmentDate(task.description,order.customerId,order.submissionId,order.estimatedShipmentDate,activity);
    rows.push({
      procurementSource:task.procurementSource===true,customerDemandTaskId:task.procurementSource?task.customerDemandTaskId:null,
      id: task.title, qtyEdited: activity.some(event=>event.imageAltText===task.title&&event.action==='PURCHASE_QTY_REDUCED'&&event.result==='SAVED'), editVersion:taskEditVersion(task), orderId: task.description, sourceLineId: task.imageAltText,
      customerId: order.customerId, barcode: order.description, name: order.image, packing: text(order.imageAltText), brandName:text(snapshot.brandName),
      ea: number(order.orderId), ord: number(task.purchaseQtyInCtn), requested: task.specialPurchase&&specialEvent.length===1?number(specialEvent[0].details?.extraQty):number(order.orderQtyInCtn), inc: warehouse?warehouse.customerReceived:number(task.receivedQtyInCtn),
      procurement: {...procurement,updatedAt:stamp(procurement.updatedAt),expectedExtra:procurement.extraCtn??(procurement.totalCtn===null?null:Math.max(0,procurement.totalCtn-task.purchaseQtyInCtn)),availableCtn:warehouse?(warehouse.stock?.usableReceived??warehouse.accepted)-(allocations.find(row=>row.sourceTaskId===task.title)?.targets||[]).reduce((sum,row)=>sum+row.quantity,0):null,allocationEnabled:Boolean(warehouse?.accepted)},
      warehouse:warehouse?{hasPhysicalReceipt:warehouse.hasPhysicalReceipt,accepted:warehouse.accepted,rejected:warehouse.rejected,issue:warehouse.issue,stock:warehouse.stock,updatedAt:warehouse.at}:null,
      supplierId: text(task.supplierId), po: text(task.ourPoNumber), customerPo: text(order.customerPoNumber), salesInvoiceNumber: text(order.salesInvoiceNumber), salesInvoiceLocked: Boolean(text(order.financialLockedBy)),
      transactionCurrency: text(order.transactionCurrency), costCurrency: 'MYR',
      lpPc: number(task.lpPc), lpCtn: number(task.lpCtn), disc1: number(task.disc1), disc2: number(task.disc2), disc3: number(task.disc3),
      netCostCtn: ['lpCtn','disc1','disc2','disc3'].every(key=>number(task[key])!==null)?Number((task.lpCtn*(1-task.disc1)*(1-task.disc2)-task.disc3).toFixed(2)):number(snapshot.netCostCtn), cbmPerCtn: number(order.cbmCtn),
      costStatus: text(task.costStatus), costErrorReason: text(task.costErrorReason), costCapturedAt: stamp(task.lastCostCaptureTime),
      manualCostField:Array.isArray(task.manualCostField)?task.manualCostField:[],
      stage: text(task.purchaseStage), risk: task.risk === true, riskReason: text(task.riskReason),
      archived: task.purchaseStage === 'SHIPPED' && Boolean(text(order.salesInvoiceNumber)),
      specialPurchase: task.specialPurchase === true, specialPurchaseReason: text(task.specialPurchaseReason),
      rowPosition: number(task.rowPosition), masterReceivedAt: stamp(order.masterReceivedTime) || receipt.receivedAt,
      submittedAt: stamp(order.salesSubmissionTime), submittedByName: text(order.submittedByStaffName),
      estimatedShipmentDate: shipmentDate.date || null,
      shipmentDate,
      history: activity.filter(event => event.description === task.description &&
        ['ORDER_RECEIVED', 'COST_CAPTURE', 'COST_RETRY_ATTEMPT', 'COST_RETRY_CAPTURED', 'COST_RETRY_RESULT','PURCHASE_PRICE_SAVED','PURCHASE_AVERAGE_COST_APPLIED','PURCHASE_PLAN_SAVED','PURCHASE_ROW_MOVED','PURCHASE_PO_ASSIGNED','PURCHASE_QTY_REDUCED','SPECIAL_PURCHASE_ADDED','PURCHASE_SOURCE_ADDED'].includes(event.action) &&
        (event.imageAltText === task.title || event.action === 'ORDER_RECEIVED')).map(event => ({
          id: text(event.title), action: text(event.action), time: stamp(event.activityTime),
          requestId: text(event.details?.requestId), retryOutcome: event.action === 'COST_RETRY_RESULT' ? {
            ok: event.details?.outcome?.ok === true, error: text(event.details?.outcome?.error)
          } : null,
          actor: event.actorType === 'SYSTEM' ? 'System' : text(event.initiatedByStaffName),
          initiatedBy: text(event.initiatedByStaffName), result: text(event.result), message: text(event.message)
          ,changes:['PURCHASE_PRICE_SAVED','PURCHASE_AVERAGE_COST_APPLIED','PURCHASE_PLAN_SAVED','PURCHASE_ROW_MOVED','PURCHASE_PO_ASSIGNED','PURCHASE_QTY_REDUCED'].includes(event.action)?{before:event.details?.before??null,after:event.details?.after??null,reason:text(event.details?.reason),...(event.action==='PURCHASE_AVERAGE_COST_APPLIED'?{calculation:event.details?.calculation}:{} )}:event.action==='SPECIAL_PURCHASE_ADDED'?{parentTaskId:text(event.details?.parentTaskId),extraQty:number(event.details?.extraQty),reason:text(event.details?.reason)}:null
        })).sort((a, b) => String(a.time).localeCompare(String(b.time)))
    });
  }
  const invoicedShipments=readCustomerShipments(activity).filter(shipment=>shipment.company===company&&['INVOICED','DISPATCHED'].includes(shipment.status));
  for(const row of rows.filter(row=>row.procurementSource)){row.requested=0;row.procurement.expectedExtra=row.procurement.extraCtn??0;}
  attachPurchaseSourceTotals(rows);
  for(const root of rows.filter(row=>!row.procurementSource&&!row.specialPurchase)){
    const sources=rows.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id);
    const fixed=readPurchaseShares(root.id,activity);
    if(fixed.shares){if(fixed.shares.length!==sources.length)throw Error('Supplier allocation save requires confirmation. Retry the original request.');for(const source of sources){const share=fixed.shares.find(item=>item.taskId===source.id);if(!share||share.totalCtn!==(source.procurement.totalCtn||0))throw Error('Supplier allocation save requires confirmation. Retry the original request.');/** @type {typeof source.procurement & {customerCtn:number}} */ (source.procurement).customerCtn=share.customerCtn;source.procurement.expectedExtra=share.totalCtn-share.customerCtn;}/** @type {typeof root & {sourcing:{unplacedCtn:number}}} */ (root).sourcing.unplacedCtn=Math.max(0,root.ord-fixed.shares.reduce((sum,share)=>sum+share.customerCtn,0));continue;}
    if(!sources.some(row=>row.procurement.totalCtn>0))continue;
    let extra=Math.max(0,sources.reduce((sum,row)=>sum+(row.procurement.totalCtn||0),0)-root.ord);
    for(const source of sources.filter(row=>row.procurementSource)){source.procurement.expectedExtra=Math.min(extra,source.procurement.extraCtn||0);extra-=source.procurement.expectedExtra;}
    root.procurement.expectedExtra=extra;
  }
  for(const row of rows){const invoices=invoicedShipments.filter(shipment=>shipment.lines.some(line=>line.taskId===row.id));row.salesFulfilment={invoicedQty:invoices.reduce((sum,shipment)=>sum+shipment.lines.find(line=>line.taskId===row.id).quantity,0),invoices:invoices.map(shipment=>({shipmentId:shipment.id,number:shipment.invoice.number,date:shipment.invoice.date,quantity:shipment.lines.find(line=>line.taskId===row.id).quantity,at:shipment.invoice.at,dispatched:shipment.status==='DISPATCHED'})),sourceInvoicedQty:invoicedShipments.flatMap(shipment=>shipment.lines).flatMap(line=>line.sources).filter(source=>source.sourceTaskId===row.id).reduce((sum,source)=>sum+source.quantity,0)};}
  for(const row of rows){row.shortage=readShortage(row.id,activity);row.shortageVersion=shortageVersion(row,activity);row.demandReviewRequired=activity.some(event=>event.imageAltText===row.id&&event.action==='PURCHASE_QTY_REDUCED'&&event.result==='SAVED'&&event.details?.authorizedRole!=='SUPER ADMIN');}
  const quantityCases=projectQuantityCases({company,tasks:rows},activity);
  for(const row of rows){
    row.quantityCases=quantityCases.filter(item=>item.taskId===row.id);
    const related=quantityCases.filter(item=>item.customerDemandTaskId===(row.customerDemandTaskId||row.id));
    if(related.some(item=>item.revision)){
      const feedback=customerCaseFeedback(related),receipt=row.quantityCases.find(item=>item.kind==='RECEIPT');
      row.shortage={...feedback,supplierDecision:receipt?.decision?.supplierDecision||'PENDING',financeRequired:Boolean(receipt),scopedCases:true};
    }
  }
  for (const receipt of accepted.values()) if ([...receipt.ids].some(id => !seen.has(id))) throw Error('Accepted receipt is missing a task. Please contact Admin.');
  rows.sort((a, b) => a.customerId.localeCompare(b.customerId) || (a.rowPosition ?? Infinity) - (b.rowPosition ?? Infinity) || String(a.masterReceivedAt).localeCompare(String(b.masterReceivedAt)) ||
    a.orderId.localeCompare(b.orderId) || a.id.localeCompare(b.id));
  return {
    company, staff: { staffId: staff.staffId, staffName: staff.staffName, memberId:staff.memberId, canEditCustomerDemand:staff.role==='SUPER ADMIN' }, fetchedAt: new Date().toISOString(),sourcesVersion:purchaseSourcesVersion({company,tasks:rows}),allocationVersion:allocationVersion({company,tasks:rows},activity),allocations,creditTransfers:readCreditTransfers(activity),
    customers: [...customers.values()].sort((a, b) => a.name.localeCompare(b.name)), tasks: rows,quantityCasesVersion:quantityCasesVersion({company,tasks:rows},activity),
    suppliers: suppliers.map(row => ({ id: text(row.title), name: text(row.companyName), shortName: text(row.shortName), brands:Array.isArray(row.brands)?row.brands.filter(value=>typeof value==='string').map(text):[] }))
      .filter(row => row.id && row.name).sort((a, b) => a.name.localeCompare(b.name)),
    shipmentPlans: readShipmentPlans(activity),
    paymentRequestsConnected: false
  };
}
