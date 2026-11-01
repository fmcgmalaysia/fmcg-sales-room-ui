'use strict';
const assert=require('node:assert/strict');
function once(source,before,after){assert.equal(source.split(before).length,2,'Quiet quantity hunk: '+before.slice(0,85));return source.replace(before,()=>after);}
function patchGrid(source){
 source=once(source,'tasks,allocations=[],allocationContext=null,customers,','tasks,allocations=[],allocationContext=null,deskDeliveries=[],customers,');
 source=once(source,'setContext({tasks,allocations,allocationContext,customers})','setContext({tasks,allocations,allocationContext,deskDeliveries,customers})');
 source=once(source,`product+='<small class="source-contribution">Original PO 原采购 '+quantity(original.procurement.totalCtn)+' · Customer source 本客户来源 <b>'+quantity(actual)+'</b> CTN</small>';`,'');
 source=once(source,`+'</span><small class="source-original">PO '+value+'</small>'+close`,`+'</span>'+close`);
 return source;
}
function patchInfo(source){
 const from=source.indexOf('  function receiptSummary(m){'),to=source.indexOf('  function sourceSummary(m){',from);assert(from>=0&&to>from);
 source=once(source,source.slice(from,to),`  function receiptView(m,aggregate=false){
    const planned=m.group.reduce((n,row)=>n+(row.procurement?.totalCtn||0),0),problem=m.group.some(row=>row.warehouse?.issue||(row.warehouse?.stock?.cases||[]).some(item=>item.status!=='RESOLVED'));
    const rejected=m.receipts.some(row=>row.rejected!==0),partial=Number.isSafeInteger(m.received)&&planned>0&&m.received<planned;
    const info=!aggregate&&(Boolean(m.batchId&&!m.sourceId)||m.receipts.length>1||m.adjusted||rejected||problem||partial);
    const split=info&&!m.batchId&&!m.adjusted&&!rejected&&m.receipts.length===2&&m.receipts.every(row=>row.received>0)&&new Set(m.receipts.map(row=>row.poId)).size===1;
    const value=split?m.receipts.map(row=>qty(row.received)).join(' + '):qty(m.received);
    const at=!aggregate&&!info&&m.receipts.length===1?m.receipts[0].at:'';
    let day='';if(at&&Number.isFinite(Date.parse(at))){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit'}).formatToParts(new Date(at)).map(part=>[part.type,part.value]));day=parts.day+'-'+parts.month+'-'+parts.year;}
    return {value,info,date:day};
  }
  function receiptSummary(m){return receiptView(m).date;}
  function allocationView(m,data=context){
    const delivery=data?.deskDeliveries?.find(row=>row.taskId===m.task.id),outstanding=m.sources.some(row=>row.loans.some(loan=>loan.outstanding>0));
    return {info:!m.consistent||outstanding,settled:delivery?.confirmed===true&&Number.isSafeInteger(m.allocated)&&delivery.loadedQty===m.allocated&&!delivery.issue&&!delivery.pending};
  }
`);
 source=once(source,`receipt.innerHTML='RCV Qty<small class="purchase-info-caption">PO receipts</small>'`,`receipt.textContent='RCV Qty'`);
 source=once(source,`allocation.innerHTML='Alloc Qty<small class="purchase-info-caption">Sources</small>'`,`allocation.textContent='Alloc Qty'`);
 source=once(source,"      if(receipt&&m.group.some(task=>task.po||task.warehouse?.hasPhysicalReceipt)){",`      if(receipt&&m.group.some(task=>task.po||task.warehouse?.hasPhysicalReceipt)){
        const view=receiptView(m,row.dataset.draftHasSources==='true');
        if(Number.isSafeInteger(m.received))receipt.dataset.purchaseReceiptTotal=String(m.received);`);
 source=once(source,"if(primary){primary.textContent=qty(m.received);if(primary.tagName==='SPAN')primary.classList.add('purchase-info-total');}","if(primary){primary.textContent=view.value;primary.dataset.purchaseReceiptTotal=String(m.received);if(primary.tagName==='SPAN')primary.classList.add('quantity-reference','purchase-info-total');}");
 source=once(source,"const value=document.createElement('span');value.className='quantity-reference purchase-info-total';value.textContent=qty(m.received);receipt.prepend(value);","if(view.value){const value=document.createElement('span');value.className='quantity-reference purchase-info-total';value.textContent=view.value;value.dataset.purchaseReceiptTotal=String(m.received);receipt.prepend(value);}");
 source=once(source,`        receipt.append(infoButton('receipts',m));const summary=receiptSummary(m);
        if(summary){const line=document.createElement('small');line.className='purchase-info-note';line.textContent=summary;receipt.append(line);}`,`        if(view.info){const line=document.createElement('small');line.className='purchase-info-note';line.append(infoButton('receipts',m));receipt.append(line);}
        else if(view.date){const line=document.createElement('small');line.className='purchase-info-note';line.textContent=view.date;receipt.append(line);}`);
 source=once(source,`        allocated.append(infoButton('allocation',m));
        const summary=sourceSummary(m);if(summary){const line=document.createElement('small');line.className='purchase-info-note';line.innerHTML=summary;allocated.append(line);}`,`        const view=allocationView(m);allocated.toggleAttribute('data-purchase-info-settled',view.settled);
        if(view.info){const line=document.createElement('small');line.className='purchase-info-note';line.append(infoButton('allocation',m));allocated.append(line);}`);
 source=once(source,'model,receiptSummary,sourceSummary};','model,receiptSummary,sourceSummary,receiptView,allocationView};');
 return source;
}
module.exports={once,patchGrid,patchInfo};
