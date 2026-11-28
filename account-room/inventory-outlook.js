(() => {
  const section=document.querySelector('#inventoryReport'), bar=document.querySelector('#inventoryViews');
  const app=document.querySelector('#app'),company=document.querySelector('#company');
  const asOf=section.querySelector('[type=date]'),month=section.querySelector('[type=month]'),output=section.querySelector('[data-output]');
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  asOf.value=asOf.max=today;
  const next=new Date(today.slice(0,7)+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);month.value=next.toISOString().slice(0,7);
  let active=false, pane='list', pending=null, timer=null;
  const fmt=n=>n==null?'Review':n.toLocaleString('en-GB');
  const money=n=>n==null?'Review':(n/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sum=(rows,key)=>rows.some(r=>r[key]==null)?null:rows.reduce((s,r)=>s+r[key],0);
  const group=(rows,key)=>{const map=new Map();for(const row of rows){if(!map.has(row[key]))map.set(row[key],[]);map.get(row[key]).push(row);}return map;};
  function amounts(rows) {
    const sales=[...group(rows,'currency')].map(([currency,rs])=>esc(currency)+' '+money(sum(rs,'salesCents'))).join(' · ');
    return [fmt(sum(rows,'qty')),sales||'—',fmt(sum(rows,'reserved')),money(sum(rows,'costCents')),fmt(sum(rows,'incoming')),fmt(sum(rows,'toArrange'))].map(v=>'<td>'+v+'</td>').join('');
  }
  function paint(data) {
    let html='',idx=0;
    for(const lines of group(data.lines,'customerId').values()){
      const firstCustomer=idx===0,cid='c'+idx++;
      html+='<tr><th><button type="button" data-fold="'+cid+'" aria-expanded="'+firstCustomer+'">'+esc(lines[0].customer)+'</button></th>'+amounts(lines)+'</tr>';
      let j=0;
      for(const [order,items] of group(lines,'order')){
        const oid=cid+'o'+j++,expanded=firstCustomer&&j===1;
        html+='<tr data-parent="'+cid+'" '+(firstCustomer?'':'hidden')+'><th class="outlook-order"><button type="button" data-fold="'+oid+'" aria-expanded="'+expanded+'">'+esc(order)+'</button></th>'+amounts(items)+'</tr>';
        for(const item of items)html+='<tr data-parent="'+oid+'" '+(expanded?'':'hidden')+'><td class="outlook-product">'+esc(item.product)+'<small>'+esc(item.barcode)+' · '+esc(item.packing)+'</small></td>'+amounts([item])+'</tr>';
      }
    }
    output.innerHTML='<div class="outlook-scroll"><table><thead><tr><th>Customer / order / product</th><th>Ordered CTN<br>remaining</th><th>Expected sales</th><th>Reserved<br>CTN</th><th>Reserved cost<br>MYR</th><th>On PO, not received<br>CTN</th><th>To arrange<br>CTN</th></tr></thead><tbody>'+html+'</tbody><tfoot><tr><th>Included orders</th>'+amounts(data.lines)+'</tr></tfoot></table></div><h2>Company available stock</h2><p>'+fmt(sum(data.available,'qty'))+' CTN · MYR '+money(sum(data.available,'cents'))+'</p><div class="outlook-scroll"><table><thead><tr><th>Product</th><th>Barcode / packing</th><th>Available CTN</th><th>Value MYR</th></tr></thead><tbody>'+data.available.map(r=>'<tr><td>'+esc(r.product)+'</td><td>'+esc(r.barcode)+' · '+esc(r.packing)+'</td><td>'+fmt(r.qty)+'</td><td>'+money(r.cents)+'</td></tr>').join('')+'</tbody></table></div>';
    if(!data.lines.length)output.insertAdjacentHTML('afterbegin','<p>No confirmed order lines for this shipment month.</p>');
    if(data.review.length)output.insertAdjacentHTML('afterbegin','<div role="status"><b>Review required · Excluded from order totals</b><ul>'+data.review.map(r=>'<li>'+esc(r.order)+' · '+esc(r.product)+' · '+esc(r.reason)+'</li>').join('')+'</ul></div>');
  }
  function updateRows(){for(const row of output.querySelectorAll('[data-parent]')){const parent=output.querySelector('[data-fold="'+row.dataset.parent+'"]');row.hidden=parent.closest('tr').hidden||parent.getAttribute('aria-expanded')!=='true';}}
  output.addEventListener('click',e=>{const b=e.target.closest('[data-fold]');if(!b)return;b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'));updateRows();});
  function read(){
    clearTimeout(timer);pending=null;
    if(!asOf.reportValidity()||!month.reportValidity()){output.replaceChildren();return;}
    pending=crypto.randomUUID();output.textContent='Reading month-end inventory…';
    parent.postMessage({type:'FINANCE_INVENTORY_OUTLOOK_REQUEST',company:company.value,requestId:pending,asOf:asOf.value,month:month.value},'*');
    timer=setTimeout(()=>{pending=null;output.textContent='Outlook could not be confirmed. Select Refresh to retry.';},45000);
  }
  window.addEventListener('message',e=>{const m=e.data;if(e.source!==parent||m?.type!=='FINANCE_INVENTORY_OUTLOOK_RESULT'||m.company!==company.value||!pending||m.requestId!==pending)return;
    clearTimeout(timer);pending=null;
    if(!m.ok){output.textContent=m.review?'Historical evidence requires review. No closing balances are shown.':'Outlook could not be confirmed. Check Finance access or refresh.';return;}
    if(m.result?.company!==company.value||m.result?.asOf!==asOf.value||m.result?.shipmentMonth!==month.value){output.textContent='Report period changed. Select Refresh.';return;}
    paint(m.result);
  });
  function show(name){pane=name;app.hidden=active&&name==='outlook';section.hidden=!app.hidden;bar.hidden=!active;
    for(const b of bar.querySelectorAll('[data-pane]'))b.setAttribute('aria-pressed',String(b.dataset.pane===name));
    if(!section.hidden)read();else{clearTimeout(timer);pending=null;output.replaceChildren();}
  }
  document.querySelector('.stock-entry')&&bar.insertBefore(document.querySelector('.stock-entry'),bar.lastElementChild);
  bar.addEventListener('click',e=>{const b=e.target.closest('[data-pane]');if(b)show(b.dataset.pane);});
  document.addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(!b)return;active=b.dataset.view==='stock';show('list');});
  company.addEventListener('change',()=>show(pane));
  section.querySelector('[data-read]').onclick=read;
  asOf.onchange=month.onchange=read;
})();
