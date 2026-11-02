import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { partialInvoiceMargin } from 'backend/partialInvoiceMargin.js';
import { randomBytes } from 'crypto';
import { operationId, canonical } from 'backend/purchaseOperationJournal.js';
import { taskEditVersion } from 'backend/purchaseTaskIdentity.js';
import { calculateGrossProfitMargin, calculateNetCartonCost } from 'backend/grossProfitMargin.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function openSourceCost(row, task, tasks, workspace, invoiceLines = []) {
  const sources = workspace.tasks.filter(source => source.id === row.id || !row.procurementSource && source.customerDemandTaskId === row.id);
  let quantity = 0, amount = 0;
  for (const source of sources) {
    const invoiced = invoiceLines.flatMap(line => line.costSources || []).filter(part => part.sourceTaskId === source.id).reduce((sum, part) => sum + part.quantity, 0);
    const plan=source.procurement,customerQuantity=plan?.customerCtn??((plan?.totalCtn||0)-(plan?.expectedExtra||0));
    const remaining = Math.max(0, customerQuantity - invoiced);
    if (!remaining) continue;
    if (!(plan?.revision||source.po)||!Number.isSafeInteger(plan?.totalCtn)||plan.totalCtn<=0) return null;
    const raw = tasks.find(item => item.title === source.id),costing=plan.costing;
    const cost = costing?(Number.isSafeInteger(costing.amountCents)&&costing.amountCents>0&&costing.totalCtn===plan.totalCtn?costing.amountCents/100/plan.totalCtn:null):raw?calculateNetCartonCost(raw):null;
    if (!finite(cost)||cost<0) return null;
    quantity += remaining; amount += remaining * cost;
  }
  const demand=row.procurementSource?(row.procurement?.customerCtn??((row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0))):row.shortage?.customerDecision==='STOP'?(row.inc||0):row.ord,openQuantity=demand-invoiceLines.reduce((sum,line)=>sum+line.quantity,0);
  return Number.isSafeInteger(openQuantity)&&openQuantity>0&&quantity>=openQuantity ? amount / quantity : null;
}
function marginValue({row,order,task,invoiceLines,quantity},tasks,workspace,rateToMyr){
 const cost=openSourceCost(row,task,tasks,workspace,invoiceLines);
 return invoiceLines?partialInvoiceMargin({quantity,invoiceLines,sellingPricePc:order.sellingPricePc,eaPerCtn:order.orderId,netCostCtn:cost,rateToMyr}):calculateGrossProfitMargin({sellingPricePc:order.sellingPricePc,eaPerCtn:order.orderId,netCostCtn:cost,rateToMyr});
}
// Display-only arithmetic over existing inputs: no transport, store or cache dependency.
export function readPurchaseMargins({company,orders,tasks,workspace,activity=[]}){
 const result=new Map(),invoices=readCustomerShipments(activity).filter(row=>row.company===company&&['INVOICED','DISPATCHED'].includes(row.status)),locks=new Set(activity.map(row=>row._id));
 for(const root of workspace.tasks.filter(row=>!row.procurementSource)){
  const group=workspace.tasks.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id),order=orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId);
  const blocked=!order||!group.some(row=>row.po);
  const invoiceLines=invoices.flatMap(shipment=>shipment.lines.filter(line=>line.taskId===root.id));
  for(const row of [root,...group.map(source=>({...source,procurementSource:true}))]){
   const key=row.procurementSource?'SOURCE:'+row.id:row.id;result.set(key,null);
   if(blocked||row.procurementSource&&!row.po||(row.procurementSource?[row]:group).some(source=>locks.has(operationId(company,source.id,'COST_LOCK'))||locks.has(operationId(company,source.id,'GP_LOCK'))))continue;
   if(!invoiceLines.length&&String(order.salesInvoiceNumber||'').trim()){
    if(!row.procurementSource&&String(order.financialLockedBy||'').trim()&&finite(order.gp))result.set(key,order.gp);
    continue;
   }
   const relevant=row.procurementSource?invoiceLines.map(line=>{const parts=(line.costSources||[]).filter(part=>part.sourceTaskId===row.id);return {...line,quantity:parts.reduce((n,part)=>n+part.quantity,0),costSources:parts};}).filter(line=>line.quantity>0):invoiceLines;
   const quantity=row.procurementSource?(row.procurement?.customerCtn??((row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0))):row.shortage?.customerDecision==='STOP'?(row.inc||0):row.ord;
   if(quantity>relevant.reduce((n,line)=>n+line.quantity,0)&&group.filter(source=>!row.procurementSource||source.id===row.id).some(source=>!source.po))continue;
   result.set(key,marginValue({row,order,task:tasks.find(item=>item.title===row.id),quantity,...(relevant.length?{invoiceLines:relevant}:{})},tasks,workspace,order.adminFxSource));
  }
 }
 return result;
}
// Existing SI save confirmation only; page reads use readPurchaseMargins.
export function createPurchaseMarginRefresh({ store, readRates, now = () => new Date() }) {
  return async ({ company, names, orders, tasks, workspace, activity=[] }) => {
    const results = new Map(), open = [], sourceChecks = [], invoices=readCustomerShipments(activity).filter(row=>row.company===company&&['INVOICED','DISPATCHED'].includes(row.status));
    for (const row of workspace.tasks.flatMap(item => item.procurementSource ? [item] : [item, {...item, procurementSource:true}])) {
      const resultId=row.procurementSource?'SOURCE:'+row.id:row.id;
      const order = orders.find(item => item.title === row.orderId && item.sourceLineId === row.sourceLineId);
      const task = tasks.find(item => item.title === row.id);
      if (!order || !task) continue;
      const invoiceLines=invoices.flatMap(shipment=>shipment.lines.filter(line=>line.taskId===(row.customerDemandTaskId||row.id))),quantity=row.procurementSource?(row.procurement?.customerCtn??((row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0))):row.shortage?.customerDecision==='STOP'?(row.inc||0):row.ord;
      if(row.procurementSource){
        const sourceInvoices=invoiceLines.map(line=>{const parts=(line.costSources||[]).filter(part=>part.sourceTaskId===row.id);return {...line,quantity:parts.reduce((sum,part)=>sum+part.quantity,0),costSources:parts};}).filter(line=>line.quantity>0);
        if(!sourceInvoices.length&&String(order.salesInvoiceNumber||'').trim())results.set(resultId,null);
        else open.push({row,order,task,quantity,...(sourceInvoices.length?{invoiceLines:sourceInvoices}:{})});
        continue;
      }
      if(invoiceLines.length){
        const invoiceSummary=invoices.filter(shipment=>shipment.lines.some(line=>line.taskId===row.id)).map(shipment=>({
          number:shipment.invoice.number,date:shipment.invoice.date,currency:shipment.invoice.currency,
          invoiceAmountCents:shipment.invoice.amountCents,quantity:shipment.lines.find(line=>line.taskId===row.id).quantity,
          rateToMyr:shipment.invoice.rateToMyr,at:shipment.invoice.at,by:shipment.invoice.by,byStaffId:shipment.invoice.byStaffId
        }));
        open.push({row,order,task,invoiceLines,quantity,invoiceSummary});continue;
      }
      if (String(order.salesInvoiceNumber || '').trim()) {
        results.set(resultId, String(order.financialLockedBy || '').trim() && finite(order.gp) ? order.gp : null);
      } else open.push({ row, order, task });
    }
    let rates;
    try { rates = open.length ? await readRates([...new Set(open.map(({ order }) => order.transactionCurrency))]) : []; }
    catch (_) { rates=[]; }
    for (const { row, order, task, invoiceLines, quantity, invoiceSummary } of open) {
      const matches = rates.filter(rate => rate.currency === order.transactionCurrency);
      const rate = matches.length === 1 ? matches[0] : null, cost = openSourceCost(row, task, tasks, workspace, invoiceLines);
      const gp = marginValue({row,order,task,invoiceLines,quantity},tasks,workspace,rate?.rateToMyr);
      const resultId=row.procurementSource?'SOURCE:'+row.id:row.id;
      results.set(resultId, gp);
      if(row.procurementSource){
        if(gp===null)continue;
        sourceChecks.push(async()=>{try{const current=await store.read(names.tasks,task._id),currentOrder=await store.read(names.orders,order._id);
          if(!current||taskEditVersion(current)!==taskEditVersion(task)||!currentOrder||currentOrder.sellingPricePc!==order.sellingPricePc||currentOrder.orderId!==order.orderId||currentOrder.transactionCurrency!==order.transactionCurrency||String(currentOrder.salesInvoiceNumber||'')!==String(order.salesInvoiceNumber||'')||await store.read(names.activity,operationId(company,task.title,'COST_LOCK')))results.set(resultId,null);
        }catch(_){results.set(resultId,null);}});
        continue;
      }
      const hasOpenQuantity=invoiceLines?quantity>invoiceLines.reduce((sum,line)=>sum+line.quantity,0):true;
      const cachedRate=hasOpenQuantity?rate?.rateToMyr:order.adminFxSource;
      if (gp === null || (order.gp === gp && order.adminFxSource === cachedRate &&
          (!invoiceSummary||canonical(order.salesInvoiceSummary||[])===canonical(invoiceSummary)))) continue;
      const lockId = operationId(company, task.title, 'GP_LOCK'), requestId = randomBytes(16).toString('hex');
      let held = false;
      try {
        if (await store.read(names.activity, lockId) || await store.read(names.activity, operationId(company, task.title, 'COST_LOCK'))) { results.set(row.id, null); continue; }
        await store.insert(names.activity, { _id: lockId, title: lockId, description: order.title, activityTime: now(), details: { requestId, actorMemberId: 'SYSTEM_GP' } });
        held = true;
        let sourceChanged = false;
        for (const source of workspace.tasks.filter(item => item.customerDemandTaskId === row.id)) {
          const before = tasks.find(item => item.title === source.id), current = before && await store.read(names.tasks, before._id);
          if (!current || taskEditVersion(current) !== taskEditVersion(before) || await store.read(names.activity, operationId(company, source.id, 'COST_LOCK'))) { sourceChanged = true; break; }
        }
        if (sourceChanged) { results.set(row.id, null); continue; }
        const currentTask = await store.read(names.tasks, task._id), currentOrder = await store.read(names.orders, order._id);
        if (!currentTask || !currentOrder || taskEditVersion(currentTask) !== taskEditVersion(task) ||
            currentOrder.title !== order.title || currentOrder.sourceLineId !== order.sourceLineId || currentOrder.customerId !== order.customerId ||
            (invoiceLines?String(currentOrder.salesInvoiceNumber||'')!==String(order.salesInvoiceNumber||''):String(currentOrder.salesInvoiceNumber || '').trim()) || currentOrder.sellingPricePc !== order.sellingPricePc ||
            currentOrder.orderId !== order.orderId || currentOrder.transactionCurrency !== order.transactionCurrency) { results.set(row.id, null); continue; }
        if(currentOrder.gp===gp&&currentOrder.adminFxSource===cachedRate&&(!invoiceSummary||canonical(currentOrder.salesInvoiceSummary||[])===canonical(invoiceSummary)))continue;
        // The SI business event already preserves financial evidence.
        await store.update(names.orders, { ...currentOrder, gp, adminFxSource: cachedRate,
          ...(invoiceSummary?{salesInvoiceSummary:invoiceSummary}: {}) });
      } catch (_) { results.set(row.id, null); }
      finally { if (held) { try { const lock = await store.read(names.activity, lockId); if (lock?.details?.requestId === requestId) await store.remove(names.activity, lockId); } catch (_) { results.set(row.id, null); } } }
    }
    // Only independent read validations overlap; GP writes and their locks stay serial.
    for(let i=0;i<sourceChecks.length;i+=4)await Promise.all(sourceChecks.slice(i,i+4).map(check=>check()));
    return results;
  };
}
