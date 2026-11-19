(()=>{
'use strict';
const buyer=document.currentScript.dataset.room==='buyer',host=document.getElementById(buyer?'completedList':'customerHistory'),docsHost=buyer?document.getElementById('customerDocumentList'):null;
if(!host)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=n=>Number.isSafeInteger(n)?(n/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—',date=v=>{if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit',timeZone:'Asia/Kuala_Lumpur'}).replaceAll('/','-'):'—';},label=(en,zh)=>en+(buyer?'':' '+zh),types={SALES_INV:'Sales Invoice',SALES_CN:'Credit Note',DEBIT_NOTE:'Debit Note',CUSTOMER_RECEIPT:'Payment',CHARGE_INV:'Charge Invoice'},code=v=>v==='CF'?'CUS':v;
let customer='',customers=[],company='NCT',tab='shipments',query='',page=1,request=null,error='',buyerIdentity='',cache=new Map(),fromDate='',toDate='',historyDialog=null;
const key=()=>JSON.stringify([company,customer]),active=()=>buyer?document.getElementById('completedView').classList.contains('active')||document.getElementById('docsView').classList.contains('active'):document.getElementById('history').classList.contains('active'),data=()=>{const values=['NCT','GHR'].map(c=>cache.get(JSON.stringify([c,customer]))?.data);if(values.some(v=>!v))return null;return {transactions:values.flatMap(v=>v.transactions),documents:values.flatMap(v=>v.documents),account:{entries:values.flatMap(v=>v.account.entries),balances:values.flatMap(v=>v.account.balances),unapplied:values.flatMap(v=>v.account.unapplied)}};};
function valid(value,expectedCompany){
 const owned=row=>row&&row.company===expectedCompany&&row.customerId===customer,known=doc=>doc&&value.documents.some(file=>file.fileId===doc.fileId&&file.ready===doc.ready&&file.url===doc.url);
 return value&&value.company===expectedCompany&&value.customerId===customer&&Array.isArray(value.transactions)&&Array.isArray(value.documents)&&Array.isArray(value.account?.entries)&&Array.isArray(value.account?.balances)&&Array.isArray(value.account?.unapplied)&&value.account.invoiceMatching==='EXPLICIT_ALLOCATIONS'&&[...value.transactions,...value.account.entries,...value.account.balances,...value.account.unapplied].every(owned)&&value.documents.every(row=>row&&/^[A-Za-z0-9_-]{10,200}$/.test(row.fileId)&&(row.ready===true&&row.url==='https://drive.google.com/file/d/'+row.fileId+'/view'||row.ready===false&&row.url===null))&&value.transactions.every(row=>['GOODS','CHARGE'].includes(row.kind)&&typeof row.id==='string'&&Boolean(row.id)&&(row.kind==='CHARGE'||Number.isSafeInteger(row.quantity)&&row.quantity>0)&&Number.isSafeInteger(row.amountCents)&&row.amountCents>0&&Number.isSafeInteger(row.dueCents)&&row.dueCents>=0&&Array.isArray(row.lines)&&Array.isArray(row.payments)&&Array.isArray(row.adjustments)&&Array.isArray(row.documents)&&row.documents.every(known)&&[...row.payments,...row.adjustments].every(entry=>Number.isSafeInteger(entry.amountCents)&&entry.amountCents>0&&Array.isArray(entry.documents)&&entry.documents.every(known)))&&value.account.entries.every(row=>Array.isArray(row.documents)&&row.documents.every(known));
}
const files=items=>items.map(d=>d.ready!==true?'<span class="history-file-pending">'+esc(code(d.code)||'PDF')+' · Preparing</span>':'<a class="history-file" data-history-file="'+esc(d.fileId)+'" title="'+esc(d.number||d.name||'PDF')+'" href="https://drive.google.com/file/d/'+encodeURIComponent(d.fileId)+'/view" target="_blank" rel="noopener noreferrer">'+esc(code(d.code)||'PDF')+'</a>').join(' ');
function wireFiles(target){
 target.querySelectorAll('[data-history-file]').forEach(link=>link.onclick=event=>{
  event.preventDefault();if(request||error)return;
  for(const c of ['NCT','GHR']){const entry=cache.get(JSON.stringify([c,customer]));
   if(entry?.data.customerId===customer&&entry.data.documents.some(file=>file.fileId===link.dataset.historyFile&&file.ready===true&&file.url==='https://drive.google.com/file/d/'+file.fileId+'/view')){
    parent.postMessage({type:'CUSTOMER_HISTORY_FILE_OPEN',company:c,customerId:customer,requestId:entry.requestId,fileId:link.dataset.historyFile},'*');return;
   }
  }
 });
}
function requestData(force=false){
 if(!customer||request||!active())return;
 if(!force&&['NCT','GHR'].every(c=>{const prior=cache.get(JSON.stringify([c,customer]));return prior&&Date.now()-prior.at<60000;})){render();return;}
 error='';request={customerId:customer,pending:new Map(['NCT','GHR'].map(c=>[c,crypto.randomUUID()])),values:new Map(),errors:[]};const batch=request;batch.requestIds=new Map(batch.pending);render();
 for(const [c,id]of batch.pending)parent.postMessage(buyer?{type:'BUYER_TRANSACTION_HISTORY_REQUEST',company:c,requestId:id}:{type:'SALES_ROOM_SHIPMENT_REQUEST',customerId:customer,company:c,action:'HISTORY',requestId:id},'*');
 setTimeout(()=>{if(request===batch){request=null;error='Records incomplete. Both company accounts could not be confirmed. Use Refresh to try again.';render();}},30000);
}
function currentMonth(){
 const parts=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',timeZone:'Asia/Kuala_Lumpur'}).formatToParts(new Date());
 return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
}
let invoiceMonth=currentMonth();
function monthPicker(){
 const months=new Set([currentMonth(),invoiceMonth]);
 for(const row of data()?.transactions||[])if(/^\d{4}-(0[1-9]|1[0-2])/.test(row.date))months.add(row.date.slice(0,7));
 return '<select data-month aria-label="Invoice month">'+[...months].sort().reverse().map(m=>'<option value="'+m+'"'+(m===invoiceMonth?' selected':'')+'>'+new Intl.DateTimeFormat('en-GB',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T00:00:00Z'))+'</option>').join('')+'</select>';
}
function controls(mode=tab){return '<div class="history-controls">'+(!buyer?'<select data-customer aria-label="History customer"><option value="">Select customer</option>'+customers.map(c=>'<option value="'+esc(c.customerId)+'"'+(c.customerId===customer?' selected':'')+'>'+esc(c.customerShortName||c.companyName||c.customerId)+'</option>').join('')+'</select>':'')+(!buyer?monthPicker():'')+'<input data-search aria-label="Search transactions" placeholder="Search invoice or document" value="'+esc(query)+'"><button class="history-refresh" data-refresh'+(request?' disabled':'')+'>Refresh</button></div>'+(!buyer?'':'<div class="history-dates"><span>'+((mode==='payments')?'Payment date':mode==='documents'?'Document date':'Invoice date')+'</span><input type="date" data-from aria-label="From date" value="'+esc(fromDate)+'"><span>–</span><input type="date" data-to aria-label="To date" value="'+esc(toDate)+'"><button class="history-refresh" data-clear>Clear</button></div>');}
const salesDocTypes=['SO','BL','BC','SI','DO','CN','DN','PL','INS','CF','$'];
function salesDocs(row){
 const all=new Map();
 for(const file of [...row.documents,...row.adjustments.flatMap(a=>a.documents),...row.payments.flatMap(p=>p.documents)])all.set(file.fileId,file);
 return [...all.values()];
}
function salesDocCode(doc){return doc.code==='RECEIPT'?'$':doc.code==='CUS'?'CF':doc.code;}
function salesDocSlots(row){
 const docs=salesDocs(row);
 return '<div class="sales-doc-slots">'+salesDocTypes.map(type=>{
  const group=docs.filter(d=>salesDocCode(d)===type);
  if(!group.length)return '<span class="sales-doc-empty" aria-label="'+type+' unavailable">'+type+'</span>';
  if(group.every(d=>!d.ready))return '<span class="sales-doc-empty" aria-label="'+type+' preparing">'+type+'</span>';
  if(group.length===1&&group[0].ready)return files([{...group[0],code:type}]).replace('>CUS<','>CF<');
  return '<button class="sales-doc-group" data-files="'+esc(row.company+':'+row.id)+'" data-doc-type="'+type+'" aria-label="'+type+' documents">'+type+'</button>';
 }).join('')+'</div>';
}
function salesStatus(r){
 if(![r.paidCents,r.creditCents,r.debitCents,r.dueCents].every(Number.isSafeInteger))return '—';
 if(r.dueCents===0)return r.creditCents?(r.paidCents?'Settled':'Settled by CN'):'Fully Paid';
 return r.paidCents?'Partially Paid':'Unpaid';
}
function salesShipmentHtml(rows){
 const headers=['Transactions','Details','Shipped On','Currency','Invoice Amount','CN / DN Amount','Last Payment','Balance Due','Payment Status','Docs'];
 const header=headers.map((h,i)=>'<th scope="col"'+(i>=4&&i<=7?' class="history-number"':'')+'>'+h+'</th>').join('');
 return '<div class="history-scroll"><table class="history-table sales-invoice-table"><thead><tr>'+header+'</tr></thead><tbody>'+rows.map(r=>{
  const key=esc(r.company+':'+r.id),transport={LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'};
  const details=r.kind==='CHARGE'?r.lines.map(l=>esc(l.description)).join(' · '):r.quantity.toLocaleString('en-US')+' CTN'+(r.transport?'<small>'+esc(transport[r.transport]||r.transport)+'</small>':'');
  const adjustment=(type,n)=>Number.isSafeInteger(n)?(n>0?'<button class="history-link sales-'+type.toLowerCase()+'" data-adjustment="'+key+'">'+type+' '+money(n)+'</button>':''):'—';
  const last=r.lastPayment?'<button class="history-link" data-payment="'+key+'">'+money(r.lastPayment.amountCents)+'</button><small>'+date(r.lastPayment.date)+'</small>':'—';
  return '<tr><td><button class="history-link" data-transaction="'+key+'">'+esc(r.number)+'</button><small>Inv Date '+date(r.date)+'</small></td><td>'+details+'</td><td>'+date(r.departureDate)+'</td><td>'+esc(r.currency)+'</td><td class="history-number">'+money(r.amountCents)+'</td><td class="history-number">'+adjustment('DN',r.debitCents)+adjustment('CN',r.creditCents)+'</td><td class="history-number">'+last+'</td><td class="history-number">'+money(r.dueCents)+'</td><td><span class="sales-pay-status">'+salesStatus(r)+'</span></td><td>'+salesDocSlots(r)+'</td></tr>';
 }).join('')+'</tbody></table></div>';
}
function shipmentHtml(rows){return '<div class="history-scroll"><table class="history-table history-transactions"><thead><tr><th>Transaction</th><th>Details</th><th>Currency</th><th class="history-number">Invoice Amount</th><th class="history-number">Last Payment</th><th class="history-number">Amount Due</th><th>Docs</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><button class="history-link" data-transaction="'+esc(r.company+':'+r.id)+'">'+esc(r.number)+'</button><small>'+(r.departureDate?'Shipment '+date(r.departureDate):'Issued '+date(r.date))+'</small></td><td class="history-description">'+(r.kind==='CHARGE'?esc(r.lines.map(line=>line.description).join(' · ')):r.quantity.toLocaleString('en-US')+' CTN'+(r.transport?' · '+esc(({LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'})[r.transport]||r.transport):''))+'</td><td>'+esc(r.currency)+'</td><td class="history-number">'+money(r.amountCents)+'</td><td class="history-number">'+(r.lastPayment?'<button class="history-link" data-payment="'+esc(r.company+':'+r.id)+'">'+money(r.lastPayment.amountCents)+'</button><small>'+date(r.lastPayment.date)+'</small>':'—')+'</td><td class="history-number">'+money(r.dueCents)+'</td><td>'+files(r.documents.slice(0,3))+(r.documents.length>3?'<button class="history-link" data-files="'+esc(r.company+':'+r.id)+'">+'+(r.documents.length-3)+'</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';}
function listedBalances(rows){
 const totals=new Map();
 for(const row of rows){const label=row.company+' · '+row.currency;totals.set(label,(totals.get(label)||0)+row.dueCents);}
 return '<div class="sales-listed-balances">'+[...totals].map(([label,sum])=>'<span>Listed balance · '+esc(label)+' <b>'+money(sum)+'</b></span>').join('')+'</div>';
}
function balancesHtml(value){return '<div class="history-balances">'+value.account.balances.map(b=>{const unused=value.account.unapplied.filter(row=>row.company===b.company&&row.customerId===b.customerId&&row.currency===b.currency&&row.type!=='DEBIT_NOTE').reduce((n,row)=>n+row.amountCents,0);return '<div class="history-balance"><span>'+esc(b.company)+' · '+esc(b.currency)+' · '+(b.balanceCents<0?'Account credit':'Current balance')+'</span><strong>'+money(Math.abs(b.balanceCents))+'</strong>'+(unused?'<small>Unapplied payments and credits '+money(unused)+'</small>':'')+'</div>';}).join('')+'</div>';}
function accountHtml(rows){return '<div class="history-scroll"><table class="history-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Currency</th><th class="history-number">Amount</th><th>Files</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+date(r.date)+'</td><td>'+esc(types[r.type]||r.type)+'</td><td>'+esc(r.number)+'</td><td>'+esc(r.currency)+'</td><td class="history-number">'+money(r.amountCents)+'</td><td>'+files(r.documents)+'</td></tr>').join('')+'</tbody></table></div>';}
function documentsHtml(rows){return '<div class="history-scroll"><table class="history-table"><thead><tr><th>Date</th><th>Document</th><th>Reference</th><th>Scope</th><th>File</th></tr></thead><tbody>'+rows.map(d=>'<tr><td>'+date(d.at)+'</td><td>'+esc(code(d.code))+'</td><td>'+esc(d.number||'—')+'</td><td>'+esc(['ACCOUNT','CUSTOMER'].includes(d.scope)?'Account':d.scope==='INVOICE'?'Invoice':'Shipment')+'</td><td>'+files([d])+'</td></tr>').join('')+'</tbody></table></div>';}
function mount(target,documentsOnly=false){
 if(!target)return;target.className='transaction-history'+(buyer?' buyer-history':'');const value=data(),mode=documentsOnly?'documents':buyer?tab:'shipments';
 const all=value?(mode==='shipments'?value.transactions:mode==='payments'?value.account.entries.filter(row=>!['SALES_INV','CHARGE_INV'].includes(row.type)):value.documents):[];
 const filtered=(error&&!buyer?[]:all).filter(r=>{const day=String(r.date||r.at||'').slice(0,10);return (r.number+' '+(r.name||'')+' '+(r.code||'')+' '+(r.type||'')+(!buyer?' '+[...salesDocs(r),...r.adjustments].map(d=>d.number||d.name||'').join(' '):'')).toLowerCase().includes(query.toLowerCase())&&(buyer||day.slice(0,7)===invoiceMonth)&&(!fromDate||day>=fromDate)&&(!toDate||day<=toDate);}).sort((a,b)=>String(b.date||b.at||'').localeCompare(String(a.date||a.at||''))||String(a.company||'').localeCompare(String(b.company||''))||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(filtered.length/20));page=Math.min(page,pages);const rows=filtered.slice((page-1)*20,page*20),empty=!customer?'Select a customer to view transactions.':request&&!value?'Loading transactions…':error&&(!buyer||!value)?'Records unavailable.':'No matching records.';
 target.innerHTML=controls(mode)+(!documentsOnly&&buyer?'<div class="history-tabs" role="tablist">'+[['shipments','Transactions'],['payments','Payments & Statement'],['documents','Documents']].map(([id,en])=>'<button role="tab" data-tab="'+id+'" aria-selected="'+(mode===id)+'">'+en+'</button>').join('')+'</div>':'')+'<p class="history-status'+(error?' history-error':'')+'" role="status">'+esc(error||(request?'Updating…':''))+'</p>'+(!error&&value&&buyer?balancesHtml(value):'')+(rows.length?(mode==='shipments'?(buyer?shipmentHtml(rows):salesShipmentHtml(rows)):mode==='payments'?accountHtml(rows):documentsHtml(rows)):'<div class="history-empty">'+empty+'</div>')+(value?.account.unapplied.some(row=>row.type!=='DEBIT_NOTE'&&row.amountCents>0)?'<p class="history-note">Unapplied payments and credits remain on your account until Finance matches them to invoices. Company accounts and currencies are kept separate.</p>':'')+(!buyer&&filtered.length&&!error?listedBalances(filtered):'')+(pages>1?'<div class="history-pagination"><button data-prev'+(page===1?' disabled':'')+'>Previous</button><span>'+page+' / '+pages+'</span><button data-next'+(page===pages?' disabled':'')+'>Next</button></div>':'');
 wireFiles(target);
 target.querySelector('[data-refresh]').onclick=()=>requestData(true);
 const picker=target.querySelector('[data-customer]');if(picker)picker.onchange=e=>{closeDialog();fromDate='';toDate='';invoiceMonth=currentMonth();customer=e.target.value;page=1;error='';request=null;render();requestData();};
 target.querySelector('[data-search]').oninput=e=>{query=e.target.value;page=1;const start=e.target.selectionStart;render();const input=target.querySelector('[data-search]');input.focus();input.setSelectionRange(start,start);};
 if(!buyer)target.querySelector('[data-month]').onchange=e=>{invoiceMonth=e.target.value;page=1;render();};
 else for(const [selector,setter]of [['[data-from]',v=>fromDate=v],['[data-to]',v=>toDate=v]])target.querySelector(selector).onchange=e=>{setter(e.target.value);page=1;render();};
 if(buyer)target.querySelector('[data-clear]').onclick=()=>{query='';fromDate='';toDate='';page=1;render();};
 target.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;fromDate='';toDate='';page=1;render();});
 target.querySelector('[data-prev]')?.addEventListener('click',()=>{page--;render();});target.querySelector('[data-next]')?.addEventListener('click',()=>{page++;render();});
 for(const [attribute,kind]of [['transaction','invoice'],['payment','payment'],['files','files'],['adjustment','adjustment']])target.querySelectorAll('[data-'+attribute+']').forEach(button=>button.onclick=()=>showDetails(kind,button.dataset[attribute],button.dataset.docType));
}
function closeDialog(){if(historyDialog){historyDialog.close();historyDialog.remove();historyDialog=null;}}
function showDetails(kind,id,docType){
 const row=data()?.transactions.find(r=>r.company+':'+r.id===id);if(!row)return;closeDialog();historyDialog=document.createElement('dialog');historyDialog.className='history-dialog'+(buyer?' buyer-history':'');
 let body='';
 if(kind==='payment')body='<div class="history-dialog-total"><span>Invoice Amount</span><b>'+esc(row.currency)+' '+money(row.amountCents)+'</b></div><table class="history-table"><thead><tr><th>Payment</th><th class="history-number">Amount</th><th>Date</th><th>Proof</th></tr></thead><tbody>'+[...row.payments].reverse().map((p,i)=>'<tr><td>'+(i+1)+(i===0?'st':i===1?'nd':i===2?'rd':'th')+' Payment</td><td class="history-number">'+money(p.amountCents)+(p.totalAmountCents!==p.amountCents?'<small>Receipt total '+money(p.totalAmountCents)+'</small>':'')+'</td><td>'+date(p.date)+'</td><td>'+files(p.documents)+'</td></tr>').join('')+row.adjustments.map(p=>'<tr><td>'+esc(types[p.type])+'</td><td class="history-number">'+money(p.amountCents)+'</td><td>'+date(p.date)+'</td><td>'+files(p.documents)+'</td></tr>').join('')+'</tbody></table><div class="history-dialog-total"><span>Total Paid</span><b>'+money(row.paidCents)+'</b></div><div class="history-dialog-total"><span>Amount Due</span><b>'+money(row.dueCents)+'</b></div>';
 else if(kind==='adjustment')body='<table class="history-table"><thead><tr><th>Adjustment</th><th>Date</th><th class="history-number">Applied to invoice</th><th>Docs</th></tr></thead><tbody>'+row.adjustments.map(a=>'<tr><td>'+esc(types[a.type])+'<small>'+esc(a.number)+'</small></td><td>'+date(a.date)+'</td><td class="history-number">'+money(a.amountCents)+'</td><td>'+files(a.documents)+'</td></tr>').join('')+'</tbody></table>';
 else if(kind==='files')body=documentsHtml(!buyer&&docType?salesDocs(row).filter(d=>salesDocCode(d)===docType):row.documents);
 else body='<p>'+esc(row.kind==='CHARGE'?'Charges':row.quantity.toLocaleString('en-US')+' CTN'+(row.transport?' · '+(({LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'})[row.transport]||row.transport):''))+'</p><table class="history-table"><thead><tr><th>Description</th>'+(row.kind==='GOODS'?'<th class="history-number">Qty</th><th class="history-number">Price / CTN</th>':'')+'<th class="history-number">Amount</th></tr></thead><tbody>'+row.lines.map(line=>'<tr><td>'+esc(line.description||line.name)+(line.packing?'<small>'+esc(line.packing)+'</small>':'')+'</td>'+(row.kind==='GOODS'?'<td class="history-number">'+line.quantity.toLocaleString('en-US')+'</td><td class="history-number">'+money(Math.round(line.sellingPriceCtn*100))+'</td>':'')+'<td class="history-number">'+money(row.kind==='CHARGE'?line.amountCents:Math.round(line.quantity*line.sellingPriceCtn*100))+'</td></tr>').join('')+'</tbody></table><div class="history-dialog-total"><span>Invoice Amount</span><b>'+esc(row.currency)+' '+money(row.amountCents)+'</b></div><div class="history-docs">'+files(row.documents)+'</div>';
 historyDialog.innerHTML='<header><div><h2>'+(kind==='payment'?'Payment Details':kind==='files'?'Documents':kind==='adjustment'?'CN / DN Details':esc(row.number))+'</h2><small>'+esc(kind==='invoice'?row.company+' · '+row.currency:row.number)+' · Issued '+date(row.date)+'</small></div><button data-close-history aria-label="Close">×</button></header><div class="history-dialog-body">'+body+'</div><footer><button class="history-refresh" data-close-history>Close</button></footer>';document.body.append(historyDialog);wireFiles(historyDialog);historyDialog.querySelectorAll('[data-close-history]').forEach(button=>button.onclick=closeDialog);historyDialog.showModal();
}
function render(){if(buyer&&document.getElementById('docsView').classList.contains('active'))mount(docsHost,true);else mount(host);}
window.customerTransactionHistory={render,openCustomer(id,mode='documents'){if(buyer||typeof id!=='string'||!id)return;closeDialog();fromDate='';toDate='';customer=id;tab=['shipments','payments','documents'].includes(mode)?mode:'documents';query='';page=1;request=null;error='';document.querySelector('.nav button[data-view="history"]')?.click();render();requestData();}};
document.querySelectorAll(buyer?'.nav button[data-view="completed"],.nav button[data-view="docs"]':'.nav button[data-view="history"]').forEach(b=>b.addEventListener('click',()=>{page=1;render();requestData();}));
window.addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data||{};
 if(buyer&&m.type==='BUYER_ROOM_DATA'){const id=String(m.data?.customerId||'');if(id&&id!==buyerIdentity){closeDialog();fromDate='';toDate='';buyerIdentity=id;customer=id;cache.clear();request=null;error='';render();if(active())requestData();}return;}
 if(!buyer&&m.type==='SALES_ROOM_CUSTOMERS'&&m.ok){customers=Array.isArray(m.customers)?m.customers:[];if(customer&&!customers.some(c=>c.customerId===customer)){closeDialog();customer='';cache.clear();request=null;}render();return;}
 if(m.type!==(buyer?'BUYER_TRANSACTION_HISTORY_RESULT':'SALES_ROOM_SHIPMENT_RESULT')||!request||!request.pending.has(m.company)||m.requestId!==request.pending.get(m.company)||request.customerId!==customer)return;
 const batch=request;batch.pending.delete(m.company);if(!m.ok||!valid(m.result,m.company))batch.errors.push(m.company+': '+(m.error||'Records could not be confirmed.'));else batch.values.set(m.company,m.result);if(!batch.pending.size){request=null;if(batch.errors.length)error='Records incomplete. '+batch.errors.join(' ');else{const at=Date.now();for(const [c,value]of batch.values)cache.set(JSON.stringify([c,customer]),{data:value,at,requestId:batch.requestIds.get(c)});error='';}}render();
});
if(buyer&&typeof state!=='undefined'&&state.customerId){buyerIdentity=state.customerId;customer=buyerIdentity;}
if(!buyer&&typeof customerRecords!=='undefined')customers=customerRecords;
render();
})();
