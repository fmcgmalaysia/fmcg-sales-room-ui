const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const build = '20261113-shipment-delivery-v1';
const warehouseTableBuild = '20261114-warehouse-desk-selector-v1';
const warehouseCompactBuild = '20261113-warehouse-delivery-compact-v2';
const previousSupport = '20261113-support-standalone-dn-v3';
const previousWarehouse = '20261111-warehouse-desk-workflow-history-v2';
const previousDelivery = '20261111-warehouse-desk-workflow-v1';
const malaysiaToday = "new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())";
const expiryFormat = "value=>/^\\d{4}-\\d{2}-\\d{2}$/.test(value||'')?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(2,4):'—'";

function replace(source, before, after) {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, () => after);
}

function supportScript(source) {
  source = replace(source, '  const guides=', '  const expiryDay='+expiryFormat+', planningToday=()=>'+malaysiaToday+';\n  const guides=');
  source = replace(source, ".map(day).join(' · ')", ".map(expiryDay).join(' · ')");
  source = replace(source, "read('Booked By','—')", "read('Booked By',activeDesk?shipment?.bookedBy:'Per Desk')");
  source = replace(source, "if(!transport||!date)return;attempt=", "if(!transport||!date)return;if(date!==order.booking?.date&&date<planningToday()){$('booking-status').textContent='Select today or a future shipment date.';return;}attempt=");
  source = replace(source, "if(!transport||!date)return;const ok=", "if(!transport||!date)return;const saved=deskState().shipments.find(row=>row.desk===activeDesk)||{};if([['date',date],['arrival',arrival]].some(([key,value])=>value&&value!==saved[key]&&value<planningToday())){$('booking-status').textContent='Select today or a future shipment date.';return;}const ok=");
  source = replace(source, "$('booking-date').value=value.date||'';$('booking-fields')", "$('booking-date').value=value.date||'';$('booking-date').min=value.date&&value.date<planningToday()?value.date:planningToday();$('booking-fields')");
  source = replace(source, "$('booking-date').min='1900-01-01';", "$('booking-date').min=value.date&&value.date<planningToday()?value.date:planningToday();$('booking-arrival').min=value.arrival&&value.arrival<planningToday()?value.arrival:planningToday();");
  return source;
}

function supportDetails(source) {
  source = replace(source, "const order=activeOrder();retainDetails();try{const input=", "const order=activeOrder();retainDetails();try{if(!deskPending())validatePlanningDetails(detailsDrafts.get(detailsContext.key),detailsValues(order));const input=");
  source = replace(source, "$('desk-details-fields').disabled=Boolean(deskPending());", "showPlanningControls(values,shipment);$('desk-details-fields').disabled=Boolean(deskPending());");
  source = replace(source, "Enter valid shipment|Enter valid Desk", "Enter valid shipment|Enter valid Desk|New shipment dates|Select Last Gate In");
  source = replace(source, "  function retainDetails(){", [
    "  function showPlanningControls(values,shipment){",
    "    const gateDate=$('gate-date'),hour=$('gate-hour'),minute=$('gate-minute'),legacy=$('gate-legacy-minute');",
    "    const value=values.lastGateIn||'';",
    "    const oldMinute=value.slice(14,16);",
    "    legacy.value=/^(00|15|30|45)$/.test(oldMinute)?'':oldMinute;legacy.textContent=legacy.value;",
    "    gateDate.value=value.slice(0,10);hour.value=value.slice(11,13);minute.value=oldMinute;",
    "    $('gate-booked-by').value=deskState().shipments.find(row=>row.desk===activeDesk)?.bookedBy||'';",
    "    for(const field of [gateDate,hour,minute])field.disabled=!shipment;",
    "    const fields=$('desk-details-form').elements,today=planningToday();",
    "    for(const key of ['date','departureDate','arrival'])fields[key].min=today;",
    "    gateDate.min=today;",
    "  }",
    "  function validatePlanningDetails(values,saved){",
    "    const form=$('desk-details-form'),gateDate=$('gate-date'),hour=$('gate-hour'),minute=$('gate-minute');",
    "    if(!gateDate.disabled&&gateDate.value&&(!hour.value||!minute.value))throw Error('Select an hour and minutes for Last Gate In.');",
    "    const today=planningToday();",
    "    for(const key of ['date','departureDate','arrival','lastGateIn']){",
    "      const field=key==='lastGateIn'?gateDate:form.elements[key],value=values[key]||'';",
    "      if(field.disabled)continue;",
    "      if(field.validity.badInput||field.validity.rangeOverflow)throw Error('Enter a valid shipment date.');",
    "      if(value&&value!==saved[key]&&value.slice(0,10)<today)throw Error('Select today or a future shipment date.');",
    "    }",
    "    if(values.lastGateIn&&values.lastGateIn!==saved.lastGateIn&&!/:(00|15|30|45)$/.test(values.lastGateIn))throw Error('Select Last Gate In minutes 00, 15, 30 or 45.');",
    "    const deposit=form.elements.depositAmount;",
    "    if(!deposit.disabled&&!deposit.checkValidity())throw Error('Enter a valid deposit amount.');",
    "    const depositDate=form.elements.depositDate;",
    "    if(!depositDate.disabled&&!depositDate.checkValidity())throw Error('Enter a valid deposit date.');",
    "  }",
    "  function retainDetails(){"
  ].join('\n'));
  return replace(source, "values.invoiceNoDraft=detailsDrafts", "const gateDate=$('gate-date'),hour=$('gate-hour').value,minute=$('gate-minute').value;if(!gateDate.disabled)values.lastGateIn=gateDate.value&&hour&&minute?gateDate.value+'T'+hour+':'+minute:'';values.invoiceNoDraft=detailsDrafts");
}

function supportHtml(source) {
  const options = values => values.map(value=>'<option>'+value+'</option>').join('');
  const hours = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
  source=replace(source,'<form id="desk-details-form">','<form id="desk-details-form" novalidate>');
  source=replace(source,'<label>Booked By<input disabled placeholder="—"></label>','<label>Booked By<input id="gate-booked-by" disabled placeholder="—"></label>');
  return replace(source,'<label>Last Gate In<input name="lastGateIn" type="datetime-local" min="1900-01-01T00:00" max="9999-12-31T23:59"></label>',
    '<div class="shipment-gate"><label>Last Gate In<input id="gate-date" type="date" max="9999-12-31"></label><label>Hour<select id="gate-hour"><option value="">HH</option>'+options(hours)+'</select></label><label>Minutes<select id="gate-minute"><option value="">MM</option>'+options(['00','15','30','45'])+'<option id="gate-legacy-minute" value="" hidden disabled></option></select></label></div>');
}

function warehouseScript(source) {
  source=replace(source, '  const stamp=', '  const expiryDay='+expiryFormat+';\n  const stamp=');
  const header=source.split('\n').find(line=>line.includes("html+='<header class=\"dd-customer-header\">"));
  assert.ok(header);
  source=replace(source,header,[
    "    const loadedLines=selected.lines.filter(line=>line.loadedConfirmedAt&&line.loaded>0);",
    "    const loadedCartons=loadedLines.reduce((sum,line)=>sum+line.loaded,0);",
    "    const allocatedCartons=selected.lines.reduce((sum,line)=>sum+(line.resolution?.maximum??line.quantity??0),0);",
    "    const loadedCbm=loadedLines.every(line=>Number.isFinite(line.cbm)&&line.cbm>0)?loadedLines.reduce((sum,line)=>sum+line.loaded*line.cbm,0):null;",
    "    const elapsed=selected.sentAt&&!state.history?age(selected.sentAt):'';",
    "    const totals='<dl class=\"dd-totals\"><div><dt>Total CTN</dt><dd>'+number(allocatedCartons)+' <small>Alloc</small> · '+number(loadedCartons)+' <small>Loaded</small></dd></div><div><dt>Total CBM</dt><dd>'+(loadedCbm===null?'—':loadedCbm.toFixed(4))+' <small>Loaded</small></dd></div></dl>';",
    "    html+='<header class=\"dd-customer-header\"><div class=\"dd-customer-title\"><h3>'+esc(selected.customerName)+' <span>Desk '+selected.desk.number+'</span></h3>'+(elapsed?'<strong class=\"dd-task-age\">Opened '+esc(elapsed)+'</strong>':'')+'</div><div class=\"dd-desk-overview\">'+",
    "    '<div class=\"dd-shipment\"><span>Logistic <b>'+esc(({LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'})[shipment?.transport]||shipment?.transport||'—')+'</b></span><span>ETD <b>'+date(shipment?.date)+'</b></span><span>Last Gate In <b>'+esc(shipment?.lastGateIn?date(shipment.lastGateIn)+' '+shipment.lastGateIn.slice(11,16):'—')+'</b></span></div>'+totals+'</div></header>';"
  ].join('\n'));
  source=replace(source,"esc(stamp(line.loadedConfirmedAt||line.lastLoadedAt))+'</span><small>'+(line.loadedConfirmedBy?'by '+esc(line.loadedConfirmedBy):'')","esc(selected.sentBy||'—')+'</span><small>'+esc(stamp(selected.sentAt))");
  const expiryStart=source.indexOf("(line.expiryDate?date(line.expiryDate):'—')+(state.history?");
  assert.ok(expiryStart>0);
  const expiryEnd=source.indexOf("+'</td><td>'+message",expiryStart);
  assert.ok(expiryEnd>expiryStart);
  return source.slice(0,expiryStart)+"(state.history?expiryDay(line.expiryDate):'<button type=\"button\" class=\"'+(line.expiryDate?'dd-expiry-date':'')+'\" data-dd-expiry=\"'+esc(line.taskId)+'\" aria-label=\"Edit expiry '+esc(line.name)+'\" '+(state.queue.length?'disabled':'')+'>'+(line.expiryDate?expiryDay(line.expiryDate):'✎')+'</button>')"+source.slice(expiryEnd);
}

const supportCss = '\n.shipment-gate{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(65px,.7fr) minmax(75px,.8fr);gap:8px;align-items:end}.shipment-gate input,.shipment-gate select{min-width:0;width:100%}\n';
const deliveryCss = '\n'+[
  '.dd-customer-title{gap:12px}.dd-customer-title h3 span{display:inline-block;margin-left:6px;font-weight:600}',
  '.dd-task-age{padding:3px 8px;border-radius:10px;background:#fff0d6;color:#8a4b00;font-size:12px;white-space:nowrap}',
  '.dd-desk-overview{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:5px}',
  '.dd-desk-overview .dd-shipment{margin:0;gap:7px 18px}.dd-totals{display:flex;gap:14px;margin:0;color:#203047}',
  '.dd-totals div{border-left:1px solid #d5dee7;padding-left:10px}.dd-totals dt{color:#59708a;font-size:10px}.dd-totals dd{margin:0;font-weight:600;white-space:nowrap}.dd-totals small{font-weight:400;color:#59708a}',
  '.dd-task-table{min-width:740px}.dd-task-table td,.dd-task-table th{padding:5px 7px;vertical-align:middle}.dd-task-table th{white-space:nowrap}.dd-task-table td.dd-row-no{font-weight:600}',
  '.dd-task-table th:nth-child(2),.dd-task-table td:nth-child(2){width:54px;text-align:center}.dd-task-table .dd-product-image img{width:38px;height:38px;max-width:100%;margin-inline:auto}',
  '.dd-task-table th:nth-child(4),.dd-task-table th:nth-child(5){width:68px;text-align:center}.dd-task-table td:nth-child(4),.dd-task-table td:nth-child(5){text-align:center}',
  '.dd-task-table th:nth-child(6){width:98px}.dd-task-table th:nth-child(7){width:68px;text-align:right}.dd-task-table th:nth-child(8){width:72px;text-align:center}.dd-task-table td.dd-expiry{text-align:center}.dd-task-table th:nth-child(9){width:clamp(160px,24vw,400px);text-align:left}',
  '.dd-task-table .dd-description small,.dd-task-table .dd-description strong{display:block;line-height:1.2;margin:0}.dd-task-table .dd-description strong{margin:1px 0;overflow-wrap:anywhere}',
  '.dd-task-table .dd-pic span{font-weight:600;color:#203047}.dd-task-table .dd-pic small{margin:2px 0 0}',
  '.dd-task-table .dd-expiry button.dd-expiry-date{font:inherit;padding:0;position:relative;transition:transform .16s ease}.dd-expiry-date:not(:disabled):is(:hover,:focus-visible){transform:translateY(-1px)}.dd-expiry-date:not(:disabled)::after{position:absolute;content:"";background:currentColor;height:1px;inset:auto 0 0;transform:scaleX(0);transform-origin:left;transition:transform .16s ease}.dd-expiry-date:not(:disabled):is(:hover,:focus-visible)::after{transform:scaleX(1)}',
  '.dd-task-table .tc-cell{display:flex;flex-direction:row-reverse;justify-content:flex-end;align-items:flex-start;gap:6px;text-align:left;min-width:0}.dd-task-table .tc-actions{padding:0}.dd-task-table .tc-snippet{min-width:0;text-align:left;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:11px}.dd-task-table .tc-peer{min-width:24px;height:17px;font-size:10px;padding:0 4px!important}.dd-task-table .tc-peer:after{left:4px;border-top-width:4px;border-right-width:5px}',
  '@media(max-width:740px){.dd-totals{flex-wrap:wrap;gap:6px 12px}.dd-totals div{border:0;padding:0}.dd-desk-overview{align-items:flex-start;gap:8px}}',
  '@media(prefers-reduced-motion:reduce){.dd-task-table .dd-expiry button.dd-expiry-date,.dd-expiry-date::after{transition:none}.dd-expiry-date:not(:disabled):is(:hover,:focus-visible){transform:none}}'
].join('\n')+'\n';

const hashes = {
  'support-room/workroom.html': 'c8f5cbaadaf51571f717306c2e02d221d37572330a9d58a2a76589bb92716d8e',
  'support-room/workroom.css': 'a6a89a8cb34b2f9bd5a78b42ad74acc45a0aa10b808e9f5fa89504852fcb3e31',
  'support-room/workroom.js': 'fb63eb7134fb13e8b80982b1099e3e5f217e9580b78938c7546f3a40ae8f303f',
  'warehouse-room/style.css': 'b10941d22d5c71cb78af04f42073eab60681cb0124e9680fc9dc67c8c2969311',
  'warehouse-room/index.html': 'a2694de1566f8a90e71245f6ac047c90d2bf7be7264c2cefbb8d4d6c5b39626f',
  'master-shared/desk-delivery.css': 'f04c761a2257c7a27b836b797d41a9c497358e754debad44062b496d40cf7a00',
  'master-shared/desk-delivery.js': '008e47eaca104176711228155b2a57291c6d4e0af0faf63e08b8e67b81a2e197',
};
function stage(site) {
  const read = name => {
    const bytes=fs.readFileSync(path.join(site,name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hashes[name],name);
    return bytes.toString('utf8');
  };
  const replacements = {
    'support-room/workroom.html': supportHtml(read('support-room/workroom.html')).replaceAll(previousSupport,build),
    'support-room/workroom.js': supportDetails(supportScript(read('support-room/workroom.js'))),
    'support-room/workroom.css': read('support-room/workroom.css')+supportCss,
    'warehouse-room/index.html': read('warehouse-room/index.html').replace('name="build" content="'+previousWarehouse+'"','name="build" content="'+warehouseTableBuild+'"').replace('href="style.css?v='+previousDelivery,'href="style.css?v='+warehouseTableBuild).replaceAll('desk-delivery.css?v='+previousDelivery,'desk-delivery.css?v='+warehouseCompactBuild).replaceAll('desk-delivery.js?v='+previousDelivery,'desk-delivery.js?v='+build),
    'warehouse-room/style.css': read('warehouse-room/style.css')+'\n.dd-heading select[data-dd-select]{border-color:#e6aa63;background-color:#fff2df}\n',
    'master-shared/desk-delivery.css': read('master-shared/desk-delivery.css')+deliveryCss,
    'master-shared/desk-delivery.js': warehouseScript(read('master-shared/desk-delivery.js')),
  };
  for (const [name, value] of Object.entries(replacements)) fs.writeFileSync(path.join(site,name),value);
}
module.exports={stage};
if(require.main===module)stage(process.argv[2]);
