const assert = require('node:assert/strict');

function compactHeader(source) {
  const footer = "'<div class=\"shipment-compact-footer\">'+headerDocuments(order)+";
  const end = "'</section></div>'+";
  const start = source.indexOf("section('Shipment Details','shipment')");
  const boundary = source.indexOf(end, start);
  assert.ok(start >= 0 && boundary > start && source.indexOf(footer, boundary) > boundary);
  source = source.slice(0, boundary) + "'</section>'+headerDocuments(order)+'</div>'+" + source.slice(boundary + end.length);
  return source.replace(footer, "'<div class=\"shipment-compact-footer\">'+");
}

function compactOverview(source) {
  const start = source.indexOf("      const rows=matching(data.customers);");
  const end = source.indexOf('      return;', start);
  assert.ok(start >= 0 && end > start);
  const overview = [
    "      const rows=matching(data.customers);$('count').textContent=rows.length+' customers';",
    "      const summary=new Map();",
    "      for(const order of data.orders)for(const line of order.lines){",
    "        if(!(line.orderQty>line.invoicedQty))continue;",
    "        if(!summary.has(order.customerId))summary.set(order.customerId,[0,0,0,0]);",
    "        const counts=summary.get(order.customerId);",
    "        const portions=line.deskPortions?.length?line.deskPortions:[{desk:data.desks?.find(desk=>desk.customerId===order.customerId)?.assignments.find(row=>row.taskId===line.taskId)?.desk||0,quantity:line.orderQty,invoiced:line.invoicedQty}];",
    "        for(const part of portions)counts[part.desk]+=Math.max(0,part.quantity-(part.invoiced||0));",
    "      }",
    "      $('content').innerHTML=table([['Customer'],['Country'],['Currency'],['Port Name'],['Desk'],['Open tasks',true],['Entry']],rows.map(row=>{",
    "        const counts=summary.get(row.id)||[];",
    "        const desks=!data.deskAvailable||!data.delivery?'—':[1,2,3,0].filter(desk=>counts[desk]>0).map(desk=>'<span class=\"overview-desk'+(desk?'':' pending')+'\">'+(desk?'Desk '+desk:'Pending')+' · '+number(counts[desk])+' CTN</span>').join('')||'—';",
    "        return '<tr><td><strong>'+esc(row.name)+'</strong>'+(row.profile?'<button type=\"button\" class=\"icon-link overview-profile\" data-profile=\"'+esc(row.id)+'\" aria-label=\"Edit profile for '+esc(row.name)+'\">'+profileIcon+'</button>':'')+'</td><td>'+esc(row.country||'—')+'</td><td>'+esc(row.currency||'—')+'</td><td>'+esc(row.port||'—')+'</td><td><div class=\"overview-desks\">'+desks+'</div></td><td class=\"num\">'+number(row.openTaskCount)+'</td><td><button type=\"button\" class=\"customer-order-entry\" data-customer-orders=\"'+esc(row.id)+'\">Entry '+entryIcon+'</button></td></tr>';",
    "      }));",
    '',
  ].join('\n');
  return source.slice(0, start) + overview + source.slice(end);
}

function compactTransactions(source) {
  const start = source.indexOf("    if(view==='transactions'){$('content').innerHTML=");
  const end = source.indexOf('\n', start);
  assert.ok(start >= 0 && end > start);
  const header = [
    "    if(view==='transactions'){",
    "      const charges=(customer.transactions||[]).filter(row=>['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type));",
    "      const rows=matching([...customer.invoices,...charges].map(row=>({...row,customerName:customer.name}))).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));",
    "      const legend=guides.map(([code,label])=>'<li><strong>'+esc(code)+'</strong> '+esc(label)+'</li>').join('');",
    "      $('content').innerHTML='<section class=\"invoice-toolbar\"><strong>'+esc(customer.name)+'</strong><button type=\"button\" class=\"primary\" data-new-charge=\"'+esc(customer.id)+'\">+ Add Invoice</button><ul class=\"invoice-legend\" aria-label=\"Document codes\">'+legend+'</ul></section>'+invoiceTable(rows);",
    "      $('count').textContent=rows.length+' invoices';return;",
    "    }",
  ].join('\n');
  source=source.slice(0, start) + header + source.slice(end);
  const tableStart=source.indexOf('  function invoiceTable(');
  const tableEnd=source.indexOf('  function transportLabel(',tableStart);
  assert.ok(tableStart>=0&&tableEnd>tableStart);
  const invoiceTable=String.raw`  function chargeInvoiceDetails(row){
    const names=(row.chargeLines||[]).map(line=>String(line.description||'').trim()).filter(Boolean);
    return [...new Set(names.map(name=>/^ocean freight$/i.test(name)?'Ocean Fee':name))].join(' + ')||'Charge invoice';
  }
  function chargeInvoiceDocs(row){
    const fileId=row.fileId||'';
    return '<div class="doc-strip">'+guides.map(([code,label])=>{
      if(code==='SI'&&/^[A-Za-z0-9_-]{10,200}$/.test(fileId))return '<a class="invoice-file" target="_blank" rel="noopener noreferrer" aria-label="'+esc(label)+'" href="https://drive.google.com/file/d/'+encodeURIComponent(fileId)+'/view">SI</a>';
      if(row.type==='CHARGE_INV'&&['$','CN','DN'].includes(code)){
        const available=supportDocs(row.customerId,'',row.id,code).length>0;
        return '<button type="button" class="'+(available?'available':'')+'" data-doc="'+code+'" data-customer="'+esc(row.customerId)+'" data-order-id="" data-invoice-id="'+esc(row.id)+'" aria-label="'+esc(label)+'">'+code+'</button>';
      }
      return '<span class="invoice-file-muted" title="'+esc(label)+'" aria-label="'+esc(label)+' unavailable">'+esc(code)+'</span>';
    }).join('')+'</div>';
  }
  function invoiceTable(rows){
    const ordersById=new Map(data.orders.map(order=>[JSON.stringify([order.customerId,order.orderId]),order]));
    return table([['Invoice'],['Details'],['Shipped On'],['Currency'],['Invoice Amount',true],['Balance Due',true],['Payment Status'],['Docs']],rows.map(row=>{
      const charge=['CHARGE_INV','CHARGE_INVOICE_DOCUMENT'].includes(row.type);
      const lines=row.lines||[],order=ordersById.get(JSON.stringify([row.customerId,lines[0]?.orderId]));
      const qty=lines.length&&lines.every(line=>Number.isSafeInteger(line.quantity)&&line.quantity>=0)?lines.reduce((sum,line)=>sum+line.quantity,0):null;
      const details=charge?chargeInvoiceDetails(row):'Order of goods'+(qty===null?'':' '+qty+' ctn');
      const numberLabel=charge?'<strong>'+esc(row.number)+'</strong>':'<button class="link" data-invoice="'+esc(row.id)+'">'+esc(row.number)+'</button>';
      const shippedOn=charge?'—':day(row.dispatch?.at||(row.deskNumber?row.deskShipment?.departureDate:order?.booking?.departureDate));
      const status=charge&&row.pending?'Awaiting Finance':row.paymentStatus;
      const files=charge?chargeInvoiceDocs(row):docs(row.customerId,[row.id],lines[0]?.orderId||'',row.id);
      return '<tr><td>'+numberLabel+'<small>Inv Date '+day(row.pending?null:row.date)+'</small></td><td class="invoice-details">'+esc(details)+'</td><td>'+shippedOn+'</td><td>'+esc(row.currency)+'</td><td class="num">'+number(row.amountCents/100,2)+'</td><td class="num">'+(Number.isSafeInteger(row.balanceCents)?number(row.balanceCents/100,2):'—')+'</td><td><span class="plain-status neutral">'+esc(status)+'</span></td><td>'+files+'</td></tr>';
    }),'invoice-list');
  }
`;
  source=source.slice(0,tableStart)+invoiceTable+source.slice(tableEnd);
  const oldChargeStart=source.indexOf('  function chargeTable(');
  const oldChargeEnd=source.indexOf('  function showInvoice(',oldChargeStart);
  assert.ok(oldChargeStart>=0&&oldChargeEnd>oldChargeStart);
  return (source.slice(0,oldChargeStart)+source.slice(oldChargeEnd))
    .replace("['SI','CN','$'].includes(code)?'INVOICE':'ORDER'", () => "['SI','CN','DN','$'].includes(code)?'INVOICE':'ORDER'")
    .replace("row.orderId===c.orderId&&(!invoiceId||row.invoiceId===invoiceId||row.shipmentId===invoiceId)", "row.orderId===c.orderId&&(!invoiceId||row.invoiceId===invoiceId||row.shipmentId===invoiceId||row.scope==='ORDER'&&!type)")
    .replace("const customerScope=!orderId&&['$','CN','DN'].includes(code);", () => "const customerScope=!orderId&&!invoiceId&&['$','CN','DN'].includes(code);")
    .replace("(customerScope?'Customer account 客户账户':desk?", "(customerScope?'Customer account 客户账户':!orderId&&invoiceId?customer?.transactions?.find(row=>row.id===invoiceId)?.number||invoiceId:desk?")
    .replace("transactions:'Transactions'", "transactions:'Invoices & Payments'")
    .replace("$('guide').hidden=view!=='transactions'", "$('guide').hidden=true");
}

function chargeInvoiceForm(source) {
  const marker = "container.innerHTML=lines.map(chargeLineHtml).join('')+'<button type=\"button\" data-add-charge>Add charge</button>';";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, [
    "const pendingInput=attempt?.input||recovery?.input;",
    "const preferred=pendingInput?.chargeCurrency||customer?.currency||'';",
    "const currencies=[...new Set([preferred,'MYR','USD','SGD','EUR','GBP','AUD','JPY','CNY','HKD','THB','IDR','PHP','BND','NZD'].filter(value=>/^[A-Z]{3}$/.test(value)))];",
    "const choices=['Ocean Fee','Insurance','Sticker Printing','Labour Charges','Other'];",
    "container.innerHTML='<label>Currency<select id=\"charge-currency\" required>'+(!preferred?'<option value=\"\">Select currency</option>':'')+currencies.map(code=>'<option value=\"'+code+'\"'+(code===preferred?' selected':'')+'>'+code+'</option>').join('')+'</select></label>'+",
    "  (attempt||recovery?(pendingInput?lines.map(row=>chargeLineHtml(row)).join(''):''):'<fieldset class=\"charge-options\"><legend>Charge Types</legend>'+choices.map(label=>'<div><label class=\"charge-option\"><input type=\"checkbox\" data-charge-option> '+label+'</label>'+chargeLineHtml({description:label==='Other'?'':label,amountCents:0},label)+'</div>').join('')+'</fieldset>');",
    "for(const option of container.querySelectorAll('[data-charge-option]')){const row=option.parentElement.nextElementSibling;const update=()=>{row.hidden=!option.checked;for(const input of row.querySelectorAll('input'))input.disabled=row.hidden;};option.addEventListener('input',update);update();}",
    "if(attempt||recovery)container.querySelector('#charge-currency').disabled=true;",
  ].join('\n'));
  const formStart=source.indexOf('  function chargeLineHtml(');
  const formEnd=source.indexOf("  $('document-invoice').onchange",formStart);
  assert.ok(formStart>=0&&formEnd>formStart);
  source=source.slice(0,formStart)+String.raw`  function chargeLineHtml(row,label=''){
    const named=label&&label!=='Other';
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
`+source.slice(formEnd);
  source = source.replace("container.addEventListener('input',()=>{try{$('document-amount').value=(chargeValues()", "container.addEventListener('input',()=>{try{$('document-amount').value=(chargeValues(false)");
  source = source.replace("const invoiceId=ctx.charge?'':ctx.code==='SI'?$('document-invoice').value:ctx.invoiceId,", "const chargeLines=ctx.charge&&!ctx.recovery?chargeValues():null;const invoiceId=ctx.charge?'':ctx.code==='SI'?$('document-invoice').value:ctx.invoiceId,");
  source = source.replace('amountCents=ctx.charge?chargeValues().reduce((n,row)=>n+row.amountCents,0)', 'amountCents=ctx.charge?(chargeLines?.reduce((n,row)=>n+row.amountCents,0)??ctx.recovery.input.amountCents)');
  source = source.replace("invoiceKind:'CHARGE',chargeLines:chargeValues()", "invoiceKind:'CHARGE',chargeCurrency:$('charge-currency').value,chargeLines");
  return source;
}

const css = [
  '.shipment-compact .shipment-columns{grid-template-columns:minmax(110px,.7fr) minmax(150px,1fr) minmax(160px,1.1fr) minmax(290px,1.9fr)}',
  '.shipment-compact .shipment-documents{display:block;padding:8px 15px}',
  '.shipment-compact .shipment-documents h3{margin-bottom:5px}',
  '.shipment-compact .shipment-doc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:none;grid-auto-flow:row;gap:4px 10px}',
  '.shipment-compact .shipment-doc-grid>div>span{display:inline;line-height:1.2}',
  '@media(min-width:1450px){.shipment-compact .shipment-doc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}',
  '@media(max-width:900px){.shipment-compact .shipment-columns{grid-template-columns:repeat(3,minmax(0,1fr))}.shipment-compact .shipment-documents{grid-column:1/-1;border-left:0;border-top:1px solid #dce6ef}}',
  '@media(max-width:700px){.shipment-compact .shipment-columns{grid-template-columns:1fr 1fr}}',
  '@media(max-width:460px){.shipment-compact .shipment-columns{grid-template-columns:1fr}}',
  '.overview-desks{display:flex;flex-wrap:wrap;gap:4px}.overview-desk{background:#e8f1ff;color:#245398;padding:3px 6px;border-radius:4px;white-space:nowrap}.overview-desk.pending{background:#fff0d6;color:#875000}.overview-profile{margin-left:7px}',
  '.invoice-toolbar{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px 16px;padding:8px 12px;margin:0 0 8px;background:#fff;border:1px solid #dce6ef;border-radius:5px}.invoice-toolbar .primary{white-space:nowrap}.invoice-legend{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 14px;list-style:none;margin:0;padding:0;font-size:11px;color:#405b73}.invoice-legend li{white-space:nowrap}.invoice-legend strong{color:#183653;margin-right:3px}',
  '.invoice-list th,.invoice-list td{padding:8px 9px}.invoice-list td:first-child small{display:block;margin-top:3px;color:#536d87;white-space:nowrap}.invoice-list .invoice-details{width:100%;min-width:150px}.invoice-list td:not(.invoice-details){white-space:nowrap}.invoice-list .doc-strip{gap:4px}.invoice-file,.invoice-file-muted{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 4px;border-radius:5px;background:#eef3f7;color:#516b83;font-size:11px;font-weight:700}.invoice-file{background:#2563eb;color:#fff;text-decoration:none}.invoice-file:hover{text-decoration:underline}',
  '#charge-lines .charge-options{margin:8px 0 0;border:1px solid #dce6ef;border-radius:5px;padding:6px 10px}#charge-lines .charge-options>div{display:grid;grid-template-columns:1fr 2fr;align-items:center;min-height:32px;gap:8px}#charge-lines .charge-option{display:flex;align-items:center;gap:6px;margin:0}#charge-lines .charge-option input[type=checkbox]{width:auto;height:auto;margin:0}#charge-lines [hidden]{display:none}#charge-lines .charge-inputs:not([hidden]){display:flex;gap:6px}#charge-lines .charge-inputs input[data-charge-amount]{width:96px;margin-left:auto;text-align:right}',
].join('\n');

module.exports = { compactHeader, compactOverview, compactTransactions, chargeInvoiceForm, css };
