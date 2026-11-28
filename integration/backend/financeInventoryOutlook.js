import { projectStockCard } from 'backend/stockCardProjection.js';
import { sourceCost } from 'backend/stockValuationService.js';
import { readPhysicalOutflows } from 'backend/physicalOutflow.js';
import { projectPurchaseWorkspace, PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { confirmedPurchaseState } from 'backend/purchasePlan.js';
import { readSupportDesks } from 'backend/supportDesk.js';
import { deskTaskPortions } from 'backend/shortloadResolutionModel.js';

const quantity = n => Number.isSafeInteger(n) && n >= 0;
function instant(value) {
  const t = value == null ? NaN : new Date(value).getTime();
  if (!Number.isFinite(t)) throw Error('Historical timestamp requires review.');
  return t;
}

// Use the evidence available by end of day in Malaysia. Never pass a later
// version of a mutable CMS row to the original inventory projection.
function rowsAt(rows, end) {
  return rows.filter(row => {
    if (instant(row._createdDate) >= end) return false;
    if (instant(row._updatedDate) >= end) throw Error('Historical revision requires review.');
    return true;
  });
}
export function outlookPeriod(company, asOf, shipmentMonth) {
  if (!Object.hasOwn(PURCHASE_COLLECTIONS, company) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(shipmentMonth)) throw Error('Invalid report period.');
  const date = instant(asOf+'T00:00:00Z');
  if (new Date(date).toISOString().slice(0,10)!==asOf) throw Error('Invalid closing date.');
  return date + 16*60*60*1000;
}
export function outlookContextAt({company, orders, tasks, activity}, asOf, shipmentMonth) {
  const end = outlookPeriod(company, asOf, shipmentMonth);
  const events = rowsAt(activity, end).filter(e => instant(e.activityTime) < end);
  const orderRows = rowsAt(orders, end);
  const confirmedState = confirmedPurchaseState({company, tasks:rowsAt(tasks,end), activity:events});
  const workspace = projectPurchaseWorkspace({company, orders:orderRows, tasks:confirmedState.tasks, activity:events,
    confirmedState, suppliers:[], staff:{role:'FINANCE'}});
  return {context:{...workspace,activity:confirmedState.activity},orderRows};
}
export function financeInventoryOutlook(raw, asOf, shipmentMonth) {
  const {company}=raw;
  const {context,orderRows}=outlookContextAt(raw,asOf,shipmentMonth);
  return projectOrderOutlook(company, asOf, shipmentMonth, context, orderRows);
}
export function projectOrderOutlook(company, asOf, shipmentMonth, context, orderRows) {
  const card = projectStockCard(context);
  const flows = readPhysicalOutflows(context.activity);
  const desks = readSupportDesks(context.activity,company);
  const byId = new Map(context.tasks.map(task=>[task.id,task]));
  const held = new Map(), available = [], lines = [], review = [];
  for (const product of card.items) {
    for (const lot of product.sources) {
      if (lot.issues.length) throw Error('Warehouse source quantities require reconciliation.');
      const cost = sourceCost(byId.get(lot.sourceTaskId));
      const amount = qty => qty===0 ? 0 : cost.unit===null ? null : Math.round(qty*cost.unit*100);
      if (lot.available>0) available.push({barcode:product.barcode,product:product.name,packing:product.packing,
        source:lot.sourceTaskId,qty:lot.available,cents:amount(lot.available)});
      for (const claim of lot.reservations.filter(r=>r.remaining>0)) {
        const h=held.get(claim.taskId)||{qty:0,cents:0};
        const cents=amount(claim.remaining);
        h.qty+=claim.remaining;
        h.cents=h.cents==null||cents==null?null:h.cents+cents;
        held.set(claim.taskId,h);
      }
    }
  }
  for (const t of context.tasks.filter(t=>!t.specialPurchase&&!t.procurementSource)) {
    const order=orderRows.filter(o=>o.title===t.orderId && o.sourceLineId===t.sourceLineId && o.customerId===t.customerId);
    if(order.length!==1) throw Error('Order line identity requires review.');
    const owner=order[0];
    const stock=held.get(t.id)||{qty:0,cents:0};
    const shipped=flows.filter(f=>f.taskId===t.id).reduce((n,f)=>n+f.quantity,0);
    const remaining=t.requested-shipped;
    if (!quantity(t.requested)||!quantity(remaining)||stock.qty>remaining) throw Error('Order balance requires reconciliation.');
    if(!remaining) continue;
    const sources=context.tasks.filter(s=>s.id===t.id||s.customerDemandTaskId===t.id);
    let incoming=0;
    for(const s of sources.filter(s=>s.po)){
      const share=s.procurement.customerCtn,accepted=s.warehouse?.accepted??0;
      if(!quantity(share)||!quantity(accepted)) throw Error('Purchase order quantities require review.');
      if(!s.quantityCases?.some(c=>c.kind==='RECEIPT'&&c.decision?.supplierDeliveryDecision==='STOP'))
        incoming+=Math.max(0,share-accepted);
    }
    const desk=desks.find(d=>d.customerId===t.customerId);
    let date=t.estimatedShipmentDate;
    const months=new Set();
    if(t.batchEntitlements?.length || desk?.assignments.some(a=>a.taskId===t.id)){
      if(t.batchEntitlements?.length) {
        // Cost is pinned to source and order line. Never spread it across months
        // without explicit remaining lot-to-batch evidence.
        review.push({order:t.orderId,product:t.name,reason:'Shipment batch attribution requires review.'});continue;
      }
      for(const p of deskTaskPortions(context.activity,desk,t,flows).filter(p=>p.quantity>p.loaded)){
        const d=desk.shipments.find(s=>s.desk===p.desk)?.date||date;
        months.add(d?.slice(0,7)||'');
      }
      if(months.size===1) date=[...months][0];
      else {review.push({order:t.orderId,product:t.name,reason:'Split shipment dates require review.'});continue;}
    }
    if(!date){review.push({order:t.orderId,product:t.name,reason:'Shipment date not set.'});continue;}
    if(date.slice(0,7)!==shipmentMonth)continue;
    if(incoming+stock.qty>remaining){review.push({order:t.orderId,product:t.name,reason:'Open PO exceeds remaining unreserved demand.'});continue;}
    const sale=owner.sellingPricePc;
    lines.push({customer:owner.customerCompanyName,customerId:t.customerId,order:t.orderId,line:t.sourceLineId,product:t.name,
      barcode:t.barcode,packing:t.packing,date,qty:remaining,currency:owner.transactionCurrency,
      salesCents:Number.isFinite(sale)&&sale>=0&&quantity(t.ea)&&t.ea>0?Math.round(remaining*t.ea*sale*100):null,
      reserved:stock.qty,costCents:stock.cents,incoming,toArrange:remaining-stock.qty-incoming});
  }
  return {company,asOf,shipmentMonth,lines,available,review};
}
