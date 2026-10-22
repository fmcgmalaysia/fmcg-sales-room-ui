(function(){'use strict';
const accountEnglish=!!document.querySelector('nav[aria-label="Account navigation"]');
const stockCopy=(english,bilingual)=>accountEnglish?english:bilingual;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds={INTERNAL_DAMAGE:stockCopy("Internal damage",'Internal damage 内部损坏'),WRONG_ITEM:stockCopy("Wrong item",'Wrong item 错货'),SHORT_EXPIRY:stockCopy("Short expiry",'Short expiry 保质期不足')},owners={ADMIN:stockCopy("Super Admin",'Super Admin 最高管理员'),PURCHASE:stockCopy("Purchase",'Purchase 采购'),ACCOUNT:stockCopy("Account",'Account 财务'),WAREHOUSE:stockCopy("Warehouse",'Warehouse 仓库')};
const actions={QUARANTINE:stockCopy("Report stock issue",'Report stock issue 登记库存异常'),DECIDE:stockCopy("Supplier solution",'Supplier solution 供应商处理方案'),RETURN:stockCopy("Record return",'Record return 登记退货'),REPLACEMENT:stockCopy("Receive replacement",'Receive replacement 签收换货'),APPROVE_LOSS:stockCopy("Approve inventory loss",'Approve inventory loss 批准库存损耗'),APPROVE_VARIANCE:stockCopy("Approve unrecovered amount",'Approve unrecovered amount 批准未追回金额'),APPROVE_RELEASE:stockCopy("Approve quarantine release",'Approve quarantine release 批准解除隔离'),CLOSE:stockCopy("Finance verification",'Finance verification 财务结案核对')};
const money=value=>(Number(value||0)/100).toFixed(2),qty=value=>Number(value||0),companyValue=()=>document.getElementById('companySelect')?.value||document.getElementById('company')?.value||'NCT';
function stamp(value){if(!value)return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));return parts.day+'-'+parts.month+'-'+parts.year+' '+parts.hour+':'+parts.minute;}
const button=document.createElement('button');button.className='stock-entry';button.type='button';button.textContent=stockCopy("Stock Issues",'Stock Issues 库存异常');document.querySelector('nav').appendChild(button);
const dialog=document.createElement('dialog');dialog.className='stock-dialog';dialog.id='stockExceptions';document.body.appendChild(dialog);
let company='',data=null,pending=null,busy=false,readId='',timer,changed=false,form=null;

let stockMeta=null,stockActor=null,stockReadKind='',stockFinal=null,stockFlight=false,stockSerial=0,stockSteps=0,stockBlocked=false,stockCompanyLock=null;
const stockSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b),stockClone=value=>JSON.parse(JSON.stringify(value));
const stockIdentity=value=>value&&Object.keys(value).length===2&&['staffId','memberId'].every(key=>typeof value[key]==='string'&&value[key]&&value[key].length<=200);
const stockCacheKey=(selected,actor)=>'fmcg-stock-exception-current-v1/'+selected+'/'+encodeURIComponent(actor.staffId)+'/'+encodeURIComponent(actor.memberId);
function stockRequest(request){return request&&Object.keys(request).every(key=>['type','company','requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
 &&request.type==='STOCK_SAVE_REQUEST'&&['NCT','GHR'].includes(request.company)&&/^[a-f0-9-]{36}$/i.test(request.requestId||'')&&stockIdentity(request.stockIdentity)
 &&request.stockProtocol===1&&typeof request.stockBuild==='string'&&request.stockBuild&&Number.isSafeInteger(request.stockGeneration)&&request.stockGeneration>=0
 &&request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&['QUARANTINE','DECIDE','RETURN','REPLACEMENT','APPROVE_LOSS','APPROVE_VARIANCE','APPROVE_RELEASE','CLOSE'].includes(request.input.action)
 &&typeof request.input.version==='string'&&request.input.version&&JSON.stringify(request).length<=200000;}
function stockSelectLock(value){const select=document.getElementById('companySelect')||document.getElementById('company');if(!select)return;
 if(value){if(stockCompanyLock===null)stockCompanyLock=Boolean(select.disabled);select.disabled=true;}else if(stockCompanyLock!==null){select.disabled=stockCompanyLock;stockCompanyLock=null;}}
function stockRetained(create){const key=stockCacheKey(pending.company,pending.stockIdentity),raw=sessionStorage.getItem(key);
 if(raw!==null){const cached=JSON.parse(raw);if(cached.schema!==1||!stockSame(cached.request,pending))throw Error('Original stock cache changed');return key;}
 if(!create)throw Error('Original stock cache missing');const cached={schema:1,request:stockClone(pending)};sessionStorage.setItem(key,JSON.stringify(cached));
 if(!stockSame(JSON.parse(sessionStorage.getItem(key)||'null'),cached))throw Error('Original stock cache unconfirmed');return key;}
function stockUnknown(text){stockFlight=false;stockFinal=null;lock(false);stockSelectLock(true);error(text||stockCopy('Save unconfirmed. Original request retained; retry this same save.','保存尚未确认，已保留原请求，请重试同一次保存。'));}
function stockRecovery(){stockSelectLock(true);shell('<p>'+esc(stockCopy('Original stock save retained. No automatic retry.','原库存请求已保留，不会自动重试。'))+'</p><p>'+esc(pending.input.action)+' · '+esc(pending.requestId)+'</p>',
 '<button data-save class="primary">'+esc(stockCopy('Retry same save','重试原保存'))+'</button>');dialog.querySelector('[data-save]').onclick=save;lock(false);}
function stockSend(){if(!stockRequest(pending)||pending.company!==companyValue()||!stockSame(pending.stockIdentity,stockActor)||stockBlocked){stockUnknown(stockCopy('Original identity or request unconfirmed. Preserve this tab.','原身份或请求尚未确认，请保留此页。'));return;}
 if(stockFlight||stockFinal)return;
 try{stockRetained(true);}catch(_){stockUnknown(stockCopy('Not sent: browser cache unconfirmed. Retry this same request.','尚未发送：浏览器暂存未确认，请重试同一次请求。'));return;}
 const original=pending,segment=++stockSerial;stockFlight=true;lock(true);stockSelectLock(true);error(stockCopy('Saving original request…','正在保存原请求…'));
 try{parent.postMessage({...stockClone(pending),stockSegment:segment},'*');}catch(_){stockUnknown();return;}
 clearTimeout(timer);timer=setTimeout(()=>{if(pending===original&&stockSerial===segment&&stockFlight)stockUnknown();},30000);
}
function stockResponse(message){
 if(companyValue()!==company)return true;
 if(message.type==='STOCK_READ_RESULT'&&message.requestId===readId){
  clearTimeout(timer);const result=message.result;
  if(stockReadKind==='IDENTITY'){
   if(!message.ok||result?.ok!==true||result.company!==company||result.schema!=='STOCK_EXCEPTION_ORIGINAL_CONTEXT_V1'||!result.staff?.staffName||!stockIdentity({staffId:result.staff.staffId,memberId:result.staff.memberId})){
    error(stockCopy('Original staff identity unconfirmed. Retry reading.','原员工身份尚未确认，请重试读取。'));return true;}
   stockActor={staffId:result.staff.staffId,memberId:result.staff.memberId};
   try{const raw=sessionStorage.getItem(stockCacheKey(company,stockActor));if(raw!==null){const cached=JSON.parse(raw);
    if(cached.schema!==1||!stockRequest(cached.request)||cached.request.company!==company||!stockSame(cached.request.stockIdentity,stockActor))throw Error('Invalid original stock cache');
    pending=stockClone(cached.request);stockRecovery();return true;}
   }catch(_){stockBlocked=true;stockSelectLock(true);error(stockCopy('Original cache requires review. No new save was started.','原暂存需要核对，未开始新保存。'));return true;}
   read();return true;
  }
  if(!message.ok||!result||result.company!==company||!Array.isArray(result.cases)||!Array.isArray(result.sources)){
   if(pending?.stockProtocol===1)stockUnknown(stockCopy('Save or fresh stock unconfirmed. Original request retained.','保存或最新库存尚未确认，已保留原请求。'));else error(stockCopy('Stock read unconfirmed. Please retry.','库存读取尚未确认，请重试。'));return true;}
  const meta=result.stockCurrent;
  if(meta!==undefined&&(!meta||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0||!stockIdentity(meta.stockIdentity)||!stockSame(meta.stockIdentity,stockActor))){
   if(pending)stockUnknown();else error(stockCopy('Current stock identity unconfirmed. Refresh.','当前库存身份尚未确认，请刷新。'));return true;}
  if(pending?.stockProtocol===1){
   if(!stockFinal||!meta||meta.stockBuild!==pending.stockBuild||!stockSame(meta.stockIdentity,pending.stockIdentity)||meta.stockGeneration<stockFinal.stockGeneration){stockUnknown();return true;}
   const savedCase=result.cases.find(item=>item.id===stockFinal.caseId);
   if(!savedCase||pending.input.action==='QUARANTINE'&&(savedCase.sourceTaskId!==pending.input.sourceTaskId||savedCase.quantity!==pending.input.quantity||savedCase.kind!==pending.input.kind||savedCase.byStaffId!==pending.stockIdentity.staffId)){stockUnknown();return true;}
   try{const key=stockRetained(false);sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error('Cleanup unconfirmed');}
   catch(_){stockUnknown(stockCopy('Save recorded; cache cleanup unconfirmed. Retry original request.','保存已记录，暂存清理尚未确认，请重试原请求。'));return true;}
   pending=null;stockFinal=null;stockFlight=false;stockSteps=0;lock(false);stockSelectLock(false);changed=true;stockMeta=stockClone(meta);data=result;list();return true;
  }
  stockMeta=meta===undefined?null:stockClone(meta);return false;
 }
 if(message.type!=='STOCK_SAVE_RESULT'||pending?.stockProtocol!==1)return false;
 if(message.requestId!==pending.requestId||message.stockSegment!==stockSerial)return true;
 if(!stockFlight||stockFinal)return true;clearTimeout(timer);const result=message.result;
 if(message.ok&&result?.ok===true&&result.pending!==true&&result.requestId===pending.requestId&&result.company===pending.company&&typeof result.caseId==='string'&&result.caseId
  &&(pending.input.action==='QUARANTINE'||result.caseId===pending.input.id)&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>pending.stockGeneration){
  stockFlight=false;stockFinal=stockClone(result);lock(true);error(stockCopy('Save recorded. Checking current stock…','保存已记录，正在核对最新库存…'));read(false,true);return true;
 }
 if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===pending.requestId&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)
  &&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.totalRecords<=1000000&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
  stockFlight=false;if(++stockSteps>64){stockUnknown(stockCopy('Automatic progress paused. Retry only this original save.','自动续接已暂停，请只重试原保存。'));return true;}
  error(stockCopy('Saving… ','正在保存… ')+result.completedCount+' / '+result.totalRecords);const original=pending,segment=stockSerial;
  setTimeout(()=>{if(pending===original&&stockSerial===segment&&!stockFlight&&!stockFinal)stockSend();},250);return true;
 }
 stockUnknown();return true;
}
const stockCompanySelect=document.getElementById('companySelect')||document.getElementById('company');
stockCompanySelect?.addEventListener('change',event=>{if(pending||stockBlocked){event.target.value=company;event.stopImmediatePropagation?.();}},true);
window.addEventListener('beforeunload',event=>{if(pending?.stockProtocol===1||stockBlocked){event.preventDefault();event.returnValue='';}});

function shell(body,footer=''){dialog.innerHTML=stockCopy("<header><strong>Stock Issues</strong><button data-close aria-label=\"Close stock issues\">×</button></header><div class=\"stock-body\">",'<header><strong>Stock Issues 库存异常</strong><button data-close aria-label="Close stock issues">×</button></header><div class="stock-body">')+body+'<p id="stockError" role="alert"></p></div><footer>'+footer+stockCopy("<button data-close>Close</button></footer>",'<button data-close>Close 关闭</button></footer>');dialog.querySelectorAll('[data-close]').forEach(el=>el.onclick=close);}
function error(value){dialog.querySelector('#stockError').textContent=value;}
function close(){if(busy||pending||stockBlocked){error(stockCopy("Save is not confirmed. Retry the same save first.",'保存尚未确认，请先重试同一次保存。'));return;}dialog.close();if(changed){changed=false;document.getElementById('refresh')?.click();}}
dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
function read(identityOnly=false,verify=false){if(pending&&!verify)return;stockReadKind=identityOnly?'IDENTITY':verify?'VERIFY':'DATA';readId=crypto.randomUUID();
 parent.postMessage({type:'STOCK_READ_REQUEST',company,requestId:readId,...(identityOnly?{readOptions:{contextOnly:true}}:{})},'*');clearTimeout(timer);const id=readId;
 timer=setTimeout(()=>{if(readId!==id)return;if(pending?.stockProtocol===1)stockUnknown();else error(stockCopy('Read is not confirmed. Please retry.','读取尚未确认，请重试。'));dialog.querySelector('[data-reload]')?.removeAttribute('disabled');},30000);}
function open(){if(document.querySelector('dialog[open]'))return;company=companyValue();data=null;form=null;stockMeta=null;stockActor=null;stockFinal=null;stockReadKind='';shell(stockCopy("<p>Loading…</p><button data-reload>Retry</button>",'<p>Loading 正在读取库存异常…</p><button data-reload>Retry 重试</button>'));dialog.querySelector('[data-reload]').onclick=read;dialog.showModal();dialog.querySelector('[data-reload]').onclick=()=>read(true);read(true);}
button.onclick=open;
function list(){form=null;dialog.style.width='800px';const open=data.cases.filter(item=>item.status!=='RESOLVED');button.innerHTML=stockCopy("Stock Issues",'Stock Issues 库存异常')+(open.length?'<span class="stock-count">'+open.length+'</span>':'');
 shell('<div class="stock-tools">'+(data.permissions.report?stockCopy("<button data-report class=\"primary\">Report issue</button>",'<button data-report class="primary">Report issue 登记异常</button>'):'')+stockCopy("<button data-reload>Refresh</button><select id=\"stockFilter\" aria-label=\"Stock case status\"><option value=\"OPEN\">Open</option><option value=\"ALL\">All</option></select></div><div id=\"stockRows\"></div>",'<button data-reload>Refresh 刷新</button><select id="stockFilter" aria-label="Stock case status"><option value="OPEN">Open 未解决</option><option value="ALL">All 全部记录</option></select></div><div id="stockRows"></div>'));
 dialog.querySelector('[data-report]')?.addEventListener('click',()=>edit('QUARANTINE'));
 dialog.querySelector('[data-reload]').onclick=read;dialog.querySelector('#stockFilter').onchange=rows;rows();
}
function rows(){const items=data.cases.filter(item=>dialog.querySelector('#stockFilter').value==='ALL'||item.status!=='RESOLVED');dialog.querySelector('#stockRows').innerHTML=stockCopy("<table><thead><tr><th>Barcode · Item</th><th>Supplier · P.O.</th><th>Issue</th><th>Owner</th><th>Entry</th></tr></thead><tbody>",'<table><thead><tr><th>Barcode · Item 产品</th><th>Supplier · P.O. 供应商</th><th>Issue 异常</th><th>Owner 责任部门</th><th>Entry 处理</th></tr></thead><tbody>')+items.map(item=>'<tr><td>'+esc(item.source.barcode)+'<b style="display:block">'+esc(item.source.name)+'</b><small>'+esc(item.source.packing)+'</small></td><td>'+esc(item.source.supplierName)+'<small>'+esc(item.source.po)+'</small></td><td><span class="'+(item.status==='RESOLVED'?'stock-green':'stock-red')+'">'+item.quantity+' CTN · '+esc(kinds[item.kind])+'</span><small>'+stamp(item.at)+'<br>by '+esc(item.by)+'</small></td><td>'+esc(item.status==='RESOLVED'?stockCopy("Resolved",'Resolved 已核对'):owners[item.owner]||item.owner)+'<small>'+(item.status==='RESOLVED'?'':stockCopy("Affects available stock and financial closure",'影响：销售可用数量、财务结案'))+'</small></td><td><button data-case="'+esc(item.id)+stockCopy("\">Open</button></td></tr>",'">Open 打开</button></td></tr>')).join('')+(items.length?'':stockCopy("<tr><td colspan=\"5\">No pending stock issues</td></tr>",'<tr><td colspan="5">No pending stock issues 暂无库存异常</td></tr>'))+'</tbody></table>';dialog.querySelectorAll('[data-case]').forEach(el=>el.onclick=()=>caseView(el.dataset.case));}
function identity(item){return '<div class="stock-identity">'+esc(item.source.barcode)+'<b>'+esc(item.source.name)+'</b>'+esc(item.source.packing)+'<small>'+esc(item.source.supplierName)+' · '+esc(item.source.po)+'</small></div>';}
function caseView(id){const item=data.cases.find(item=>item.id===id),state=item.resolution||{},choices=[];if(item.status!=='RESOLVED'){
 if(data.permissions.decide&&item.kind!=='INTERNAL_DAMAGE'&&!state.adminApproval&&!state.returns?.length&&!state.replacements?.length)choices.push('DECIDE');
 if(data.permissions.approve){if(!state.adminApproval&&!state.returns?.length&&!state.replacements?.length){if(item.kind==='INTERNAL_DAMAGE')choices.push('APPROVE_LOSS');choices.push('APPROVE_RELEASE');}if(item.kind!=='INTERNAL_DAMAGE')choices.push('APPROVE_VARIANCE');}
 if(data.permissions.report&&state.decision&&!state.adminApproval){if(state.decision.disposition==='RETURN')choices.push('RETURN');if(state.decision.value==='REPLACE')choices.push('REPLACEMENT');}
 if(data.permissions.close&&(state.adminApproval||state.decision&&state.decision.value!=='PENDING'))choices.push('CLOSE');}
 const entries=[{title:stockCopy("Reported",'Reported 登记'),reason:item.reason,at:item.at,by:item.by},state.decision&&{title:stockCopy("Supplier decision ·",'Supplier decision 采购决定 · ')+state.decision.value,...state.decision},state.adminApproval&&{title:stockCopy("Admin approval",'Admin approval 管理员批准'),...state.adminApproval},state.varianceApproval&&{title:stockCopy("Variance approval",'Variance approval 差额批准'),...state.varianceApproval},...(state.returns||[]).map(row=>({title:stockCopy("Returned ",'Returned 退回 ')+row.quantity+' CTN',...row})),...(state.replacements||[]).map(row=>({title:stockCopy("Replacement ",'Replacement 换货 ')+row.quantity+' CTN',...row})),state.financeApproval&&{title:stockCopy("Finance checked",'Finance checked 财务核对'),...state.financeApproval}].filter(Boolean);
 shell(identity(item)+'<p class="stock-note">'+item.quantity+' CTN · '+esc(kinds[item.kind])+stockCopy("<br>Responsible",'<br>Responsible 责任：')+esc(item.status==='RESOLVED'?stockCopy("Resolved",'Resolved 已核对'):owners[item.owner]||item.owner)+'</p><div class="stock-tools" style="flex-wrap:wrap">'+choices.map(action=>'<button data-action="'+action+'">'+esc(actions[action])+'</button>').join('')+'</div><div class="stock-history">'+entries.map(entry=>'<p><b>'+esc(entry.title)+'</b><small>'+stamp(entry.at)+' · by '+esc(entry.by)+'</small>'+esc(entry.reason||'')+'</p>').join('')+'</div>',stockCopy("<button data-back>Back</button>",'<button data-back>Back 返回</button>'));dialog.querySelector('[data-back]').onclick=list;dialog.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>edit(el.dataset.action,item));}
const field=(label,name,type='text',value='')=>'<label for="stock-'+name+'">'+label+'</label><input id="stock-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0" step="0.01"':'')+' required>';
const select=(label,name,options)=>'<label for="stock-'+name+'">'+label+'</label><select id="stock-'+name+'" name="'+name+'">'+options.map(([value,title])=>'<option value="'+esc(value)+'">'+esc(title)+'</option>').join('')+'</select>';
function allocations(item){const finance=item.finance,others=(finance.stockCases||[]).filter(value=>value.id!==item.id).map(value=>value.resolution?.financeApproval).filter(Boolean).concat(finance.quantityClaims||[]);return stockCopy("<p class=\"wide stock-note\">Allocate amounts to this case. CN and refunds cannot be reused.</p>",'<p class="wide stock-note">填写本宗异常分配金额；相同 CN 退款不得重复使用。</p>')+finance.documents.map(doc=>{const confirmed=finance.amounts.find(row=>row.fileId===doc.fileId&&row.sha256===doc.sha256),used=others.flatMap(row=>row.cnAllocations||[]).filter(row=>row.fileId===doc.fileId).reduce((sum,row)=>sum+row.cents,0);return confirmed?'<label>CN '+esc(doc.number)+stockCopy("<small>Available RM ",'<small>Available 可用 RM ')+money(confirmed.cents-used)+'</small></label><input type="number" min="0" step="0.01" value="0.00" data-cn="'+esc(doc.fileId)+'">':'';}).join('')+finance.refunds.map(payment=>{const used=others.flatMap(row=>row.refundAllocations||[]).filter(row=>row.paymentId===payment.id).reduce((sum,row)=>sum+row.cents,0);return stockCopy("<label>Refund ",'<label>Refund 已收退款 ')+esc(payment.reference)+stockCopy("<small>Available RM",'<small>Available 可用 RM ')+money(payment.cents-used)+'</small></label><input type="number" min="0" step="0.01" value="0.00" data-refund="'+esc(payment.id)+'">';}).join('');}
function edit(action,item){form={action,id:item?.id};dialog.style.width='560px';let fields='';const state=item?.resolution||{};
 if(action==='QUARANTINE')fields=select(stockCopy("Supplier line",'Supplier line 采购行'),'sourceTaskId',data.sources.filter(row=>row.availablePhysical>0).map(row=>[row.id,row.barcode+' · '+row.po+' · '+row.supplierName]))+select(stockCopy("Issue",'Issue 问题'),'kind',Object.entries(kinds))+field(stockCopy("Affected CTN",'Affected CTN 箱数'),'quantity','number')+stockCopy("<p class=\"wide stock-note\">Record issues found after receiving. Quarantined cartons cannot be dispatched. Original receipts remain.</p>",'<p class="wide stock-note">本功能登记收货后发现的问题。隔离箱数不可发给客户；原始签收记录保留。</p>');
 if(action==='DECIDE')fields=select(stockCopy("Solution",'Solution 处理方式'),'decision',[['PENDING',stockCopy("Awaiting supplier",'Awaiting supplier 等供应商回复')],['REFUND',stockCopy("CN + Refund",'CN + Refund / CN及退款')],['CREDIT',stockCopy("CN + Next purchase",'CN + Next purchase / CN下次扣账')],['REPLACE',stockCopy("Replacement",'Replacement 补货换货')]])+select(stockCopy("Goods",'Goods 原货处理'),'disposition',[['RETURN',stockCopy("Return to supplier",'Return to supplier 退给供应商')],['SUPPLIER_NO_RETURN',stockCopy("Supplier does not require return",'Supplier does not require return 供应商无需退回')]])+field(stockCopy("Supplier reference",'Supplier reference 回复依据'),'supplierReference')+field(stockCopy("Replacement date",'Replacement date 换货日期'),'expectedDate','date');
 if(['RETURN','REPLACEMENT'].includes(action))fields=field(stockCopy("This movement",'This movement 本次箱数'),'quantity','number')+field(stockCopy("Reference",'Reference 单号'),'reference')+(action==='REPLACEMENT'?stockCopy("<label for=\"stock-acceptedGood\">Goods inspected</label><input id=\"stock-acceptedGood\" name=\"acceptedGood\" type=\"checkbox\">",'<label for="stock-acceptedGood">Goods inspected 验收合格</label><input id="stock-acceptedGood" name="acceptedGood" type="checkbox">'):'');
 if(['APPROVE_LOSS','APPROVE_VARIANCE'].includes(action))fields=field(stockCopy("Amount MYR",'Amount MYR 金额'),'cents','number',action==='APPROVE_LOSS'?money(item.referenceCostCents):'');
 if(action==='APPROVE_RELEASE')fields=stockCopy("<p class=\"wide stock-note\">For an incorrect quarantine entry only. Another Finance employee must verify before stock is released.</p>",'<p class="wide stock-note">仅限原隔离登记有误。财务由另一员工核对后才恢复可用库存。</p>');
 if(action==='CLOSE'){
  const outcome=state.adminApproval?.outcome||(state.decision?.value==='REPLACE'?'REPLACED':state.decision?.value);
  fields=stockCopy("<p class=\"wide stock-note\">Outcome",'<p class="wide stock-note">Outcome 核对结果：')+esc(({LOSS:stockCopy("Inventory loss",'Inventory loss 库存损耗'),RELEASED:stockCopy("Release quarantine",'Release quarantine 解除隔离'),REFUND:stockCopy("Refund received",'Refund received 已收到退款'),CREDIT:stockCopy("Supplier credit",'Supplier credit 下次扣账'),REPLACED:stockCopy("Replacement complete",'Replacement complete 换货完成')})[outcome]||stockCopy("Awaiting Purchase or Admin",'等待采购或管理员处理'))+'</p><input name="outcome" type="hidden" value="'+esc(outcome||'')+'">';
  if(['LOSS','REFUND','CREDIT'].includes(outcome))fields+=field(stockCopy("Actual MYR",'Actual MYR 实际金额'),'cents','number',outcome==='LOSS'?money(state.adminApproval.cents):'');
  if(['REFUND','CREDIT'].includes(outcome))fields+=allocations(item);
  if(outcome==='REPLACED')fields+=stockCopy("<label for=\"stock-noExtraCharge\">No extra charge</label><input id=\"stock-noExtraCharge\" name=\"noExtraCharge\" type=\"checkbox\">",'<label for="stock-noExtraCharge">No extra charge 无额外费用</label><input id="stock-noExtraCharge" name="noExtraCharge" type="checkbox">');
 }
 fields+=stockCopy("<label for=\"stock-reason\">Note</label><textarea id=\"stock-reason\" name=\"reason\" maxlength=\"2000\" required></textarea>",'<label for="stock-reason">Note 内部处理记录</label><textarea id="stock-reason" name="reason" maxlength="2000" required></textarea>');
 shell((item?identity(item):'')+'<b>'+esc(actions[action])+'</b><form id="stockForm" class="stock-fields" style="margin-top:12px">'+fields+'</form>',stockCopy("<button data-back>Back</button><button data-save class=\"primary\">Save</button>",'<button data-back>Back 返回</button><button data-save class="primary">Save 保存</button>'));dialog.querySelector('[data-back]').onclick=()=>item?caseView(item.id):list();dialog.querySelector('[data-save]').onclick=save;dialog.querySelector('#stockForm').onsubmit=event=>{event.preventDefault();save();};
 if(action==='DECIDE'){
  const decision=dialog.querySelector('[name=decision]');
  const refresh=()=>{for(const name of ['disposition','supplierReference','expectedDate']){const field=dialog.querySelector('[name='+name+']'),visible=name==='expectedDate'?decision.value==='REPLACE':decision.value!=='PENDING';field.hidden=!visible;field.disabled=!visible;field.required=visible;dialog.querySelector('label[for="stock-'+name+'"]').hidden=!visible;}};
  decision.onchange=refresh;refresh();
 }
 const quantityField=dialog.querySelector('[name=quantity]');if(quantityField){quantityField.min='1';quantityField.step='1';}
}
function lock(value){busy=value;dialog.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=value||!!pending);dialog.querySelectorAll('[data-close],[data-back]').forEach(el=>el.disabled=value||!!pending);const save=dialog.querySelector('[data-save]');if(save){save.disabled=value;save.textContent=value?stockCopy("Saving…",'Saving 保存中…'):pending?stockCopy("Retry Save",'Retry Save 重试保存'):stockCopy("Save",'Save 保存');}}
function save(){if(busy)return;if(!pending){const node=dialog.querySelector('#stockForm');if(!node.reportValidity())return;const values=Object.fromEntries(new FormData(node));values.reason=values.reason.trim();if(!values.reason){error(stockCopy("Enter an internal note.",'请填写内部处理记录。'));return;}const input={action:form.action,...values,version:form.action==='QUARANTINE'?data.version:data.resolutionVersion,...(form.id?{id:form.id}:{})};if('quantity'in input)input.quantity=qty(input.quantity);if('cents'in input)input.cents=Math.round(Number(input.cents)*100);if('acceptedGood'in input)input.acceptedGood=true;if('noExtraCharge'in input)input.noExtraCharge=true;
 if(['REFUND','CREDIT'].includes(input.outcome)){input.cnAllocations=[...node.querySelectorAll('[data-cn]')].filter(el=>Number(el.value)>0).map(el=>({fileId:el.dataset.cn,cents:Math.round(Number(el.value)*100)}));input.refundAllocations=[...node.querySelectorAll('[data-refund]')].filter(el=>Number(el.value)>0).map(el=>({paymentId:el.dataset.refund,cents:Math.round(Number(el.value)*100)}));}
 pending={type:'STOCK_SAVE_REQUEST',company,requestId:crypto.randomUUID(),input};if(stockMeta)pending=stockClone({...pending,...stockMeta});}
 if(pending.stockProtocol===1){stockSteps=0;stockSend();return;}
 error('');lock(true);parent.postMessage(pending,'*');const id=pending.requestId;clearTimeout(timer);timer=setTimeout(()=>{if(pending?.requestId===id){lock(false);error(stockCopy("Save is not confirmed. Retry the same save to avoid a duplicate.",'尚未确认保存。请重试同一次保存，不会重复登记。'));}},30000);
}
window.addEventListener('message',event=>{if(event.source!==parent)return;const message=event.data||{};
 if(message.ok&&message.company===companyValue()&&['PURCHASE_WORKSPACE_RESULT','ACCOUNT_ORDERS_RESULT','WAREHOUSE_ORDERS_RESULT'].includes(message.type)){
  const result=message.workspace||message.result||{},items=[...(result.tasks||[]).flatMap(row=>row.warehouse?.stock?.cases||[]),...(result.orders||[]).flatMap(row=>row.stockCases||[])],count=new Set(items.filter(item=>item.status!=='RESOLVED').map(item=>item.id)).size;
  button.innerHTML=stockCopy("Stock Issues",'Stock Issues 库存异常')+(count?'<span class="stock-count">'+count+'</span>':'');
 }
 if(message.company!==company)return;
 if(stockResponse(message))return;
 if(message.type==='STOCK_READ_RESULT'&&message.requestId===readId){clearTimeout(timer);if(!message.ok||!message.result?.cases){error(message.error||stockCopy("Read failed. Please retry.",'读取失败，请重试。'));return;}data=message.result;list();}
 if(message.type==='STOCK_SAVE_RESULT'&&message.requestId===pending?.requestId){clearTimeout(timer);if(message.ok&&message.result?.ok){pending=null;lock(false);changed=true;shell(stockCopy("<p>Saved. Loading current stock…</p><button data-reload>Retry</button>",'<p>Saved 已保存。正在读取最新库存…</p><button data-reload>Retry 重试</button>'));dialog.querySelector('[data-reload]').onclick=read;read();}else{if(message.result?.retryable===false)pending=null;lock(false);error(message.result?.error||message.error||stockCopy("Save is not confirmed. Please retry.",'保存尚未确认，请重试。'));}}
});
window.masterStockExceptions={open};
(document.getElementById('companySelect')||document.getElementById('company'))?.addEventListener('change',()=>{button.textContent=stockCopy("Stock Issues",'Stock Issues 库存异常');});
})();
