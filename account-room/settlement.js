/* Audited MYR reconciliation and proof records; never executes a bank payment. */
(()=>{
 const dialog=document.querySelector('#documents');let pending=null,saving=false;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=c=>Number.isSafeInteger(c)?(c/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const date=x=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(x).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
 const toCents=x=>/^\d{1,10}(\.\d{1,2})?$/.test(x)?Number(x.split('.')[0])*100+Number((x.split('.')[1]||'').padEnd(2,'0')):null;
 function modal(row,title,body){
  dialog.innerHTML='<div class="dialog-header"><div><h2>'+title+'</h2><strong>'+esc(row.supplierName)+'</strong><p>'+esc(row.company)+' · '+esc(row.number)+'</p></div><button id="closeDocuments" aria-label="Close documents">×</button></div><form id="settlementForm" class="dialog-body"><input type="hidden" name="id" value="'+esc(row.id)+'">'+body+'<label class="account-field"><span>Note / 说明</span><textarea name="reason" rows="2" maxlength="2000" required></textarea></label><p id="settlementError" role="alert"></p></form><footer><button id="accountDialogDone">Cancel / 取消</button><button id="settlementSubmit" class="primary">Save / 保存</button></footer>';
  dialog.classList.add('settlement-dialog');dialog.showModal();
 }
 function edit(row,kind){
  if(pending)return;let body;
  if(kind==='amounts'){
   const docs=row.documents.filter(d=>d.linked&&!d.superseded&&['INV','CN'].includes(d.type));
   body='<p class="document-note">按最终文件填写 MYR 金额；CN 填正数，系统扣减。PO 金额仅供参考。</p>'+docs.map(d=>{const value=row.finance?.amounts?.find(a=>a.fileId===d.fileId&&a.sha256===d.sha256)?.cents;return '<label class="account-field"><span>'+esc(d.type+' '+d.number)+'</span><input name="amount" data-file-id="'+esc(d.fileId)+'" inputmode="decimal" placeholder="0.00" value="'+(Number.isSafeInteger(value)?(value/100).toFixed(2):'')+'" required></label>';}).join('');
   if(!docs.length)body+='<p>先上传 Final INV / Final supplier Invoice required.</p>';
   modal(row,'Reconcile Amounts / 核对金额',body);
  }else if(kind==='payment'||kind==='do'){
   body='<p class="document-note">'+(kind==='payment'?'仅登记已经完成的银行付款，不会执行转账。付款证明存入 '+esc(row.company)+' Account Dept。':'上传实际供应商送货单，保留员工与时间记录。')+'</p>'+(kind==='payment'?'<label class="account-field"><span>Paid Amount / 已付 MYR</span><input name="paid" inputmode="decimal" placeholder="0.00" required></label>':'')+'<label class="account-field"><span>Date / 文件日期</span><input name="date" type="date" value="'+date(new Date())+'" required></label><label class="account-field"><span>Reference / 单号</span><input name="reference" maxlength="120" required></label><label class="account-field"><span>PDF / 选择文件</span><input name="pdf" type="file" accept="application/pdf,.pdf" required></label>';
   modal(row,kind==='payment'?'Record Payment / 登记付款':'Supplier DO / 供应商送货单',body);
  }else if(kind==='cn')modal(row,'CN Decision / 贷项单适用情况','<p>没有退货、少货或金额调整，供应商无需开 CN 时，财务可明确登记“不适用”。</p><label class="account-field"><span>CN Not Applicable / 无需贷项单</span><input name="cn" type="checkbox" '+(row.finance?.cnNotApplicable?.enabled?'checked':'')+'></label>');
  else modal(row,'Transaction Checked / 交易最终核对','<p class="document-note">'+esc(row.invoiceChecked?'撤销本次核对，需要填写原因。':row.checkBlocker||'确认实收与最终 INV／DO／CN 相符，没有未处理少货或多付款。')+'</p>');
  dialog.dataset.settlementKind=kind;dialog.dataset.settlementRow=JSON.stringify(row);
 }
 function lock(enabled){document.querySelector('#company').disabled=enabled;document.querySelectorAll('nav button').forEach(b=>b.disabled=enabled);dialog.querySelectorAll('input,textarea,button').forEach(e=>e.disabled=enabled);}
 function send(){if(!pending||saving)return;saving=true;lock(true);window.parent.postMessage(pending,'*');const current=pending;setTimeout(()=>{if(pending===current){saving=false;lock(false);document.querySelector('#settlementSubmit').textContent='Retry same save / 重试';document.querySelector('#settlementError').textContent='保存尚未确认，输入与原保存编号已保留。请重试，勿重复登记付款。';}},30000);}
 async function submit(){
  if(pending){send();return;}const row=JSON.parse(dialog.dataset.settlementRow),kind=dialog.dataset.settlementKind,form=document.querySelector('#settlementForm');
  if(!form.reportValidity())return;const values=new FormData(form),input={id:row.id,version:row.version,reason:String(values.get('reason')||'').trim()};
  if(kind==='amounts'){input.action='AMOUNTS';input.amounts=[...form.querySelectorAll('[data-file-id]')].map(e=>({fileId:e.dataset.fileId,cents:toCents(e.value.trim())}));}
  else if(kind==='cn'){input.action='CN_NOT_APPLICABLE';input.enabled=values.get('cn')==='on';}
  else if(kind==='check'){input.action='CHECK';input.enabled=!row.invoiceChecked;}
  else{
   const file=values.get('pdf');if(!file||file.size>3*1024*1024||file.size<5){document.querySelector('#settlementError').textContent='请选择 3 MiB 以内 PDF。';return;}
   lock(true);try{const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});Object.assign(input,{action:'DOCUMENT_UPLOAD',type:kind==='payment'?'PAYMENT':'DO',date:values.get('date'),number:values.get('reference'),base64,...(kind==='payment'?{cents:toCents(String(values.get('paid')).trim())}:{})});}catch(_){lock(false);document.querySelector('#settlementError').textContent='无法读取 PDF，请重新选择。';return;}
  }
  pending={type:'ACCOUNT_SETTLEMENT_REQUEST',company:row.company,requestId:crypto.randomUUID(),input};send();
 }
 window.accountSettlement={edit,money,busy:()=>Boolean(pending),amountCell:row=>'<button class="account-money" data-settlement="amounts" data-po="'+esc(row.id)+'">'+money(row.finance?.payableCents)+'</button><small>PO '+(typeof row.amount==='number'?row.amount.toFixed(2):'—')+'</small>',paymentCell:row=>'<button class="account-money" data-settlement="payment" data-po="'+esc(row.id)+'">'+money(row.finance?.paidCents||0)+' / '+money(row.finance?.balanceCents)+'</button><small>Record / 登记付款</small>',tools:row=>'<div class="settlement-tools"><button data-settlement="amounts" data-po="'+esc(row.id)+'">INV / CN 金额</button><button data-settlement="do" data-po="'+esc(row.id)+'">Upload DO / 送货单</button><button data-settlement="cn" data-po="'+esc(row.id)+'">CN 不适用</button></div>',proofs:row=>'<section class="account-doc-section"><h3>Payment Proof / 付款证明</h3>'+((row.finance?.payments||[]).map(p=>'<div class="account-file"><span>'+esc(p.reference)+' · MYR '+money(p.cents)+'<small>'+esc(p.date)+' · by '+esc(p.by)+'</small></span><a href="https://drive.google.com/file/d/'+encodeURIComponent(p.proof.fileId)+'/view" target="_blank" rel="noopener">View / 查看</a><a href="https://drive.google.com/uc?export=download&amp;id='+encodeURIComponent(p.proof.fileId)+'" target="_blank" rel="noopener">Download / 下载</a></div>').join('')||'<small>No payment proof / 尚无付款证明</small>')+'</section>'};
 document.addEventListener('click',event=>{if(event.target.closest('#settlementSubmit'))submit();},true);
 document.addEventListener('click',event=>{if(pending&&event.target.closest('#closeDocuments,#accountDialogDone,nav button')){event.preventDefault();event.stopImmediatePropagation();document.querySelector('#settlementError').textContent='保存尚未确认，请先重试同一保存。';}},true);
 window.addEventListener('message',event=>{const m=event.data||{};if(event.source!==window.parent||m.type!=='ACCOUNT_SETTLEMENT_RESULT'||!pending||m.company!==pending.company||m.requestId!==pending.requestId)return;saving=false;
  if(m.ok&&m.result?.ok&&m.result.requestId===pending.requestId){pending=null;lock(false);dialog.close();document.querySelector('#accountRefresh')?.click();}
  else{lock(false);document.querySelector('#settlementError').textContent=m.result?.error||m.error||'保存未确认，请重试。';if(m.result?.retryable===false){pending=null;document.querySelector('#settlementSubmit').textContent='Save / 保存';}else document.querySelector('#settlementSubmit').textContent='Retry same save / 重试';}
 });
 dialog.addEventListener('close',()=>{dialog.classList.remove('settlement-dialog');});dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault();});window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
})();
