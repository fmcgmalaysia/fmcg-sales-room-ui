(() => {
  const section=document.querySelector('#inventoryReport'), bar=document.querySelector('#inventoryViews');
  const app=document.querySelector('#app'),company=document.querySelector('#company');
  const asOf=section.querySelector('[type=date]'),month=section.querySelector('[type=month]'),output=section.querySelector('[data-output]');
  const archiveStatus=section.querySelector('[data-archive-status]');
  const openOriginal=section.querySelector('[data-original]');
  const reviewClosing=section.querySelector('[data-review-close]');
  const confirmClosing=section.querySelector('[data-confirm-close]');
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  asOf.value=asOf.max=today;
  const next=new Date(today.slice(0,7)+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);month.value=next.toISOString().slice(0,7);
  let active=false, pane='list', pending=null, timer=null, revision=null;
  const fmt=n=>n==null?'Review':n.toLocaleString('en-GB');
  const money=n=>n==null?'Review':(n/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sum=(rows,key)=>rows.some(r=>r[key]==null)?null:rows.reduce((s,r)=>s+r[key],0);
  const group=(rows,key)=>{const map=new Map();for(const row of rows){if(!map.has(row[key]))map.set(row[key],[]);map.get(row[key]).push(row);}return map;};
  const units=(count,unit)=>fmt(count)+(count==null?'':' '+unit);
  const orderRef=order=>String(order).replace(/^ORD-CUS-.+-([a-f0-9]{8})[a-f0-9]{24}$/i,'Order $1');
  const fullDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')
    ? new Date(date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) : '';
  const salesByCurrency=rows=>[...group(rows,'currency')].map(([currency,rs])=>{
    const amount=sum(rs,'salesCents');
    return esc(currency)+' '+money(amount);
  });
  const metric=(label,value,note='')=>'<div class="outlook-metric"><span>'+label+'</span><strong>'+value+'</strong>'+(note?'<small>'+note+'</small>':'')+'</div>';
  function amounts(rows) {
    const sales=salesByCurrency(rows).map(item=>'<span class="outlook-currency">'+item+'</span>').join('');
    return [fmt(sum(rows,'qty')),sales||'—',fmt(sum(rows,'reserved')),money(sum(rows,'costCents')),fmt(sum(rows,'incoming')),fmt(sum(rows,'toArrange'))].map(v=>'<td>'+v+'</td>').join('');
  }
  function reviewPanel(rows) {
    if(!rows.length)return '';
    const groups=[...group(rows,'reason')].map(([reason,items])=>'<section class="outlook-review-group"><h3>'+esc(reason)+'</h3><ul>'+items.map(item=>
      '<li><span>'+esc(item.product)+'</span><small title="'+esc(item.order)+'">'+esc(orderRef(item.order))+'</small></li>').join('')+'</ul></section>').join('');
    return '<details class="outlook-review"><summary><strong>Needs review</strong><span>'+rows.length+' order '+(rows.length===1?'line':'lines')+' excluded from these totals</span></summary><div class="outlook-review-content">'+groups+'</div></details>';
  }
  function availableStock(rows) {
    const total=sum(rows,'cents');
    const value=total==null?'Value needs review':'MYR '+money(total);
    const body=rows.length?'<div class="outlook-scroll" aria-label="Available stock details" role="region" tabindex="0"><table><thead><tr><th scope="col">Product</th><th scope="col">Barcode · Packing</th><th scope="col">Available CTN</th><th scope="col">Value MYR</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.product)+'</td><td>'+esc(r.barcode)+' · '+esc(r.packing)+'</td><td>'+fmt(r.qty)+'</td><td>'+money(r.cents)+'</td></tr>').join('')+'</tbody></table></div>' : '<p class="outlook-empty">No unallocated stock at this date.</p>';
    return '<details class="outlook-stock"><summary><strong>Company available stock</strong><span>'+units(sum(rows,'qty'),'CTN')+' · '+value+'</span></summary>'+body+'</details>';
  }
  function paint(data) {
    let html='',idx=0;
    for(const lines of group(data.lines,'customerId').values()){
      const cid='c'+idx++, orders=group(lines,'order');
      const count=orders.size+' '+(orders.size===1?'order':'orders');
      html+='<tr class="outlook-customer"><th scope="row"><button type="button" data-fold="'+cid+'" aria-expanded="false"><span>'+esc(lines[0].customer)+'<small>'+count+'</small></span></button></th>'+amounts(lines)+'</tr>';
      let j=0;
      for(const [order,items] of orders){
        const oid=cid+'o'+j++,dates=new Set(items.map(item=>item.date));
        const date=dates.size===1?fullDate(items[0].date):'';
        html+='<tr data-parent="'+cid+'" hidden class="outlook-order-row"><th scope="row" class="outlook-order"><button type="button" data-fold="'+oid+'" aria-expanded="false" title="'+esc(order)+'"><span>'+esc(orderRef(order))+(date?'<small>'+esc(date)+'</small>':'')+'</span></button></th>'+amounts(items)+'</tr>';
        for(const item of items)html+='<tr data-parent="'+oid+'" hidden><th scope="row" class="outlook-product">'+esc(item.product)+'<small>'+esc(item.barcode)+' · '+esc(item.packing)+'</small></th>'+amounts([item])+'</tr>';
      }
    }
    const reservedCost=sum(data.lines,'costCents');
    const metrics=metric('Expected sales',salesByCurrency(data.lines).map(item=>'<span class="outlook-currency">'+item+'</span>').join(''),units(sum(data.lines,'qty'),'CTN remaining'))+
      metric('In warehouse for orders',units(sum(data.lines,'reserved'),'CTN'),reservedCost==null?'Reserved stock cost needs review':'MYR '+money(reservedCost)+' reserved stock cost')+
      metric('On P.O. awaiting receipt',units(sum(data.lines,'incoming'),'CTN'))+
      metric('Still to arrange',units(sum(data.lines,'toArrange'),'CTN'));
    const table='<div class="outlook-scroll" aria-label="Customer order outlook" role="region" tabindex="0"><table class="outlook-orders"><thead><tr><th scope="col">Customer and order</th><th scope="col">Remaining<small>CTN</small></th><th scope="col">Expected sales</th><th scope="col">In warehouse<small>CTN</small></th><th scope="col">Reserved stock cost<small>MYR</small></th><th scope="col">Awaiting receipt<small>CTN</small></th><th scope="col">To arrange<small>CTN</small></th></tr></thead><tbody>'+html+'</tbody><tfoot><tr><th scope="row">All included orders</th>'+amounts(data.lines)+'</tr></tfoot></table></div>';
    output.innerHTML='<div class="outlook-section-heading"><h2>Shipment outlook</h2><span>'+esc(new Date(data.shipmentMonth+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}))+'</span></div>'+
      (data.lines.length?'<div class="outlook-metrics">'+metrics+'</div>':'')+reviewPanel(data.review)+
      (data.lines.length?table:'<p class="outlook-empty">No confirmed order lines for this shipment month.</p>')+availableStock(data.available);
  }
  function updateRows(){for(const row of output.querySelectorAll('[data-parent]')){const parent=output.querySelector('[data-fold="'+row.dataset.parent+'"]');row.hidden=parent.closest('tr').hidden||parent.getAttribute('aria-expanded')!=='true';}}
  output.addEventListener('click',e=>{const b=e.target.closest('[data-fold]');if(!b)return;b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'));updateRows();});
  function completedMonthEnd(){
    if (!asOf.value || asOf.value>=today) return false;
    const date=new Date(asOf.value+'T00:00:00Z');
    date.setUTCDate(date.getUTCDate()+1);
    return date.getUTCDate()===1;
  }
  function paintClosing(data, saved) {
    paint(data.outlook);
    const summary=data.totals;
    const rows=data.products.flatMap(p=>p.sources.map(s=>'<tr><td>'+esc(p.name)+'<small>'+esc(p.barcode)+' · '+esc(p.packing)+'</small></td><td>'+esc(s.po || s.sourceType || s.sourceTaskId)+'</td><td>'+fmt(s.onHand)+'</td><td>'+fmt(s.reservedUsable)+'</td><td>'+fmt(s.available)+'</td><td>'+money(s.valuation.valueCents)+'</td></tr>')).join('');
    const closingMetrics=metric('On hand',units(summary.onHand.quantity,'CTN'),'MYR '+money(summary.valuation.knownValueCents)+' known stock value')+
      metric('Reserved',units(summary.reservedUsable.quantity,'CTN'))+metric('Available',units(summary.available.quantity,'CTN'))+
      metric('Isolated',units(summary.isolated.quantity,'CTN'));
    output.insertAdjacentHTML('afterbegin','<div class="outlook-section-heading"><h2>'+ (saved ? 'Original closing balance' : 'Review closing balance') +'</h2><span>'+esc(fullDate(data.asOf))+'</span></div><div class="outlook-metrics">'+closingMetrics+'</div><details class="outlook-stock outlook-closing"><summary><strong>Closing stock by source</strong></summary><div class="outlook-scroll" aria-label="Closing stock by source" role="region" tabindex="0"><table><thead><tr><th scope="col">Product</th><th scope="col">Source</th><th scope="col">On hand CTN</th><th scope="col">Reserved CTN</th><th scope="col">Available CTN</th><th scope="col">Value MYR</th></tr></thead><tbody>'+rows+'</tbody></table></div></details>');
    archiveStatus.textContent=saved
      ? 'Version '+data.version+' · Confirmed by '+data.closedBy+' · '+new Date(data.closedAt).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})+' MYT'
      : 'Check the balance and source details, then select Confirm month-end to save the original.';
  }
  function read(kind='READ'){
    clearTimeout(timer);pending=null;
    if(!asOf.reportValidity()||!month.reportValidity()){output.replaceChildren();return;}
    const closing=completedMonthEnd(), reviewedRevision=revision;
    revision=null;
    confirmClosing.hidden=true;
    openOriginal.disabled=reviewClosing.disabled=!closing;
    if (kind==='SAVE' && (!reviewedRevision || !closing)) return;
    archiveStatus.textContent='';
    pending={id:crypto.randomUUID(),kind};
    output.textContent=kind==='SAVE'?'Saving the original closing balance…':'Reading month-end inventory…';
    parent.postMessage({type:'FINANCE_INVENTORY_OUTLOOK_REQUEST',kind,company:company.value,requestId:pending.id,asOf:asOf.value,month:month.value,revision:reviewedRevision},'*');
    timer=setTimeout(()=>{pending=null;output.textContent=kind==='SAVE'?'Save not confirmed. Select Open original to check.':'Outlook could not be confirmed. Select Refresh to retry.';},45000);
  }
  window.addEventListener('message',e=>{const m=e.data;if(e.source!==parent||m?.type!=='FINANCE_INVENTORY_OUTLOOK_RESULT'||m.company!==company.value||!pending||m.requestId!==pending.id)return;
    const {kind}=pending;
    clearTimeout(timer);pending=null;
    if(!m.ok){output.textContent=m.review?'Historical evidence requires review. No closing balances are shown.':kind==='SAVE'?'Save not confirmed. Select Open original to check, or review the balance again.':'Request unavailable. Check Finance access or try again.';return;}
    if(kind!=='READ'){
      const original=kind==='PREVIEW'?m.result?.original:m.result;
      if(original?.company===company.value && original.asOf===asOf.value){paintClosing(original,true);return;}
      const preview=m.result?.preview;
      if(kind==='PREVIEW' && preview?.company===company.value && preview.asOf===asOf.value && /^[0-9a-f]{32}$/.test(m.result.revision||'')){
        revision=m.result.revision;paintClosing(preview,false);confirmClosing.hidden=false;return;
      }
      output.textContent=kind==='ORIGINAL' && !m.result?'No original saved for this month.':'Closing balance unavailable. Select Open original to check.';
      return;
    }
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
  section.querySelector('[data-read]').onclick=()=>read();
  openOriginal.onclick=()=>read('ORIGINAL');
  reviewClosing.onclick=()=>read('PREVIEW');
  confirmClosing.onclick=()=>read('SAVE');
  asOf.onchange=month.onchange=()=>read();
})();
