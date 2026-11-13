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
    "      const actions=[['$','Payment Slip'],['CN','Credit Note'],['DN','Debit Note']];",
    "      const documents=actions.map(([code,label])=>'<div><button type=\"button\" data-doc=\"'+code+'\" data-customer=\"'+esc(customer.id)+'\" data-order-id=\"\" data-invoice-id=\"\" aria-label=\"'+label+'\">'+code+'</button><span>'+label+'</span></div>').join('');",
    "      $('content').innerHTML='<section class=\"invoice-toolbar\"><strong>'+esc(customer.name)+'</strong><div class=\"shipment-doc-grid\">'+documents+'</div><button type=\"button\" class=\"primary\" data-new-charge=\"'+esc(customer.id)+'\">+ Add Invoice</button></section>'+invoiceTable(matching(customer.invoices))+chargeTable(customer);",
    "      $('count').textContent=(customer.invoices.length+(customer.transactions||[]).filter(row=>row.type==='CHARGE_INV').length)+' invoices';return;",
    "    }",
  ].join('\n');
  return (source.slice(0, start) + header + source.slice(end))
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
    "const choices=['Ocean Freight','Insurance','Sticker Printing','Labour Charges','Other'];",
    "container.innerHTML='<label>Currency<select id=\"charge-currency\" required>'+(!preferred?'<option value=\"\">Select currency</option>':'')+currencies.map(code=>'<option value=\"'+code+'\"'+(code===preferred?' selected':'')+'>'+code+'</option>').join('')+'</select></label>'+",
    "  (pendingInput?lines.map(chargeLineHtml).join(''):'<label>Charge Type<select id=\"charge-type\" required><option value=\"\">Select charge type</option>'+choices.map(label=>'<option>'+label+'</option>').join('')+'</select></label>'+chargeLineHtml(lines[0]));",
    "const type=container.querySelector('#charge-type'),description=container.querySelector('[data-charge-description]');",
    "if(type){const applyType=()=>{description.hidden=type.value!=='Other';description.required=!description.hidden;description.value=type.value==='Other'?'':type.value;};type.onchange=applyType;applyType();}",
    "if(pendingInput)container.querySelector('#charge-currency').disabled=true;",
  ].join('\n'));
  source = source.replace("invoiceKind:'CHARGE',chargeLines:chargeValues()", "invoiceKind:'CHARGE',chargeCurrency:$('charge-currency').value,chargeLines:chargeValues()");
  source = source.replace("throw Error('Enter valid charge amounts.');", "throw Error('Enter valid charge amounts.');if(Number(raw)<=0)throw Error('Enter a charge amount greater than zero.');");
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
  '.invoice-toolbar{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;padding:8px 12px;margin:0 0 8px;background:#fff;border:1px solid #dce6ef;border-radius:5px}.invoice-toolbar .shipment-doc-grid{display:flex;gap:7px 12px;flex-wrap:wrap;margin-left:auto}.invoice-toolbar .primary{white-space:nowrap}',
].join('\n');

module.exports = { compactHeader, compactOverview, compactTransactions, chargeInvoiceForm, css };
