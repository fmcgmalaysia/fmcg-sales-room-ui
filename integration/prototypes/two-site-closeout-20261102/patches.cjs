'use strict';
const assert=require('node:assert/strict');
function once(source,before,after){assert.equal(source.split(before).length,2,'unique published patch anchor');return source.replace(before,()=>after);}
function apply(file,source){
 if(file==='buyer-room.html')return once(source,"setInterval(()=>{if(!document.hidden)post('BUYER_ROOM_REQUEST_DATA')},60000);","setInterval(()=>{if(!document.hidden)post('BUYER_ROOM_REQUEST_DATA')},15000);");
 if(file==='account-room/settlement.js'){
  source=once(source,"}else if(kind.startsWith('proof:')){\n   modal(row,'Add Payment Files'","}else if(kind.startsWith('proof:')){\n   const payment=(row.finance?.payments||[]).find(item=>item.id===kind.slice(6));if(!payment)return;\n   modal(row,'Add Payment Files'");
  return once(source,'<input name="reference" type="hidden" value="">','<input name="reference" type="hidden" value="\'+esc(payment.reference||\'\')+\'">');
 }
 if(file==='account-room/payment-layout.js'){
  source=once(source,'<small>ETA: ','<small>ETD: ');
  source=once(source,'const supplierMetrics=(rows,summary)=>{','const supplierMetrics=(rows,summary,loading=false)=>{if(loading)return \'<div class="acc-account-metrics" aria-label="Supplier account overview" aria-busy="true"><section class="acc-account-metric"><small>Task</small><b>—</b><span>Involved Suppliers <strong>—</strong></span></section><section class="acc-account-metric"><small>Total Amount</small><b>—</b><span>Partially Paid <strong>—</strong></span></section></div>\';');
  return once(source,"supplierMetrics(rows,data?.summary)","supplierMetrics(rows,data?.summary,!data)");
 }
 if(file==='warehouse-room/app.js')return once(source," lockStoppedReceipts();\n}\n$('entryLines').addEventListener('focusin'",` lockStoppedReceipts();
 const localErrors=['请填写分批到货、少货、拒收或解决异常的原因。','尚未收齐，请选择分批送货或少货原因。'];
 if(!pending&&!saving&&!correcting&&localErrors.includes($('entryError').textContent)&&[...$('entryLines').querySelectorAll('[data-line]')].every(section=>{
  const line=selected.lines[Number(section.dataset.line)];if(line.receivingStoppedWaiting)return true;
  const field=name=>section.querySelector('[data-field="'+name+'"]'),accepted=Number(field('accepted').value),rejected=Number(field('rejected').value),kind=field('kind').value;
  if(!Number.isSafeInteger(accepted)||!Number.isSafeInteger(rejected)||accepted<0||rejected<0||accepted>line.remaining)return false;
  if(!accepted&&!rejected&&kind==='DELIVERY')return true;
  return !((accepted<line.remaining||rejected>0||kind!=='DELIVERY'||line.issue)&&!field('reason').value.trim())&&!(accepted<line.remaining&&kind==='DELIVERY');
 }))$('entryError').textContent='';
}
$('entryLines').addEventListener('focusin'`);
 return source;
}
module.exports={apply};
