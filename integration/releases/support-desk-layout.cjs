const assert = require('node:assert/strict');

function replace(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function patchSupportScript(source) {
  source = replace(source, "read('Currency',currency)+read('Port Name',order.port)", "read('Port Name',order.port)+read('Currency',currency,'desk-currency')");
  source = replace(source, `const read=(label,value)=>'<div class="shipment-kv"><span>'+label+'</span><strong>'+esc(value||'—')+'</strong></div>';`,
    `const read=(label,value,style='')=>'<div class="shipment-kv '+style+'"><span>'+label+'</span><strong>'+esc(value||'—')+'</strong></div>';`);
  source = patchDocuments(source);
  source = replace(source, "function openDetails(section,opener){", "function openDetails(section,opener){\n    const shipment=section==='shipment';$('desk-details').dataset.section=section;$('desk-details').querySelector('h2').textContent=shipment?'Shipment Details':'Order Details';");
  source = replace(source, "if(input.name){input.value=values[input.name]??'';", "if(input.name){input.disabled=(input.closest('section')===input.closest('fieldset')?.lastElementChild)!==shipment;input.value=values[input.name]??'';");
  source = replace(source, "const values=Object.fromEntries(new FormData($('desk-details-form'))),deposit=", "const values={...detailsValues(activeOrder()),...Object.fromEntries(new FormData($('desk-details-form')))},deposit=");
  source = replace(source, "if(deposit.dataset.moneyUnset==='1'&&Number(deposit.value)===0)", "if(!deposit.disabled&&deposit.dataset.moneyUnset==='1'&&Number(deposit.value)===0)");
  source = replace(source, "':'Deposit is recorded for this Desk only;", "':shipment?'':'Deposit is recorded for this Desk only;");
  source = replace(source, "const value=item=>item===null?'Incomplete':number(item,places);", `const value=item=>item===null?'Incomplete':number(item,places);
    const basis=(item,missing)=>missing&&item===null?'<button type="button" class="cbm-issue-pill" data-cbm aria-label="Missing CBM" title="CBM unavailable">'+number(0,3)+'</button>':value(item);`);
  source = replace(source, "places,unit='',invoiced=false){", "places,unit='',invoiced=false,missingCbm=false){");
  source = replace(source, "const part=(label,item)=>", "const part=(label,item,missing=false)=>");
  source = replace(source, "+value(item)+(unit?", "+basis(item,missing)+(unit?");
  source = replace(source, "part('Planned',planned))+part(invoiced?'Invoiced':'Loaded',loaded)", "part('Planned',planned,missingCbm))+part(invoiced?'Invoiced':'Loaded',loaded,missingCbm&&invoiced)");
  source = replace(source, "quantityPair(planned.cbm,totalCbm,3,'m³'", "quantityPair(planned.cbm,totalCbm,4,'m³'");
  source = replace(source, `((line.cbm>0?'':'<button class="issue" data-cbm aria-label="Missing CBM">⚠</button>')+quantityPair(planned.cbm,loaded.cbm,3,'',invoiced))`,
    "quantityPair(planned.cbm,loaded.cbm,4,'',invoiced,!(line.cbm>0))");
  source = replace(source, "['Customer'],['Country'],['Currency'],['Port Name'],['Desk'],['Open tasks',true],['Entry']", "['Profile'],['Customer'],['Country'],['Port Name'],['Currency'],['Desk'],['']");
  const profile = `(row.profile?'<button type="button" class="icon-link overview-profile" data-profile="'+esc(row.id)+'" aria-label="Edit profile for '+esc(row.name)+'">'+profileIcon+'</button>':'')`;
  source = replace(source, "return '<tr><td><strong>'+esc(row.name)", "return '<tr data-customer-row><td class=\"overview-profile-cell\">'+ "+profile+" +'</td><td><strong>'+esc(row.name)");
  source = replace(source, "'</strong>'+"+profile+"+'</td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.currency||'—')+'</td><td>'+esc(row.port||'—')", "'</strong></td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.port||'—')+'</td><td>'+esc(row.currency||'—')");
  source = replace(source, `</div></td><td class="num">'+number(row.openTaskCount)+'</td><td><button type="button" class="customer-order-entry" data-customer-orders="'+esc(row.id)+'">Entry '+entryIcon`, `</div></td><td class="overview-entry-cell"><button type="button" class="customer-order-entry" data-customer-orders="'+esc(row.id)+'" aria-label="Open orders for '+esc(row.name)+'">'+entryIcon`);
  source = replace(source, "const rows=matching(data.customers);", "const rows=data.customers;");
  source = replace(source, "document.body.classList.toggle('support-orders-view',view==='orders');", "document.body.classList.toggle('support-orders-view',view==='orders');document.body.classList.toggle('support-customers-view',view==='customers');");
  source = replace(source, "const button=event.target.closest('button');if(!button)return;if(button.dataset.deskSplit)", `const target=event.target;
    const control=target.closest('button,a,input,select,textarea,label');
    const button=control?control.closest('button'):target.closest('[data-customer-row]')?.querySelector('.customer-order-entry');
    if(!button)return;if(button.dataset.deskSplit)`);
  source = replace(source, '<path d="M14 4h6v16h-6M3 12h13m-5-5 5 5-5 5"/>', '<path d="M4 12h15m-6-6 6 6-6 6"/>');
  source = replace(source, '<circle cx="9" cy="7" r="3"/><path d="M3 19v-3a6 6 0 0 1 11-3m1 7 5-5-2-2-5 5-1 3z"/>', '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>');
  source = replace(source, "lines:viewLines(order),canSend:", "lines:viewLines(order),showOpenedTime:true,canSend:");
  return patchCompactWorkspace(patchInvoices(source));
}

function patchCompactWorkspace(source) {
  const pencil = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 16h4L21 7a2.8 2.8 0 0 0-4-4l-9 9zM15 5l4 4"/></svg>';
  source = replace(source, "+(canEdit?'':'disabled')+'>✎</button></div>'", "+(canEdit?'':'disabled')+'>"+pencil+"</button></div>'");
  source = replace(source, "documentGuides.map(([code,label])=>{const count=activeDesk?", "documentGuides.filter(([code])=>code!=='DN').map(([code,label])=>{const count=activeDesk?");
  source = replace(source, "documentContext={code,customerId,", "$('documents').classList.toggle('charge-form',charge);documentContext={code,customerId,");
  source = replace(source, "+read('Currency',currency,'desk-currency')", "");
  source = replace(source, `+'</h2><div class="desk-switcher">`, `+'</h2><span class="desk-currency" aria-label="Invoice currency">'+esc(currencies.length===1?currency:currencies.length>1?'Mixed currencies':currency||'—')+'</span><div class="desk-switcher">`);
  const footerStart = source.indexOf(`      '<div class="shipment-compact-footer">'`);
  const footerEnd = source.indexOf("\n", footerStart);
  assert.ok(footerStart>=0 && footerEnd>footerStart);
  const footer = source.slice(footerStart, footerEnd);
  source = replace(source, footer+"\n", "");
  source = replace(source, `      '<div class="shipment-columns">`, footer+"\n"+`      '<div class="shipment-columns">`);
  source = replace(source, "[['Profile'],['Customer'],['Country'],['Port Name'],['Currency'],['Desk'],['']],rows.map(row=>{", "[['No.'],['Profile'],['Customer'],['Country'],['Port Name'],['Currency'],['Desk'],['']],rows.map((row,index)=>{");
  source = replace(source, '<tr data-customer-row><td class="overview-profile-cell">', `<tr data-customer-row><td class="overview-number">'+String(index+1).padStart(3,'0')+'</td><td class="overview-profile-cell">`);
  source = replace(source, "$('invoice-month').hidden=view!=='invoiceRegister';", "$('invoice-period').hidden=view!=='invoiceRegister';");
  source = replace(source, "document.body.classList.toggle('support-customers-view',view==='customers');", "document.body.classList.toggle('support-customers-view',view==='customers');document.body.classList.toggle('support-invoices-view',view==='transactions');");
  return replace(source, "$('invoice-month').onchange=render;", `const yearLabel=$('invoice-year'),monthSelect=$('invoice-month-select');
  const setInvoicePeriod=(year,month)=>{
    $('invoice-month').value=year+'-'+month;
    yearLabel.textContent=year;monthSelect.value=month;
  };
  setInvoicePeriod(monthParts.year,monthParts.month);
  monthSelect.onchange=()=>{setInvoicePeriod(yearLabel.textContent,monthSelect.value);render();};
  for(const button of $('invoice-period').querySelectorAll('button'))button.onclick=()=>{
    setInvoicePeriod(Number(yearLabel.textContent)+Number(button.dataset.yearStep),monthSelect.value);render();
  };`);
}

function patchDocuments(source) {
  source = replace(source, "  function supportDocs(", `  const documentGuides=['SO','DO','SI','PL','CN','BC','CF','BL','INS','$','DN'].map(code=>guides.find(guide=>guide[0]===code));
  const documentLabel=code=>code==='$'?'TT':code;
  function matchesDeskDocument(doc,customerId,desk,batchId,invoiceId=''){
    if(doc.customerId!==customerId)return false;
    if(doc.scope==='INVOICE')return Boolean(invoiceId)&&doc.invoiceId===invoiceId;
    return doc.scope==='DESK'&&doc.desk===desk&&
      (doc.invoiceId?doc.invoiceId===invoiceId:Boolean(batchId)&&(doc.batchId||initialDeskBatch(desk,customerId))===batchId);
  }
  function supportDocs(`);
  source = replace(source, "doc.customerId===customerId&&doc.code===code&&(doc.invoiceId===invoiceId||doc.scope==='DESK'&&doc.desk===desk&&!doc.invoiceId&&(doc.batchId||initialDeskBatch(desk,customerId))===invoice.deskBatchId)", "doc.code===code&&matchesDeskDocument(doc,customerId,desk,invoice.deskBatchId||initialDeskBatch(desk,customerId),invoiceId)");
  source = replace(source, "row.scope==='DESK'&&row.desk===c.desk&&(c.invoiceId?row.invoiceId===c.invoiceId||!row.invoiceId&&(row.batchId||initialDeskBatch(c.desk,c.customerId))===c.batchId:!row.invoiceId&&(row.batchId||initialDeskBatch(c.desk,c.customerId))===c.batchId)", "matchesDeskDocument(row,c.customerId,c.desk,c.batchId,c.invoiceId)");
  source = replace(source, "row.customerId===selectedCustomer&&row.scope==='DESK'&&row.desk===activeDesk&&!row.invoiceId&&(row.batchId||initialDeskBatch(activeDesk))===deskBatch(activeDesk)&&(!code||row.code===code)", "matchesDeskDocument(row,selectedCustomer,activeDesk,deskBatch(activeDesk),invoiceId)&&(!code||row.code===code)");
  source = replace(source, "function deskDocuments(code){", "function deskDocuments(code,invoiceId=''){");
  source = replace(source, "['SO','SI','DO','CN','$','BC','PL','CF','INS','BL'].map(code=>{const guide=guides.find(row=>row[0]===code),count=activeDesk?deskDocuments(code).length:0;", "documentGuides.map(([code,label])=>{const count=activeDesk?deskDocuments(code,currentDeskInvoice()?.id).length:0;");
  source = replace(source, `'+guide[1]+'">'+code+'</button><span>'+guide[1]`, `'+label+'">'+documentLabel(code)+'</button><span>'+label`);
  source = replace(source, "const records=documents(customerId,ids);return '<div class=\"doc-strip\">'+guides.map", "const records=documents(customerId,ids);return '<div class=\"doc-strip\">'+documentGuides.map");
  source = replace(source, "{SI:'SALES_INV',CN:'SALES_CN','$':'CUSTOMER_RECEIPT'}[code]", "{SI:'SALES_INV',CN:'SALES_CN',DN:'DEBIT_NOTE','$':'CUSTOMER_RECEIPT'}[code]");
  source = replace(source, `aria-label="'+label+'">'+code+'</button>';}).join('')+'</div>';}`, `aria-label="'+label+'">'+documentLabel(code)+'</button>';}).join('')+'</div>';}`);
  source = replace(source, "return '<div class=\"doc-strip\">'+guides.map", "return '<div class=\"doc-strip\">'+documentGuides.map");
  source = replace(source, `aria-label="'+esc(label)+'">'+code+'</button>';`, `aria-label="'+esc(label)+'">'+documentLabel(code)+'</button>';`);
  source = replace(source, `unavailable">'+esc(code)+'</span>';`, `unavailable">'+documentLabel(code)+'</span>';`);
  return replace(source, "const legend=guides.map(([code,label])=>'<li><strong>'+esc(code)", "const legend=documentGuides.map(([code,label])=>'<li><strong>'+documentLabel(code)");
}

function patchInvoices(source) {
  source = replace(source, "function matching(rows){const query=$('search').value.trim().toLowerCase(),customer=$('customer-filter').value;", "function matching(rows,filterCustomer=true){const query=$('search').value.trim().toLowerCase(),customer=filterCustomer?$('customer-filter').value:'';");
  source = replace(source, "transactions:'Invoices & Payments'", "transactions:'Invoices & Payments',invoiceRegister:'Invoice Register'");
  source = replace(source, "$('order-filter').hidden=true;\n    document.querySelectorAll", "$('order-filter').hidden=true;$('invoice-month').hidden=view!=='invoiceRegister';\n    document.querySelectorAll");
  source = replace(source, "    const customer=data.customers.find(row=>row.id===selectedCustomer);\n    if(!customer)", "    if(view==='invoiceRegister'){renderInvoiceRegister();return;}\n    const customer=data.customers.find(row=>row.id===selectedCustomer);\n    if(!customer)");
  source = replace(source, "    $('company-name').textContent=customer.name;", "    if(view!=='transactions')$('company-name').textContent=customer.name;");
  source = replace(source, `<strong>'+esc(customer.name)+'</strong><button type="button" class="primary" data-new-charge`, `<button type="button" class="primary invoice-add" data-new-charge`);
  source = replace(source, "$('search').oninput=render;", `$('search').oninput=render;
  const monthParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  $('invoice-month').value=monthParts.year+'-'+monthParts.month;
  $('invoice-month').onchange=render;`);
  return replace(source, '  function chargeInvoiceDetails(row){', `  function renderInvoiceRegister(){
    const month=$('invoice-month').value;
    if(!month){$('count').textContent='';$('content').innerHTML='<div class="empty">Select an invoice month.</div>';return;}
    const invoices=new Map();
    for(const customer of data.customers){
      const issued=(customer.transactions||[]).filter(row=>row.type==='SALES_INV'||row.type==='CHARGE_INV');
      for(const row of issued){
        if(!row.id||row.pending||row.customerId!==customer.id||(row.company&&row.company!==data.company)||String(row.date||'').slice(0,7)!==month)continue;
        invoices.set(row.id,{...row,customerName:customer.name});
      }
    }
    const rows=matching([...invoices.values()],false).sort((a,b)=>b.date.localeCompare(a.date)||String(a.number).localeCompare(String(b.number)));
    $('count').textContent=invoices.size+' issued'+(rows.length!==invoices.size?' · '+rows.length+' shown':'');
    $('content').innerHTML=table([['Invoice'],['Customer'],['Invoice Date'],['Type'],['Currency'],['Invoice Amount',true]],rows.map(row=>{
      const charge=row.type==='CHARGE_INV',label=esc(row.number);
      const invoice=charge?(/^[A-Za-z0-9_-]{10,200}$/.test(row.fileId||'')?'<a class="link" target="_blank" rel="noopener noreferrer" href="https://drive.google.com/file/d/'+encodeURIComponent(row.fileId)+'/view">'+label+'</a>':label):'<button type="button" class="link" data-invoice="'+esc(row.id)+'">'+label+'</button>';
      return '<tr><td>'+invoice+'</td><td>'+esc(row.customerName)+'</td><td>'+day(row.date)+'</td><td>'+(charge?'Charge':'Goods')+'</td><td>'+esc(row.currency)+'</td><td class="num">'+(Number.isSafeInteger(row.amountCents)?number(row.amountCents/100,2):'—')+'</td></tr>';
    }),'invoice-register');
  }

  function chargeInvoiceDetails(row){`);
}

function patchDeskDelivery(source) {
  const activeLine = "const slot=root.querySelector('.shipment-delivery-actions'),anchor=root.querySelector('.shipment-task-count');";
  source = replace(source, activeLine, `if(active&&context.showOpenedTime&&!pending){
   const date=new Date(active.sentAt),valid=Boolean(active.sentAt)&&Number.isFinite(date.getTime());
   const parts=valid?Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value])):null;
   const opened=document.createElement('span');opened.className='dd-opened-status';opened.textContent=parts?'Task Opened on '+parts.day+'-'+parts.month+'-'+parts.year+' '+parts.hour+':'+parts.minute:'Task Opened';
   const action=bar.querySelector('button');action.hidden=true;action.before(opened);bar.querySelector('[role="status"]').textContent='';
  }
  `+activeLine);
  return replace(source, "if(pending?.running)return;", "if(pending?.running||(active&&context.showOpenedTime&&!supportPending.has(key)))return;");
}

function patchSupportHtml(source, previousBuild, build) {
  source = source.replaceAll(previousBuild, build);
  source = replace(source, '<button data-view="transactions">Invoices &amp; Payments</button>', '<button data-view="transactions">Invoices &amp; Payments</button><button data-view="invoiceRegister">Invoice Register</button>');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  source = replace(source, '<select id="order-filter"', '<div id="invoice-period" hidden><select id="invoice-month-select" aria-label="Invoice month">'+
    months.map((month,index)=>'<option value="'+String(index+1).padStart(2,'0')+'">'+month+'</option>').join('')+
    '</select><button type="button" data-year-step="-1" aria-label="Previous invoice year">‹</button><span id="invoice-year" aria-live="polite"></span><button type="button" data-year-step="1" aria-label="Next invoice year">›</button><input id="invoice-month" type="hidden"></div><select id="order-filter"');
  source = replace(source, 'task-chat.js?v=20261103-department-chat-prompts-v1', 'task-chat.js?v='+build);
  return replace(source, 'desk-delivery.js?v=20261111-warehouse-desk-workflow-v1', 'desk-delivery.js?v='+build);
}

function patchTaskChat(source) {
  return replace(source, "esc(messagePreview(latest)||'—')", "esc(messagePreview(latest)||(department==='SUPPORT'&&ids?'':'—'))");
}

const css = `
.shipment-compact .desk-currency{display:inline-flex;align-items:center;min-height:30px;padding:2px 8px;border-radius:5px;background:#fff0d4;color:#804500;font-size:23px;line-height:1.1;font-weight:800}
.shipment-compact .shipment-customer-desk{flex-wrap:wrap;gap:7px 12px}
.shipment-compact .shipment-doc-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(5,auto);grid-auto-flow:column}
.shipment-compact .shipment-doc-grid>div:nth-child(n+6){grid-column:2}
.shipment-compact .shipment-section-pencil{display:inline-grid;place-items:center}
.shipment-compact .shipment-columns h3{color:#28465e;font-weight:700;letter-spacing:.045em}
.shipment-compact .desk-switcher{border-color:#e7a34e;background:#fff0d4;color:#804500}
.shipment-compact .desk-switcher button:not(:disabled){color:#a95400}
.shipment-compact .shipment-section-pencil svg{transition:transform .16s ease}
.shipment-compact .shipment-section-pencil:not(:disabled):is(:hover,:focus-visible) svg{transform:translate(1px,-2px) rotate(-9deg)}
@media(prefers-reduced-motion:reduce){.shipment-compact .shipment-section-pencil svg{transition:none;transform:none!important}}
#desk-details{width:365px}
#desk-details #desk-details-fields{display:block}
#desk-details[data-section="order"] #desk-details-fields>section:nth-child(2),
#desk-details[data-section="shipment"] #desk-details-fields>section:first-child,
#desk-details[data-section="shipment"] #desk-details-fields>section:nth-child(2)>label:nth-of-type(2){display:none}
#desk-details #desk-details-fields h3{display:none}
.shipment-compact .shipment-compact-footer{background:#173651;padding:6px 14px}
.shipment-compact .shipment-totals{justify-content:flex-start;gap:9px 19px;border:0;color:#fff;padding:0}
.shipment-compact .shipment-totals :is(dt,small,.desk-amount>span,.shipment-invoice>span){color:#d8e7f4}
.shipment-compact .shipment-totals .quantity-basis>b{color:#fff}
.shipment-compact .shipment-invoice .invoice-number-link{background:#244963;border-color:#7895ac;color:#fff}
.shipment-compact .shipment-invoice .invoice-number-link:disabled{background:#244963;color:#c0d2e0}
.shipment-compact .quantity-basis,.order-tasks .quantity-basis{justify-content:flex-end;gap:5px}
.order-tasks .quantity-comparison{width:auto;min-width:0}
.order-tasks .quantity-basis>b{min-width:7ch;text-align:right}
.order-tasks :is(th,td):nth-child(8),.order-tasks :is(th,td):nth-child(9){width:1%;padding-inline:6px}
.order-tasks .cbm-issue-pill{background:#e51b2b;color:#fff;border:0;border-radius:999px;font:inherit;padding:1px 6px}
.shipment-delivery-actions .dd-action[hidden]{display:none}
.shipment-delivery-actions .dd-opened-status{font-size:11px;font-weight:600;color:#184d80}
.order-tasks td:last-child{vertical-align:top}
.order-tasks [data-tc-cell="sources"]{flex-direction:row-reverse;align-items:flex-start;gap:6px}
.order-tasks [data-tc-cell="sources"] .tc-actions{padding:0}
.order-tasks [data-tc-cell="sources"] .tc-peer{min-width:24px;height:17px;font-size:10px;padding:0 4px!important}
.order-tasks [data-tc-cell="sources"] .tc-peer:after{left:4px;border-top-width:4px;border-right-width:5px}
.order-tasks [data-tc-cell="sources"] .tc-snippet{font-size:11px}
.overview-number{width:36px;color:#536d87;font-variant-numeric:tabular-nums}
.overview-profile-cell,.overview-entry-cell{text-align:center;width:44px}
.overview-profile{margin:0}
.overview-profile svg{fill:currentColor;stroke:none}
.overview-entry-cell .customer-order-entry{min-width:28px;min-height:28px;justify-content:center}
.overview-entry-cell .customer-order-entry svg{transition:transform .18s ease}
.support-customers-view .tools{display:none}
tr[data-customer-row]{cursor:pointer}
tr[data-customer-row]:is(:hover,:focus-within)>td{background:#f6faff}
tr[data-customer-row]:hover .customer-order-entry svg,.customer-order-entry:focus-visible svg{transform:translateX(3px)}
@media(prefers-reduced-motion:reduce){tr[data-customer-row] .customer-order-entry svg{transition:none;transform:none!important}}
.invoice-toolbar{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:4px 8px;margin:0}
.invoice-toolbar .invoice-add{grid-column:2;grid-row:1;min-height:28px;padding:3px 8px}
.invoice-toolbar .invoice-legend{grid-column:1;grid-row:1;gap:3px 9px}
body.support-workroom.support-invoices-view .heading{min-height:0;margin-bottom:8px}
body.support-workroom.support-invoices-view .tools{padding:5px 8px;gap:8px;margin-bottom:5px}
#documents.charge-form{width:470px}
#documents.charge-form #document-fields{display:grid;gap:8px;margin-top:8px}
#documents.charge-form #document-fields>label{margin:0}
#documents.charge-form #document-fields>label[hidden],
#documents.charge-form #document-amount-label small,
#documents.charge-form #document-fields>label:has(#document-file)+small{display:none}
#documents.charge-form #charge-lines{grid-row:2}
#documents.charge-form #document-amount-label{grid-row:3}
#documents.charge-form #document-amount{width:120px;margin-left:auto;text-align:right}
#documents.charge-form #document-amount-label{display:flex;align-items:center;gap:8px}
#documents.charge-form #document-status{font-size:11px;margin:6px 0;color:#536d87}
#invoice-period:not([hidden]){display:flex;align-items:center;gap:6px}
.tools #invoice-month-select{min-width:62px}
#invoice-period button{min-width:26px;min-height:28px}
#invoice-year{min-width:4ch;text-align:center;font-variant-numeric:tabular-nums}
.invoice-list :is(th,td):last-child{min-width:366px}
.invoice-list .doc-strip{width:max-content;flex-wrap:nowrap}
.invoice-list .doc-strip>*{box-sizing:border-box;flex:0 0 28px}
.work-table.invoice-register{min-width:640px}
.invoice-register td:nth-child(2){width:35%;overflow-wrap:anywhere}
`;

module.exports = { patchSupportScript, patchSupportHtml, patchDeskDelivery, patchTaskChat, css };
