(() => {
  'use strict';
  document.documentElement.dataset.supportBuild='20261105-support-transaction-context-v1';
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(value,places=0)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-GB',{minimumFractionDigits:places,maximumFractionDigits:places}):'—';
  const supportDayFormat=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:'UTC'});
  const day=value=>{if(!value||!/^\d{4}-\d{2}-\d{2}/.test(value))return '—';return supportDayFormat.format(new Date(value.slice(0,10)+'T00:00:00Z'));};
  const expiryDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(2,4):'—', planningToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const guides=[['SO','Sales Order','销售订单'],['BL','Bill of Lading','海运提单'],['BC','Booking Confirmation','订舱确认'],['SI','Sales Invoice','销售发票'],['DO','Delivery Order','送货单'],['CN','Credit Note','贷项通知单'],['DN','Debit Note','借项通知单'],['PL','Packing List','装箱单'],['INS','Insurance','保险'],['CF','Customs Form','报关单'],['$','Payment Slip','客户付款凭证']];
  let company=new URLSearchParams(location.search).get('company')==='GHR'?'GHR':'NCT',view='customers',tab='invoices',data=null,selectedCustomer='',selectedOrder='',busy=false,readSequence=0,readCache=null,deskReceiptEpoch=0;
  let activeDesk=0,deskBusy=false;const deskAttempts=new Map();
  const deliveryAttempts=new Map();let delivering=false;
  const detailsDrafts=new Map();let detailsContext=null,detailOpener=null;
  const pending=new Map(),activeReadSets=new Map(),bookingAttempts=new Map(),invoiceAttempts=new Map(),selectedLines=new Set(),documentAttempts=new Map();let parentOrigin='',bookingOrder='',bookingBusy=false,invoiceBusy=false,reviewOrder='',documentContext=null,documentBusy=false,dragContext=null;const rowPreferences=new Map();
  try{const ref=new URL(location.ancestorOrigins?.[0]||document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(ref.hostname))parentOrigin=ref.origin;}catch(_){}
  $('guide-items').innerHTML=guides.map(([code,label,zh])=>'<div class="guide-item"><strong>'+code+'</strong><span>'+label+'<small>'+zh+'</small></span></div>').join('');
  function send(type,input,identity){
    if(parent===window||!parentOrigin)return Promise.reject(Error('Open this workroom from the MASTER Support page. 请从 MASTER Support 页面打开。'));
    const requestId=identity||crypto.randomUUID(),requestCompany=company;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Loading could not be confirmed. Click Refresh to try again.'));},30000);
      pending.set(requestId,{company:requestCompany,resultType:type.replace('_REQUEST','_RESULT'),resolve,reject,timer});parent.postMessage({type,company:requestCompany,requestId,...(input?{input}:{})},parentOrigin);});
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==parentOrigin)return;
    const message=event.data||{},request=pending.get(message.requestId);
    if(message.type==='FULFILMENT_LOGIN_RESULT'&&message.ok){load();return;}
    if(!request||message.company!==request.company||message.type!==request.resultType)return;
    clearTimeout(request.timer);pending.delete(message.requestId);
    if(message.ok!==true||message.result?.ok===false){const error=Error(message.error||message.result?.error||'Could not load current orders.');error.retryable=message.result?.retryable;request.reject(error);}
    else request.resolve(message.result);
  });
  function info(title,html){$('print-saved-invoice').hidden=true;$('information-title').textContent=title;$('information-body').innerHTML=html;$('information').showModal();}
  function matching(rows,filterCustomer=true){const query=$('search').value.trim().toLowerCase(),customer=filterCustomer?$('customer-filter').value:'';return rows.filter(row=>(!customer||row.customerId===customer||row.id===customer)&&(!query||[row.customerName,row.name,row.orderId,row.number,row.currency,...(row.invoices||[]).map(invoice=>invoice.number)].filter(Boolean).join(' ').toLowerCase().includes(query)));}
  function table(headers,rows,cls=''){return '<table class="work-table '+cls+'"><thead><tr>'+headers.map(([label,num])=>'<th'+(num?' class="num"':'')+'>'+label+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+(rows.length?'':'<tr><td class="empty" colspan="'+headers.length+'">No matching records</td></tr>')+'</tbody></table>';}
  function documents(customerId,shipmentIds){const entries=data.customers.find(customer=>customer.id===customerId)?.transactions||[];return entries.flatMap(entry=>entry.documents||[]).filter(doc=>!shipmentIds||shipmentIds.includes(doc.shipmentId));}
  const documentGuides=['SO','DO','SI','PL','CN','BC','CF','BL','INS','$','DN'].map(code=>guides.find(guide=>guide[0]===code));
  const documentLabel=code=>code==='$'?'TT':code;
  function matchesDeskDocument(doc,customerId,desk,batchId,invoiceId=''){
    if(doc.customerId!==customerId)return false;
    if(doc.scope==='INVOICE')return Boolean(invoiceId)&&doc.invoiceId===invoiceId;
    return doc.scope==='DESK'&&doc.desk===desk&&
      (doc.invoiceId?doc.invoiceId===invoiceId:Boolean(batchId)&&(doc.batchId||initialDeskBatch(desk,customerId))===batchId);
  }
  function supportDocs(customerId,orderId,invoiceId,code){const invoice=data.invoices.find(row=>row.id===invoiceId),desk=invoice?.deskNumber;if(desk)return (data.documents||[]).filter(doc=>doc.code===code&&matchesDeskDocument(doc,customerId,desk,invoice.deskBatchId||initialDeskBatch(desk,customerId),invoiceId));const scope=invoiceId&&['SI','CN','DN','$'].includes(code)?'INVOICE':'ORDER';return (data.documents||[]).filter(doc=>doc.customerId===customerId&&doc.orderId===orderId&&doc.code===code&&doc.scope===scope&&(scope==='ORDER'||doc.invoiceId===invoiceId));}
  function docs(customerId,ids,orderId='',invoiceId=''){const records=documents(customerId,ids);return '<div class="doc-strip">'+documentGuides.map(([code,label])=>{const type={SI:'SALES_INV',CN:'SALES_CN',DN:'DEBIT_NOTE','$':'CUSTOMER_RECEIPT'}[code],count=supportDocs(customerId,orderId,invoiceId,code).length+(type?records.filter(doc=>doc.type===type).length:0);return '<button class="'+(count?'available':'')+'" data-doc="'+code+'" data-customer="'+esc(customerId)+'" data-order-id="'+esc(orderId)+'" data-invoice-id="'+esc(invoiceId)+'" aria-label="'+label+'">'+documentLabel(code)+'</button>';}).join('')+'</div>';}
  function ordersTable(rows){return table([['Customer'],['Currency'],['Items',true],['Country'],['Port'],['Order Progress'],['Shipment Details'],['Invoice No.'],['Docs']],rows.map(row=>'<tr data-order-row="'+esc(row.id)+'"><td><button class="link customer-link" '+(row.invoiceId?'data-invoice="'+esc(row.invoiceId)+'"':'data-order="'+esc(row.id)+'"')+'>'+esc(row.customerName)+'</button><small>'+esc(row.orderId)+'</small></td><td>'+esc(row.currency||'—')+'</td><td class="num">'+(row.lines.length?row.items:'—')+'</td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.port||'—')+'</td><td><span class="plain-status '+(row.progress==='Dispatched'?'blue':'')+'">'+row.progress+'</span></td><td><button class="link" data-shipment="'+esc(row.bookingOrderId||row.id)+'" aria-label="Shipment details">'+(row.booking?esc(transportLabel(row.booking.transport))+'<small>'+day(row.booking.date)+'</small>':'✎')+'</button></td><td>'+row.shipments.filter(shipment=>shipment.invoice).map(shipment=>'<button class="link" data-invoice="'+esc(shipment.id)+'">'+esc(shipment.invoice.number)+'</button>').join('<br>')+'</td><td>'+docs(row.customerId,row.shipments.map(s=>s.id),row.orderId,row.invoiceId||'')+'</td></tr>'));}
  function renderInvoiceRegister(){
    const month=$('invoice-month').value;
    if(!month){$('count').textContent='';$('content').innerHTML='<div class="empty">Select an invoice month.</div>';return;}
    const invoices=new Map();
    for(const customer of data.customers){
      const issued=(customer.transactions||[]).filter(row=>row.type==='SALES_INV'||row.type==='CHARGE_INV'||row.invoiceKind==='STANDALONE_DN');
      for(const row of issued){
        if(!row.id||row.pending||row.customerId!==customer.id||(row.company&&row.company!==data.company)||String(row.date||'').slice(0,7)!==month)continue;
        invoices.set(row.id,{...row,customerName:customer.name});
      }
    }
    const rows=matching([...invoices.values()],false).sort((a,b)=>b.date.localeCompare(a.date)||String(a.number).localeCompare(String(b.number)));
    $('count').textContent=invoices.size+' issued'+(rows.length!==invoices.size?' · '+rows.length+' shown':'');
    $('content').innerHTML=table([['Invoice'],['Customer'],['Invoice Date'],['Type'],['Currency'],['Invoice Amount',true]],rows.map(row=>{
      const debit=row.invoiceKind==='STANDALONE_DN',charge=row.type==='CHARGE_INV'||debit,label=esc(row.number);
      const invoice=charge?(/^[A-Za-z0-9_-]{10,200}$/.test(row.fileId||'')?'<a class="link" target="_blank" rel="noopener noreferrer" href="https://drive.google.com/file/d/'+encodeURIComponent(row.fileId)+'/view">'+label+'</a>':label):'<button type="button" class="link" data-invoice="'+esc(row.id)+'">'+label+'</button>';
      return '<tr><td>'+invoice+'</td><td>'+esc(row.customerName)+'</td><td>'+day(row.date)+'</td><td>'+(debit?'Debit Note':charge?'Charge':'Goods')+'</td><td>'+esc(row.currency)+'</td><td class="num">'+(Number.isSafeInteger(row.amountCents)?number(row.amountCents/100,2):'—')+'</td></tr>';
    }),'invoice-register');
  }

  function chargeInvoiceDetails(row){
    const names=(row.chargeLines||[]).map(line=>String(line.description||'').trim()).filter(Boolean);
    return [...new Set(names.map(name=>/^ocean freight$/i.test(name)?'Ocean Fee':name))].join(' + ')||'Charge invoice';
  }
  function chargeInvoiceDocs(row){
    const fileId=row.fileId||'';
    return '<div class="doc-strip">'+documentGuides.map(([code,label])=>{
      if(code===(row.invoiceKind==='STANDALONE_DN'?'DN':'SI')&&/^[A-Za-z0-9_-]{10,200}$/.test(fileId))return '<a class="invoice-file" target="_blank" rel="noopener noreferrer" aria-label="'+esc(label)+'" href="https://drive.google.com/file/d/'+encodeURIComponent(fileId)+'/view">'+code+'</a>';
      if(row.type==='CHARGE_INV'&&['$','CN','DN'].includes(code)||row.type==='DEBIT_NOTE'&&!row.pending&&row.invoiceKind==='STANDALONE_DN'&&code==='$'){
        const available=supportDocs(row.customerId,'',row.id,code).length>0;
        return '<button type="button" class="'+(available?'available':'')+'" data-doc="'+code+'" data-customer="'+esc(row.customerId)+'" data-order-id="" data-invoice-id="'+esc(row.id)+'" aria-label="'+esc(label)+'">'+documentLabel(code)+'</button>';
      }
      return '<span class="invoice-file-muted" title="'+esc(label)+'" aria-label="'+esc(label)+' unavailable">'+documentLabel(code)+'</span>';
    }).join('')+'</div>';
  }
  function invoiceTable(rows){
    const ordersById=new Map(data.orders.map(order=>[JSON.stringify([order.customerId,order.orderId]),order]));
    return table([['Invoice'],['Details'],['Shipped On'],['Currency'],['Invoice Amount',true],['Balance Due',true],['Payment Status'],['Docs']],rows.map(row=>{
      const debit=row.invoiceKind==='STANDALONE_DN',charge=debit||['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type);
      const lines=row.lines||[],order=ordersById.get(JSON.stringify([row.customerId,lines[0]?.orderId]));
      const qty=lines.length&&lines.every(line=>Number.isSafeInteger(line.quantity)&&line.quantity>=0)?lines.reduce((sum,line)=>sum+line.quantity,0):null;
      const details=charge?(debit?'Debit Note · ':'')+chargeInvoiceDetails(row):'Order of goods'+(qty===null?'':' '+qty+' ctn');
      const numberLabel=charge?'<strong>'+esc(row.number)+'</strong>':'<button class="link" data-invoice="'+esc(row.id)+'">'+esc(row.number)+'</button>';
      const shippedOn=charge?'—':day(row.dispatch?.at||(row.deskNumber?row.deskShipment?.departureDate:order?.booking?.departureDate));
      const status=charge&&row.pending?'Awaiting Finance':row.paymentStatus;
      const files=charge?chargeInvoiceDocs(row):docs(row.customerId,[row.id],lines[0]?.orderId||'',row.id);
      return '<tr><td>'+numberLabel+'<small>Inv Date '+day(row.pending?null:row.date)+'</small></td><td class="invoice-details">'+esc(details)+'</td><td>'+shippedOn+'</td><td>'+esc(row.currency)+'</td><td class="num">'+number(row.amountCents/100,2)+'</td><td class="num">'+(Number.isSafeInteger(row.balanceCents)?number(row.balanceCents/100,2):'—')+'</td><td><span class="plain-status neutral">'+esc(status)+'</span></td><td>'+files+'</td></tr>';
    }),'invoice-list');
  }
  function transportLabel(value){return {LAND:'LAND',SEA_20FT:'SEA 20FT',SEA_40FT:'SEA 40FT',OTHER:'Other'}[value]||'—';}
  function openBooking(id){
    const order=data.orders.find(row=>row.id===id);if(!order)return;
    if(!order.bookingAvailable){info('Shipment Details','<p>Shipment details have not loaded. Refresh before editing.</p><p>订船资料尚未读取成功，请刷新后再修改。</p>');return;}
    bookingOrder=id;const retained=bookingAttempts.get(company+'|'+id),value=retained?.input||order.booking||{};$('booking-arrival-label').hidden=true;$('booking-date').min='1000-01-01';
    $('booking-order').textContent=order.customerName+' · '+order.orderId;
    document.querySelectorAll('input[name="transport"]').forEach(input=>input.checked=input.value===value.transport);
    $('booking-date').value=value.date||'';$('booking-date').min=value.date&&value.date<planningToday()?value.date:planningToday();$('booking-fields').disabled=Boolean(retained);$('booking-save').disabled=bookingBusy;
    $('booking-save').textContent=retained?'Retry Save':'Save';$('booking-status').textContent=retained?'The previous save was not confirmed. Retry the same details. 上次保存未确认，请重试。':'';
    $('booking').showModal();
  }
  $('booking-form').onsubmit=async event=>{
    event.preventDefault();if(bookingBusy)return;
    if(bookingOrder.startsWith('DESK:')){const order=activeOrder();if(!order||activeDesk===0)return;const transport=document.querySelector('input[name="transport"]:checked')?.value,date=$('booking-date').value,arrival=$('booking-arrival').value;if(!transport||!date)return;const saved=deskState().shipments.find(row=>row.desk===activeDesk)||{};if([['date',date],['arrival',arrival]].some(([key,value])=>value&&value!==saved[key]&&value<planningToday())){$('booking-status').textContent='Select today or a future shipment date.';return;}const ok=await saveDeskChange({action:'DESK_SHIPMENT',customerId:selectedCustomer,desk:activeDesk,revision:deskState().revision,transport,date,arrival},'booking-status');if(ok)$('booking').close();return;}
    const order=data?.orders.find(row=>row.id===bookingOrder);if(!order||!order.bookingAvailable)return;
    const saveCompany=company,key=company+'|'+bookingOrder;
    let attempt=bookingAttempts.get(key);
    if(!attempt){const transport=document.querySelector('input[name="transport"]:checked')?.value,date=$('booking-date').value;if(!transport||!date)return;if(date!==order.booking?.date&&date<planningToday()){$('booking-status').textContent='Select today or a future shipment date.';return;}attempt={requestId:crypto.randomUUID(),input:{customerId:order.customerId,orderId:order.orderId,transport,date,revision:order.booking?.revision||''}};bookingAttempts.set(key,attempt);}
    bookingBusy=true;$('booking-fields').disabled=true;$('booking-save').disabled=true;$('booking-status').textContent='Saving…';
    try{const result=await send('SUPPORT_BOOKING_SAVE_REQUEST',attempt.input,attempt.requestId);if(result.company!==saveCompany||result.requestId!==attempt.requestId||!result.booking?.revision||result.booking.customerId!==order.customerId||result.booking.orderId!==order.orderId)throw Error('Booking save could not be confirmed.');bookingAttempts.delete(key);$('booking').close();if(company===saveCompany)await load([2]);}
    catch(error){$('booking-status').textContent=error.message;$('booking-save').textContent='Retry Save';}
    finally{bookingBusy=false;$('booking-save').disabled=false;}
  };
  function preferenceKey(order){return 'support-row-order|'+company+'|'+order.id;}
  function viewLines(order){const key=preferenceKey(order);let saved=activeDesk?(deskLock()?.snapshot?.rowOrder??deskState().rowOrders?.find(row=>row.desk===activeDesk&&row.batchId===deskBatch())?.taskIds??[]):rowPreferences.get(key);if(!saved){try{saved=JSON.parse(localStorage.getItem(key)||'[]');}catch(_){saved=[];}if(!Array.isArray(saved))saved=[];}const ids=Array.from(new Set(saved.filter(id=>order.lines.some(line=>line.taskId===id))));const newIds=order.lines.map(line=>line.taskId).filter(id=>!ids.includes(id));if(activeDesk)newIds.sort((a,b)=>a<b?-1:a>b?1:0);ids.push(...newIds);return ids.map(id=>order.lines.find(line=>line.taskId===id));}
  function reorderDeskRow(order,taskId,targetIndex){
    const ids=viewLines(order).map(line=>line.taskId),from=ids.indexOf(taskId);
    if(from<0||targetIndex<0||targetIndex>=ids.length||from===targetIndex)return;
    ids.splice(targetIndex,0,ids.splice(from,1)[0]);
    if(activeDesk){
      if(deskBusy||deskPending()||invoiceBusy||deskLock())return;
      void saveDeskChange({action:'DESK_ORDER',customerId:selectedCustomer,desk:activeDesk,revision:deskState().revision,batchId:deskBatch(),taskIds:ids});
      return;
    }
    const key=preferenceKey(order);rowPreferences.set(key,ids);
    try{localStorage.setItem(key,JSON.stringify(ids));}catch(_){}render();
  }
  document.addEventListener('dragstart',event=>{
    const handle=event.target.closest('[data-drag-task]');
    if(!handle||handle.disabled)return;
    dragContext={company,orderId:activeOrder()?.id,taskId:handle.dataset.dragTask,desk:activeDesk};
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',handle.dataset.dragTask);
  });
  document.addEventListener('dragover',event=>{
    if(dragContext&&event.target.closest('tr[data-task]')){event.preventDefault();event.dataTransfer.dropEffect='move';}
  });
  document.addEventListener('drop',event=>{
    const row=event.target.closest('tr[data-task]'),order=activeOrder(),drag=dragContext;dragContext=null;
    if(!row||!order||!drag||drag.company!==company||drag.orderId!==order.id||drag.desk!==activeDesk)return;
    event.preventDefault();reorderDeskRow(order,drag.taskId,viewLines(order).findIndex(line=>line.taskId===row.dataset.task));
  });
  document.addEventListener('dragend',()=>dragContext=null);
  document.addEventListener('keydown',event=>{
    const handle=event.target.closest('[data-drag-task]'),order=activeOrder();
    if(!handle||handle.disabled||!order||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();
    const index=viewLines(order).findIndex(line=>line.taskId===handle.dataset.dragTask);
    if(index>=0)reorderDeskRow(order,handle.dataset.dragTask,index+(event.key==='ArrowUp'?-1:1));
  });
  function selectedReview(order){return order?viewLines(order).filter(line=>line.invoiceReadyQty>0).map(line=>({...line,quantity:line.invoiceReadyQty})):[];}
  function reviewTotal(){const attempt=invoiceAttempts.get(company+'|'+reviewOrder),order=activeOrder(),lines=attempt?.review||selectedReview(order);let total=0;for(const line of lines){const value=Number(document.querySelector('[data-invoice-qty="'+line.taskId+'"]')?.value);total+=Math.round(value*line.priceCtn*100);} $('invoice-total').textContent=(lines[0]?.currency||order?.currency||'')+' '+number(total/100,2);}
  function openInvoiceReview(id){
    const order=activeOrder();if(!order||order.id!==id||!data.invoiceVersion||!data.deskAvailable||data.deskMetadataVersion<2||activeDesk===0||deskBusy||deskPending()||deskLock()?.status==='ISSUED')return;if(new Set(selectedReview(order).map(line=>line.currency)).size>1){info('Invoice Currency','<p>Move different currencies to separate Desks before invoicing.</p><p>请先将不同货币的任务分到不同工作台。</p>');return;}
    const attempt=invoiceAttempts.get(company+'|'+id);if(!attempt&&!deskReceiptsComplete(order))return;reviewOrder=id;const lines=attempt?.review||selectedReview(order);
    dialogCustomer('invoice-context',order.customerName,'Desk '+activeDesk+' · '+(attempt?.review?.[0]?.currency||invoiceCurrency(order)));
    $('invoice-review-lines').innerHTML=table([['Description'],['Loaded',true],['Amount',true]],lines.map(line=>'<tr><td class="description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="num"><input class="invoice-qty" readonly data-invoice-qty="'+esc(line.taskId)+'" type="number" min="1" max="'+line.invoiceReadyQty+'" step="1" value="'+line.quantity+'" '+(attempt?'disabled':'')+' required></td><td class="num">'+number(Math.round(line.quantity*line.priceCtn*100)/100,2)+'</td></tr>'));
    $('invoice-number').value=attempt?.input.number||'';$('invoice-fields').disabled=Boolean(attempt);$('invoice-status').textContent=attempt?'The earlier save is not confirmed. Retry the same save or withdraw the unissued request. 上次保存尚未确认，请重试或撤回未开出的请求。':order.lines.some(line=>line.invoiceReadyQty<(line.orderQty??0)-line.invoicedQty)?'Resolve the remaining Desk quantities before confirming this invoice.':'';
    $('invoice-withdraw').hidden=!attempt;$('invoice-withdraw').disabled=invoiceBusy;$('invoice-confirm').disabled=invoiceBusy||!lines.length||(!attempt&&order.lines.some(line=>line.invoiceReadyQty<(line.orderQty??0)-line.invoicedQty));$('invoice-confirm').textContent=attempt?'Retry Confirmation':'Confirm';reviewTotal();$('invoice-review').showModal();
  }
  document.addEventListener('change',event=>{const input=event.target;if(!input.dataset.deskTask)return;const order=activeOrder(),line=order?.lines.find(row=>row.taskId===input.dataset.deskTask);if(!line||!data.deskAvailable||deskBusy)return;if(input.value==='SPLIT'){input.value=String(taskDesk(line.taskId));openDeskSplit(line.taskId);return;}const desk=Number(input.value);if(![0,1,2,3].includes(desk)||desk===taskDesk(line.taskId))return;saveDeskChange({action:'DESK_ASSIGN',customerId:selectedCustomer,taskId:line.taskId,desk,revision:deskState().revision});});
  document.addEventListener('input',event=>{if(event.target.hasAttribute('data-invoice-qty'))reviewTotal();});
  function confirmedInvoiceAttempt(attempt,model,customerId){
    if(!attempt||!model)return null;const hold=model.deskLocks.find(row=>row.customerId===customerId&&row.desk===attempt.input.desk.number&&row.status==='ISSUED'&&row.requestId===attempt.requestId),invoice=hold&&model.invoices.find(row=>row.id===hold.invoiceId);
    return invoice&&invoice.customerId===customerId&&invoice.number===attempt.input.number&&invoice.lines.length===attempt.input.lines.length&&attempt.input.lines.every(line=>invoice.lines.some(saved=>saved.taskId===line.taskId&&saved.quantity===line.quantity))?invoice:null;
  }
  $('invoice-form').onsubmit=async event=>{
    event.preventDefault();if(invoiceBusy)return;const order=activeOrder();if(!order)return;const saveCompany=company,key=company+'|'+reviewOrder;let attempt=invoiceAttempts.get(key);
    if(!attempt&&!deskReceiptsComplete(order)){$('invoice-status').textContent='Complete receiving for every line on this Desk before confirming its invoice.';return;}
    if(!attempt&&order.lines.some(line=>line.invoiceReadyQty<(line.orderQty??0)-line.invoicedQty)){$('invoice-status').textContent='Resolve the remaining Desk quantities before confirming this invoice.';return;}
    if(!attempt){const lines=selectedReview(order).map(line=>({...line,quantity:Number(document.querySelector('[data-invoice-qty="'+line.taskId+'"]')?.value)}));if(!lines.length||lines.some(line=>!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>line.invoiceReadyQty))return;attempt={requestId:crypto.randomUUID(),review:lines,input:{version:data.invoiceVersion,desk:{number:activeDesk,revision:deskState().revision},customerId:order.customerId,orderId:lines[0].orderId,...(new Set(lines.map(line=>line.orderId)).size>1?{orderIds:[...new Set(lines.map(line=>line.orderId))]}:{}),number:$('invoice-number').value.trim(),lines:lines.map(line=>({taskId:line.taskId,quantity:line.quantity}))}};if(!attempt.input.number)return;invoiceAttempts.set(key,attempt);}
    invoiceBusy=true;$('invoice-confirm').disabled=true;$('invoice-fields').disabled=true;$('invoice-withdraw').disabled=true;document.querySelectorAll('[data-invoice-qty]').forEach(input=>input.disabled=true);$('invoice-status').textContent='Creating invoice…';
    try{const result=await send('SUPPORT_INVOICE_SAVE_REQUEST',attempt.input,attempt.requestId);if(result.company!==saveCompany||result.requestId!==attempt.requestId||!result.shipmentId)throw Error('Invoice creation could not be confirmed.');invoiceAttempts.delete(key);selectedLines.clear();$('invoice-review').close();if(company===saveCompany){await load([0,1,2,3]);selectedCustomer=order.customerId;if(deskLock()?.archiveRequired===true){render();return;}view='transactions';$('customer-filter').value=selectedCustomer;render();}}
    catch(error){$('invoice-status').textContent='Checking saved invoice…';if(company===saveCompany)await load([0,1,2,3]);if(company===saveCompany&&confirmedInvoiceAttempt(attempt,data,order.customerId)){invoiceAttempts.delete(key);selectedLines.clear();$('invoice-review').close();selectedCustomer=order.customerId;if(deskLock()?.archiveRequired===true){render();return;}view='transactions';$('customer-filter').value=selectedCustomer;render();}else{$('invoice-status').textContent=error.message;$('invoice-confirm').textContent='Retry Confirmation';$('invoice-withdraw').hidden=false;}}
    finally{invoiceBusy=false;$('invoice-confirm').disabled=false;$('invoice-withdraw').disabled=false;}
  };
  $('invoice-withdraw').onclick=async()=>{const key=company+'|'+reviewOrder,attempt=invoiceAttempts.get(key);if(!attempt||invoiceBusy)return;invoiceBusy=true;$('invoice-withdraw').disabled=true;$('invoice-confirm').disabled=true;attempt.cancelId=attempt.cancelId||crypto.randomUUID();try{const result=await send('SUPPORT_INVOICE_CANCEL_REQUEST',{invoiceRequestId:attempt.requestId},attempt.cancelId);if(!result.cancelled||result.requestId!==attempt.cancelId)throw Error('Withdrawal is not confirmed.');invoiceAttempts.delete(key);selectedLines.clear();$('invoice-review').close();await load([0,1,2,3]);}catch(error){$('invoice-status').textContent=error.message;}finally{invoiceBusy=false;$('invoice-withdraw').disabled=false;$('invoice-confirm').disabled=false;}};
  function documentKey(ctx){return JSON.stringify([company,ctx.customerId,ctx.orderId,ctx.invoiceId||'',ctx.code,ctx.desk||0,ctx.batchId||'',ctx.replacesDocumentId||'',ctx.charge||false]);}
  function renderDocumentHistory(){
    const c=documentContext,invoiceId=$('document-invoice').value||c.invoiceId,type={SI:'SALES_INV',CN:'SALES_CN',DN:'DEBIT_NOTE','$':'CUSTOMER_RECEIPT'}[c.code];
    const records=(data.customerFiles?.length?data.customerFiles:(data.documents||[]).map(row=>({...row,sourceKind:'SUPPORT'}))).filter(row=>row.customerId===c.customerId&&(row.code===c.code||type&&row.type===type)&&(c.customerScope?row.scope==='CUSTOMER'||row.sourceKind==='ACCOUNT':c.desk?matchesDeskDocument(row,c.customerId,c.desk,c.batchId,c.invoiceId):row.orderId===c.orderId&&(!invoiceId||row.invoiceId===invoiceId||row.shipmentId===invoiceId||row.scope==='ORDER'&&!type)));
    $('document-history').innerHTML=records.map(row=>{const safe=/^[A-Za-z0-9_-]{10,200}$/.test(row.fileId||''),financial=['$','CN','DN'].includes(row.code),status=row.superseded?'Superseded 已替换':row.financeRecorded||row.sourceKind==='ACCOUNT'?'Recorded 已记录':financial?'Awaiting Finance 待财务核对':'';return '<div class="document-item">'+(safe?'<a target="_blank" rel="noopener noreferrer" href="https://drive.google.com/file/d/'+encodeURIComponent(row.fileId)+'/view">'+esc(row.name||row.number)+'</a>':esc(row.name||row.number))+'<small>'+esc(row.by||'')+' · '+day(row.at)+(status?' · '+status:'')+'</small>'+(!row.superseded&&!row.customerLinkReady?'<button type="button" data-prepare-file="'+esc(row.id)+'" data-file-source="'+row.sourceKind+'" '+(delivering?'disabled':'')+'>Prepare customer download 准备客户下载</button>':'')+(financial&&!row.superseded&&!row.financeRecorded?'<button type="button" data-replace-proof="'+esc(row.id)+'" '+(documentBusy?'disabled':'')+'>Replace 更换</button>':'')+'</div>';}).join('')||'<p class="muted">No uploaded document. 尚未上传文件。</p>';
  }
  async function prepareCustomerFile(id,sourceKind){
    if(delivering||!documentContext||!data.documentVersion)return;const c={...documentContext},saveCompany=company,key=JSON.stringify([company,sourceKind,id]);let attempt=deliveryAttempts.get(key);if(!attempt){attempt={requestId:crypto.randomUUID(),input:{action:'DELIVER',documentId:id,sourceKind,customerId:c.customerId,version:data.documentVersion}};deliveryAttempts.set(key,attempt);}delivering=true;renderDocumentHistory();$('document-status').textContent='Preparing customer download…';
    try{const result=await send('SUPPORT_DOCUMENT_SAVE_REQUEST',attempt.input,attempt.requestId);if(result.company!==saveCompany||result.requestId!==attempt.requestId||result.documentId!==id||result.customerLinkReady!==true)throw Error('Customer download is not confirmed. Retry the same preparation.');deliveryAttempts.delete(key);if(company===saveCompany){await load([4]);renderDocumentHistory();$('document-status').textContent='Customer download ready.';}}catch(error){$('document-status').textContent=error.message;}finally{delivering=false;renderDocumentHistory();}
  }
  document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.prepareFile)prepareCustomerFile(button.dataset.prepareFile,button.dataset.fileSource);if(button.dataset.replaceProof&&!documentBusy&&!delivering){const d=(data.documents||[]).find(row=>row.id===button.dataset.replaceProof);if(d&&!d.superseded&&!d.financeRecorded){$('documents').close();openDocument(d.code,d.customerId,d.orderId,d.invoiceId,d.desk||0,d.id);}}});
  function openDocument(code,customerId,orderId,invoiceId,desk=0,replacesDocumentId='',charge=false){
    document.getElementById('charge-lines')?.remove();$('document-amount').readOnly=false;$('charge-currency')?.closest('label').remove();$('document-reference').readOnly=false;$('document-reference').placeholder='';$('document-invoice').disabled=false;$('document-deposit').disabled=false;
    desk=desk||data.invoices.find(row=>row.id===invoiceId)?.deskNumber||0;
    const customerScope=!orderId&&!invoiceId&&['$','CN','DN'].includes(code);$('documents').classList.toggle('charge-form',Boolean(charge));$('documents').classList.toggle('standalone-debit-form',charge==='STANDALONE_DN');documentContext={code,customerId,orderId:orderId||'',invoiceId:invoiceId||'',desk,batchId:invoiceId?data.invoices.find(row=>row.id===invoiceId)?.deskBatchId||initialDeskBatch(desk,customerId):deskBatch(desk,customerId),customerScope,replacesDocumentId,charge};const customer=data.customers.find(row=>row.id===customerId),invoices=data.invoices.filter(row=>row.customerId===customerId&&row.lines.some(line=>line.orderId===orderId)&&(!desk||invoiceId?(!desk||row.id===invoiceId):row.deskNumber===desk&&row.deskBatchId===documentContext.batchId));
    $('document-title').textContent=guides.find(row=>row[0]===code)?.[1]||'Document';dialogCustomer('document-context',customer?.name||customerId,customerScope?'Customer account 客户账户':!orderId&&invoiceId?customer?.transactions?.find(row=>row.id===invoiceId)?.number||invoiceId:desk?'Desk '+desk:day(data.orders.find(row=>row.orderId===orderId)?.orderDate));
    $('document-form').reset();$('document-invoice-label').hidden=code!=='SI'||Boolean(desk);$('document-invoice').innerHTML=invoices.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.number)+'</option>').join('');$('document-invoice').value=invoiceId||invoices[0]?.id||'';
    $('document-reference-label').hidden=code==='SI';$('document-reference').required=['CN','DN','$'].includes(code);$('document-amount-label').hidden=!['CN','DN','$'].includes(code);$('document-amount').required=['CN','DN','$'].includes(code);$('document-deposit-label').hidden=code!=='$';
    const replaced=(data.documents||[]).find(row=>row.id===replacesDocumentId);if(replaced){$('document-reference').value=replaced.reference||'';$('document-amount').value=(replaced.amountCents/100).toFixed(2);}
    const attempt=documentAttempts.get(documentKey(documentContext)),recovery=attempt?null:window.SupportWorkroom.pendingDocumentAttempt({...documentContext,invoiceKind:charge==='STANDALONE_DN'?charge:undefined},data);documentContext.recovery=recovery;if(attempt){$('document-amount').value=(attempt.input.amountCents/100).toFixed(2);$('document-reference').value=attempt.input.reference||'';}$('document-fields').disabled=Boolean(attempt)||!data.documentVersion;$('document-upload').disabled=documentBusy||!data.documentVersion||code==='SI'&&!invoices.length;$('document-upload').textContent=attempt?'Retry Upload':'Upload';$('document-file').required=!attempt;
    $('document-status').textContent=attempt?'The earlier upload is not confirmed. Retry the same upload. 上次上传尚未确认，请重试。':!data.documentVersion?'Refresh to load current documents. 请刷新文件资料。':code==='SI'&&!invoices.length?'Create the Sales Invoice first. 请先开出销售发票。':'';
    if(charge){$('document-title').textContent=charge==='STANDALONE_DN'?'Debit Note':'Charge Invoice';dialogCustomer('document-context',customer?.name||customerId,company);
    $('document-invoice-label').hidden=true;$('document-reference-label').hidden=false;$('document-reference').required=true;$('document-amount-label').hidden=false;$('document-amount').readOnly=true;$('document-amount').value=attempt?(attempt.input.amountCents/100).toFixed(2):'0.00';$('document-upload').disabled=documentBusy||!data.documentVersion;$('document-status').textContent=attempt?'Retry this same upload.':'Reference only. Finance confirms the actual charges before they enter the customer account.';const container=document.createElement('div');container.id='charge-lines';$('document-fields').append(container);const lines=attempt?.input.chargeLines||recovery?.input?.chargeLines||[{description:'',amountCents:0}];const pendingInput=attempt?.input||recovery?.input;
const allowedCurrencies=['MYR','SGD','USD','RMB','EUR'];
const originalCurrency=pendingInput?.chargeCurrency||'';
const preferred=originalCurrency||(allowedCurrencies.includes(customer?.currency)?customer.currency:'');
const reference=$('document-reference'),prefix=company+(charge==='STANDALONE_DN'?'-DN-':'-INV-');
reference.placeholder=prefix+'000000';reference.value=pendingInput?.reference||prefix;
const currencies=originalCurrency&&!allowedCurrencies.includes(originalCurrency)?[...allowedCurrencies,originalCurrency]:allowedCurrencies;
const choices=charge==='STANDALONE_DN'?['On behalf of customer','Other']:['Ocean Fee','Insurance','Sticker Printing','Labour Charges','Other'];
container.innerHTML='<label>Currency<select id="charge-currency" required>'+(!preferred?'<option value="">Select currency</option>':'')+currencies.map(code=>'<option value="'+code+'"'+(code===preferred?' selected':'')+'>'+code+'</option>').join('')+'</select></label>'+
  (attempt||recovery?(pendingInput?lines.map(row=>chargeLineHtml(row)).join(''):''):'<fieldset class="charge-options"><legend>Charge Types</legend>'+choices.map(label=>'<div><label class="charge-option"><input type="checkbox" data-charge-option> '+label+'</label>'+chargeLineHtml({description:['Other','On behalf of customer'].includes(label)?'':label,amountCents:0},label)+'</div>').join('')+'</fieldset>');
for(const option of container.querySelectorAll('[data-charge-option]')){const row=option.parentElement.nextElementSibling;const update=()=>{row.hidden=!option.checked;for(const input of row.querySelectorAll('input'))input.disabled=row.hidden;};option.addEventListener('input',update);update();}
const currency=container.querySelector('#charge-currency');$('charge-document-identity').append(currency.closest('label'));if(attempt||recovery)currency.disabled=true;container.addEventListener('click',event=>{if(event.target.hasAttribute('data-add-charge')&&container.querySelectorAll('[data-charge-line]').length<20){event.target.insertAdjacentHTML('beforebegin',chargeLineHtml({description:'',amountCents:0}));}});container.addEventListener('input',()=>{try{$('document-amount').value=(chargeValues(false).reduce((n,row)=>n+row.amountCents,0)/100).toFixed(2);$('document-status').textContent='Reference only. Finance confirms the actual charges.';}catch(error){$('document-status').textContent=error.message;}});}
    if(recovery){
      $('document-upload').disabled=Boolean(recovery.blocked)||!data.documentVersion;$('document-upload').textContent='Resume Original Upload';
      $('document-status').textContent=recovery.blocked?'The original request needs review. No new upload will be created. 原请求需核对，不会建立新上传。':'Choose the original PDF to resume the same upload. 请选择原PDF，继续原上传。';
      if(!recovery.blocked){$('document-reference').value=recovery.input.reference||'';$('document-amount').value=(recovery.input.amountCents/100).toFixed(2);$('document-deposit').checked=recovery.input.depositPayment===true;}
      $('document-reference').readOnly=true;$('document-amount').readOnly=true;$('document-invoice').disabled=true;$('document-deposit').disabled=true;document.querySelectorAll('#charge-lines input').forEach(field=>field.readOnly=true);
    }
    renderDocumentHistory();$('documents').showModal();
  }
  function chargeLineHtml(row,label=''){
    const named=label&&label!=='Other'&&label!=='On behalf of customer';
    return '<div data-charge-line class="charge-inputs"><input data-charge-description maxlength="200" aria-label="Charge description" placeholder="Describe charge" required '+(named?'hidden ':'')+'value="'+esc(row.description)+'"><input data-charge-amount aria-label="'+esc(label||'Charge')+' amount" inputmode="decimal" value="'+(row.amountCents/100).toFixed(2)+'"></div>';
  }
  function chargeValues(strict=true){
    const rows=[...document.querySelectorAll('#charge-lines [data-charge-line]:not([hidden])')];
    if(strict&&!rows.length)throw Error('Select at least one charge type.');
    return rows.map(row=>{
      const raw=row.querySelector('[data-charge-amount]').value.trim();
      if(!/^\d{1,10}(\.\d{1,2})?$/.test(raw))throw Error('Enter valid charge amounts.');
      if(strict&&Number(raw)<=0)throw Error('Enter a charge amount greater than zero for each selected type.');
      const description=row.querySelector('[data-charge-description]').value.trim();
      if(strict&&!description)throw Error('Enter a description for Other.');
      const [whole,fraction='']=raw.split('.');
      return {description,amountCents:Number(whole)*100+Number(fraction.padEnd(2,'0'))};
    });
  }
  $('document-invoice').onchange=renderDocumentHistory;
  document.addEventListener('focusout',event=>{const field=event.target;if(!(field.id==='document-amount'||field.hasAttribute('data-charge-amount')||field.name==='depositAmount'&&field.closest('#desk-details-form'))||field.disabled||field.readOnly)return;const raw=field.value.trim();if(!raw)field.value='0.00';else if(/^\d{1,10}(\.\d{1,2})?$/.test(raw))field.value=Number(raw).toFixed(2);if(field.name==='depositAmount')retainDetails();});
  $('document-form').onsubmit=async event=>{
    event.preventDefault();if(documentBusy||!documentContext||!data.documentVersion)return;const ctx={...documentContext},saveCompany=company,key=documentKey(ctx);let attempt=documentAttempts.get(key);documentBusy=true;$('document-upload').disabled=true;$('document-status').textContent='Uploading…';
    try{if(!attempt){const file=$('document-file').files[0];if(!file||file.size>3*1024*1024||file.size<5)throw Error('Select a PDF up to 3 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Select a valid PDF.');if(ctx.recovery){if(ctx.recovery.blocked)throw Error('The original request needs review.');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(file.size!==ctx.recovery.size||digest!==ctx.recovery.sha256)throw Error('Select the exact original PDF. The original request is retained. 请选择原PDF，原请求已保留。');}const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('File could not be read.'));reader.readAsDataURL(file);});const chargeLines=ctx.charge&&!ctx.recovery?chargeValues():null;const invoiceId=ctx.charge?'':ctx.code==='SI'?$('document-invoice').value:ctx.invoiceId,scope=ctx.charge==='STANDALONE_DN'?'CUSTOMER':ctx.charge?'INVOICE':ctx.customerScope?'CUSTOMER':ctx.desk?'DESK':invoiceId&&['SI','CN','DN','$'].includes(ctx.code)?'INVOICE':'ORDER',amountCents=ctx.charge?(chargeLines?.reduce((n,row)=>n+row.amountCents,0)??ctx.recovery.input.amountCents):['CN','DN','$'].includes(ctx.code)?Math.round(Number($('document-amount').value)*100):0;attempt=ctx.recovery?{requestId:ctx.recovery.requestId,input:{...ctx.recovery.input,base64}}:{requestId:crypto.randomUUID(),input:{version:data.documentVersion,code:ctx.code,customerId:ctx.customerId,orderId:ctx.orderId,invoiceId,scope,...(ctx.charge?{invoiceKind:ctx.charge,chargeCurrency:$('charge-currency').value,chargeLines}:{}),...(ctx.replacesDocumentId?{replacesDocumentId:ctx.replacesDocumentId}:{}),...(ctx.desk?{desk:ctx.desk,batchId:ctx.batchId}:{}),...(ctx.code==='$'?{depositPayment:$('document-deposit').checked}:{}),reference:$('document-reference').value.trim(),amountCents,base64}};documentAttempts.set(key,attempt);}
      $('document-fields').disabled=true;const result=await send('SUPPORT_DOCUMENT_SAVE_REQUEST',attempt.input,attempt.requestId);if(result.company!==saveCompany||result.requestId!==attempt.requestId||!result.documentId)throw Error('Document upload could not be confirmed.');documentAttempts.delete(key);$('documents').close();if(company===saveCompany)await load(ctx.charge==='STANDALONE_DN'?[0,4]:[4]);
    }catch(error){
      $('document-status').textContent='Checking saved document…';if(company===saveCompany)await load([4]);
      if(company===saveCompany&&window.SupportWorkroom.confirmedDocumentAttempt(attempt,data)){documentAttempts.delete(key);$('documents').close();}
      else{$('document-status').textContent=error.message;if(attempt)$('document-upload').textContent='Retry Upload';}
    }
    finally{documentBusy=false;$('document-upload').disabled=false;}
  };
  function showInvoice(id){const invoice=data.invoices.find(row=>row.id===id);if(!invoice)return;const customer=data.customers.find(row=>row.id===invoice.customerId),body='<div class="invoice-heading"><b>'+(company==='NCT'?'North Cape Trading Sdn. Bhd.':'GHR')+'</b><h2>Sales Invoice</h2></div><p><b>'+esc(invoice.number)+'</b><br>'+esc(customer?.name||invoice.customerId)+'<br>'+day(invoice.date)+' · '+esc(invoice.currency)+'</p>'+table([['Description'],['Qty',true],['Price/Ctn',true],['Amount',true]],invoice.lines.map(line=>'<tr><td class="description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="num">'+number(line.quantity)+'</td><td class="num">'+number(line.sellingPriceCtn,2)+'</td><td class="num">'+number(Math.round(line.quantity*line.sellingPriceCtn*100)/100,2)+'</td></tr>'))+'<p class="invoice-total">'+esc(invoice.currency)+' '+number(invoice.amountCents/100,2)+'</p>';info('Sales Invoice',body);$('print-saved-invoice').hidden=false;$('print-saved-invoice').onclick=()=>{$('print-invoice').innerHTML=body;$('print-invoice').hidden=false;document.body.classList.add('printing-invoice');window.print();};}
  window.addEventListener('afterprint',()=>{document.body.classList.remove('printing-invoice');$('print-invoice').hidden=true;});
  const entryIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
  const profileIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/></svg>';
  function customerOrders(id){return data.orders.filter(order=>order.customerId===id&&order.lines.some(line=>line.invoicedQty<(line.orderQty??0)));}
  function activeOrder(){
    const orders=data.orders.filter(row=>row.customerId===selectedCustomer),customer=data.customers.find(row=>row.id===selectedCustomer);if(!customer)return null;
    const hold=deskLock(),invoice=currentDeskInvoice(),all=orders.flatMap(row=>row.lines),open=all.filter(line=>line.invoicedQty<(line.orderQty??0));
    const frozen=invoice?invoice.lines.map(part=>{const source=all.find(row=>row.taskId===part.taskId)||{},ea=source.pricePc>0&&source.priceCtn>0?source.priceCtn/source.pricePc:null;return {...source,...part,orderQty:part.quantity,allocQty:part.quantity,loadedQty:part.quantity,invoiceReadyQty:0,invoicedQty:part.quantity,priceCtn:part.sellingPriceCtn,pricePc:ea?part.sellingPriceCtn/ea:null,currency:invoice.currency};}):null;
    const lines=frozen||open.flatMap(line=>{if(!activeDesk)return [{...line,orderQty:Math.max(0,line.orderQty-line.invoicedQty),allocQty:Math.max(0,line.allocQty-line.invoicedQty),loadedQty:Math.max(0,line.loadedQty-line.invoicedQty),invoicedQty:0}];if(line.deskPortions?.length){const part=line.deskPortions.find(row=>row.desk===activeDesk);return part&&part.quantity>(part.invoiced||0)?[{...line,portionDesk:part.desk,orderQty:part.quantity-(part.invoiced||0),allocQty:Math.max(0,(part.planned??part.allocated)-(part.invoiced||0)),loadedQty:Math.max(0,part.loaded-(part.invoiced||0)),invoicedQty:0,invoiceReadyQty:part.invoiceReadyQty}]:[];}return taskDesk(line.taskId)===activeDesk?[line]:[];}),currencies=[...new Set(lines.map(line=>line.currency).filter(Boolean))];
    return {...(orders[0]||{}),id:'TASKS:'+selectedCustomer+':DESK:'+activeDesk,customerId:selectedCustomer,customerName:customer.name,country:customer.country||orders[0]?.country||'',port:customer.port||orders[0]?.port||'',orders,lines,currency:currencies.length===1?currencies[0]:currencies.length?currencies.join(', '):customer.currency||orders[0]?.currency||''};
  }
  function invoiceCurrency(order){const currencies=[...new Set(selectedReview(order).map(line=>line.currency))];return currencies.length===1?currencies[0]:'';}
  function canSelect(line,order){const selectedCurrency=invoiceCurrency(order);return line.invoiceReadyQty>0&&(!selectedCurrency||line.currency===selectedCurrency);}
  function chooseCustomer(id){if(id!==selectedCustomer&&['Saved','Warehouse task recalled.','Desk authorized to Warehouse.'].includes($('notice').textContent))$('notice').textContent='';activeDesk=0;selectedCustomer=id;$('customer-filter').value=id;selectedOrder='';selectedLines.clear();}
  function deskState(){return data?.desks?.find(row=>row.customerId===selectedCustomer)||{company,customerId:selectedCustomer,revision:'',assignments:[],shipments:[]};}
  function deskBatch(desk=activeDesk,customerId=selectedCustomer){return data.desks?.find(row=>row.customerId===customerId)?.batches?.find(row=>row.desk===desk)?.id||'';}
  function initialDeskBatch(desk,customerId=selectedCustomer){return data.desks?.find(row=>row.customerId===customerId)?.batches?.find(row=>row.desk===desk)?.initialId||'';}
  function taskDesk(taskId){return deskState().assignments.find(row=>row.taskId===taskId)?.desk||0;}
  function deskPending(){return deskAttempts.get(company+'|'+selectedCustomer);}
  let deskSplitDialog;
  function openDeskSplit(taskId){
    const line=data.orders.flatMap(order=>order.lines).find(line=>line.taskId===taskId);if(!line||deskBusy||deskPending())return;
    const assignment=deskState().assignments.find(row=>row.taskId===taskId),total=line.orderQty-line.invoicedQty,parts=line.deskPortions?.length?line.deskPortions:assignment?.parts||[{desk:assignment?.desk||0,quantity:total}];
    const unassigned=Math.max(0,(parts.find(part=>part.desk===0)?.quantity||0)-(parts.find(part=>part.desk===0)?.invoiced||0));
    const sources=parts.filter(part=>part.desk>0&&part.quantity>(part.invoiced||0));
    if(!sources.length&&!unassigned)return;
    if(!deskSplitDialog){deskSplitDialog=document.createElement('dialog');deskSplitDialog.className='desk-split-dialog';document.body.append(deskSplitDialog);}
    const currentQty=part=>part.quantity-(part.invoiced||0);
    deskSplitDialog.setAttribute('aria-labelledby','desk-split-title');
    deskSplitDialog.innerHTML=`<form>
      <header class="dialog-header"><h2 id="desk-split-title">Split shipment 分批出货</h2><button type="button" data-close aria-label="Close">×</button></header>
      <div class="split-body"><b>${esc(line.name)}</b>
      ${sources.length?`<div class="split-quantities">
        <div class="split-quantity-row split-quantity-head"><span>Desk</span><span>Current Qty <small>原数量</small></span><span>Keep in Desk <small>保留数量</small></span></div>
        ${sources.map(part=>`<div class="split-quantity-row">
          <span>Desk ${part.desk}</span><strong>${number(currentQty(part))} CTN</strong>
          <input aria-label="Keep in Desk ${part.desk} 保留数量" data-part="${part.desk}" type="number" inputmode="numeric" step="1" value="${currentQty(part)}">
        </div>`).join('')}
      </div>`:''}
      ${unassigned?`<details><summary>Assign pending 安排待办 · ${number(unassigned)} CTN</summary><label>Qty<input data-assign-qty type="number" min="0" max="${unassigned}" step="1" value="0"></label><label>Desk<select data-assign-desk><option value="">Choose Desk</option>${[1,2,3].map(desk=>'<option value="'+desk+'">Desk '+desk+'</option>').join('')}</select></label></details>`:''}
      <div class="split-pending"><span>Pending after split <small>拆分后待安排</small></span><strong id="split-pending-qty" aria-live="polite"></strong></div>
      <p id="split-status" role="status"></p></div>
      <footer><button type="button" data-close>Cancel 取消</button><button type="submit" class="primary">Confirm 确认</button></footer>
    </form>`;
    const form=deskSplitDialog.querySelector('form'),button=form.querySelector('[type=submit]');let saving=false;
    const fields=()=>[...form.querySelectorAll('[data-part]')];
    const locked=input=>input.min===input.max||data.deskLocks.some(lock=>lock.customerId===selectedCustomer&&lock.desk===Number(input.dataset.part)&&(lock.status!=='ISSUED'||lock.archiveRequired===true));
    for(const input of fields()){
      const desk=Number(input.dataset.part),part=parts.find(row=>row.desk===desk),floor=(data.delivery?.lists||[]).filter(list=>list.desk?.number===desk&&!['DRAFT','CANCELLED'].includes(list.status)).flatMap(list=>list.lines.filter(row=>row.taskId===taskId)).reduce((n,row)=>n+(row.resolution?.maximum??row.quantity),0);
      input.max=String(currentQty(part));
      const movable=Math.max(0,part.quantity-Math.max(floor,part.invoiced||0));
      input.min=String(currentQty(part)-movable);
      input.disabled=locked(input);
    }
    const splitTotal=()=>fields().reduce((sum,input)=>sum+Number(input.max)-Number(input.value),0);
    const assignQty=()=>Number(form.querySelector('[data-assign-qty]')?.value||0),assignDesk=()=>Number(form.querySelector('[data-assign-desk]')?.value||0);
    const preview=()=>{
      const split=splitTotal(),assign=assignQty();
      const valid=Number.isSafeInteger(assign)&&assign>=0&&assign<=unassigned&&fields().every(input=>{
        const keep=Number(input.value);
        return input.value.trim()&&Number.isSafeInteger(keep)&&keep>=Number(input.min)&&keep<=Number(input.max);
      });
      form.querySelector('#split-pending-qty').textContent=valid?number(unassigned+split-assign)+' CTN':'—';
      button.disabled=!valid||split+assign<=0||(assign>0&&![1,2,3].includes(assignDesk()));
    };
    form.querySelector('[data-assign-qty]')?.addEventListener('input',preview);form.querySelector('[data-assign-desk]')?.addEventListener('change',preview);
    fields().forEach(input=>input.oninput=preview);form.querySelectorAll('[data-close]').forEach(close=>close.onclick=()=>{if(!saving&&!deskPending())deskSplitDialog.close();});deskSplitDialog.oncancel=event=>{if(saving||deskPending())event.preventDefault();};
    form.onsubmit=async event=>{event.preventDefault();if(saving)return;const retained=deskPending();if(!retained)preview();if(button.disabled)return;saving=true;button.disabled=true;
      const moved=splitTotal(),next=parts.filter(part=>part.desk!==0).map(part=>{
        const keep=form.querySelector('[data-part="'+part.desk+'"]');
        return {desk:part.desk,quantity:keep?Number(keep.value)+(part.invoiced||0):part.quantity};
      });
      if(assignQty()){const target=next.find(part=>part.desk===assignDesk());if(target)target.quantity+=assignQty();else next.push({desk:assignDesk(),quantity:assignQty()});}
      next.push({desk:0,quantity:(parts.find(part=>part.desk===0)?.quantity||0)+moved-assignQty()});fields().forEach(input=>input.disabled=true);form.querySelector('[data-assign-qty]')?.setAttribute('disabled','');form.querySelector('[data-assign-desk]')?.setAttribute('disabled','');
      const ok=await saveDeskChange(retained?.input||{action:'DESK_SPLIT',customerId:selectedCustomer,taskId,desk:assignment?.desk||0,revision:deskState().revision,parts:next.filter(part=>part.quantity>0)},'split-status');saving=false;button.disabled=false;
      if(ok){deskSplitDialog.close();await load([0,1,2]);}else if(deskPending())button.textContent='Retry same save 重试本次保存';else{fields().forEach(input=>input.disabled=locked(input));preview();}
    };preview();deskSplitDialog.showModal();
  }
  async function saveDeskChange(input,statusId='notice'){
    if(deskBusy)return false;const saveCompany=company,customerId=input.customerId,key=company+'|'+customerId;let attempt=deskAttempts.get(key);
    if(!attempt){attempt={requestId:crypto.randomUUID(),input};deskAttempts.set(key,attempt);}deskBusy=true;render();const status=$(statusId);if(status)status.textContent='Saving Desk details…';
    try{
      const result=await send('SUPPORT_BOOKING_SAVE_REQUEST',attempt.input,attempt.requestId),archive=attempt.input.action==='DESK_ARCHIVE';
      if(result.company!==saveCompany||result.requestId!==attempt.requestId||archive&&result.archivedInvoiceId!==attempt.input.invoiceId||result.deskState?.customerId!==customerId||!result.deskState.revision||!Array.isArray(result.deskState.assignments)||!Array.isArray(result.deskState.shipments)||result.deskState.company!==saveCompany)throw Error('Desk save could not be confirmed. Retry the same save.');
      deskAttempts.delete(key);
      if(company===saveCompany&&data){
        const priorDesk=data.desks.find(row=>row.customerId===customerId);
        if(!archive||!priorDesk||priorDesk.revision===attempt.input.revision||priorDesk.revision===result.deskState.revision){
          deskReceiptEpoch++;
          if(priorDesk?.batches){result.deskState.batches=priorDesk.batches.map(batch=>({...batch,...result.deskState.batches?.find(saved=>saved.desk===batch.desk)}));}
          data.desks=data.desks.filter(row=>row.customerId!==customerId).concat(result.deskState);
          if(readCache?.company===company&&readCache.results[2].status==='fulfilled')readCache.results[2].value.desks=data.desks;
        }
        detailsDrafts.delete(saveCompany+'|'+customerId+'|'+attempt.input.desk);
        window.DeskDelivery?.invalidate(saveCompany,customerId,attempt.input.desk);
        if(selectedCustomer===customerId)$('notice').textContent='Saved';
        if(attempt.input.action==='DESK_ORDER'||attempt.input.action==='DESK_ASSIGN')queueMicrotask(()=>load([1,2]));
      }
      return true;
    }
    catch(error){if(/Desk details changed|Select an active customer task|Enter valid shipment|Enter valid Desk|New shipment dates|Select Last Gate In|Desk deposit currency|Select a customer|Desk is locked|valid SO|whole customer demand|split form|existing delivery remainder|Issued Desk batch changed|authorized to Warehouse|locked by its Sales Invoice|Confirmed, loaded or invoiced|authorization is still processing|Complete receiving for every line/.test(error.message))deskAttempts.delete(key);if(status&&$(statusId)===status)status.textContent=error.message;return false;}
    finally{deskBusy=false;render();if(referenceEdit?.waiting){referenceEdit.waiting=false;queueMicrotask(()=>saveReferenceDraft());}}
  }
  function openDeskBooking(){
    const order=activeOrder();if(!order||activeDesk===0||!data.deskAvailable||deskLock())return;
    bookingOrder='DESK:'+selectedCustomer+':'+activeDesk;const retained=deskPending(),value=retained?.input.action==='DESK_SHIPMENT'?retained.input:deskState().shipments.find(row=>row.desk===activeDesk)||{};
    $('booking-order').textContent=order.customerName+' · Desk '+activeDesk;document.querySelectorAll('input[name="transport"]').forEach(input=>input.checked=input.value===value.transport);
    $('booking-date').value=value.date||'';$('booking-date').min=value.date&&value.date<planningToday()?value.date:planningToday();$('booking-arrival').min=value.arrival&&value.arrival<planningToday()?value.arrival:planningToday();$('booking-arrival-label').hidden=false;$('booking-arrival').value=value.arrival||'';$('booking-fields').disabled=Boolean(retained)||deskBusy;$('booking-save').disabled=deskBusy;
    $('booking-save').textContent=retained?'Retry Save':'Save';$('booking-status').textContent=retained?'The earlier Desk save is not confirmed. Retry the same save. 上次工作台保存未确认，请重试。':'';$('booking').showModal();
  }
  function detailsKey(){return company+'|'+selectedCustomer+'|'+activeDesk+'|'+deskBatch(activeDesk);}
  function detailsValues(order){const references=deskReferences(order),shipment=deskState().shipments.find(row=>row.desk===activeDesk)||{};return {poNo:references.poNo,soNo:references.soNo,depositAmount:references.depositAmountCents===null||references.depositAmountCents===undefined?'':(references.depositAmountCents/100).toFixed(2),depositDate:references.depositDate||'',transport:shipment.transport||'',date:shipment.date||'',lastGateIn:shipment.lastGateIn||'',departureDate:shipment.departureDate||'',arrival:shipment.arrival||'',invoiceNoDraft:references.invoiceNoDraft||''};}
  function inputFromDetails(values,order){const raw=values.depositAmount.trim();if(raw&&!/^(?:\d+|\d*\.\d{1,2})$/.test(raw))throw Error('Enter a deposit amount with up to two decimal places.');const [whole,fraction='']=raw.split('.'),depositAmountCents=raw?Number(whole||0)*100+Number((fraction+'00').slice(0,2)):null;return {action:'DESK_SHIPMENT',customerId:selectedCustomer,desk:activeDesk,revision:deskState().revision,transport:values.transport,date:values.date,arrival:values.arrival,lastGateIn:values.lastGateIn,departureDate:values.departureDate,details:{poNo:values.poNo.trim(),soNo:values.soNo.trim(),invoiceNoDraft:values.invoiceNoDraft.trim(),depositAmountCents,depositDate:values.depositDate,depositCurrency:depositAmountCents===null?'':order.currency}};}
  function openDetails(section,opener){
    const shipment=section==='shipment';$('desk-details').dataset.section=section;$('desk-details').querySelector('h2').textContent=shipment?'Shipment Details':'Order Details';const order=activeOrder();if(!order||!activeDesk||deskLock()||deskBusy)return;detailOpener=opener;const key=detailsKey(),values=detailsDrafts.get(key)||detailsValues(order);detailsContext={company,customerId:selectedCustomer,desk:activeDesk,key};dialogCustomer('desk-details-context',order.customerName,'Desk '+activeDesk);for(const input of $('desk-details-form').elements)if(input.name){input.disabled=(input.closest('section')===input.closest('fieldset')?.lastElementChild)!==shipment;input.value=values[input.name]??'';if(input.name==='depositAmount'){input.dataset.moneyUnset=input.value.trim()?'0':'1';if(!input.value.trim())input.value='0.00';input.oninput=()=>{input.dataset.moneyUnset=input.value.trim()?'0':'1';};}}showPlanningControls(values,shipment);$('desk-details-fields').disabled=Boolean(deskPending());$('desk-details-status').textContent=deskPending()?'The earlier save is unconfirmed. Retry the original save before editing.':shipment?'':'Deposit is recorded for this Desk only; it does not post a financial receipt. 订金资料不自动入账。';$('desk-details').showModal();$(section==='shipment'?'details-transport':'details-po').focus();}
  function showPlanningControls(values,shipment){
    const gateDate=$('gate-date'),hour=$('gate-hour'),minute=$('gate-minute'),legacy=$('gate-legacy-minute');
    const value=values.lastGateIn||'';
    const oldMinute=value.slice(14,16);
    legacy.value=/^(00|15|30|45)$/.test(oldMinute)?'':oldMinute;legacy.textContent=legacy.value;
    gateDate.value=value.slice(0,10);hour.value=value.slice(11,13);minute.value=oldMinute;
    $('gate-booked-by').value=deskState().shipments.find(row=>row.desk===activeDesk)?.bookedBy||'';
    for(const field of [gateDate,hour,minute])field.disabled=!shipment;
    const fields=$('desk-details-form').elements,today=planningToday();
    for(const key of ['date','departureDate','arrival'])fields[key].min=today;
    gateDate.min=today;
  }
  function validatePlanningDetails(values,saved){
    const form=$('desk-details-form'),gateDate=$('gate-date'),hour=$('gate-hour'),minute=$('gate-minute');
    if(!gateDate.disabled&&gateDate.value&&(!hour.value||!minute.value))throw Error('Select an hour and minutes for Last Gate In.');
    const today=planningToday();
    for(const key of ['date','departureDate','arrival','lastGateIn']){
      const field=key==='lastGateIn'?gateDate:form.elements[key],value=values[key]||'';
      if(field.disabled)continue;
      if(field.validity.badInput||field.validity.rangeOverflow)throw Error('Enter a valid shipment date.');
      if(value&&value!==saved[key]&&value.slice(0,10)<today)throw Error('Select today or a future shipment date.');
    }
    if(values.lastGateIn&&values.lastGateIn!==saved.lastGateIn&&!/:(00|15|30|45)$/.test(values.lastGateIn))throw Error('Select Last Gate In minutes 00, 15, 30 or 45.');
    const deposit=form.elements.depositAmount;
    if(!deposit.disabled&&!deposit.checkValidity())throw Error('Enter a valid deposit amount.');
    const depositDate=form.elements.depositDate;
    if(!depositDate.disabled&&!depositDate.checkValidity())throw Error('Enter a valid deposit date.');
  }
  function retainDetails(){if(!detailsContext||$('desk-details-fields').disabled)return;const values={...detailsValues(activeOrder()),...Object.fromEntries(new FormData($('desk-details-form')))},deposit=$('desk-details-form').elements.namedItem('depositAmount');if(!deposit.disabled&&deposit.dataset.moneyUnset==='1'&&Number(deposit.value)===0)values.depositAmount='';const gateDate=$('gate-date'),hour=$('gate-hour').value,minute=$('gate-minute').value;if(!gateDate.disabled)values.lastGateIn=gateDate.value&&hour&&minute?gateDate.value+'T'+hour+':'+minute:'';values.invoiceNoDraft=detailsDrafts.get(detailsContext.key)?.invoiceNoDraft||detailsValues(activeOrder()).invoiceNoDraft;detailsDrafts.set(detailsContext.key,values);}
  $('desk-details-fields').addEventListener('input',retainDetails);$('desk-details-fields').addEventListener('change',retainDetails);
  $('desk-details-form').onsubmit=event=>{event.preventDefault();if(deskBusy||!detailsContext)return;const order=activeOrder();retainDetails();try{if(!deskPending())validatePlanningDetails(detailsDrafts.get(detailsContext.key),detailsValues(order));const input=deskPending()?.input||inputFromDetails(detailsDrafts.get(detailsContext.key),order);detailsContext.submitted=true;$('desk-details').close();saveDeskChange(input);}catch(error){$('desk-details-status').textContent=error.message;}};
  $('desk-details').addEventListener('close',()=>{if(detailsContext&&!detailsContext.submitted&&!deskPending())detailsDrafts.delete(detailsContext.key);});
  function deskReceiptsComplete(order){
    return Boolean(activeDesk&&order?.lines.length&&data?.delivery?.receiptReadiness?.some(row=>row.customerId===selectedCustomer&&row.desk===activeDesk&&row.batchId===deskBatch()&&row.revision===deskState().revision));
  }
  function openInvoiceNumber(opener){const order=activeOrder();if(!order||!activeDesk||deskLock()||deskBusy||!deskReceiptsComplete(order))return;detailOpener=opener;detailsContext={company,customerId:selectedCustomer,desk:activeDesk,key:detailsKey()};dialogCustomer('desk-invoice-context',order.customerName,'Desk '+activeDesk);$('desk-invoice-input').value=deskReferences(order).invoiceNoDraft||company+'-INV-';$('desk-invoice-status').textContent='Number draft only. Formal invoice review and locking remain required. 此处只记录待开票号码。';$('desk-invoice-review').disabled=Boolean(deskPending())||!order.lines.length||order.lines.some(line=>line.invoiceReadyQty<(line.orderQty-line.invoicedQty));$('desk-invoice-number').showModal();$('desk-invoice-input').focus();}
  $('desk-invoice-form').onsubmit=event=>{event.preventDefault();if(deskBusy||!detailsContext)return;const order=activeOrder();if(!deskReceiptsComplete(order)){$('desk-invoice-status').textContent='Complete receiving for every line on this Desk before editing the Invoice No.';return;}const values=detailsValues(order);values.invoiceNoDraft=$('desk-invoice-input').value.trim();if(values.invoiceNoDraft===company+'-INV-')values.invoiceNoDraft='';detailsDrafts.set(detailsContext.key,values);const input=deskPending()?.input||inputFromDetails(values,order);$('desk-invoice-number').close();saveDeskChange(input);};
  $('desk-invoice-review').onclick=()=>{const order=activeOrder();if(!order||deskPending()||deskBusy)return;if(!deskReceiptsComplete(order)){$('desk-invoice-status').textContent='Complete receiving for every line on this Desk before editing the Invoice No.';return;}const number=$('desk-invoice-input').value.trim();$('desk-invoice-number').close();openInvoiceReview(order.id);if($('invoice-review').open)$('invoice-number').value=number===company+'-INV-'?'':number;};
  window.addEventListener('beforeunload',event=>{if(detailsDrafts.size){event.preventDefault();event.returnValue='';}});

  function countryLabel(value){try{return value?.length===2?new Intl.DisplayNames(['en'],{type:'region'}).of(value.toUpperCase()).toUpperCase():value||'—';}catch(_){return value||'—';}}
  function deskLock(desk=activeDesk){return (data?.deskLocks||[]).find(row=>row.customerId===selectedCustomer&&row.desk===desk&&(row.status!=='ISSUED'||row.archiveRequired===true&&row.snapshot?.batchId===deskBatch(desk)));}
  function currentDeskInvoice(){const hold=deskLock();return hold?.invoiceId?data.invoices.find(row=>row.id===hold.invoiceId):null;}
  function openDeskArchive(){
    const hold=deskLock(),invoice=currentDeskInvoice(),batchId=deskBatch(),customerId=selectedCustomer,desk=activeDesk;
    const pending=deskPending();
    if(deskBusy||invoiceBusy)return;
    if(pending){
      if(pending.input.action!=='DESK_ARCHIVE'||pending.input.desk!==desk)return;
    }else if(!invoice||hold?.status!=='ISSUED'||hold.archiveRequired!==true||!batchId)return;
    const invoiceNumber=data.invoices.find(row=>row.id===(pending?.input.invoiceId||invoice?.id))?.number||'the issued invoice';
    info('Archive & Free Desk','<p>Archive <strong>'+esc(invoiceNumber)+'</strong> and free Desk '+desk+' for the next shipment?</p><p>The invoice and documents remain in Invoices &amp; Payments and Invoice Register.</p><p id="archive-desk-status" role="status"></p><button type="button" class="primary" id="confirm-desk-archive">'+(pending?'Retry original confirmation':'Confirm Archive')+'</button>');
    $('confirm-desk-archive').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      const input=pending?.input||{action:'DESK_ARCHIVE',customerId,desk,revision:deskState().revision,invoiceId:invoice.id,batchId};
      const archiveView=$('information');
      const result=await saveDeskChange(input,'archive-desk-status');
      if(!result){button.disabled=false;button.textContent='Retry original confirmation';return;}
      void load([1,2]);
      if(!archiveView.open||$('confirm-desk-archive')!==button)return;
      $('information-title').textContent='Desk Archived';
      $('information-body').innerHTML='<p><strong>'+esc(invoiceNumber)+'</strong> was archived and Desk '+desk+' was released.</p><button type="button" data-customer-transactions="'+esc(customerId)+'" id="archive-open-invoices">Open Invoices &amp; Payments</button>';
      $('archive-open-invoices').onclick=()=>$('information').close();
    };
  }
  function originalPoNumbers(order){return [...new Set(order.lines.map(line=>line.customerPo).filter(Boolean))];}
  function deskReferences(order){const hold=deskLock(),saved=hold?.snapshot?.references||(deskState().references||[]).find(row=>row.desk===activeDesk);return {...saved,soNo:saved?.soNo||'',poNo:saved?.poNo||originalPoNumbers(order).join(' · ')};}
  function deskDocuments(code,invoiceId=''){return (data.documents||[]).filter(row=>matchesDeskDocument(row,selectedCustomer,activeDesk,deskBatch(activeDesk),invoiceId)&&(!code||row.code===code));}
  let referenceEdit=null,referenceTimer;
  const referenceValue=value=>JSON.stringify([value.soNo||'',value.poNo||'']);
  function referenceDirty(){return Boolean(referenceEdit&&(referenceEdit.saving||referenceEdit.saved!==referenceValue(referenceEdit.values)));}
  function openDeskReferences(){
    const order=activeOrder();if(!order||activeDesk===0||deskLock()||data.deskMetadataVersion<2)return;
    if(referenceDirty()&&(referenceEdit.company!==company||referenceEdit.customerId!==selectedCustomer||referenceEdit.desk!==activeDesk)){info('References pending','<p>Confirm the pending reference save before editing another Desk.</p>');return;}
    const retained=deskPending(),values=retained?.input.action==='DESK_REFERENCES'?retained.input:deskReferences(order);
    if(!referenceDirty())referenceEdit={company,customerId:selectedCustomer,desk:activeDesk,values:{soNo:values.soNo||'',poNo:values.poNo||''},saved:retained?null:referenceValue(values),failed:Boolean(retained),saving:false};
    dialogCustomer('desk-reference-context',order.customerName,'Desk '+activeDesk);$('desk-so-number').value=referenceEdit.values.soNo;$('desk-po-number').value=referenceEdit.values.poNo;
    $('desk-original-po').textContent=originalPoNumbers(order).join(' · ')||'No customer PO provided.';$('desk-reference-fields').disabled=false;$('desk-reference-save').disabled=referenceEdit.saving;$('desk-reference-save').hidden=!referenceDirty();
    $('desk-reference-save').textContent=referenceEdit.failed?'Retry Save':'Save now';$('desk-reference-status').textContent=referenceEdit.failed?'The previous save is not confirmed. Retry the same references.':'Changes save automatically. 自动保存修改。';
    $('desk-references').querySelector('footer [data-close]').textContent='Close';$('desk-references').showModal();
  }
  async function saveReferenceDraft(retry=false,close=false){
    clearTimeout(referenceTimer);const edit=referenceEdit;if(!edit)return;edit.close=edit.close||close;
    if(edit.saving)return;if(edit.failed&&!retry)return;if(edit.company!==company||!data)return;
    if(edit.saved===referenceValue(edit.values)){$('desk-reference-save').hidden=true;if(edit.close)$('desk-references').close();return;}
    if(deskBusy){edit.waiting=true;return;}edit.waiting=false;edit.failed=false;edit.saving=true;
    const state=data.desks.find(row=>row.customerId===edit.customerId),retained=deskAttempts.get(company+'|'+edit.customerId);
    const input=retained?.input||{action:'DESK_REFERENCES',customerId:edit.customerId,desk:edit.desk,revision:state?.revision||'',...edit.values};
    $('desk-reference-save').disabled=true;$('desk-reference-save').textContent='Saving…';
    const ok=await saveDeskChange(input,'desk-reference-status');edit.saving=false;if(referenceEdit!==edit)return;$('desk-reference-save').disabled=false;
    if(!ok){edit.failed=true;$('desk-reference-save').textContent='Retry Save';return;}
    edit.saved=referenceValue(input);$('desk-reference-save').textContent='Save now';
    if(edit.saved!==referenceValue(edit.values)){queueMicrotask(()=>saveReferenceDraft());return;}
    $('desk-reference-status').textContent='Saved 已保存';$('desk-reference-save').hidden=true;if(edit.close)$('desk-references').close();
  }
  $('desk-reference-fields').addEventListener('input',()=>{
    if(!referenceEdit)return;referenceEdit.values={soNo:$('desk-so-number').value.trim(),poNo:$('desk-po-number').value.trim()};$('desk-reference-save').hidden=!referenceDirty();
    if(!referenceDirty()){$('desk-reference-status').textContent='';clearTimeout(referenceTimer);return;}
    $('desk-reference-status').textContent=referenceEdit.failed?'Changes retained. Retry the unconfirmed save first.':'Changes pending 自动保存待处理';
    clearTimeout(referenceTimer);if(!referenceEdit.failed)referenceTimer=setTimeout(()=>saveReferenceDraft(),600);
  });
  $('desk-reference-form').onsubmit=event=>{event.preventDefault();saveReferenceDraft(true,true);};
  $('desk-references').addEventListener('close',()=>{clearTimeout(referenceTimer);if(referenceDirty()&&!referenceEdit.failed)saveReferenceDraft();});
  window.addEventListener('change',event=>{if(event.target===$('company')&&referenceDirty()){event.stopImmediatePropagation();event.target.value=company;$('notice').textContent='Confirm the pending reference save before changing company.';}},true);
  window.addEventListener('beforeunload',event=>{if(referenceDirty()||deskAttempts.size){event.preventDefault();event.returnValue='';}});
  function headerDocuments(order){return '<section class="shipment-documents" aria-label="Documents"><div class="shipment-doc-grid">'+documentGuides.filter(([code])=>code!=='DN').map(([code,label])=>{const count=deskDocuments(code,currentDeskInvoice()?.id).length;return '<div><button type="button" class="'+(count?'available':'')+'" data-desk-doc="'+code+'" '+(!data.documentVersion||data.deskMetadataVersion<2||!order.lines.length?'disabled':'')+' aria-label="'+label+'">'+documentLabel(code)+'</button><span>'+label+'</span></div>';}).join('')+'</div></section>';}
  function dialogCustomer(id,name,detail){
    const context=$(id), customer=document.createElement('strong'), subtitle=document.createElement('small');
    customer.textContent=name;
    subtitle.textContent=detail;
    context.replaceChildren(customer,subtitle);
  }
  function autoCountRows(lines,mode){
    const invoice=mode==='SI';
    if(invoice&&lines.some(line=>line.loadedQty!==line.invoiceReadyQty||line.invoiceReadyQty<line.orderQty)){
      throw Error('Complete or resolve the remaining Desk quantities before copying Loaded Qty.');
    }
    const quantity=invoice?'invoiceReadyQty':'orderQty';
    if(lines.some(line=>!Number.isSafeInteger(line[quantity])||line[quantity]<0))throw Error('Check the carton quantities on this Desk.');
    const details=lines.filter(line=>line[quantity]>0);
    if(!details.length)throw Error('This Desk has no cartons to copy.');
    const currency=details[0].currency;
    if(!/^[A-Z]{3}$/.test(currency||'')||details.some(line=>line.currency!==currency))throw Error('Check the currency on this Desk.');
    if(details.some(line=>!/^\d{1,15}$/.test(line.barcode||'')))throw Error('Check the product barcodes on this Desk.');
    if(invoice&&details.some(line=>!Number.isFinite(line.priceCtn)||line.priceCtn<=0))throw Error('Check the carton prices on this Desk.');
    const text=details.map(line=>{
      const cells=Array(invoice?13:11).fill('');
      cells[0]=line.barcode;
      cells[10]=line[quantity];
      if(invoice)cells[12]=line.priceCtn.toFixed(2);
      return cells.join('\t');
    }).join('\r\n');
    return {currency,text};
  }
  function openAutoCount(){
    const order=activeOrder();
    if(!order||!activeDesk||deskLock()||deskPending()||deskBusy||invoiceBusy)return;
    info('Copy to AutoCount','<p id="autocount-context"></p><div class="autocount-actions"><button type="button" data-copy-qty="DO">Delivery Order · Order Qty</button><button type="button" data-copy-qty="SI">Sales Invoice · Loaded Qty</button></div><p id="autocount-status" role="status"></p><textarea id="autocount-data" hidden readonly aria-label="AutoCount rows"></textarea>');
    dialogCustomer('autocount-context',order.customerName,'Desk '+activeDesk+' · '+order.currency);
    const lines=viewLines(order);
    $('information-body').querySelectorAll('[data-copy-qty]').forEach(button=>{
      button.onclick=async()=>{
        const status=$('autocount-status'),output=$('autocount-data');
        output.hidden=true;
        let rows;
        try{rows=autoCountRows(lines,button.dataset.copyQty);}catch(error){status.textContent=error.message;return;}
        const destination='Set the document currency to '+rows.currency+'.';
        try{
          await navigator.clipboard.writeText(rows.text);
          status.textContent='Copied. '+destination;
        }catch(_){
          output.value=rows.text;
          output.hidden=false;
          output.focus();
          output.select();
          status.textContent='Press Ctrl+C to copy the selected rows. '+destination;
        }
      };
    });
  }
  function headerTotals(planned,loaded,currency,invoice){
    const cells=(totals)=>[[totals.qty,0,'CTN'],[totals.cbm,4,'m³'],[totals.amount,2,currency]].map(([value,places,unit])=>'<td>'+(value===null?'Incomplete':number(value,places)+(unit?' <small>'+esc(unit)+'</small>':''))+'</td>').join('');
    const row=(label,totals)=>'<tr><th scope="row">'+label+'</th>'+cells(totals)+'</tr>';
    return '<section class="shipment-totals"><table aria-label="Shipment totals"><thead><tr><td></td><th scope="col">Qty</th><th scope="col">CBM</th><th scope="col">Amount</th></tr></thead><tbody>'+(invoice?row('Invoiced',{...loaded,amount:invoice.amountCents/100}):row('Planned',planned)+row('Loaded',loaded))+'</tbody></table></section>';
  }
  // Display projections only: allocation plans and confirmed loading keep separate quantities.
  function quantityTotals(lines,key){
    const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
    const quantitiesKnown=lines.every(line=>valid(line[key]));
    const currencies=[...new Set(lines.map(line=>line.currency).filter(Boolean))];
    const currencyKnown=!lines.length||currencies.length===1&&lines.every(line=>line.currency===currencies[0]);
    return {qty:quantitiesKnown?lines.reduce((sum,line)=>sum+line[key],0):null,
      cbm:quantitiesKnown&&lines.every(line=>line[key]===0||valid(line.cbm)&&line.cbm>0)?lines.reduce((sum,line)=>sum+(line[key]===0?0:line[key]*line.cbm),0):null,
      amount:quantitiesKnown&&currencyKnown&&lines.every(line=>line[key]===0||valid(line.priceCtn))?lines.reduce((sum,line)=>sum+(line[key]===0?0:Math.round(line[key]*line.priceCtn*100)),0)/100:null};
  }
  function quantityPair(planned,loaded,places,unit='',invoiced=false,missingCbm=false){
    const value=item=>item===null?'Incomplete':number(item,places);
    const basis=(item,missing)=>missing&&item===null?'<button type="button" class="cbm-issue-pill" data-cbm aria-label="Missing CBM" title="CBM unavailable">'+number(0,3)+'</button>':value(item);
    const part=(label,item,missing=false)=>'<span class="quantity-basis"><small>'+label+'</small><b>'+basis(item,missing)+(unit?' <small>'+unit+'</small>':'')+'</b></span>';
    return '<span class="quantity-comparison">'+(invoiced?'':part('Planned',planned,missingCbm))+part(invoiced?'Invoiced':'Loaded',loaded,missingCbm&&invoiced)+'</span>';
  }
  function deskHeader(order,lines){
    const hold=deskLock(),invoice=currentDeskInvoice(),shipment=hold?.snapshot?.shipment||(activeDesk?deskState().shipments.find(row=>row.desk===activeDesk):null),references=deskReferences(order),currencies=[...new Set(lines.map(line=>line.currency).filter(Boolean))],currency=currencies.length===1?currencies[0]:order.currency,planned=quantityTotals(lines,'allocQty'),loaded=quantityTotals(lines,'loadedQty');
    const pendingDesk=deskPending(),attempt=invoiceAttempts.has(company+'|'+order.id),canReview=activeDesk>0&&data.deskMetadataVersion>=2&&!deskBusy&&!pendingDesk&&(!hold||invoice||attempt),canEdit=activeDesk>0&&data.deskMetadataVersion>=2&&data.delivery?.deskDeliveryVersion===2&&!hold&&!deskBusy;
    // Header deposit is a manual Desk declaration, separate from posted payment documents.
    const read=(label,value,style='')=>'<div class="shipment-kv '+style+'"><span>'+label+'</span><strong>'+esc(value||'—')+'</strong></div>';
    const section=(title,key)=>'<div class="shipment-section-title"><h3>'+title+'</h3><button type="button" class="shipment-section-pencil" data-edit-details="'+key+'" aria-label="Edit '+title+'" '+(canEdit?'':'disabled')+'><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 16h4L21 7a2.8 2.8 0 0 0-4-4l-9 9zM15 5l4 4"/></svg></button></div>';
    const depositAmount=references.depositAmountCents===null||references.depositAmountCents===undefined?'—':references.depositCurrency+' '+number(references.depositAmountCents/100,2),invoiceLabel=invoice?.number||hold?.number||references.invoiceNoDraft||company+'-INV-';
    return '<article class="desk-header shipment-header shipment-compact">'+
      '<div class="desk-heading"><div class="shipment-customer-desk"><h2>'+esc(order.customerName)+'</h2><span class="desk-currency" aria-label="Invoice currency">'+esc(currencies.length===1?currency:currencies.length>1?'Mixed currencies':currency||'—')+'</span><div class="desk-switcher"><button type="button" data-desk-step="-1" aria-label="Previous Desk" '+(activeDesk===0?'disabled':'')+'>‹</button><b>'+(activeDesk?'Desk '+activeDesk:'All')+'</b><button type="button" data-desk-step="1" aria-label="Next Desk" '+(activeDesk===3?'disabled':'')+'>›</button></div></div><div class="shipment-delivery-actions"></div>'+(activeDesk&&!hold&&!pendingDesk&&!attempt&&lines.length?'<button type="button" class="autocount-launch" data-autocount>Copy to AutoCount</button>':'')+'</div>'+

      '<div class="shipment-columns '+(activeDesk?'':'shipment-overview')+'"><section class="shipment-details"><h3>Customer Details</h3>'+read('Country',countryLabel(order.country))+read('Port Name',order.port)+(activeDesk?'<div class="shipment-invoice"><span>Sales Invoice No.</span><button type="button" class="invoice-number-link '+(!invoice&&!references.invoiceNoDraft?'invoice-prefix':'invoice-assigned')+'" '+(invoice?'data-invoice="'+esc(invoice.id)+'"':'data-edit-invoice-number')+' '+(invoice||canEdit&&deskReceiptsComplete(order)?'':'disabled')+(!invoice&&activeDesk&&!deskReceiptsComplete(order)?' aria-describedby="desk-invoice-wait"':'')+'>'+esc(invoiceLabel)+'</button>'+(!invoice&&activeDesk&&!deskReceiptsComplete(order)?'<small id="desk-invoice-wait">Awaiting complete receipt 待收齐</small>':'')+'</div>':'')+'</section>'+
      (activeDesk?'<section class="shipment-order">'+section('Order Details','order')+read('PO',activeDesk?references.poNo:'Per Desk')+read('SO',activeDesk?references.soNo:'Per Desk')+read('Deposit Amount',activeDesk?depositAmount:'Per Desk')+read('Deposit Date',activeDesk?day(references.depositDate):'Per Desk')+read('ETD',activeDesk?day(shipment?.date):'Per Desk')+'</section>'+
      '<section class="shipment-shipping">'+section('Shipment Details','shipment')+read('Logistic',activeDesk?transportLabel(shipment?.transport):'Per Desk')+read('Booked By',activeDesk?shipment?.bookedBy:'Per Desk')+read('Last Gate In',activeDesk&&shipment?.lastGateIn?day(shipment.lastGateIn)+' · '+shipment.lastGateIn.slice(11,16):activeDesk?'—':'Per Desk')+read('Departure Date',activeDesk?day(shipment?.departureDate):'Per Desk')+read('ETA',activeDesk?day(shipment?.arrival):'Per Desk')+'</section>':'')+headerTotals(planned,loaded,currency,invoice)+'</div>'+(activeDesk?headerDocuments(order):'')+(hold?.status==='ISSUED'&&hold.archiveRequired===true?'<div class="shipment-save-retry"><button type="button" class="primary" data-archive-desk>Archive &amp; Free Desk</button></div>':'')+
      '<div class="shipment-authorization-status" role="status"></div>'+(pendingDesk?'<div class="shipment-save-retry"><button type="button" class="link" data-retry-desk '+(deskBusy?'disabled':'')+'>Retry Desk Save</button></div>':'')+'</article><div class="shipment-task-count">'+lines.length+' tasks'+(hold?'<span>Desk locked · Documents and payments remain available</span>':'')+'</div>';
  }

  function splitDeskLabel(line){
    const desk=line.portionDesk??(currentDeskInvoice()?activeDesk:null);
    const portions=Number.isSafeInteger(desk)
      ? [{desk,quantity:line.orderQty}]
      : (line.deskPortions||[]).map(part=>({desk:part.desk,quantity:part.quantity-(part.invoiced||0)}));
    return portions.filter(part=>part.quantity>0).sort((a,b)=>(a.desk||4)-(b.desk||4)).map(part=>
      '<span class="desk-portion'+(part.desk?'':' desk-portion-pending')+'">'+
      (part.desk?'Desk '+part.desk:'Pending')+(activeDesk?'':' · '+number(part.quantity))+'</span>').join('')||'—';
  }

  function orderContent(order){
    const lines=viewLines(order),invoiced=Boolean(currentDeskInvoice());$('count').textContent=lines.length+' tasks';
    return deskHeader(order,lines)+'<div class="desk-task-table">'+table([[''],['Desk'],['Descriptions'],['Price',true],['Order Qty',true],['Alloc Qty',true],['Loaded Qty',true],['Line CBM',true],['Line Amount',true],['Expiry'],['Message']],lines.map(line=>{const planned=quantityTotals([line],'allocQty'),loaded=quantityTotals([line],'loadedQty'),locked=(data.deskLocks||[]).some(hold=>hold.customerId===selectedCustomer&&hold.desk===(line.portionDesk??taskDesk(line.taskId))&&(hold.status!=='ISSUED'||hold.archiveRequired===true)),hasSplit=Boolean(data.desks?.some(state=>state.customerId===selectedCustomer&&state.assignments.some(row=>row.taskId===line.taskId&&row.parts))||line.deskPortions?.length>1);return '<tr data-task="'+esc(line.taskId)+'"><td class="desk-drag-cell"><button type="button" class="row-drag" data-drag-task="'+esc(line.taskId)+'" draggable="'+(!invoiced&&(!activeDesk||!deskBusy&&!deskPending()&&!deskLock()))+'" '+(invoiced||activeDesk&&(deskBusy||deskPending()||deskLock())?'disabled':'')+' aria-label="Move row" title="Drag, or press Alt + Up or Down">⠿</button></td><td class="desk-cell">'+(hasSplit?'<button type="button" class="desk-portions" title="Manage split shipment 分批出货" data-desk-split="'+esc(line.taskId)+'" '+(!data.deskAvailable||deskBusy||deskPending()||invoiceBusy?'disabled':'')+'>'+splitDeskLabel(line)+'</button>':'<select class="'+(taskDesk(line.taskId)===0?'unassigned':'')+'" data-desk-task="'+esc(line.taskId)+'" aria-label="Desk for '+esc(line.name||line.taskId)+'" '+(!data.deskAvailable||data.deskMetadataVersion<2||deskBusy||deskPending()||invoiceBusy||locked||invoiceAttempts.has(company+'|'+order.id)?'disabled':'')+'><option value="0" '+(taskDesk(line.taskId)===0?'selected':'')+'>—</option>'+[1,2,3].map(desk=>'<option value="'+desk+'" '+(taskDesk(line.taskId)===desk?'selected':'')+' '+(deskLock(desk)&&taskDesk(line.taskId)!==desk?'disabled':'')+'>'+desk+'</option>').join('')+'<option value="SPLIT">Split… 分批</option></select>')+'</td><td class="description"><small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small></td><td class="num price-cell"><span>'+number(line.pricePc,2)+'</span><span>'+number(line.priceCtn,2)+'</span></td><td class="num">'+number(line.orderQty)+'</td><td class="num">'+number(line.allocQty)+'</td><td class="num">'+number(line.loadedQty)+'</td><td class="num">'+quantityPair(planned.cbm,loaded.cbm,4,'',invoiced,!(line.cbm>0))+'</td><td class="num">'+quantityPair(planned.amount,loaded.amount,2,'',invoiced)+'</td><td>'+esc((line.expiryDates||[]).map(expiryDay).join(' · ')||'—')+'</td><td>'+(window.departmentMessages?.sourceCell([line.taskId])||'')+'</td></tr>'; }),'detail order-tasks')+'</div>';
  }

  function render(){
    document.body.classList.toggle('support-orders-view',view==='orders');document.body.classList.toggle('support-customers-view',view==='customers');document.body.classList.toggle('support-invoices-view',view==='transactions');$('back').hidden=true;$('guide').hidden=true;$('summary').hidden=true;$('subnav').hidden=true;$('customer-filter').hidden=view!=='transactions';$('order-filter').hidden=true;$('invoice-period').hidden=view!=='invoiceRegister';
    document.querySelectorAll('nav [data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    $('company-name').textContent=company==='NCT'?'North Cape Trading Sdn. Bhd.':'Global HR';$('title').textContent={customers:'Customers',orders:'Orders',transactions:'Invoices & Payments',invoiceRegister:'Invoice Register'}[view]||'Customers';
    if(!data){$('content').innerHTML='<div class="loading">'+(busy?'Loading customer orders…':'Customer orders have not loaded.')+'</div>';$('count').textContent='';return;}
    if(view==='customers'){
      const rows=data.customers;$('count').textContent=rows.length+' customers';
      const summary=new Map();
      for(const order of data.orders)for(const line of order.lines){
        if(!(line.orderQty>line.invoicedQty))continue;
        if(!summary.has(order.customerId))summary.set(order.customerId,[0,0,0,0]);
        const counts=summary.get(order.customerId);
        const portions=line.deskPortions?.length?line.deskPortions:[{desk:data.desks?.find(desk=>desk.customerId===order.customerId)?.assignments.find(row=>row.taskId===line.taskId)?.desk||0,quantity:line.orderQty,invoiced:line.invoicedQty}];
        for(const part of portions)counts[part.desk]+=Math.max(0,part.quantity-(part.invoiced||0));
      }
      $('content').innerHTML=table([['No.'],['Profile'],['Customer'],['Country'],['Port Name'],['Currency'],['Desk'],['']],rows.map((row,index)=>{
        const counts=summary.get(row.id)||[];
        const desks=!data.deskAvailable||!data.delivery?'—':[1,2,3,0].filter(desk=>counts[desk]>0).map(desk=>'<span class="overview-desk'+(desk?'':' pending')+'">'+(desk?'Desk '+desk:'Pending')+' · '+number(counts[desk])+' CTN</span>').join('')||'—';
        const pendingArchive=(data.deskLocks||[]).some(lock=>lock.customerId===row.id&&lock.status==='ISSUED'&&lock.archiveRequired===true);
        const recovery=deskAttempts.get(company+'|'+row.id)?.input;
        const retryArchive=recovery?.action==='DESK_ARCHIVE';
        const actionable=counts.some(quantity=>quantity>0)||pendingArchive||retryArchive;
        const deskDisplay=desks+(retryArchive?' <span class="overview-desk pending">Archive confirmation pending</span>':pendingArchive?' <span class="overview-desk pending">Awaiting archive</span>':'');
        return '<tr'+(actionable?' data-customer-row':'')+'><td class="overview-number">'+String(index+1).padStart(3,'0')+'</td><td class="overview-profile-cell">'+ (row.profile?'<button type="button" class="icon-link overview-profile" data-profile="'+esc(row.id)+'" aria-label="Edit profile for '+esc(row.name)+'">'+profileIcon+'</button>':'') +'</td><td><strong>'+esc(row.name)+'</strong></td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.port||'—')+'</td><td>'+esc(row.currency||'—')+'</td><td><div class="overview-desks">'+deskDisplay+'</div></td><td class="overview-entry-cell">'+(actionable?'<button type="button" class="customer-order-entry" data-customer-orders="'+esc(row.id)+'" aria-label="Open orders for '+esc(row.name)+'">'+entryIcon+'</button>':'')+'</td></tr>';
      }));
      return;
    }
    if(view==='invoiceRegister'){renderInvoiceRegister();return;}
    const customer=data.customers.find(row=>row.id===selectedCustomer);
    if(!customer){$('content').innerHTML='<div class="empty">Select a customer to view '+(view==='orders'?'order tasks.':'transactions.')+'</div>';$('count').textContent='';return;}
    if(view!=='transactions')$('company-name').textContent=customer.name;
    if(view==='transactions'){
      const charges=(customer.transactions||[]).filter(row=>['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type)||row.invoiceKind==='STANDALONE_DN');
      const rows=matching([...customer.invoices,...charges].map(row=>({...row,customerName:customer.name}))).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
      const legend=documentGuides.map(([code,label])=>'<li><strong>'+documentLabel(code)+'</strong> '+esc(label)+'</li>').join('');
      $('content').innerHTML='<section class="invoice-toolbar"><button type="button" class="primary invoice-add" data-new-charge="'+esc(customer.id)+'">+ Add Invoice / Debit Note</button><ul class="invoice-legend" aria-label="Document codes">'+legend+'</ul></section>'+invoiceTable(rows);
      $('count').textContent=rows.length+' invoices';return;
    }
    const order=activeOrder();
    if(!order){$('content').innerHTML='<div class="empty">No outstanding order tasks.</div>';$('count').textContent='0 tasks';return;}
    $('order-filter').hidden=true;
    $('content').innerHTML=orderContent(order);
    const deliveryCompany=company,deliveryCustomer=selectedCustomer;
    window.DeskDelivery?.mountSupport({company,model:data,root:$('content'),customerId:selectedCustomer,desk:activeDesk,lines:viewLines(order),showOpenedTime:true,canSend:activeDesk>0&&!busy&&!deskBusy&&!deskPending()&&!invoiceBusy&&!deskLock(),send,
      applyReceipt(result){if(company!==deliveryCompany||!data)return;deskReceiptEpoch++;if(result.deskState){data.desks=data.desks.filter(row=>row.customerId!==result.deskState.customerId).concat(result.deskState);if(readCache?.company===company&&readCache.results[2].status==='fulfilled')readCache.results[2].value.desks=data.desks;}data.delivery.pendingAuthorizations=(data.delivery.pendingAuthorizations||[]).filter(row=>row.requestId!==result.requestId);data.delivery.lists=data.delivery.lists.filter(row=>row.id!==result.list.id).concat(result.list);if(readCache?.company===company&&readCache.results[1].status==='fulfilled')readCache.results[1].value=data.delivery;if(selectedCustomer===deliveryCustomer)$('notice').textContent=result.status==='CANCELLED'?'Warehouse task recalled.':'Desk authorized to Warehouse.';render();},invalidate(){if(company===deliveryCompany)load([0,1,2,3]);}});
  }
  const profileFields=[['preferredCurrency','Currency',['','USD','MYR','SGD','RMB','JPY']],['destinationPortName','Port Name'],['picTitle','Contact Title',['','MR','MRS','MS','DR']],['picName','Contact Name'],['mobileNo','Mobile No.'],['whatsapp','WhatsApp',['','YES','NO']],['primaryEmail','Email'],['companyWebsite','Website'],['address1','Address Line 1'],['address2','Address Line 2'],['address3','Address Line 3'],['natureOfBusiness','Business Type',['','WHOLESALE','RETAIL','E-COMMERCE','SOURCING AGENT','OTHERS']]];
  let profileCustomer='',profileBusy=false,profileSnapshot=null;const profileAttempts=new Map();
  function openProfile(id){const customer=data.customers.find(row=>row.id===id);if(!customer?.profile)return;profileCustomer=id;profileSnapshot=customer.profile;const attempt=profileAttempts.get(company+'|'+id);$('profile-identity').textContent=customer.name+' · '+(customer.country||'—');$('profile-fields').innerHTML=profileFields.map(([key,label,choices])=>'<label>'+label+(choices?'<select name="'+key+'">'+choices.map(value=>'<option '+(String(profileSnapshot[key]||'')===value?'selected ':'')+'value="'+esc(value)+'">'+esc(value||'—')+'</option>').join('')+'</select>':'<input name="'+key+'" maxlength="500" value="'+esc(profileSnapshot[key]||'')+'">')+'</label>').join('');$('profile-fields').disabled=Boolean(attempt);$('profile-save').disabled=profileBusy;$('profile-save').textContent=attempt?'Retry Save':'Save';$('profile-status').textContent=attempt?'The earlier save was not confirmed. Retry the same changes.':'Changes are shared with Sales. Existing invoices remain unchanged.';$('customer-profile').showModal();}
  $('profile-form').onsubmit=async event=>{event.preventDefault();if(profileBusy||!profileSnapshot)return;const saveCompany=company,key=company+'|'+profileCustomer;let attempt=profileAttempts.get(key);if(!attempt){const patch={};for(const [field] of profileFields){const value=$('profile-fields').querySelector('[name="'+field+'"]').value.trim();if(value!==String(profileSnapshot[field]||''))patch[field]=value;}if(!Object.keys(patch).length){$('customer-profile').close();return;}attempt={requestId:crypto.randomUUID(),input:{customerId:profileCustomer,revision:profileSnapshot.revision,patch}};profileAttempts.set(key,attempt);}profileBusy=true;$('profile-fields').disabled=true;$('profile-save').disabled=true;$('profile-status').textContent='Saving…';try{const result=await send('SUPPORT_CUSTOMER_SAVE_REQUEST',attempt.input,attempt.requestId);if(result.company!==saveCompany||result.requestId!==attempt.requestId||result.customerId!==attempt.input.customerId||!result.saved)throw Error('Customer profile save could not be confirmed.');profileAttempts.delete(key);$('customer-profile').close();if(company===saveCompany)await load([5]);}catch(error){$('profile-status').textContent=error.message;if(/profile changed|Invalid |Only editable/.test(error.message)){profileAttempts.delete(key);$('profile-save').textContent='Save';}else $('profile-save').textContent='Retry Save';}finally{profileBusy=false;$('profile-save').disabled=false;}};
  async function load(parts,quiet=false){
    const sequence=++readSequence,epoch=deskReceiptEpoch,cache=readCache?.company===company&&data?readCache:null;busy=true;$('refresh').disabled=true;
    if(!quiet){$('notice').textContent='Loading customer orders…';render();}
    const requested=new Set(Array.isArray(parts)&&cache?parts:[0,1,2,3,4,5]);for(const active of activeReadSets.values())for(const index of active)requested.add(index);activeReadSets.set(sequence,requested);
    const types=['FULFILMENT_READ_REQUEST','PACKING_READ_REQUEST','SUPPORT_BOOKING_READ_REQUEST','SUPPORT_INVOICE_READ_REQUEST','SUPPORT_DOCUMENT_READ_REQUEST','SUPPORT_CUSTOMER_READ_REQUEST'];
    const results=await Promise.all(types.map((type,index)=>cache&&!requested.has(index)?cache.results[index]:send(type).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}))));
    activeReadSets.delete(sequence);if(sequence!==readSequence)return;
    if(epoch!==deskReceiptEpoch&&readCache?.company===company){results[2]=readCache.results[2];results[1]=readCache.results[1];}
    if(quiet&&cache){
      for(const index of [1,2])if(results[index].status==='rejected')results[index]=cache.results[index];
      const businessPayload=result=>{const {readAt,...payload}=result?.value||{};return JSON.stringify(payload);};
      if(results.every((result,index)=>result===cache.results[index]||businessPayload(result)===businessPayload(cache.results[index]))){busy=false;$('refresh').disabled=false;return;}
    }
    readCache={company,results};
    busy=false;$('refresh').disabled=false;
    if(results[0].status==='rejected'){data=null;$('notice').textContent=results[0].reason.message;$('login').hidden=false;render();return;}
    try{data=window.SupportWorkroom.project(results[0].value,results[1].status==='fulfilled'?results[1].value:null,results[2].status==='fulfilled'?results[2].value:null,results[3].status==='fulfilled'?results[3].value:null,results[4].status==='fulfilled'?results[4].value:null,results[5].status==='fulfilled'?results[5].value:null);$('staff').textContent=data.staff?.staffName||'';$('login').hidden=true;$('notice').textContent=[results[1].status==='rejected'?'Warehouse quantities could not be loaded; shown as —.':'',results[2].status==='rejected'?'Shipment details could not be loaded.':'',results[3].status==='rejected'?'Invoice readiness could not be loaded.':'',results[4].status==='rejected'?'Support documents could not be loaded.':'',results[5].status==='rejected'?'Full customer directory is unavailable; showing customers with existing orders only.':''].filter(Boolean).join(' ');
      for(const held of results[2].status==='fulfilled'?results[2].value.pendingDeskInvoices||[]:[]){const key=company+'|TASKS:'+held.customerId+':DESK:'+held.desk;if(!invoiceAttempts.has(key)){const lines=held.input.lines.map(part=>{const original=data.orders.flatMap(row=>row.lines).find(line=>line.taskId===part.taskId);return {...original,taskId:part.taskId,quantity:part.quantity,invoiceReadyQty:part.quantity};});invoiceAttempts.set(key,{requestId:held.requestId,input:held.input,review:lines});}}
      for(const hold of data.deskLocks.filter(row=>row.status==='ISSUED')){const key=company+'|TASKS:'+hold.customerId+':DESK:'+hold.desk;if(invoiceAttempts.get(key)?.requestId===hold.requestId)invoiceAttempts.delete(key);}
      for(const [key,attempt]of documentAttempts){if(JSON.parse(key)[0]===company&&window.SupportWorkroom.confirmedDocumentAttempt(attempt,data)){documentAttempts.delete(key);if(documentContext&&documentKey(documentContext)===key)$('documents').close();}}
      const filter=$('customer-filter').value;$('customer-filter').innerHTML='<option value="">Select Customer</option>'+data.customers.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join('');$('customer-filter').value=data.customers.some(row=>row.id===filter)?filter:'';
    }catch(error){data=null;$('notice').textContent=error.message;}render();
  }
  let lastWarehouseRefresh=0;
  function refreshWarehouseWhenIdle(){
    if(view!=='orders'||!selectedCustomer||document.hidden||!data||busy||deskBusy||invoiceBusy||documentBusy
      ||dragContext||deskAttempts.size||invoiceAttempts.size||document.querySelector('dialog[open]')
      ||document.activeElement?.matches('input,select,textarea')||Date.now()-lastWarehouseRefresh<30000)return;
    lastWarehouseRefresh=Date.now();
    load([1,2],true);
  }
  setInterval(refreshWarehouseWhenIdle,30000);
  document.addEventListener('visibilitychange',refreshWarehouseWhenIdle);
  document.addEventListener('click',event=>{const target=event.target;
    const control=target.closest('button,a,input,select,textarea,label');
    const button=control?control.closest('button'):target.closest('[data-customer-row]')?.querySelector('.customer-order-entry');
    if(!button)return;if(button.hasAttribute('data-archive-desk')){openDeskArchive();return;}if(button.dataset.deskSplit){openDeskSplit(button.dataset.deskSplit);return;}
    if(button.dataset.close){$(button.dataset.close).close();return;}
    if(button.dataset.view){view=button.dataset.view;if(view==='customers')selectedCustomer='';$('search').value='';$('customer-filter').value=view==='customers'?'':selectedCustomer;render();}
    if(button.dataset.customerOrders||button.dataset.customerTransactions){chooseCustomer(button.dataset.customerOrders||button.dataset.customerTransactions);view=button.dataset.customerOrders?'orders':'transactions';const recovery=deskPending()?.input;if(view==='orders'&&recovery?.action==='DESK_ARCHIVE')activeDesk=recovery.desk;$('search').value='';render();}
    if(button.dataset.profile)openProfile(button.dataset.profile);
    if(button.dataset.order){selectedOrder=button.dataset.order;selectedLines.clear();view='order';render();}
    if(button.hasAttribute('data-clear-selection')){selectedLines.clear();render();}
    if(button.hasAttribute('data-autocount'))openAutoCount();
    if(button.dataset.deskStep){activeDesk=Math.max(0,Math.min(3,activeDesk+Number(button.dataset.deskStep)));selectedLines.clear();render();}
    if(button.dataset.editDetails)openDetails(button.dataset.editDetails,button);
    if(button.hasAttribute('data-edit-invoice-number'))openInvoiceNumber(button);
    if(button.hasAttribute('data-desk-shipment'))openDeskBooking();
    if(button.hasAttribute('data-desk-references'))openDeskReferences();
    if(button.dataset.deskDoc){const order=activeOrder(),hold=deskLock(),orderId=order?.lines[0]?.orderId||order?.orders[0]?.orderId;if(activeDesk&&orderId)openDocument(button.dataset.deskDoc,selectedCustomer,orderId,hold?.invoiceId||'',activeDesk);}
    if(button.hasAttribute('data-retry-desk')){const attempt=deskPending();if(attempt){if(attempt.input.action==='DESK_ARCHIVE')openDeskArchive();else if(attempt.input.action==='DESK_REFERENCES'&&referenceEdit?.customerId===attempt.input.customerId)saveReferenceDraft(true);else saveDeskChange(attempt.input);}}
    if(button.hasAttribute('data-create-invoice')){const invoice=currentDeskInvoice();if(invoice)showInvoice(invoice.id);else openInvoiceReview(activeOrder()?.id);}
    if(button.dataset.tab){tab=button.dataset.tab;render();}
    if(button.hasAttribute('data-cbm'))info('CBM Required','<p>Please contact Warehouse to update the product data as soon as possible.</p><p>请尽快联系货仓以更新产品数据。</p>');
    if(button.hasAttribute('data-booking-picker')){const order=activeOrder();info('Shipment Details',order.orders.map(item=>'<p><button class="link" data-shipment="'+esc(item.id)+'">'+day(item.orderDate)+' · '+esc(item.currency)+' · '+esc(transportLabel(item.booking?.transport))+' · '+day(item.booking?.date)+'</button></p>').join(''));}
    if(button.dataset.shipment){$('information').close();openBooking(button.dataset.shipment);}
    if(button.dataset.newCharge)info('Add document','<div class="charge-document-choice"><button type="button" class="primary" data-charge-choice="CHARGE" data-customer="'+esc(button.dataset.newCharge)+'">Invoice</button><button type="button" data-charge-choice="STANDALONE_DN" data-customer="'+esc(button.dataset.newCharge)+'">Debit Note</button></div>');
    if(button.dataset.chargeChoice){$('information').close();openDocument(button.dataset.chargeChoice==='STANDALONE_DN'?'DN':'SI',button.dataset.customer,'','',0,'',button.dataset.chargeChoice);}
    if(button.dataset.invoice)showInvoice(button.dataset.invoice);
    if(button.dataset.doc)openDocument(button.dataset.doc,button.dataset.customer,button.dataset.orderId,button.dataset.invoiceId);
  });
  $('back').onclick=()=>{view=view==='customer'?'customers':'orders';$('search').value='';render();};$('search').oninput=render;
  const monthParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  $('invoice-month').value=monthParts.year+'-'+monthParts.month;
  const yearLabel=$('invoice-year'),monthSelect=$('invoice-month-select');
  const setInvoicePeriod=(year,month)=>{
    $('invoice-month').value=year+'-'+month;
    yearLabel.textContent=year;monthSelect.value=month;
  };
  setInvoicePeriod(monthParts.year,monthParts.month);
  monthSelect.onchange=()=>{setInvoicePeriod(yearLabel.textContent,monthSelect.value);render();};
  for(const button of $('invoice-period').querySelectorAll('button'))button.onclick=()=>{
    setInvoicePeriod(Number(yearLabel.textContent)+Number(button.dataset.yearStep),monthSelect.value);render();
  };$('customer-filter').onchange=()=>{chooseCustomer($('customer-filter').value);render();};$('order-filter').onchange=()=>{selectedOrder=$('order-filter').value;selectedLines.clear();render();};$('refresh').onclick=load;
  $('company').onchange=()=>{if($('desk-details').open||$('desk-invoice-number').open){$('company').value=company;$('notice').textContent='Close the Desk details window before changing company.';return;}if(window.DeskDelivery?.supportPending()){$('company').value=company;$('notice').textContent='Confirm the pending Warehouse authorization before changing company.';return;}$('customer-profile').close();$('desk-references').close();$('booking').close();$('invoice-review').close();$('documents').close();selectedLines.clear();company=$('company').value;data=null;view='customers';selectedCustomer='';selectedOrder='';activeDesk=0;readCache=null;activeReadSets.clear();$('search').value='';$('customer-filter').value='';$('staff').textContent='';load();};
  $('company').value=company;
  $('login').onclick=()=>{if(parentOrigin)parent.postMessage({type:'FULFILMENT_LOGIN_REQUEST'},parentOrigin);};load();
})();
