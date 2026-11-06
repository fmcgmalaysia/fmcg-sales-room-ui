/* Read-only receipt and allocation details; all stock writers remain unchanged. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qty=value=>Number.isSafeInteger(value)?String(value):'';
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replaceAll('/','-').replace(',',''):'';
  let context=null,company='',opened=null,infoDialog=null;
  function setContext(next){
    const selected=document.getElementById('companySelect')?.value||'';
    if(company!==selected&&infoDialog?.open){infoDialog.close();opened=null;}
    company=selected;context=next;
  }
  function model(taskId,batchId='',sourceId='',data=context){
    const task=data?.tasks.find(row=>row.id===taskId);if(!task)return null;
    const own=data.tasks.filter(row=>row.id===task.id||row.customerDemandTaskId===task.id),group=sourceId?own.filter(row=>row.id===sourceId):own;
    const physical=group.filter(row=>row.warehouse?.hasPhysicalReceipt===true&&Number.isSafeInteger(row.warehouse.accepted));
    const received=physical.length?physical.reduce((n,row)=>n+row.warehouse.accepted,0):null;
    const seen=new Set(),receipts=group.flatMap(row=>(row.receiptHistory||[]).map(entry=>({...entry,sourceTaskId:row.id}))).filter(entry=>{const key=JSON.stringify([entry.id,entry.sourceTaskId]);if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id));
    const receiptCount=new Set(receipts.filter(entry=>entry.kind!=='CORRECTION'&&(entry.received>0||entry.rejected>0)).map(entry=>JSON.stringify([entry.poId,entry.id]))).size;
    const adjusted=receipts.some(entry=>entry.kind==='CORRECTION');
    const sources=(data.allocations||[]).flatMap(allocation=>{
      const target=allocation.targets?.find(row=>row.taskId===taskId);if(!target)return [];
      const quantity=batchId?(target.batches||[]).filter(row=>row.id===batchId).reduce((n,row)=>n+row.quantity,0):target.quantity;
      if(!Number.isSafeInteger(quantity)||quantity<=0)return [];
      const source=data.tasks.find(row=>row.id===allocation.sourceTaskId),local=own.some(row=>row.id===allocation.sourceTaskId);
      const loans=(data.allocationContext?.loans||[]).filter(loan=>loan.borrowerTaskId===taskId&&loan.sources.some(row=>row.sourceTaskId===allocation.sourceTaskId));
      const replenished=!local&&(data.allocationContext?.loans||[]).some(loan=>loan.lenderTaskId===taskId&&loan.borrowerTaskId===(source?.customerDemandTaskId||source?.id)&&loan.quantity-loan.outstanding>=quantity);
      const common={id:allocation.sourceTaskId,po:source?.po||'',customerId:source?.customerId||'',at:allocation.at,by:allocation.by||''},kind=local?'PO':replenished?'Replenished':'Stock';
      if(!loans.length)return [{...common,quantity,kind,repaid:false,loans:[]}];
      const origins=loans.map(loan=>({loan,origin:data.allocationOrigins?.loans?.find(row=>row.loanId===loan.id)}));
      const known=data.allocationOrigins?.known===true&&origins.every(({origin})=>origin?.known===true&&(!batchId||origin.batchKnown===true));
      const borrowed=known?origins.filter(({origin})=>!batchId||origin.borrowerBatchId===batchId).map(({loan,origin})=>({loan,repaid:origin.repaid,quantity:origin.sources.filter(row=>row.sourceTaskId===allocation.sourceTaskId).reduce((n,row)=>n+row.quantity,0)})):[];
      const total=borrowed.reduce((n,row)=>n+row.quantity,0);
      if(!known||!Number.isSafeInteger(total)||total<0||total>quantity)return [{...common,quantity,kind:'Source',repaid:false,loans}];
      return [...(quantity>total?[{...common,quantity:quantity-total,kind,repaid:false,loans:[]}]:[]),...borrowed.filter(row=>row.quantity>0).map(row=>({...common,quantity:row.quantity,kind:'Borrowed',repaid:row.repaid,loans:[row.loan]}))];
    });
    const allocated=batchId?task.batchEntitlements?.find(row=>row.id===batchId)?.metrics?.received:task.inc;
    const sourceTotal=sources.reduce((n,row)=>n+row.quantity,0),consistent=Number.isSafeInteger(allocated)&&sourceTotal===allocated;
    const supply=batchId?task.supplyAllocation?.batches?.find(row=>row.id===batchId):task.supplyAllocation;
    return {task,group,received,receipts,receiptCount,adjusted,sources,allocated,consistent,batchId,sourceId,supply};
  }
  function receiptView(m,aggregate=false){
    const planned=m.group.reduce((n,row)=>n+(row.procurement?.totalCtn||0),0),problem=m.group.some(row=>row.warehouse?.issue||(row.warehouse?.stock?.cases||[]).some(item=>item.status!=='RESOLVED'));
    const rejected=m.receipts.some(row=>row.rejected!==0),partial=Number.isSafeInteger(m.received)&&planned>0&&m.received<planned;
    const info=!aggregate&&(Boolean(m.batchId&&!m.sourceId)||m.receipts.length>1||m.adjusted||rejected||problem||partial);
    const split=info&&!m.batchId&&!m.adjusted&&!rejected&&m.receipts.length===2&&m.receipts.every(row=>row.received>0)&&new Set(m.receipts.map(row=>row.poId)).size===1;
    const defaultZero=m.received===null&&!m.receipts.length&&m.group.every(row=>row.warehouse?.hasPhysicalReceipt!==true);
    const value=defaultZero?'0':split?m.receipts.map(row=>qty(row.received)).join(' + '):qty(m.received);
    const at=!info&&m.receipts.length===1?m.receipts[0].at:'';
    let day='';if(at&&Number.isFinite(Date.parse(at))){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit'}).formatToParts(new Date(at)).map(part=>[part.type,part.value]));day=parts.day+'-'+parts.month+'-'+parts.year;}
    return {value,info,date:day,defaultZero};
  }
  function receiptSummary(m){return receiptView(m).date;}
  function allocationView(m,data=context){
    const delivery=data?.deskDeliveries?.find(row=>row.taskId===m.task.id),outstanding=m.sources.some(row=>row.loans.some(loan=>loan.outstanding>0));
    const displayed=m.supply?.planned??m.allocated,defaultZero=displayed==null&&m.sources.length===0;
    return {value:defaultZero?'0':qty(displayed),defaultZero,info:!m.consistent&&!defaultZero||outstanding,settled:delivery?.confirmed===true&&Number.isSafeInteger(displayed)&&delivery.loadedQty===displayed&&!delivery.issue&&!delivery.pending};
  }
  function sourceSummary(m){
    if(!m.consistent)return '';
    const grouped=new Map();
    for(const source of m.sources){const key=source.kind+(source.repaid?' · Repaid':'');grouped.set(key,(grouped.get(key)||0)+source.quantity);}
    return [...grouped].map(([label,value])=>'<span class="purchase-info-source '+(label.includes('Borrowed')&&!label.includes('Repaid')?'loan':'')+'">'+esc(label.split(' · ')[0])+' '+value+(label.includes('Repaid')?' · Repaid':'')+'</span>').join(' + ');
  }
  function infoButton(kind,m){const button=document.createElement('button');button.type='button';button.className='purchase-info-link';button.textContent='Info';button.dataset.purchaseInfo=kind;button.dataset.infoTask=m.task.id;button.dataset.infoBatch=m.batchId;button.dataset.infoSource=m.sourceId;button.setAttribute('aria-label',(kind==='receipts'?'Receipt':'Allocation')+' info '+m.task.barcode);return button;}
  function decorate(table,receiptsOnly=false,renderQuantities=null){
    if(!context)return;
    const header=table.tHead?.rows[0];
    if(header&&!header.dataset.purchaseInfoReady){
      const receipt=[...header.cells].find(cell=>cell.textContent.trim().toLowerCase()==='rcv qty'),allocation=[...header.cells].find(cell=>cell.textContent.trim().toLowerCase()==='alloc qty');
      if(receipt)receipt.textContent='Rcv Qty';
      if(allocation)allocation.textContent='Alloc Qty';
      header.dataset.purchaseInfoReady='true';
    }
    for(const row of table.tBodies[0]?.rows||[]){
      if(row.dataset.purchaseInfoReady&&!receiptsOnly)continue;
      const rootId=row.dataset.splitParent||row.dataset.id,sourceId=row.dataset.sourceId||row.dataset.receiptSourceId||'';
      const source=context.tasks.find(task=>task.id===sourceId),taskId=rootId||source?.customerDemandTaskId||sourceId;
      if(!taskId)continue;
      const m=model(taskId,row.dataset.splitBatch||'',sourceId);if(!m)continue;
      const receipt=row.querySelector('.received-quantity'),allocated=row.querySelector('.allocated-quantity');
      if(receipt){
        if(receiptsOnly){
          receipt.querySelectorAll('.purchase-info-note').forEach(node=>node.remove());
          if(renderQuantities){const fresh=document.createElement('tr'),scoped=sourceId?source:m.task;fresh.innerHTML=renderQuantities({...scoped,procurementSource:Boolean(sourceId),quantityCases:m.group.flatMap(item=>item.quantityCases||[])});receipt.querySelectorAll('[data-quantity-case]').forEach(node=>node.remove());for(const button of fresh.querySelectorAll('.received-quantity [data-quantity-case]'))receipt.append(button);}
        }
        const view=receiptView(m,row.dataset.draftHasSources==='true');
        // Customer source share is not the PO's cumulative physical receipt.
        const contributionText=(row.querySelector('.order-quantity .source-actual,.order-quantity-slots>span:last-child')||row.querySelector('.order-quantity'))?.textContent.trim(),contribution=/^\d+$/.test(contributionText||'')?Number(contributionText):null;
        if(m.sourceId&&Number.isSafeInteger(contribution)&&Number.isSafeInteger(m.received)&&contribution!==m.received){view.value='';view.info=true;view.date='';}
        receipt.dataset.purchaseQuantityEmpty=String(view.defaultZero);
        if(Number.isSafeInteger(m.received))receipt.dataset.purchaseReceiptTotal=String(m.received);
        if(!m.batchId||m.sourceId){
          receipt.querySelectorAll('.extra-stock,small').forEach(node=>node.remove());
          const primary=receipt.querySelector('.quantity-reference,.draft-receipt-shortfall');
          if(primary){primary.textContent=view.value;primary.dataset.purchaseReceiptTotal=String(m.received);primary.dataset.purchaseQuantityEmpty=String(view.defaultZero);primary.classList.toggle('purchase-quantity-zero',view.value==='0');if(primary.tagName==='SPAN')primary.classList.add('quantity-reference','purchase-info-total');}
          else{for(const node of [...receipt.childNodes])if(node.nodeType===3)node.remove();if(view.value){const value=document.createElement('span');value.className='quantity-reference purchase-info-total'+(view.value==='0'?' purchase-quantity-zero':'');value.dataset.purchaseQuantityEmpty=String(view.defaultZero);value.textContent=view.value;value.dataset.purchaseReceiptTotal=String(m.received);receipt.prepend(value);}}
        }
        if(view.info){const line=document.createElement('small');line.className='purchase-info-note';line.append(infoButton('receipts',m));receipt.append(line);}
        else if(view.date){const line=document.createElement('small');line.className='purchase-info-note purchase-receipt-date task-received-date';line.textContent=view.date;receipt.append(line);}
      }
      if(rootId&&allocated&&!receiptsOnly){
        const view=allocationView(m);allocated.dataset.purchaseQuantityEmpty=String(view.defaultZero);
        for(const node of [...allocated.childNodes])if(node.nodeType===3&&/^\s*\d[\d,]*\s*$/.test(node.textContent)){const value=document.createElement('span');value.className='quantity-reference receipt-complete purchase-info-total';value.textContent=node.textContent.trim();node.replaceWith(value);}
        if(!allocated.querySelector('.purchase-info-total')&&view.value!==''){const value=document.createElement('span');value.className='quantity-reference purchase-info-total purchase-info-pending';value.textContent=view.value;allocated.prepend(value);}
        allocated.querySelectorAll('span.purchase-info-total').forEach(value=>{value.textContent=view.value;value.classList.toggle('purchase-quantity-zero',view.value==='0');value.dataset.purchaseQuantityEmpty=String(view.defaultZero);});allocated.toggleAttribute('data-purchase-info-settled',view.settled);
        if(view.info&&!allocated.querySelector('.purchase-info-pending,.purchase-quantity-zero')){const line=document.createElement('small');line.className='purchase-info-note';line.append(infoButton('allocation',m));allocated.append(line);}
      }
      row.dataset.purchaseInfoReady='true';
    }
  }
  function show(selection){
    const m=model(selection.taskId,selection.batchId,selection.sourceId);if(!m)return;
    const receipts=selection.kind==='receipts';
    let body;
    if(receipts){
      const rejected=m.receipts.some(row=>row.rejected!==0);
      body=m.receipts.length?'<table class="rowlist"><thead><tr><th>P.O.</th><th>Received</th>'+(rejected?'<th>Rejected</th>':'')+'<th>Date</th><th>By</th></tr></thead><tbody>'+m.receipts.map(row=>'<tr><td>'+esc(row.po)+'</td><td>'+qty(row.received)+(row.kind==='CORRECTION'?'<small>Correction</small>':'')+'</td>'+(rejected?'<td>'+qty(row.rejected)+'</td>':'')+'<td>'+esc(date(row.at))+'</td><td>'+esc(row.by)+'</td></tr>').join('')+'</tbody></table>':'<p>'+(m.received===null?'No receipts.':'Receipt details unavailable. Refresh to check.')+'</p>';
    }else{
      const name=id=>context.customers?.find(row=>row.id===id)?.shortName||context.customers?.find(row=>row.id===id)?.name||id;
      body=m.sources.length?'<table class="rowlist"><thead><tr><th>Source</th><th>P.O.</th><th>Qty</th><th>From</th><th>Recorded</th></tr></thead><tbody>'+m.sources.map(row=>'<tr><td>'+esc(row.kind)+(row.repaid?' · Repaid':'')+'</td><td>'+esc(row.po)+'</td><td>'+qty(row.quantity)+'</td><td>'+esc(name(row.customerId))+'</td><td>'+esc(date(row.at))+'<small>'+esc(row.by||'—')+'</small></td></tr>').join('')+'</tbody></table>':'<p>'+(m.allocated===0?'Not allocated.':'Source details unavailable. Refresh to check.')+'</p>';
      const loans=[...new Map(m.sources.flatMap(row=>row.loans).map(loan=>[loan.id||JSON.stringify([loan.borrowerTaskId,loan.lenderTaskId]),loan])).values()];
      body+=loans.map(loan=>'<p class="purchase-info-balance">Outstanding '+qty(loan.outstanding)+' CTN · '+esc(name(context.tasks.find(task=>task.id===loan.lenderTaskId)?.customerId||''))+'</p>').join('');
      if(!m.consistent&&m.sources.length)body+='<p>Source total differs. Review allocation.</p>';
    }
    if(!infoDialog){infoDialog=document.createElement('dialog');infoDialog.className='purchase-info-dialog';infoDialog.setAttribute('aria-labelledby','purchaseInfoTitle');document.body.append(infoDialog);infoDialog.addEventListener('click',event=>{if(event.target.closest('[data-info-close]'))infoDialog.close();});infoDialog.addEventListener('close',()=>opened=null);}
    infoDialog.innerHTML='<div class="dialoghead"><div><h2 id="purchaseInfoTitle">'+(receipts?'Receipts':'Allocation')+'</h2><small>'+esc(m.task.name)+(receipts&&selection.batchId?' · PO-level receipts':'')+'</small></div><button type="button" class="purchase-info-close" data-info-close aria-label="Close">×</button></div><div class="dialogbody">'+body+'</div><div class="dialogfoot"><small>Read only · CTN</small><button type="button" class="btn" data-info-close>Close</button></div>';
    opened=selection;if(!infoDialog.open)infoDialog.showModal();
  }
  if(typeof document!=='undefined')document.getElementById('app')?.addEventListener('click',event=>{const button=event.target.closest('[data-purchase-info]');if(!button)return;event.preventDefault();event.stopPropagation();show({kind:button.dataset.purchaseInfo,taskId:button.dataset.infoTask,batchId:button.dataset.infoBatch||'',sourceId:button.dataset.infoSource||''});});
  function refreshReceipts(next,renderQuantities){setContext(next);const table=document.querySelector('#taskRows')?.closest('table');if(table)decorate(table,true,renderQuantities);}
  window.purchaseTaskInfo={refreshReceipts,setContext,decorate,model,receiptSummary,sourceSummary,receiptView,allocationView};
})();
