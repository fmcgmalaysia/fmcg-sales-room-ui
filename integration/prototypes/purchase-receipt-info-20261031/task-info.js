/* Read-only receipt and allocation details; all stock writers remain unchanged. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qty=value=>Number.isSafeInteger(value)?String(value):'';
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';
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
      return [{id:allocation.sourceTaskId,quantity,po:source?.po||'',customerId:source?.customerId||'',kind:local?'PO':loans.length?'Borrowed':replenished?'Replenished':'Stock',repaid:loans.length>0&&loans.every(loan=>loan.outstanding===0),loans,at:allocation.at,by:allocation.by||''}];
    });
    const allocated=batchId?task.batchEntitlements?.find(row=>row.id===batchId)?.metrics?.received:task.inc;
    const sourceTotal=sources.reduce((n,row)=>n+row.quantity,0),consistent=Number.isSafeInteger(allocated)&&sourceTotal===allocated;
    return {task,group,received,receipts,receiptCount,adjusted,sources,allocated,consistent,batchId,sourceId};
  }
  function receiptSummary(m){
    if(m.batchId&&!m.sourceId)return m.receiptCount?'PO receipts':'';
    if(!m.receipts.length)return '';
    if(m.adjusted)return m.receiptCount+' receipt'+(m.receiptCount===1?'':'s')+' · Adjusted';
    if(m.receiptCount===2&&m.receipts.length===2)return m.receipts.map(row=>qty(row.received)).join(' + ')+' · 2 receipts';
    return m.receiptCount+' receipt'+(m.receiptCount===1?'':'s');
  }
  function sourceSummary(m){
    if(!m.consistent)return '';
    const grouped=new Map();
    for(const source of m.sources){const key=source.kind+(source.repaid?' · Repaid':'');grouped.set(key,(grouped.get(key)||0)+source.quantity);}
    return [...grouped].map(([label,value])=>'<span class="purchase-info-source '+(label.includes('Borrowed')&&!label.includes('Repaid')?'loan':'')+'">'+esc(label.split(' · ')[0])+' '+value+(label.includes('Repaid')?' · Repaid':'')+'</span>').join(' + ');
  }
  function infoButton(kind,m){const button=document.createElement('button');button.type='button';button.className='purchase-info-link';button.textContent='Info';button.dataset.purchaseInfo=kind;button.dataset.infoTask=m.task.id;button.dataset.infoBatch=m.batchId;button.dataset.infoSource=m.sourceId;button.setAttribute('aria-label',(kind==='receipts'?'Receipt':'Allocation')+' info '+m.task.barcode);return button;}
  function decorate(table){
    if(!context)return;
    const header=table.tHead?.rows[0];
    if(header&&!header.dataset.purchaseInfoReady){
      const receipt=[...header.cells].find(cell=>cell.textContent.trim().toLowerCase()==='rcv qty'),allocation=[...header.cells].find(cell=>cell.textContent.trim().toLowerCase()==='alloc qty');
      if(receipt)receipt.innerHTML='RCV Qty<small class="purchase-info-caption">PO receipts</small>';
      if(allocation)allocation.innerHTML='ALLOC Qty<small class="purchase-info-caption">Sources</small>';
      header.dataset.purchaseInfoReady='true';
    }
    for(const row of table.tBodies[0]?.rows||[]){
      if(row.dataset.purchaseInfoReady)continue;
      const rootId=row.dataset.splitParent||row.dataset.id,sourceId=row.dataset.sourceId||row.dataset.receiptSourceId||'';
      const source=context.tasks.find(task=>task.id===sourceId),taskId=rootId||source?.customerDemandTaskId||sourceId;
      if(!taskId)continue;
      const m=model(taskId,row.dataset.splitBatch||'',sourceId);if(!m)continue;
      const receipt=row.querySelector('.received-quantity'),allocated=row.querySelector('.allocated-quantity');
      if(receipt&&m.group.some(task=>task.po||task.warehouse?.hasPhysicalReceipt)){
        if(!m.batchId||m.sourceId){
          receipt.querySelectorAll('.extra-stock,small').forEach(node=>node.remove());
          const primary=receipt.querySelector('.quantity-reference,.draft-receipt-shortfall');
          if(primary)primary.textContent=qty(m.received);
          else{for(const node of [...receipt.childNodes])if(node.nodeType===3)node.remove();const value=document.createElement('span');value.className='quantity-reference purchase-info-total';value.textContent=qty(m.received);receipt.prepend(value);}
        }
        receipt.append(infoButton('receipts',m));const summary=receiptSummary(m);
        if(summary){const line=document.createElement('small');line.className='purchase-info-note';line.textContent=summary;receipt.append(line);}
      }
      if(rootId&&allocated){
        for(const node of [...allocated.childNodes])if(node.nodeType===3&&/^\s*\d[\d,]*\s*$/.test(node.textContent)){const value=document.createElement('span');value.className='quantity-reference receipt-complete purchase-info-total';value.textContent=node.textContent.trim();node.replaceWith(value);}
        allocated.append(infoButton('allocation',m));
        const summary=sourceSummary(m);if(summary){const line=document.createElement('small');line.className='purchase-info-note';line.innerHTML=summary;allocated.append(line);}
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
      body=m.sources.length?'<table class="rowlist"><thead><tr><th>Source</th><th>P.O.</th><th>Qty</th><th>From</th></tr></thead><tbody>'+m.sources.map(row=>'<tr><td>'+esc(row.kind)+(row.repaid?' · Repaid':'')+'</td><td>'+esc(row.po)+'</td><td>'+qty(row.quantity)+'</td><td>'+esc(name(row.customerId))+'</td></tr>').join('')+'</tbody></table>':'<p>'+(m.allocated===0?'Not allocated.':'Source details unavailable. Refresh to check.')+'</p>';
      const loans=[...new Map(m.sources.flatMap(row=>row.loans).map(loan=>[loan.id||JSON.stringify([loan.borrowerTaskId,loan.lenderTaskId]),loan])).values()];
      body+=loans.map(loan=>'<p class="purchase-info-balance">Outstanding '+qty(loan.outstanding)+' CTN · '+esc(name(context.tasks.find(task=>task.id===loan.lenderTaskId)?.customerId||''))+'</p>').join('');
      if(!m.consistent&&m.sources.length)body+='<p>Source total differs. Review allocation.</p>';
    }
    if(!infoDialog){infoDialog=document.createElement('dialog');infoDialog.className='purchase-info-dialog';infoDialog.setAttribute('aria-labelledby','purchaseInfoTitle');document.body.append(infoDialog);infoDialog.addEventListener('click',event=>{if(event.target.closest('[data-info-close]'))infoDialog.close();});infoDialog.addEventListener('close',()=>opened=null);}
    infoDialog.innerHTML='<div class="dialoghead"><div><h2 id="purchaseInfoTitle">'+(receipts?'Receipts':'Allocation')+'</h2><small>'+esc(m.task.name)+(receipts&&selection.batchId?' · PO-level receipts':'')+'</small></div><button type="button" class="purchase-info-close" data-info-close aria-label="Close">×</button></div><div class="dialogbody">'+body+'</div><div class="dialogfoot"><small>Read only · CTN</small><button type="button" class="btn" data-info-close>Close</button></div>';
    opened=selection;if(!infoDialog.open)infoDialog.showModal();
  }
  if(typeof document!=='undefined')document.getElementById('app')?.addEventListener('click',event=>{const button=event.target.closest('[data-purchase-info]');if(!button)return;event.preventDefault();event.stopPropagation();show({kind:button.dataset.purchaseInfo,taskId:button.dataset.infoTask,batchId:button.dataset.infoBatch||'',sourceId:button.dataset.infoSource||''});});
  window.purchaseTaskInfo={setContext,decorate,model,receiptSummary,sourceSummary};
})();
