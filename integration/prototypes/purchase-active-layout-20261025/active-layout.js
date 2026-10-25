// Approved Active Orders presentation. Original data, buttons and write handlers are retained.
(() => {
 const root=document.getElementById('app');if(!root)return;
 const choices=new Map();
 function shortfallDialog(row,ordered,received){
  let dialog=document.getElementById('draftReceiptShortfall');
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='draftReceiptShortfall';dialog.className='draft-receipt-dialog';
   dialog.setAttribute('aria-labelledby','draftReceiptTitle');
   dialog.innerHTML='<div class="draft-receipt-head"><h2 id="draftReceiptTitle">收货差额</h2><button type="button" aria-label="关闭" data-draft-receipt-close>×</button></div><div class="draft-receipt-body"><p id="draftReceiptNumbers"></p><label for="draftReceiptDecision">处理方式</label><select id="draftReceiptDecision"><option value="WAIT">等待供应商中...</option><option value="STOP">放弃等待，通知 FINANCE + WAREHOUSE</option></select></div><div class="draft-receipt-foot"><button type="button" data-draft-receipt-close>取消</button><button type="button" class="draft-receipt-confirm">确定</button></div>';
   document.body.append(dialog);
   dialog.querySelectorAll('[data-draft-receipt-close]').forEach(button=>button.onclick=()=>dialog.close());
  }
  const id=row.getAttribute('data-source-id');
  dialog.querySelector('#draftReceiptNumbers').textContent='采购 '+ordered+' 箱 · 实收 '+received+' 箱 · 差额 '+(ordered-received)+' 箱';
  const select=dialog.querySelector('#draftReceiptDecision');select.value=choices.get(id)||'WAIT';
  dialog.querySelector('.draft-receipt-confirm').onclick=()=>{choices.set(id,select.value);dialog.close();};
  dialog.showModal();
 }
 const count=cell=>{const match=cell?.textContent.trim().match(/^(\d[\d,]*)/);return match?Number(match[1].replaceAll(',','')):null;};
 function apply(){
  const table=root.querySelector('table.active-order-table');if(!table)return;
  const header=table.tHead?.rows[0];
  // The current published renderer has no ALLOC column. Read only the existing
  // server-projected customer allocation, not Warehouse received quantities.
  if(header?.cells.length===11&&header.cells[7].textContent.trim()==='Net Cost'&&header.cells[9].textContent.trim()==='Line Cost'){
   const th=document.createElement('th');th.textContent='Alloc Qty';header.insertBefore(th,header.cells[9]);
  }
  for(const row of table.tBodies[0]?.rows||[]){
   if(row.cells.length!==11||row.querySelector('.allocated-quantity'))continue;
   const cell=document.createElement('td');cell.className='allocated-quantity';
   const value=row.getAttribute('data-layout-allocation');
   if(value!==null&&/^\d+$/.test(value))cell.textContent=value;
   row.insertBefore(cell,row.cells[9]);
  }
  if(header&&header.cells.length===12){
   header.cells[7].textContent='Cost';header.cells[10].remove();
   const widths=[48,40,76,128,null,96,180,118,88,96,120];
   const cols=table.querySelector('colgroup');
   if(cols){cols.replaceChildren(...widths.map(width=>{const col=document.createElement('col');if(width!==null)col.style.width=width+'px';return col;}));}
  }
  for(const row of table.tBodies[0]?.rows||[]){
   if(row.cells.length===1){if(row.cells[0].colSpan===12)row.cells[0].colSpan=11;continue;}
   if(row.matches('[data-id],[data-split-parent]')){
    const button=row.querySelector('.supplier-cell .supplier-plan-link');
    if(button&&!button.dataset.draftHeadsOnly){
     const heads=[...button.querySelectorAll('.supplier-head')];
     if(heads.length){button.replaceChildren(...heads);button.dataset.draftHeadsOnly='true';}
    }
   }
   if(row.cells.length!==12)continue;
   const net=row.cells[7],line=row.cells[10];
   const netValue=document.createElement('span'),lineValue=document.createElement('span');
   netValue.className='draft-cost-net';netValue.setAttribute('aria-label','Net Cost');
   lineValue.className='draft-cost-line';lineValue.setAttribute('aria-label','Line Cost');
   netValue.append(...net.childNodes);lineValue.append(...line.childNodes);
   net.replaceChildren(netValue,lineValue);net.classList.add('draft-cost-stack');line.remove();
  }
  for(const row of table.tBodies[0]?.rows||[]){
   const receipt=row.querySelector('.received-quantity');if(!receipt)continue;
   if(row.matches('[data-id],[data-split-parent]')){
    let next=row.nextElementSibling,hasSources=false;
    while(next&&!next.matches('[data-id],[data-split-parent]')){if(next.hasAttribute('data-source-id'))hasSources=true;next=next.nextElementSibling;}
    if(hasSources){row.dataset.draftHasSources='true';receipt.querySelectorAll('button').forEach(button=>button.remove());}
   }
   if(!row.hasAttribute('data-source-id')||receipt.querySelector('.draft-receipt-shortfall'))continue;
   const ordered=count(row.cells[5]),value=receipt.querySelector('.quantity-reference'),received=count(value||receipt);
   if(!Number.isSafeInteger(ordered)||!Number.isSafeInteger(received)||received<0||ordered<=received)continue;
   const button=document.createElement('button');button.type='button';button.className='draft-receipt-shortfall';button.textContent=String(received);
   button.setAttribute('aria-label','收货差额：采购 '+ordered+' 箱，实收 '+received+' 箱');
   button.onclick=event=>{event.preventDefault();event.stopPropagation();shortfallDialog(row,ordered,received);};
   if(value)value.replaceWith(button);else receipt.replaceChildren(button);
  }
  for(const row of table.tBodies[0]?.rows||[]){
   if(!row.matches('[data-id],[data-split-parent]'))continue;
   const allocated=row.querySelector('.allocated-quantity');
   if(!allocated||allocated.dataset.draftAllocationDisplay)continue;
   const requested=row.hasAttribute('data-layout-intent')?Number(row.getAttribute('data-layout-intent')):count(row.cells[5]),actual=count(allocated);
   if(!Number.isSafeInteger(requested)||!Number.isSafeInteger(actual))continue;
   allocated.replaceChildren();
   if(actual===requested){allocated.textContent=String(actual);}
   else{
    const warning=document.createElement('button');warning.type='button';warning.className='draft-allocation-warning';
    warning.setAttribute('aria-label','分配数量与客户采购意向不相等');
    warning.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.4 2.7a1.85 1.85 0 0 1 3.2 0l7.2 12.5a1.85 1.85 0 0 1-1.6 2.8H2.8a1.85 1.85 0 0 1-1.6-2.8Z" fill="currentColor"/><path d="M10 6.5v5" stroke="white" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14.4" r="1" fill="white"/></svg>';
    warning.onclick=event=>{event.preventDefault();event.stopPropagation();};allocated.append(warning);
   }
   allocated.dataset.draftAllocationDisplay='true';
  }
  table.classList.add('draft-column-layout');
 }
 const observer=new MutationObserver(()=>{observer.disconnect();apply();observer.observe(root,{childList:true,subtree:true});});
 apply();observer.observe(root,{childList:true,subtree:true});
})();
