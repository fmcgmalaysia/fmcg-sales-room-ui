import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { partialInvoiceMargin } from 'backend/partialInvoiceMargin.js';
import { randomBytes } from 'crypto';
import { operationId, canonical } from 'backend/purchaseOperationJournal.js';
import { taskEditVersion } from 'backend/purchaseTaskIdentity.js';
import { calculateGrossProfitMargin, calculateNetCartonCost } from 'backend/grossProfitMargin.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function openSourceCost(row, task, tasks, workspace, invoiceLines = [], requirePo=false) {
  const sources = workspace.tasks.filter(source => source.id === row.id || !row.procurementSource && source.customerDemandTaskId === row.id);
  let quantity = 0, amount = 0;
  for (const source of sources) {
    const invoiced = invoiceLines.flatMap(line => line.costSources || []).filter(part => part.sourceTaskId === source.id).reduce((sum, part) => sum + part.quantity, 0);
    const plan=source.procurement,customerQuantity=plan?.customerCtn??((plan?.totalCtn||0)-(plan?.expectedExtra||0));
    const remaining = Math.max(0, customerQuantity - invoiced);
    if (!remaining) continue;
    if(requirePo&&!source.po)return null;
    if (!(plan?.revision||source.po)||!Number.isSafeInteger(plan?.totalCtn)||plan.totalCtn<=0) return null;
    const raw = tasks.find(item => item.title === source.id),costing=plan.costing;
    const cost = costing?(Number.isSafeInteger(costing.amountCents)&&costing.amountCents>0&&costing.totalCtn===plan.totalCtn?costing.amountCents/100/plan.totalCtn:null):raw?calculateNetCartonCost(raw):null;
    if (!finite(cost)||cost<0) return null;
    quantity += remaining; amount += remaining * cost;
  }
  const demand=row.procurementSource?(row.procurement?.customerCtn??((row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0))):row.shortage?.customerDecision==='STOP'?(row.inc||0):row.ord,openQuantity=demand-invoiceLines.reduce((sum,line)=>sum+line.quantity,0);
  return Number.isSafeInteger(openQuantity)&&openQuantity>0&&quantity>=openQuantity ? amount / quantity : null;
}
// GP is calculated only after confirmed business saves; page reads never calculate or write.
// Financial input identity excludes dates, display order, document/payment states and cached GP.
export function purchaseMarginBasis({company,orders,tasks,workspace,activity=[],marginShipments},rootId){
 const root=workspace.tasks.find(row=>row.id===rootId&&!row.procurementSource),order=root&&orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId);if(!root||!order)return null;
 const sources=workspace.tasks.filter(row=>row.id===rootId||row.customerDemandTaskId===rootId).map(row=>{const raw=tasks.find(item=>item.title===row.id),plan=row.procurement;return {id:row.id,po:Boolean(row.po),quantity:plan?.customerCtn??((plan?.totalCtn||0)-(plan?.expectedExtra||0)),total:plan?.totalCtn??null,cost:plan?.costing?{totalCtn:plan.costing.totalCtn,amountCents:plan.costing.amountCents,paidCtn:plan.costing.paidCtn,freeCtn:plan.costing.freeCtn,prices:plan.costing.prices}:null,prices:plan?.costing?null:[raw?.lpCtn??null,raw?.disc1??null,raw?.disc2??null,raw?.disc3??null]};}).sort((a,b)=>a.id.localeCompare(b.id));
 const invoices=(marginShipments||readCustomerShipments(activity)).filter(row=>row.company===company&&['INVOICED','DISPATCHED'].includes(row.status)&&row.lines.some(line=>line.taskId===rootId)).map(row=>({id:row.id,invoice:row.invoice,lines:row.lines.filter(line=>line.taskId===rootId)})).sort((a,b)=>a.id.localeCompare(b.id));
 return canonical({company,rootId,sellingPricePc:order.sellingPricePc,ea:order.orderId,currency:order.transactionCurrency,quantity:root.shortage?.customerDecision==='STOP'?(root.inc||0):root.ord,sources,invoices});
}
export function readPurchaseMarginCache(context){
 const result=new Map(),{company,orders,tasks,workspace,activity=[]}=context,shipments=context.marginShipments||readCustomerShipments(activity),basisContext={...context,marginShipments:shipments};
 for(const root of workspace.tasks.filter(row=>!row.procurementSource)){
  const group=workspace.tasks.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id),order=orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId),basis=purchaseMarginBasis(basisContext,root.id);
  result.set(root.id,null);for(const source of group)result.set('SOURCE:'+source.id,null);
  if(!order||!group.some(row=>row.po)||group.some(row=>activity.some(event=>event._id===operationId(company,row.id,'COST_LOCK')||event._id===operationId(company,row.id,'GP_LOCK'))))continue;
  const snapshot=order.gpSnapshot;
  if(snapshot?.schema===1){if(snapshot.basis!==basis||snapshot.gp!==order.gp)continue;result.set(root.id,finite(snapshot.gp)?snapshot.gp:null);for(const source of group)if(source.po&&finite(snapshot.sources?.[source.id]))result.set('SOURCE:'+source.id,snapshot.sources[source.id]);continue;}
  // Legacy records are initialized explicitly, never repaired by a customer/page read.
 }
 return result;
}
export function createPurchaseMarginRefresh({ store, readRates, now = () => new Date() }) {
  return async ({ company, names, orders, tasks, workspace, activity=[], saveSnapshot=false, triggerId='', initializeOnly=false }) => {
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
    const evaluations=open.map(entry=>{const {row,order,task,invoiceLines,quantity,invoiceSummary}=entry;
      const matches = rates.filter(rate => rate.currency === order.transactionCurrency);
      const rate = matches.length === 1 ? matches[0] : null, cost = openSourceCost(row, task, tasks, workspace, invoiceLines, saveSnapshot);
      const gp = invoiceLines?partialInvoiceMargin({quantity,invoiceLines,sellingPricePc:order.sellingPricePc,eaPerCtn:order.orderId,netCostCtn:cost,rateToMyr:rate?.rateToMyr}):calculateGrossProfitMargin({ sellingPricePc: order.sellingPricePc, eaPerCtn: order.orderId, netCostCtn: cost, rateToMyr: rate?.rateToMyr });
return {...entry,rate,cost,gp};});
    for (const { row, order, task, invoiceLines, quantity, invoiceSummary, rate, cost, gp } of evaluations) {
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
      const snapshot=saveSnapshot?{schema:1,rateToMyr:cachedRate,basis:purchaseMarginBasis({company,orders,tasks,workspace,activity,marginShipments:invoices},row.id),gp,sources:Object.fromEntries(evaluations.filter(item=>item.row.procurementSource&&(item.row.id===row.id||item.row.customerDemandTaskId===row.id)).map(item=>[item.row.id,item.gp]))}:null;
      if(initializeOnly&&(!finite(order.gp)||gp!==order.gp))continue;
      const sameSnapshot=value=>!saveSnapshot||canonical(value.gpSnapshot)===canonical(snapshot);
      if ((gp === null&&(!snapshot||!Object.values(snapshot.sources).some(finite))) || (sameSnapshot(order)&&order.gp === gp && order.adminFxSource === cachedRate &&
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
        if(initializeOnly&&currentOrder.gp!==order.gp)continue;
        if(sameSnapshot(currentOrder)&&currentOrder.gp===gp&&currentOrder.adminFxSource===cachedRate&&(!invoiceSummary||canonical(currentOrder.salesInvoiceSummary||[])===canonical(invoiceSummary)))continue;
        const at = now(), eventId = saveSnapshot?operationId(company,row.id,triggerId,operationId(snapshot.basis),'GP'):operationId(company, requestId, 'GP');
        const recorded=saveSnapshot?await store.read(names.activity,eventId):null;
        if(recorded&&(canonical(recorded.details?.after)!==canonical({gp,rateToMyr:cachedRate})||recorded.details?.marginBasis!==snapshot.basis))throw Error('GP save receipt requires review.');
        // Preserve evidence before caching. No customer-facing selling/FX fields are projected.
        if(!recorded)await store.insert(names.activity, { _id: eventId, title: eventId, description: order.title, image: order.sourceLineId, imageAltText: task.title,
          action: initializeOnly?'GP_CACHE_INITIALIZED':'GP_RECALCULATED', result: 'CALCULATED', actorType: 'SYSTEM', activityTime: at,
          message: initializeOnly?'Confirmed GP cache initialized without changing financial values':invoiceLines?'Margin combines locked invoice portions and current open quantity':'Open transaction margin calculated with current Admin FX', details: { requestId, ...(saveSnapshot?{triggerRequestId:triggerId,marginBasis:snapshot.basis}:{}), before: { gp: currentOrder.gp ?? null, rateToMyr: currentOrder.adminFxSource ?? null },
            after: { gp, rateToMyr: cachedRate }, currency: order.transactionCurrency, fxUpdatedAt: rate?.updatedAt || null, netCostCtn: cost,
            ...(invoiceSummary?{invoices:invoiceSummary,openQuantity:quantity-invoiceLines.reduce((sum,line)=>sum+line.quantity,0)}:{}) } });
        await store.update(names.orders, initializeOnly?{...currentOrder,gpSnapshot:snapshot}:{ ...currentOrder, gp, adminFxSource: cachedRate, ...(snapshot?{gpSnapshot:snapshot}:{}),
          ...(invoiceSummary?{salesInvoiceSummary:invoiceSummary}: {}) });
      } catch (_) { results.set(row.id, null); }
      finally { if (held) { try { const lock = await store.read(names.activity, lockId); if (lock?.details?.requestId === requestId) await store.remove(names.activity, lockId); } catch (_) { results.set(row.id, null); } } }
    }
    // Only independent read validations overlap; GP writes and their locks stay serial.
    for(let i=0;i<sourceChecks.length;i+=4)await Promise.all(sourceChecks.slice(i,i+4).map(check=>check()));
    return results;
  };
}

// This is a derived-cache follow-up to an already confirmed business save, never a read hook.
export function createPurchaseMarginCommit({store,readRates,now=()=>new Date()}){
 const inFlight=new Map();
 const execute=async({company,staff,requestId,result,taskIds=[],context,requireCustomerMargin=false})=>{
  if(result?.ok!==true||!PURCHASE_COLLECTIONS[company])return result;
  try{
   const names=PURCHASE_COLLECTIONS[company];
   if(!context){const [orders,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]);context={company,names,orders,tasks,activity,workspace:projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff})};}
   const ids=new Set(taskIds.filter(id=>typeof id==='string')),known=new Set(context.workspace.tasks.map(row=>row.id));
   const prepared=await store.read(names.activity,operationId(company+'/PURCHASE',requestId,staff.memberId));
   const collect=(value,depth=0)=>{if(depth>20)return;if(typeof value==='string'){if(known.has(value))ids.add(value);}else if(Array.isArray(value)){for(const item of value)collect(item,depth+1);}else if(value&&typeof value==='object')for(const item of Object.values(value))collect(item,depth+1);};
   if(prepared?.details?.actorMemberId===staff.memberId||prepared?.details?.memberId===staff.memberId)collect(prepared.details.plan);
   for(const event of context.activity.filter(row=>row.details?.requestId===requestId&&row.initiatedByStaffId===staff.staffId)){collect(event.imageAltText);collect(event.details);}
   const old=readPurchaseMarginCache(context),roots=context.workspace.tasks.filter(row=>!row.procurementSource&&(ids.has(row.id)||context.workspace.tasks.some(source=>source.customerDemandTaskId===row.id&&ids.has(source.id))));
   const changed=roots.filter(root=>{if(!context.workspace.tasks.some(row=>(row.id===root.id||row.customerDemandTaskId===root.id)&&row.po))return false;const order=context.orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId),basis=purchaseMarginBasis(context,root.id);return order?.gpSnapshot?.schema===1?(order.gpSnapshot.basis!==basis||order.gpSnapshot.gp!==order.gp):old.get(root.id)===null;});
   if(!changed.length)return requireCustomerMargin&&(!roots.length||roots.some(root=>!finite(old.get(root.id))))?{...result,gpPending:true}:result;
   const orderIds=changed.map(root=>context.orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId)?._id);
   if(orderIds.some(id=>!id)||new Set(orderIds).size!==orderIds.length)return {...result,gpPending:true};
   const currencies=[...new Set(changed.map(root=>context.orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId).transactionCurrency))];let rates=[];try{rates=await readRates(currencies);}catch(_){}
   let next=0,pending=false;
   // Only distinct order caches overlap. Each worker retains the original per-task GP/COST locks.
   await Promise.all(Array.from({length:Math.min(4,changed.length)},async()=>{while(next<changed.length){try{const root=changed[next++],workspace={...context.workspace,tasks:context.workspace.tasks.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id)},refresh=createPurchaseMarginRefresh({store,readRates:async requested=>rates.filter(row=>requested.includes(row.currency)),now});
    await refresh({...context,workspace,saveSnapshot:true,triggerId:requestId});
    const order=context.orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId),current=await store.read(names.orders,order._id);if(current?.gpSnapshot?.basis!==purchaseMarginBasis(context,root.id)||requireCustomerMargin&&!finite(current.gpSnapshot.gp))pending=true;
   }catch(_){pending=true;}}}));
   if(pending)return {...result,gpPending:true};
   return result;
  }catch(_){return {...result,gpPending:true};}
 };
 return async request=>{if(request.result?.ok!==true)return request.result;const key=operationId(request.company,request.staff?.memberId,request.requestId);if(inFlight.has(key))return inFlight.get(key);const work=execute(request);inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}};
}

// Bounded Wix-admin maintenance is called explicitly, never from page reads.
export function createPurchaseMarginInitialization({store,now=()=>new Date()}){
 return async({company,administrator=false,requestId,input={}})=>{
  if(!PURCHASE_COLLECTIONS[company]||administrator!==true||!/^[a-f0-9-]{36}$/i.test(requestId||''))throw Error('Authorized Wix administrator and initialization identity are required.');
  if(input.taskIds!==undefined&&(!Array.isArray(input.taskIds)||input.taskIds.length>5||new Set(input.taskIds).size!==input.taskIds.length||input.taskIds.some(id=>typeof id!=='string')))throw Error('Select at most five distinct GP tasks.');
  const names=PURCHASE_COLLECTIONS[company],[orders,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]),workspace=projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff:{}}),context={company,names,orders,tasks,activity,workspace};
  const eligible=workspace.tasks.filter(root=>!root.procurementSource&&workspace.tasks.some(row=>(row.id===root.id||row.customerDemandTaskId===root.id)&&row.po));
  if(input.taskIds?.some(id=>!eligible.some(root=>root.id===id)))throw Error('Initialization task is unavailable.');
  const selected=input.taskIds?eligible.filter(root=>input.taskIds.includes(root.id)):eligible.filter(root=>{const order=orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId);return order?.gpSnapshot?.basis!==purchaseMarginBasis(context,root.id);}).slice(0,5),plans=[];
  for(const root of selected){
   const order=orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId),basis=purchaseMarginBasis(context,root.id),evidence=activity.filter(row=>row.action==='GP_RECALCULATED'&&row.imageAltText===root.id&&row.details?.after?.gp===order?.gp).sort((a,b)=>new Date(b.activityTime)-new Date(a.activityTime))[0],rate=finite(order?.adminFxSource)?order.adminFxSource:evidence?.details?.after?.rateToMyr;
   const plan={taskId:root.id,basis,beforeGp:order?.gp??null,rate:finite(rate)?rate:null,status:'UNCONFIRMED'};
   if(order?.gpSnapshot?.schema===1&&order.gpSnapshot.basis===basis&&order.gpSnapshot.gp===order.gp)plan.status='ALREADY_INITIALIZED';
   else if(finite(order?.gp)){
    const shadow=new Map(),key=(collection,id)=>collection+'/'+id,overlay={read:async(c,id)=>shadow.has(key(c,id))?shadow.get(key(c,id)):store.read(c,id),insert:async(c,row)=>{if(shadow.has(key(c,row._id)))throw Error('Duplicate preview cache');shadow.set(key(c,row._id),row);},update:async(c,row)=>shadow.set(key(c,row._id),row),remove:async(c,id)=>shadow.delete(key(c,id))};
    const refresh=createPurchaseMarginRefresh({store:overlay,readRates:async currencies=>currencies.map(currency=>({currency,rateToMyr:rate})),now}),scoped={...workspace,tasks:workspace.tasks.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id)};
    const values=await refresh({...context,workspace:scoped,saveSnapshot:true,initializeOnly:true,triggerId:requestId}),updated=shadow.get(key(names.orders,order._id));
    plan.calculatedGp=values.get(root.id)??null;plan.status=updated?.gpSnapshot?.basis===basis&&updated.gp===order.gp?'READY':plan.calculatedGp!==order.gp?'MISMATCH':'PENDING_LOCK_OR_SOURCE';
   }
   plans.push(plan);
  }
  const version=operationId(company,plans),output={ok:true,company,requestId,version,plans,eligibleTaskIds:eligible.map(root=>root.id),remaining:eligible.filter(root=>{const order=orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId);return order?.gpSnapshot?.basis!==purchaseMarginBasis(context,root.id);}).length};
  if(input.confirm!==true)return output;
  if(plans.length&&plans.every(row=>row.status==='ALREADY_INITIALIZED'))return {...output,applied:true,alreadyComplete:true};
  if(input.version!==version)throw Error('GP initialization evidence changed. Preview again.');
  for(const plan of plans.filter(row=>row.status==='READY')){
   const root=workspace.tasks.find(row=>row.id===plan.taskId),order=orders.find(row=>row.title===root.orderId&&row.sourceLineId===root.sourceLineId),scoped={...workspace,tasks:workspace.tasks.filter(row=>row.id===root.id||row.customerDemandTaskId===root.id)};
   const refresh=createPurchaseMarginRefresh({store,readRates:async currencies=>currencies.map(currency=>({currency,rateToMyr:plan.rate})),now});await refresh({...context,workspace:scoped,saveSnapshot:true,initializeOnly:true,triggerId:requestId});
   const current=await store.read(names.orders,order._id);plan.status=current?.gpSnapshot?.basis===plan.basis&&current.gp===plan.beforeGp?'INITIALIZED':'PENDING';
  }
  return {...output,applied:true};
 };
}
