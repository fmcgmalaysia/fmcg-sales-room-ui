(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(value,places=0)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-GB',{minimumFractionDigits:places,maximumFractionDigits:places}):'—';
  const day=value=>{if(!value||!/^\d{4}-\d{2}-\d{2}/.test(value))return '—';return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(value.slice(0,10)+'T00:00:00Z'));};
  const guides=[['BC','Booking Confirmation','订舱确认'],['SI','Sales Invoice','销售发票'],['DO','Delivery Order','送货单'],['CN','Credit Note','贷项通知单'],['PL','Packing List','装箱单'],['INS','Insurance','保险'],['CF','Customs Form','报关单'],['$','Payment','客户付款凭证']];
  let company='NCT',view='orders',tab='invoices',data=null,selectedCustomer='',selectedOrder='',busy=false,readSequence=0;
  const pending=new Map();let parentOrigin='';
  try{const ref=new URL(document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(ref.hostname))parentOrigin=ref.origin;}catch(_){}
  $('guide-items').innerHTML=guides.map(([code,label,zh])=>'<div class="guide-item"><strong>'+code+'</strong><span>'+label+'<small>'+zh+'</small></span></div>').join('');
  function send(type){
    if(parent===window||!parentOrigin)return Promise.reject(Error('Open this workroom from the MASTER Support page. 请从 MASTER Support 页面打开。'));
    const requestId=crypto.randomUUID(),requestCompany=company;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Loading could not be confirmed. Click Refresh to try again.'));},30000);
      pending.set(requestId,{company:requestCompany,resultType:type.replace('_REQUEST','_RESULT'),resolve,reject,timer});parent.postMessage({type,company:requestCompany,requestId},parentOrigin);});
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==parentOrigin)return;
    const message=event.data||{},request=pending.get(message.requestId);
    if(message.type==='FULFILMENT_LOGIN_RESULT'&&message.ok){load();return;}
    if(!request||message.company!==request.company||message.type!==request.resultType)return;
    clearTimeout(request.timer);pending.delete(message.requestId);
    if(message.ok!==true||message.result?.ok===false)request.reject(Error(message.error||message.result?.error||'Could not load current orders.'));
    else request.resolve(message.result);
  });
  function info(title,html){$('information-title').textContent=title;$('information-body').innerHTML=html;$('information').showModal();}
  function matching(rows){const query=$('search').value.trim().toLowerCase(),customer=$('customer-filter').value;return rows.filter(row=>(!customer||row.customerId===customer||row.id===customer)&&(!query||[row.customerName,row.name,row.orderId,row.number,row.currency,...(row.invoices||[]).map(invoice=>invoice.number)].filter(Boolean).join(' ').toLowerCase().includes(query)));}
  function table(headers,rows,cls=''){return '<table class="work-table '+cls+'"><thead><tr>'+headers.map(([label,num])=>'<th'+(num?' class="num"':'')+'>'+label+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+(rows.length?'':'<tr><td class="empty" colspan="'+headers.length+'">No matching records</td></tr>')+'</tbody></table>';}
  function documents(customerId,shipmentIds){const entries=data.customers.find(customer=>customer.id===customerId)?.transactions||[];return entries.flatMap(entry=>entry.documents||[]).filter(doc=>!shipmentIds||shipmentIds.includes(doc.shipmentId));}
  function docs(customerId,ids){const records=documents(customerId,ids);return '<div class="doc-strip">'+guides.map(([code,label])=>{const type={SI:'SALES_INV',CN:'SALES_CN','$':'CUSTOMER_RECEIPT'}[code],count=type?records.filter(doc=>doc.type===type).length:0;return '<button class="'+(count?'available':'')+'" data-doc="'+code+'" data-customer="'+esc(customerId)+'" data-shipments="'+esc(JSON.stringify(ids||[]))+'" aria-label="'+label+'">'+code+'</button>';}).join('')+'</div>';}
  function ordersTable(rows){return table([['Customer'],['Currency'],['Items',true],['Country'],['Port'],['Order Progress'],['Shipment Details'],['Invoice No.'],['Docs']],rows.map(row=>'<tr data-order-row="'+esc(row.id)+'"><td><button class="link customer-link" data-order="'+esc(row.id)+'">'+esc(row.customerName)+'</button><small>'+esc(row.orderId)+'</small></td><td>'+esc(row.currency||'—')+'</td><td class="num">'+(row.lines.length?row.items:'—')+'</td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.port||'—')+'</td><td><span class="plain-status '+(row.progress==='Dispatched'?'blue':'')+'">'+row.progress+'</span></td><td><button class="link" data-shipment="'+esc(row.id)+'" aria-label="Shipment details">✎</button></td><td>'+row.shipments.filter(shipment=>shipment.invoice).map(shipment=>'<button class="link" data-invoice="'+esc(shipment.id)+'">'+esc(shipment.invoice.number)+'</button>').join('<br>')+'</td><td>'+docs(row.customerId,row.shipments.map(s=>s.id))+'</td></tr>'));}
  function invoiceTable(rows){return table([['Invoice No.'],['Invoice Date'],['Shipment Status'],['Amount',true],['Paid',true],['Balance',true],['Payment Status'],['Docs']],rows.map(row=>'<tr><td><button class="link" data-invoice="'+esc(row.id)+'">'+esc(row.number)+'</button></td><td>'+day(row.date)+'</td><td><span class="plain-status '+(row.shipmentStatus==='Dispatched'?'blue':'')+'">'+row.shipmentStatus+'</span></td><td class="num">'+esc(row.currency)+' '+number(row.amountCents/100,2)+'</td><td class="num">—</td><td class="num">—</td><td>'+row.paymentStatus+'</td><td>'+docs(row.customerId,[row.id])+'</td></tr>'));}
  function render(){
    $('back').hidden=!['customer','order'].includes(view);$('guide').hidden=view!=='orders';$('summary').hidden=view!=='customer';$('subnav').hidden=view!=='customer';$('customer-filter').hidden=['customer','order'].includes(view);
    document.querySelectorAll('nav [data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===(view==='customer'?'customers':view==='order'?'orders':view)));
    $('company-name').textContent=company==='NCT'?'North Cape Trading Sdn. Bhd.':'Global HR';
    if(!data){$('content').innerHTML='<div class="loading">'+(busy?'Loading customer orders…':'Customer orders have not loaded.')+'</div>';$('count').textContent='';return;}
    if(view==='orders'){$('title').textContent='Orders & Shipments';const rows=matching(data.orders);$('content').innerHTML=ordersTable(rows);$('count').textContent=rows.length+' orders';}
    if(view==='customers'){
      $('title').textContent='Customers';const rows=matching(data.customers);$('count').textContent=rows.length+' customers';
      $('content').innerHTML=table([['Customer'],['Country'],['Currency'],['Open Orders',true],['Invoices',true],['Outstanding',true]],rows.map(row=>'<tr><td><button class="link customer-link" data-customer-open="'+esc(row.id)+'">'+esc(row.name)+'</button></td><td>'+esc([...new Set(row.orders.map(order=>order.country).filter(Boolean))].join(', ')||'—')+'</td><td>'+esc([...new Set(row.orders.map(order=>order.currency).concat(row.invoices.map(invoice=>invoice.currency)).filter(Boolean))].join(', ')||'—')+'</td><td class="num">'+row.orders.filter(order=>order.progress!=='Dispatched').length+'</td><td class="num">'+row.invoices.length+'</td><td class="num">—<small>Awaiting reconciliation</small></td></tr>'));
    }
    if(view==='customer'){
      const customer=data.customers.find(row=>row.id===selectedCustomer);if(!customer){view='customers';render();return;}$('title').textContent=customer.name;
      $('summary').innerHTML=[['Open Orders',customer.orders.filter(row=>row.progress!=='Dispatched').length,'Across all active orders'],['Invoices',customer.invoices.length,'Issued sales invoices'],['Outstanding','—','Awaiting Finance reconciliation'],['Unallocated Payment','—','Finance confirmation required']].map(([label,value,help])=>'<div><span>'+label+'</span><b>'+value+'</b><small>'+help+'</small></div>').join('');
      $('subnav').innerHTML=[['invoices','Invoices'],['orders','Orders & Shipments'],['transactions','Transactions']].map(([id,label])=>'<button data-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+label+'</button>').join('');
      if(tab==='invoices'){$('content').innerHTML=invoiceTable(matching(customer.invoices));$('count').textContent=customer.invoices.length+' invoices';}
      if(tab==='orders'){$('content').innerHTML=ordersTable(matching(customer.orders));$('count').textContent=customer.orders.length+' orders';}
      if(tab==='transactions'){$('count').textContent=customer.transactions.length+' records';$('content').innerHTML=table([['Date'],['Reference'],['Type'],['Currency'],['Amount',true],['Status']],customer.transactions.map(row=>'<tr><td>'+day(row.date)+'</td><td>'+esc(row.number)+'</td><td>'+esc({SALES_INV:'Sales Invoice',SALES_CN:'Credit Note',DEBIT_NOTE:'Debit Note',CUSTOMER_RECEIPT:'Payment Document'}[row.type]||row.type)+'</td><td>'+esc(row.currency)+'</td><td class="num">'+number(row.amountCents/100,2)+'</td><td>'+ (row.type==='CUSTOMER_RECEIPT'?'Uploaded · Pending confirmation':'Recorded')+'</td></tr>'));}
    }
    if(view==='order'){
      const order=data.orders.find(row=>row.id===selectedOrder);if(!order){view='orders';render();return;}$('title').textContent=order.customerName;$('count').textContent=order.lines.length+' items';
      $('content').innerHTML='<div class="meta"><span>Order<b>'+esc(order.orderId)+'</b></span><span>Currency<b>'+esc(order.currency)+'</b></span><span>ETA<b>'+esc(order.eta||'—')+'</b></span><span>Shipment Date<b>—</b></span></div>'+table([['Clear'],['Row'],['Description'],['Order Qty',true],['Committed Qty',true],['Loaded Qty',true],['Prices',true],['GP',true],['CBM/Ctn',true]],order.lines.map((line,index)=>'<tr><td><input type="checkbox" disabled aria-label="Select row '+(index+1)+'"></td><td>'+String(index+1).padStart(3,'0')+'</td><td class="description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="num">'+number(line.orderQty)+'</td><td></td><td class="num">'+number(line.loadedQty)+'</td><td class="num">'+number(line.pricePc,2)+'<small>'+number(line.priceCtn,2)+'</small></td><td class="num '+(line.gp!==null&&line.gp<6?'gp-low':'')+'">'+(line.gp===null?'—':number(line.gp,2)+'%')+'</td><td class="num">'+(line.cbm>0?number(line.cbm,4):'<button class="issue" data-cbm aria-label="CBM is missing">⚠</button>')+'</td></tr>'),'detail')+'<div class="selection-bar"><span class="action-note">Invoice selection and shipment saving are being connected. 当前草稿先核对订单显示。</span><button disabled>Create Sales Invoice</button></div>';
    }
  }
  async function load(){
    const sequence=++readSequence;busy=true;$('refresh').disabled=true;$('notice').textContent='Loading customer orders…';render();
    const results=await Promise.allSettled([send('FULFILMENT_READ_REQUEST'),send('PACKING_READ_REQUEST')]);
    if(sequence!==readSequence)return;
    busy=false;$('refresh').disabled=false;
    if(results[0].status==='rejected'){data=null;$('notice').textContent=results[0].reason.message;$('login').hidden=false;render();return;}
    try{data=window.SupportWorkroom.project(results[0].value,results[1].status==='fulfilled'?results[1].value:null);$('staff').textContent=data.staff?.staffName||'';$('login').hidden=true;$('notice').textContent=results[1].status==='rejected'?'Warehouse quantities could not be loaded; shown as —.':'';
      const filter=$('customer-filter').value;$('customer-filter').innerHTML='<option value="">All Customers</option>'+data.customers.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join('');$('customer-filter').value=data.customers.some(row=>row.id===filter)?filter:'';
    }catch(error){data=null;$('notice').textContent=error.message;}render();
  }
  document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;
    if(button.dataset.close){$(button.dataset.close).close();return;}
    if(button.dataset.view){view=button.dataset.view;$('search').value='';$('customer-filter').value='';render();}
    if(button.dataset.customerOpen){selectedCustomer=button.dataset.customerOpen;view='customer';tab='invoices';$('search').value='';render();}
    if(button.dataset.order){selectedOrder=button.dataset.order;view='order';render();}
    if(button.dataset.tab){tab=button.dataset.tab;render();}
    if(button.hasAttribute('data-cbm'))info('CBM Required','<p>Please contact Warehouse to update CBM per carton as soon as possible.</p><p>请尽快联系货仓员工更新每箱 CBM。</p>');
    if(button.dataset.shipment)info('Shipment Details','<p>Shipment booking details are being connected to order records. 此项保存正在接入订单记录。</p>');
    if(button.dataset.invoice){const invoice=data.invoices.find(row=>row.id===button.dataset.invoice);if(invoice)info('Sales Invoice','<p><b>'+esc(invoice.number)+'</b></p><p>'+day(invoice.date)+' · '+esc(invoice.currency)+' '+number(invoice.amountCents/100,2)+'</p>'+table([['Description'],['Qty',true],['Price/Ctn',true]],invoice.lines.map(line=>'<tr><td>'+esc(line.name)+'</td><td class="num">'+number(line.quantity)+'</td><td class="num">'+number(line.sellingPriceCtn,2)+'</td></tr>')));}
    if(button.dataset.doc){const ids=JSON.parse(button.dataset.shipments||'[]'),records=documents(button.dataset.customer,ids.length?ids:undefined).filter(row=>row.type==={SI:'SALES_INV',CN:'SALES_CN','$':'CUSTOMER_RECEIPT'}[button.dataset.doc]);
      info(guides.find(row=>row[0]===button.dataset.doc)?.[1]||'Document',records.length?records.map(row=>{const safe=typeof row.url==='string'&&/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/.test(row.url);return '<p>'+ (safe?'<a target="_blank" rel="noopener noreferrer" href="'+esc(row.url)+'">'+esc(row.name||row.number)+'</a>':esc(row.name||row.number))+'<br><small>'+esc(row.by||'')+' · '+day(row.at)+'</small></p>';}).join(''):'<p>No uploaded document. 尚未上传文件。</p><p>Document upload is being connected. 文件保存正在接入。</p>');}
  });
  $('back').onclick=()=>{view=view==='customer'?'customers':'orders';$('search').value='';render();};$('search').oninput=render;$('customer-filter').onchange=render;$('refresh').onclick=load;
  $('company').onchange=()=>{company=$('company').value;data=null;view='orders';selectedCustomer='';selectedOrder='';$('search').value='';$('customer-filter').value='';$('staff').textContent='';$('packing').href='packing-workbench.html?v=20261021-packing-v1&live=1&department=SUPPORT&company='+company;load();};
  $('login').onclick=()=>{if(parentOrigin)parent.postMessage({type:'FULFILMENT_LOGIN_REQUEST'},parentOrigin);};load();
})();
