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
 const count=cell=>{if(cell?.getAttribute('data-purchase-quantity-empty')==='true')return null;const total=cell?.getAttribute('data-purchase-receipt-total');if(total!==null&&total!==undefined&&/^\d+$/.test(total))return Number(total);const match=cell?.textContent.trim().match(/^(\d[\d,]*)/);return match?Number(match[1].replaceAll(',','')):null;};
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
   const widths=[48,40,76,128,null,96,180,118,110,118,120];
   const cols=table.querySelector('colgroup');
   if(cols){cols.replaceChildren(...widths.map(width=>{const col=document.createElement('col');if(width!==null)col.style.width=width+'px';return col;}));}
  }
  for(const row of table.tBodies[0]?.rows||[]){
   if(row.cells.length===1){if(row.cells[0].colSpan===12)row.cells[0].colSpan=11;continue;}
   if(row.matches('[data-id],[data-split-parent]')){
    const button=row.querySelector('.supplier-cell .supplier-plan-link');
    if(button){
     let next=row.nextElementSibling,hasSources=false;
     while(next&&!next.matches('[data-id],[data-split-parent]')){if(next.hasAttribute('data-source-id'))hasSources=true;next=next.nextElementSibling;}
     row.toggleAttribute('data-draft-parent-sources',hasSources);
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
    if(hasSources){row.dataset.draftHasSources='true';receipt.querySelectorAll('button:not([data-purchase-info])').forEach(button=>button.remove());}
   }
   if(!(row.hasAttribute('data-source-id')||row.hasAttribute('data-receipt-source-id'))||receipt.querySelector('.draft-receipt-shortfall'))continue;
   if(receipt.querySelector('.receipt-stopped'))continue;
   const ordered=count(row.cells[5]),value=receipt.querySelector('.quantity-reference'),received=count(value||receipt);
   if(!Number.isSafeInteger(ordered)||!Number.isSafeInteger(received)||received<0||ordered<=received)continue;
   const button=document.createElement('button');button.type='button';button.className='draft-receipt-shortfall';button.textContent=String(received);
   button.setAttribute('aria-label','收货差额：采购 '+ordered+' 箱，实收 '+received+' 箱');
   button.onclick=event=>{event.preventDefault();event.stopPropagation();const issue=receipt.querySelector("[data-quantity-case]");if(issue)issue.click();};
   if(value)value.replaceWith(button);else receipt.replaceChildren(button);
  }
  for(const row of table.tBodies[0]?.rows||[]){
   if(!row.matches('[data-id],[data-split-parent]'))continue;
   const allocated=row.querySelector('.allocated-quantity');
   if(!allocated||allocated.dataset.draftAllocationDisplay)continue;
   const requested=row.hasAttribute('data-layout-intent')?Number(row.getAttribute('data-layout-intent')):count(row.cells[5]),actual=count(allocated);
   if(!Number.isSafeInteger(requested)||!Number.isSafeInteger(actual))continue;
   allocated.replaceChildren();
   const gap=Number(row.dataset.layoutGap||0);
   if(row.dataset.layoutBorrowOnly==='true'&&actual<=requested||!gap&&actual<=requested&&row.dataset.layoutAction==='none'||actual===requested&&!gap&&!Number(row.dataset.layoutWaiting||0)){allocated.textContent=String(actual);}
   else{
    const warning=document.createElement('button');warning.type='button';warning.className='draft-allocation-warning';
    warning.style.color=actual>requested?'#E51B2B':'#F58A00';
    warning.setAttribute('aria-label','分配数量与客户采购意向不相等');
    warning.innerHTML='<svg viewBox="40 105 435 295" aria-hidden="true"><g fill="#F58A00"><path d="M109 169c-22 11-34 29-40 53l-13 58c-2 9 4 15 13 14l25-74 15-51Zm10 17 13-37c4-12 12-17 23-17h18l-54 54Zm-9 47-23 64c-4 13 1 23 12 25 8 2 14-3 20-12l11-19-20-58Z"/><path d="M132 192c-14 15-16 32-7 51l38 88c6 14 15 19 26 13 12-5 15-14 10-27l-20-60c-7-23 2-43 23-56 22-14 47-9 66 7 26 21 33 55 19 82-7 14-19 28-34 43-13 14-13 29-5 43 8 16 24 18 38 5l35-35c15-14 31-17 53-22 26-7 46-23 62-44 21-17 28-38 24-65-4-31-13-69-25-86-5-8-12-11-22-8l-85 20-104-20c-14-3-28 3-42 16l-50 55Z"/></g></svg>';
    warning.setAttribute('data-customer-allocate',row.getAttribute('data-split-parent')||row.getAttribute('data-id'));
    warning.setAttribute('data-allocation-batch',row.getAttribute('data-split-batch')||'WHOLE');
    warning.setAttribute('aria-label',gap?'REALLOC: '+gap+' CTN shortage':'Allocate stock 库存分配：已分配 '+actual+' 箱，需求 '+requested+' 箱');
    if(gap){warning.classList.add('purchase-realloc');warning.title='REALLOC · '+gap+' CTN';}
    warning.onclick=event=>{event.preventDefault();};allocated.append(warning);
   }
   allocated.dataset.draftAllocationDisplay='true';
  }
  window.purchaseTaskInfo?.decorate(table);
  for(const row of table.rows){
   const allocation=row===header?[...row.cells].find(cell=>cell.textContent.trim()==='Alloc Qty'):row.querySelector('.allocated-quantity'),receipt=row===header?[...row.cells].find(cell=>cell.textContent.trim()==='Rcv Qty'):row.querySelector('.received-quantity');
   if(allocation&&receipt&&allocation.cellIndex>receipt.cellIndex)row.insertBefore(allocation,receipt);
  }
  // Fixed three-part slots keep each parent and its source quantities on the same divider.
  for(const row of table.tBodies[0]?.rows||[]){const cell=row.querySelector('.order-quantity');if(!cell||cell.dataset.quantityAligned)continue;
    const parent=row.matches('[data-id],[data-split-parent]'),source=row.matches('[data-source-id],[data-receipt-source-id],.ready-stock-row,.waiting-row');
    if(parent){let next=row.nextElementSibling,children=false;while(next&&!next.matches('[data-id],[data-split-parent]')){if(next.matches('[data-source-id],.ready-stock-row'))children=true;next=next.nextElementSibling;}
      const pair=cell.querySelector('.quantity-aligned,.qty-pair');if(pair&&pair.children.length===3){pair.className='order-quantity-slots';const planned=count(pair.lastElementChild),requested=count(pair.firstElementChild);pair.lastElementChild.className=planned===null?'':'quantity-reference purchase-info-total'+(requested!==null&&planned<requested?' purchase-info-pending':' receipt-complete');}
    }else if(source){const marker=row.querySelector(':is(.customer-short,.customer-child) .ao-child-marker');if(marker){const nodes=[...cell.childNodes],slots=document.createElement('span'),right=document.createElement('span');slots.className='order-quantity-source';right.append(...nodes);if(row.matches('.waiting-row'))right.className='quantity-reference purchase-info-total purchase-info-pending';slots.append(marker,right);cell.replaceChildren(slots);}}
    cell.dataset.quantityAligned='true';
  }
  const scroll=table.parentElement;scroll.classList.add('active-task-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','Active customer tasks');
  table.classList.add('draft-column-layout');
 }
 const observer=new MutationObserver(()=>{observer.disconnect();apply();observer.observe(root,{childList:true,subtree:true});});
 apply();observer.observe(root,{childList:true,subtree:true});
 window.addEventListener('resize',apply);
})();
