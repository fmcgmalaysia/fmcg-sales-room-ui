const assert = require('node:assert/strict');

function replace(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function patchSupportScript(source) {
  source = replace(source, "read('Currency',currency)+read('Port Name',order.port)", "read('Port Name',order.port)+read('Currency',currency,'desk-currency')");
  source = replace(source, `const read=(label,value)=>'<div class="shipment-kv"><span>'+label+'</span><strong>'+esc(value||'—')+'</strong></div>';`,
    `const read=(label,value,style='')=>'<div class="shipment-kv '+style+'"><span>'+label+'</span><strong>'+esc(value||'—')+'</strong></div>';`);
  source = replace(source, "['SO','SI','DO','CN','$','BC','PL','CF','INS','BL']", "['SO','DO','SI','PL','CN','BC','CF','BL','INS','$']");
  source = replace(source, `'+guide[1]+'">'+code+'</button><span>'+guide[1]`, `'+guide[1]+'">'+(code==='$'?'TT':code)+'</button><span>'+guide[1]`);
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
  source = replace(source, "['Customer'],['Country'],['Currency'],['Port Name'],['Desk'],['Open tasks',true],['Entry']", "['Customer'],['Country'],['Port Name'],['Currency'],['Desk'],['Open tasks',true],['Profile'],['']");
  const profile = `(row.profile?'<button type="button" class="icon-link overview-profile" data-profile="'+esc(row.id)+'" aria-label="Edit profile for '+esc(row.name)+'">'+profileIcon+'</button>':'')`;
  source = replace(source, "'</strong>'+"+profile+"+'</td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.currency||'—')+'</td><td>'+esc(row.port||'—')", "'</strong></td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.port||'—')+'</td><td>'+esc(row.currency||'—')");
  source = replace(source, `+'</td><td><button type="button" class="customer-order-entry" data-customer-orders="'+esc(row.id)+'">Entry '+entryIcon`, `+'</td><td class="overview-profile-cell">'+${profile}+'</td><td class="overview-entry-cell"><button type="button" class="customer-order-entry" data-customer-orders="'+esc(row.id)+'" aria-label="Open orders for '+esc(row.name)+'">'+entryIcon`);
  source = replace(source, '<path d="M14 4h6v16h-6M3 12h13m-5-5 5 5-5 5"/>', '<path d="M4 12h15m-6-6 6 6-6 6"/>');
  source = replace(source, '<circle cx="9" cy="7" r="3"/><path d="M3 19v-3a6 6 0 0 1 11-3m1 7 5-5-2-2-5 5-1 3z"/>', '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/>');
  source = replace(source, "lines:viewLines(order),canSend:", "lines:viewLines(order),showOpenedTime:true,canSend:");
  return patchInvoices(source);
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
  source = replace(source, '<select id="order-filter"', '<input id="invoice-month" type="month" aria-label="Invoice month" hidden><select id="order-filter"');
  source = replace(source, 'task-chat.js?v=20261103-department-chat-prompts-v1', 'task-chat.js?v='+build);
  return replace(source, 'desk-delivery.js?v=20261111-warehouse-desk-workflow-v1', 'desk-delivery.js?v='+build);
}

function patchTaskChat(source) {
  return replace(source, "esc(messagePreview(latest)||'—')", "esc(messagePreview(latest)||(department==='SUPPORT'&&ids?'':'—'))");
}

const css = `
.shipment-compact .desk-currency strong{font-size:24px;line-height:1.1;font-weight:800;color:#e51b2b}
.shipment-compact .shipment-doc-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(5,auto);grid-auto-flow:column}
#desk-details{width:365px}
#desk-details #desk-details-fields{display:block}
#desk-details[data-section="order"] #desk-details-fields>section:nth-child(2),
#desk-details[data-section="shipment"] #desk-details-fields>section:first-child,
#desk-details[data-section="shipment"] #desk-details-fields>section:nth-child(2)>label:nth-of-type(2){display:none}
#desk-details #desk-details-fields h3{display:none}
.shipment-compact .shipment-compact-footer{background:#173651;padding:9px 15px}
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
.overview-profile-cell,.overview-entry-cell{text-align:center;width:44px}
.overview-profile{margin:0}
.overview-profile svg{fill:currentColor;stroke:none}
.overview-entry-cell .customer-order-entry{min-width:28px;min-height:28px;justify-content:center}
.overview-entry-cell .customer-order-entry svg{transition:transform .18s ease}
.overview-entry-cell .customer-order-entry:is(:hover,:focus-visible) svg{transform:translateX(3px)}
@media(prefers-reduced-motion:reduce){.overview-entry-cell .customer-order-entry svg{transition:none}}
.invoice-toolbar .invoice-add{grid-column:2}
.work-table.invoice-register{min-width:640px}
.invoice-register td:nth-child(2){width:35%;overflow-wrap:anywhere}
`;

module.exports = { patchSupportScript, patchSupportHtml, patchDeskDelivery, patchTaskChat, css };
