/* Supplier planning dialog. Saves use the existing serial PLAN / ADD_SOURCE journal. */
(() => {
  const priceKeys=['lpPc','lpCtn','disc1','disc2','disc3'];
  const displayPrice=(value,key)=>Number.isFinite(value)?(key==='disc1'||key==='disc2'?value*100:value).toFixed(2):'0.00';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const net=prices=>priceKeys.every(key=>Number.isFinite(prices[key]))?prices.lpCtn*(1-prices.disc1)*(1-prices.disc2)-prices.disc3:null;
  function values(row){return Object.fromEntries(priceKeys.map(key=>[key,row.originalRaw?.[key]===row.raw[key]&&Number.isFinite(row.originalPrices?.[key])?row.originalPrices[key]:row.originalRaw?.[key]===row.raw[key]&&!row.edited?.includes(key)?NaN:row.raw[key]===''?NaN:Number(row.raw[key])/(key==='disc1'||key==='disc2'?100:1)]));}
  function calculation(row){const prices=values(row),paid=row.mode==='FOC'?Number(row.paid):Number(row.qty),free=row.mode==='FOC'?Number(row.free):0,total=paid+free,cost=net(prices),amountCents=row.moneySource==='TOTAL'?Math.round(Number(row.amount)*100):Number.isFinite(cost)?Math.round(cost*paid*100):NaN;
    return {schema:1,mode:row.mode||'NORMAL',moneySource:row.moneySource||'PRICES',paidCtn:paid,freeCtn:free,totalCtn:total,prices,amountCents,averageCostCtn:total?amountCents/100/total:null,manualFields:row.manual,reference:row.reference||null};}
  const basis=value=>JSON.stringify([value.mode,value.moneySource,value.paidCtn,value.freeCtn,priceKeys.map(key=>value.prices?.[key]),value.moneySource==='TOTAL'?value.amountCents:null]);
  function changed(draft,saved){const prices=values(draft),costing=calculation(draft);return !saved?.procurement?.revision||draft.supplierId!==saved.supplierId||Number(draft.qty)!==saved.procurement.totalCtn||(saved.procurement.costing?basis(costing)!==basis(saved.procurement.costing):draft.mode==='FOC'||draft.moneySource==='TOTAL'||priceKeys.some(key=>prices[key]!==saved[key]));}
  function rowDraft(source,key){const costing=source?.procurement?.costing,original=costing?.prices||source||{},raw=Object.fromEntries(priceKeys.map(name=>[name,displayPrice(original[name],name)]));return {key,taskId:source?.id||null,version:source?.editVersion||null,supplierId:source?.supplierId||'',qty:String(source?.procurement?.totalCtn??source?.ord??''),mode:costing?.mode||'NORMAL',moneySource:costing?.moneySource||'PRICES',paid:String(costing?.paidCtn??source?.procurement?.totalCtn??source?.ord??''),free:String(costing?.freeCtn??0),amount:costing?.amountCents!==undefined?(costing.amountCents/100).toFixed(2):'',raw,originalRaw:{...raw},originalPrices:Object.fromEntries(priceKeys.map(name=>[name,Number.isFinite(original[name])?original[name]:name.startsWith('disc')?0:null])),manual:costing?.manualFields?.slice()||source?.manualCostField?.slice()||[],reference:costing?.reference||null,extraKind:source?.procurement?.extraKind||'',status:'draft'};}
  function needsReason(state,workspace){const parent=workspace.tasks.find(row=>row.id===state.rootId);return state.rows.some(row=>{const saved=workspace.tasks.find(item=>item.id===row.taskId);return row.supplierId&&row.status!=='saved'&&saved&&(saved.procurement?.revision||saved.po)&&changed(row,saved);})||state.rows.filter(row=>row.supplierId).reduce((sum,row)=>sum+(Number(row.qty)||0),0)>(parent?.ord??0);}
  function submissionState(state,workspace,key){
    if(!key)return state;
    const target=state.rows.find(row=>row.key===key);
    return {...state,rows:state.rows.map(row=>row===target?row:workspace.tasks.find(saved=>saved.id===row.taskId)).filter(row=>row===target||row?.procurement?.totalCtn>0).map(row=>row===target?row:({...rowDraft(row,row.id),status:'saved'}))};
  }
  function validate(state,workspace){
    const parent=workspace.tasks.find(row=>row.id===state.rootId);if(!parent)return '原客户任务已不存在。';
    let total=0,chosen=0;
    for(const row of state.rows){
      if(row.status==='saved'){total+=Number(row.qty);continue;}
      if(!row.supplierId){if(row.taskId)return '请选择每条已存在来源的供应商。';continue;}
      chosen++;const qty=Number(row.qty),prices=values(row),calc=calculation(row),cost=calc.averageCostCtn;
      if(row.qty===''||!Number.isSafeInteger(qty)||qty<1||qty>9999)return '请填写 1–9999 的整数箱数。';
      if(!workspace.suppliers.some(s=>s.id===row.supplierId))return '所选供应商已不可用，请重新核对。';
      if(!Number.isSafeInteger(calc.paidCtn)||calc.paidCtn<1||!Number.isSafeInteger(calc.freeCtn)||calc.freeCtn<0||calc.totalCtn!==qty)return '请核对付费及 FOC 整数箱数。';
      if(row.moneySource==='TOTAL'&&(row.amount===''||!Number.isFinite(Number(row.amount))||Math.abs(Number(row.amount)*100-Math.round(Number(row.amount)*100))>.00001))return '请填写两位小数的本行实际总额。';
      if(!Number.isFinite(cost)||cost<=0||priceKeys.some(key=>prices[key]<0)||prices.disc1>1||prices.disc2>1)return '请确认成本；未知价格不代表免费采购。';
      const saved=workspace.tasks.find(item=>item.id===row.taskId);
      if(row.taskId&&!saved)return '采购来源已不存在，请核对最新资料。';
      if(saved&&changed(row,saved)){
        if(saved.archived||saved.salesInvoiceLocked||saved.salesInvoiceNumber)return '已开票或归档的来源不能修改。';
        if(saved.editVersion!==row.version)return '采购来源已变化；草稿保留，请核对最新资料。';
        if(qty<(saved.warehouse?.accepted??saved.inc??0))return '供应商数量不能低于实际已收货箱数。';
        if(saved.po&&row.supplierId!==saved.supplierId)return '已有 P.O. 的供应商不能更换。';
      }
      total+=qty;
    }
    if(!chosen&&!state.rows.some(row=>row.status==='saved'))return '请至少安排一家供应商。';
    if(needsReason(state,workspace)&&!state.reason.trim())return '修改已保存方案或额外采购，请填写原因。';
    if(state.reason.trim().length>2000)return '原因不能超过 2000 字。';
    return '';
  }
  function create(api){
    let state=null,referenceRequest=null,referenceSession={};
    const caughtRows=new Set();
    const rowLocked=row=>{const saved=workspace().tasks.find(item=>item.id===row.taskId);return Boolean(saved?.archived||saved?.salesInvoiceLocked||saved?.salesInvoiceNumber||api.financeLocked?.(row.taskId));};
    const parkedDrafts=new Map();
    const esc=api.esc,money=api.num;
    const workspace=()=>api.workspace();
    const rootTask=()=>workspace()?.tasks.find(row=>row.id===state?.rootId);
    function remainingRow(){
      const root=rootTask();if(!root||state.running)return;
      const filled=state.rows.filter(row=>row.supplierId||row.taskId),sum=filled.reduce((n,row)=>n+(Number(row.qty)||0),0),remaining=Math.max(0,root.ord-sum);
      let empty=state.rows.find(row=>!row.taskId&&!row.supplierId&&row.auto);
      if(remaining>0&&!empty){empty={...rowDraft(null,'draft-'+(++state.counter)),qty:String(remaining),auto:true};state.rows.push(empty);}
      if(empty){empty.qty=String(remaining);empty.hidden=remaining===0;}
    }
    function open(id){
      const data=workspace(),source=data.tasks.find(row=>row.id===id),root=source?.procurementSource?data.tasks.find(row=>row.id===source.customerDemandTaskId):source;
      if(!root)return;
      if(state&&state.rootId!==root.id){
        if(state.running||state.current||api.savePending()){api.status('保存结果尚未确认；可继续浏览，请先核对原保存再编辑其他分单。',true);return;}
        if(state.dirty){parkedDrafts.set(state.rootId,state);const task=data.tasks.find(item=>item.id===state.rootId);api.status((api.rowLabel?.(state.rootId)||state.rowLabel||'产品')+' · '+(task?.barcode||state.rootId)+' 有未完成草稿，已保留；可继续处理其他任务。');}
        state=parkedDrafts.get(root.id)||null;parkedDrafts.delete(root.id);
      }
      if(!state&&parkedDrafts.has(root.id)){state=parkedDrafts.get(root.id);parkedDrafts.delete(root.id);}
      if(!state||state.rootId!==root.id||!state.dirty&&!state.running){const sources=[root,...data.tasks.filter(row=>row.customerDemandTaskId===root.id)];state={company:data.company,rootId:root.id,counter:0,reason:'',rows:sources.map(row=>rowDraft(row,row.id)),dirty:false,running:false,current:null,issue:'',reopen:true};}
      referenceSession={};caughtRows.clear();if(state.issue==='正在抓取成本，请稍候…'){state.issue='';state.issueTone='';}
      state.rowLabel=api.rowLabel?.(root.id)||state.rowLabel||'';state.reopen=true;remainingRow();render();api.cache();
    }
    function render(){
      const root=rootTask();if(!root||!state)return;
      const customer=workspace().customers.find(row=>row.id===root.customerId);
      api.dialog('供应商分单',(customer?.shortName||customer?.name||root.customerId)+' · '+(root.transactionCurrency||''),
        '<section class="supplier-allocation"><div class="allocation-product"><div class="allocation-product-title"><span class="allocation-product-barcode">'+esc(root.barcode)+'</span><strong title="'+esc(root.name)+'">'+esc(root.name)+'</strong><span class="allocation-product-packing">'+esc(root.packing)+'</span></div><div>需求<strong>'+esc(root.ord)+' CTN</strong></div></div><div class="allocation-scroll"><table class="allocation-table"><colgroup><col style="width:3%"><col style="width:18%"><col style="width:7%"><col style="width:6%"><col style="width:6%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:6%"><col style="width:7%"><col style="width:5%"><col style="width:8%"><col style="width:13%"></colgroup><thead><tr><th></th><th>供应商</th><th>方式</th><th>CTN</th>'+[['LP/Pc','MYR'],['LP/Ctn','MYR'],['Disc.1','%'],['Disc.2','%'],['Disc.3','MYR'],['Net Cost','MYR/CTN'],['Catch Cost',''],['Amount','MYR']].map(([label,unit])=>'<th>'+label+'<small>'+unit+'</small></th>').join('')+'<th>PO</th></tr></thead><tbody id="allocationRows"></tbody></table></div><div class="allocation-confirmations" id="allocationConfirmations"></div><div id="allocationSummary" class="allocation-summary" aria-live="polite"></div><label class="allocation-reason"><span id="allocationReasonLabel">原因（选填）</span><input id="allocationReason" maxlength="2000" value="'+esc(state.reason)+'"></label><div id="allocationHistory" class="allocation-history"></div></section>',
        '<div class="allocation-save-actions"><div id="allocationIssue" class="allocation-issue '+(state.running||state.current?'pending':state.issueTone||'')+'" role="status">'+esc(state.issue)+'</div><div class="allocation-save-buttons"><button class="btn" id="discardSupplierAllocation" '+(state.running?'disabled':'')+'>Cancel</button><button class="btn primary" id="applySupplierAllocation" '+(state.running?'disabled':'')+'>Save</button></div></div>','task');
      api.modal().classList.add('supplier-allocation-dialog');renderRows();
    }
    function rowMarkup(row,index){
      const saved=workspace().tasks.find(item=>item.id===row.taskId),locked=state.running||saved?.archived||saved?.salesInvoiceLocked||saved?.salesInvoiceNumber||api.financeLocked?.(row.taskId);
      const supplierLocked=locked||saved?.po||saved?.procurement?.revision&&!saved.procurement.draftPlan;
      const person='<span class="allocation-person '+(saved?.procurement?.revision&&row.supplierId===saved.supplierId?'complete':'pending')+'" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="5" r="3"/><path d="M4 18v-3a6 6 0 0 1 12 0v3z"/></svg><b>'+(index+1)+'</b></span>';
      const supplier='<select data-allocation-field="supplierId" aria-label="Supplier '+(index+1)+'" '+(supplierLocked?'disabled':'')+'><option value="">WAITING</option>'+workspace().suppliers.filter(s=>s.id===row.supplierId||!state.rows.some(other=>other.key!==row.key&&other.supplierId===s.id)).map(s=>'<option value="'+esc(s.id)+'" '+(s.id===row.supplierId?'selected':'')+'>'+esc(s.shortName||s.name)+'</option>').join('')+'</select>';
      const method=row.supplierId?'<select data-allocation-field="mode" '+(locked?'disabled':'')+' aria-label="Supplier '+(index+1)+' costing mode"><option value="NORMAL" '+(row.mode!=='FOC'?'selected':'')+'>普通</option><option value="FOC" '+(row.mode==='FOC'?'selected':'')+'>FOC</option></select>':'<span class="allocation-waiting-label">WAITING</span>';
      const clean=saved&&!changed(row,saved),ready=Number.isFinite(calculation(row).averageCostCtn)&&calculation(row).averageCostCtn>0;
      const poTime=(saved?.history||[]).find(event=>event.action==='PURCHASE_PO_ASSIGNED'&&event.result==='SAVED')?.time;
      const save=row.supplierId?'<button type="button" class="allocation-save'+(!clean&&ready?' needs-save':'')+'" data-allocation-save="'+esc(row.key)+'" '+(locked||!ready||clean?'disabled':'')+'>'+esc(saved&&!changed(row,saved)?'已保存':'保存这项采购')+'</button>':'';
      const po=(saved?.procurement?.revision?'<button type="button" class="allocation-po '+(saved.po?'complete':'pending'+(clean?'':' awaiting-save'))+'" data-allocation-po="'+esc(row.key)+'" '+(state.running?'disabled':'')+' '+(!saved.po&&!clean?'hidden':'')+'>'+esc(saved.po||'P.O.')+'</button>'+(saved.po&&poTime?'<small class="allocation-po-time">'+esc(api.shortTime?.(poTime)||poTime)+'</small>':''):row.supplierId?'<button type="button" class="allocation-po pending awaiting-save" data-allocation-po="'+esc(row.key)+'" disabled hidden>P.O.</button>':'')+save;
      const quantity='<div class="allocation-number"><input type="text" inputmode="numeric" data-allocation-field="qty" value="'+esc(row.qty)+'" '+(locked?'disabled':'')+' '+(!row.supplierId||row.mode==='FOC'?'readonly':'')+' aria-label="Supplier '+(index+1)+' quantity"></div>';
      const prices=row.supplierId?priceKeys.map(key=>'<td><div class="allocation-number"><input type="text" inputmode="decimal" data-allocation-field="'+key+'" value="'+esc(row.raw[key])+'" '+(locked?'disabled':'')+' aria-label="Supplier '+(index+1)+' '+key+'">'+(['disc1','disc2'].includes(key)?'<span>%</span>':'')+'</div></td>').join('')+'<td class="amount"><b data-allocation-net>—</b></td><td class="allocation-catch"><button type="button" class="allocation-hand" data-allocation-catch="'+esc(row.key)+'" '+(locked?'disabled':'')+' aria-label="Catch Cost reference '+(index+1)+'" title="获取参考价">'+api.handIcon()+'</button></td><td class="amount"><b data-allocation-amount>—</b></td>':'<td colspan="8" class="allocation-waiting-space"></td>';
      const input=(field,value,label)=>'<label>'+label+'<input type="text" inputmode="'+(field==='amount'?'decimal':'numeric')+'" data-allocation-field="'+field+'" value="'+esc(value)+'" '+(locked?'disabled':'')+'></label>';
      const detail=row.supplierId&&(row.mode==='FOC'||row.moneySource==='TOTAL')?'<tr data-allocation-row="'+esc(row.key)+'" class="allocation-detail"><td></td><td colspan="12"><div class="allocation-detail-fields">'+(row.mode==='FOC'?input('paid',row.paid,'付费 CTN')+'<span>＋</span>'+input('free',row.free,'赠送 CTN')+'<span data-allocation-total>= '+esc(row.qty)+' CTN</span>':'')+(row.moneySource==='TOTAL'?input('amount',row.amount,'实际总额 MYR'):'')+'</div></td></tr>':'';
      return '<tr data-allocation-row="'+esc(row.key)+'" class="'+(!row.supplierId?'allocation-waiting':'')+'" '+(row.hidden?'hidden':'')+'><td>'+person+'</td><td>'+supplier+'</td><td>'+method+'</td><td>'+quantity+'</td>'+prices+'<td class="allocation-po-cell">'+po+'</td></tr>'+detail;
    }
    function renderRows(){
      document.querySelector('#allocationRows').innerHTML=state.rows.map(rowMarkup).join('');
      document.querySelector('#allocationConfirmations').innerHTML='<p id="allocationStockNote" hidden></p>';update();renderHistory();
    }
    function renderHistory(){
      const target=document.querySelector('#allocationHistory');if(!target)return;
      const entries=workspace().tasks.filter(task=>task.id===state.rootId||task.customerDemandTaskId===state.rootId).flatMap(task=>(task.history||[]).filter(event=>event.action==='PURCHASE_PLAN_SAVED'&&event.result==='SAVED'&&Number.isSafeInteger(event.changes?.before)&&Number.isSafeInteger(event.changes?.after)&&event.changes.before!==event.changes.after).map(event=>({task,event}))).sort((a,b)=>String(b.event.time).localeCompare(String(a.event.time))).slice(0,5);
      target.innerHTML=entries.length?'<details open><summary>最近变更</summary><ol>'+entries.map(({task,event})=>{const supplier=workspace().suppliers.find(item=>item.id===task.supplierId);return '<li><span>'+esc(api.shortTime?.(event.time)||event.time||'—')+' · '+esc(event.actor||'—')+'</span><b>'+esc(supplier?.shortName||supplier?.name||task.supplierId)+' · '+esc(task.po||'—')+'</b><span>采购数量 '+event.changes.before+' → '+event.changes.after+' CTN</span></li>';}).join('')+'</ol></details>':'';
    }
    function update(){
      if(!state||!document.querySelector('#allocationRows'))return;
      let assigned=0,amount=0,known=true;
      for(const row of state.rows){
        const element=document.querySelector('[data-allocation-row="'+row.key+'"]');if(!element)continue;
        const totalLabel=document.querySelector('[data-allocation-row="'+row.key+'"] [data-allocation-total]');if(totalLabel)totalLabel.textContent='= '+row.qty+' CTN';
        const quantity=Number(row.qty),calc=calculation(row),cost=calc.averageCostCtn;
        const netLabel=element.querySelector('[data-allocation-net]');if(netLabel)netLabel.textContent=money(cost);
        const amountLabel=element.querySelector('[data-allocation-amount]');if(amountLabel)amountLabel.textContent=money(Number.isFinite(cost)?calc.amountCents/100:null);
        const saveControl=element.querySelector('[data-allocation-save]');if(saveControl){const saved=workspace().tasks.find(item=>item.id===row.taskId),clean=saved&&!changed(row,saved),ready=Number.isFinite(cost)&&cost>0;saveControl.disabled=state.running||!ready||Boolean(saved?.archived||saved?.salesInvoiceLocked||saved?.salesInvoiceNumber||api.financeLocked?.(row.taskId))||clean;saveControl.textContent=clean?'已保存':'保存这项采购';saveControl.className='allocation-save'+(!clean&&ready?' needs-save':'');const poControl=element.querySelector('[data-allocation-po]');if(poControl){poControl.className='allocation-po '+(saved?.po?'complete':'pending'+(clean?'':' awaiting-save'));poControl.hidden=!saved?.po&&!clean;}}
        if(row.supplierId){assigned+=Number.isSafeInteger(quantity)?quantity:0;if(Number.isFinite(cost))amount+=calc.amountCents/100;else known=false;}
        if(row.auto&&document.activeElement!==element.querySelector('[data-allocation-field="qty"]'))element.querySelector('[data-allocation-field="qty"]').value=row.qty;
        element.hidden=Boolean(row.hidden);
      }
      paintReferences();
      for(const row of state.rows){const extra=document.querySelector('[data-allocation-extra="'+row.key+'"]');if(extra)extra.hidden=assigned<=rootTask().ord;}
      const reasonLabel=document.querySelector('#allocationReasonLabel');if(reasonLabel)reasonLabel.textContent=needsReason(state,workspace())?'原因 *':'原因（选填）';
      const stockNote=document.querySelector('#allocationStockNote');if(stockNote){stockNote.hidden=assigned<=rootTask().ord;stockNote.textContent='预计余货 '+Math.max(0,assigned-rootTask().ord)+' CTN → 库存';}
      document.querySelector('#allocationSummary').innerHTML='<span>草稿预览 · 已安排 <b>'+assigned+' CTN</b> · 待安排 <b>'+Math.max(0,rootTask().ord-assigned)+' CTN</b>'+(assigned>rootTask().ord?' · 额外库存 <b>'+(assigned-rootTask().ord)+' CTN</b>':'')+'</span><span class="allocation-summary-amount">合计 MYR <strong>'+esc(known?money(amount):'—')+'</strong></span>';
    }
    function edit(event){
      if(!state||state.running||state.current||api.savePending()||!api.modal().classList.contains('supplier-allocation-dialog'))return false;
      const field=event.target;
      if(field.id==='allocationReason'){state.reason=field.value;state.dirty=true;api.cache();return true;}
      const rowKey=field.closest?.('[data-allocation-row]')?.dataset.allocationRow;
      const key=rowKey||field.dataset.allocationConfirm||field.dataset.allocationExtraKind||field.dataset.allocationExtraConfirm;
      const row=state.rows.find(item=>item.key===key);if(!row)return false;
      if(rowLocked(row))return true;
      const name=field.dataset.allocationField;if(name)row.pendingReference=null;
      if(name==='supplierId'){row.supplierId=field.value;row.reference=null;row.manual=[];row.edited=[];for(const price of priceKeys){row.raw[price]='0.00';row.originalRaw[price]='0.00';row.originalPrices[price]=price.startsWith('disc')?0:null;}row.mode='NORMAL';row.moneySource='PRICES';row.free='0';row.amount='';}
      else if(name==='qty'){row.qty=field.value;row.auto=false;}
      else if(name==='mode'){if(field.value==='NORMAL'&&row.mode==='FOC'&&!api.confirm('全部 '+row.qty+' CTN 改为付费采购？')){field.value=row.mode;return true;}row.mode=field.value;row.paid=row.qty;row.free='0';row.auto=false;}
      else if(name==='moneySource'){row.moneySource=field.value;if(row.moneySource==='TOTAL'&&row.amount===''){const computed=calculation({...row,moneySource:'PRICES'});row.amount=Number.isFinite(computed.amountCents)?(computed.amountCents/100).toFixed(2):'';}}
      else if(name==='paid'||name==='free'){row[name]=field.value;row.qty=String(Number(row.paid)+Number(row.free));row.auto=false;}
      else if(name==='amount')row.amount=field.value;
      else if(priceKeys.includes(name)){row.raw[name]=field.value;row.edited=row.edited||[];if(!row.manual.includes(name))row.manual.push(name);if(!row.edited.includes(name))row.edited.push(name);if(['lpPc','lpCtn'].includes(name)){const ea=rootTask().ea,paired=name==='lpPc'?'lpCtn':'lpPc';if(ea>0){const precise=name==='lpPc'?Number(field.value)*ea:Number(field.value)/ea;row.raw[paired]=displayPrice(precise,paired);row.originalRaw[paired]=row.raw[paired];row.originalPrices[paired]=precise;row.manual.push(paired);row.edited.push(paired);const pairedField=document.querySelector('[data-allocation-row="'+row.key+'"] [data-allocation-field="'+paired+'"]');if(pairedField)pairedField.value=Number(row.raw[paired]).toFixed(2);}}}
      else if(field.dataset.allocationExtraKind)row.extraKind=field.value;
      row.status='draft';state.dirty=true;const count=state.rows.length;remainingRow();if(['supplierId','mode','moneySource'].includes(name)){renderRows();api.cache();return true;}if(state.rows.length!==count){document.querySelector('#allocationRows').insertAdjacentHTML('beforeend',rowMarkup(state.rows.at(-1),state.rows.length-1));}const totalField=document.querySelector('[data-allocation-row="'+row.key+'"] [data-allocation-field="qty"]');if(row.mode==='FOC'&&totalField)totalField.value=row.qty;update();api.cache();return true;
    }
    function format(event){
      const field=event.target,name=field.dataset?.allocationField,key=field.closest?.('[data-allocation-row]')?.dataset.allocationRow,row=state?.rows.find(item=>item.key===key);
      if(!row||rowLocked(row)||!priceKeys.includes(name)||!field.value.trim()||state.running||state.current||api.savePending())return;
      const value=values(row)[name];if(!Number.isFinite(value))return;
      const formatted=displayPrice(value,name);row.raw[name]=formatted;row.originalRaw[name]=formatted;row.originalPrices[name]=value;field.value=formatted;api.cache();
    }
    function keyDown(event){
      const field=event.target,name=field.dataset?.allocationField;
      if(!state||!name||field.tagName!=='INPUT'||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||!['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
      const fields=[...document.querySelectorAll('#allocationRows input[data-allocation-field]')].filter(input=>!input.disabled&&!input.readOnly&&input.getClientRects().length),index=fields.indexOf(field);if(index<0)return;
      const vertical=['ArrowUp','ArrowDown'].includes(event.key),direction=event.key==='ArrowUp'||event.key==='ArrowLeft'||event.key==='Enter'&&event.shiftKey?-1:1;
      const candidates=vertical?fields.filter(input=>input.dataset.allocationField===name):fields,target=candidates[candidates.indexOf(field)+direction];
      event.preventDefault();if(target){target.focus();target.select();}
    }
    function next(){
      if(!state?.running||state.current||api.savePending())return;
      const submitting=submissionState(state,workspace(),state.saveKey),problem=validate(submitting,workspace());if(problem){pause(problem);return;}
      if(submitting.rows.some(row=>row.status!=='saved'&&row.taskId&&changed(row,workspace().tasks.find(item=>item.id===row.taskId))&&api.financeLocked?.(row.taskId))){pause('PO 已提交财务，请先撤回或申请退回。');return;}
      const candidates=state.rows.filter(row=>(!state.saveKey||row.key===state.saveKey)&&row.supplierId&&row.status!=='saved').filter(row=>!row.taskId||changed(row,workspace().tasks.find(item=>item.id===row.taskId)));
      // Decreases first make room for increases and new supplier sources without inventing extra stock.
      candidates.sort((a,b)=>{const rank=row=>!row.taskId?2:Number(row.qty)<(workspace().tasks.find(s=>s.id===row.taskId)?.procurement?.totalCtn||0)?0:1;return rank(a)-rank(b);});
      const row=candidates[0];if(!row){state.running=false;state.dirty=state.rows.some(item=>item.supplierId&&(!item.taskId||changed(item,workspace().tasks.find(saved=>saved.id===item.taskId))));state.issue=state.dirty?'此来源已保存 · 其他草稿保留':'已保存'+(rootTask().ord>state.rows.filter(row=>row.supplierId).reduce((sum,row)=>sum+Number(row.qty),0)?' · 部分安排':'');state.saveKey=null;state.issueTone='complete';state.reopen=false;api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))render();api.status(state.issue);return;}
      const root=rootTask(),rootDraft=state.rows.find(item=>item.taskId===state.rootId),initializeRoot=!row.taskId&&!root.procurement?.revision&&!root.procurement?.totalCtn&&!root.po&&!root.archived&&!root.salesInvoiceLocked&&!root.salesInvoiceNumber&&!root.warehouse&&!(root.inc>0)&&!api.financeLocked?.(root.id)&&!workspace().tasks.some(item=>item.customerDemandTaskId===root.id)&&rootDraft?.version===root.editVersion;
      if(!row.taskId&&!root.procurement?.totalCtn&&!initializeRoot){pause('首个采购来源已有变化或保护记录；草稿保留，请核对后再保存。');return;}
      const saved=workspace().tasks.find(item=>item.id===row.taskId)||(initializeRoot?root:null),taskId=row.taskId||(initializeRoot?root.id:null),input=taskId?{taskId,version:initializeRoot?root.editVersion:row.version,planRevision:saved.procurement?.revision||'',totalCtn:Number(row.qty),reason:state.reason,extraKind:row.extraKind,supplierId:row.supplierId,prices:values(row),draftPlan:!saved.po}:{parentTaskId:state.rootId,version:workspace().sourcesVersion,supplierId:row.supplierId,poNumber:'',draftPlan:true,quantity:Number(row.qty),prices:values(row),reason:state.reason};
      input.costing=calculation(row);
      state.current=row.key;state.issue='正在保存 '+(state.rows.indexOf(row)+1)+'…';api.cache();if(api.modal().open&&api.modal().classList.contains('supplier-allocation-dialog'))render();api.mutate('PURCHASE_SAVE_REQUEST',{operation:taskId?'PLAN':'ADD_SOURCE',input,allocationRowKey:row.key,allocationRootId:state.rootId,...(initializeRoot?{allocationInitializeRoot:true}:{})});
    }
    function pause(message){state.issueTone='problem';state.running=false;state.current=null;state.issue=message;state.reopen=true;api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))render();api.status(message,true);}
    function receipt(completed,result){
      if(!state||completed?.allocationRootId!==state.rootId||completed.allocationRowKey!==state.current)return false;
      const row=state.rows.find(item=>item.key===state.current);
      if(!row)return false;
      if(completed.allocationInitializeRoot){for(const other of state.rows.filter(item=>item!==row&&item.taskId===state.rootId)){other.taskId=null;other.version=null;}row.taskId=state.rootId;}
      if(!row.taskId){if(!result?.sourceTaskId){state.running=false;state.issue='来源已收到成功回执，但缺少来源编号；请核对最新资料，不再重发。';api.cache();return true;}else row.taskId=result.sourceTaskId;}
      row.status='saved';row.auto=false;state.current=null;state.dirty=true;
      if(!api.atOrigin()){state.running=false;state.reopen=false;state.issue='当前来源已确认；其余草稿保留，返回后明确继续应用。';}
      api.cache();return true;
    }
    function receivedWorkspace(){
      if(!state||state.company!==workspace()?.company)return;
      for(const row of state.rows.filter(row=>row.status==='saved')){const saved=workspace().tasks.find(task=>task.id===row.taskId);if(!saved){pause('成功回执的采购来源未读回；停止后续提交，请核对。');return;}if(changed(row,saved)){pause('已确认来源的最新资料与本次提交不一致；停止后续提交，草稿保留。');return;}row.version=saved.editVersion;}
      if(state.saveKey&&!state.current&&state.rows.some(row=>row.key===state.saveKey&&row.status==='saved')){state.running=false;state.saveKey=null;state.dirty=state.rows.some(row=>row.supplierId&&(!row.taskId||changed(row,workspace().tasks.find(saved=>saved.id===row.taskId))));state.issue=state.dirty?'此来源已保存 · 其他草稿保留':'此来源已保存';state.issueTone='complete';api.cache();if(state.reopen&&api.modal().open&&api.modal().classList.contains('supplier-allocation-dialog'))render();state.reopen=false;return;}
      if(state.running){next();return;}
      if(state.reopen&&!api.savePending()){state.reopen=false;if(api.modal().classList.contains('supplier-allocation-dialog'))render();}
    }
    function rejected(current,message,definite){if(state&&current?.allocationRootId===state.rootId){state.running=false;state.issueTone=definite?'problem':'pending';state.issue=message;state.reopen=true;if(definite)state.current=null;api.cache();if(definite&&api.modal().classList.contains('supplier-allocation-dialog'))render();}}
    const referenceContext=row=>JSON.stringify([row.supplierId,row.raw,row.version,row.mode,row.moneySource,row.qty,row.paid,row.free,row.amount]);
    function paintReferences(){
      if(!state||!api.modal().open||!api.modal().classList.contains('supplier-allocation-dialog'))return;
      for(const row of state.rows){const button=document.querySelector('[data-allocation-catch="'+row.key+'"]');if(!button)continue;const done=caughtRows.has(row.key),loading=referenceRequest?.session===referenceSession&&referenceRequest.key===row.key;
        button.disabled=state.running||Boolean(state.current)||api.savePending()||rowLocked(row)||Boolean(referenceRequest)||done;
        button.className='allocation-hand'+(loading?' loading':done?' complete':'');button.title=loading?'正在抓取成本…':done?'成本已填入计算器':'抓取成本';button.setAttribute?.('aria-busy',loading?'true':'false');
        button.innerHTML=loading?'<span class="allocation-cost-spinner" aria-hidden="true"></span>':done?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H3V10zM7 10l5-7c1-1 3 0 3 2l-1 5h5a2 2 0 0 1 2 2l-2 7a3 3 0 0 1-3 2H7"/></svg>':api.handIcon();
      }
    }
    function reference(key){
      const row=state?.rows.find(item=>item.key===key);if(!row||state.running||state.current||api.savePending()||referenceRequest||caughtRows.has(key)||rowLocked(row)||!api.modal().open)return;
      const context=state,session=referenceSession,manual=referenceContext(row),before=calculation(row).averageCostCtn,request={key,session};referenceRequest=request;state.issueTone='pending';state.issue='正在抓取成本，请稍候…';
      const showIssue=()=>{const node=document.querySelector('#allocationIssue');if(node){node.className='allocation-issue '+state.issueTone;node.textContent=state.issue;}};
      showIssue();paintReferences();api.status(state.issue);
      const active=()=>state===context&&referenceSession===session&&api.modal().open&&api.modal().classList.contains('supplier-allocation-dialog');
      Promise.resolve().then(()=>api.read('PURCHASE_REFERENCE_REQUEST',{taskId:context.rootId})).then(result=>{
        if(!active())return;
        const saved=workspace().tasks.find(item=>item.id===row.taskId);
        if(result.company!==context.company||result.taskId!==context.rootId||referenceContext(row)!==manual||state.running||state.current||api.savePending()||rowLocked(row)||saved&&saved.editVersion!==row.version){state.issueTone='pending';state.issue='输入或采购状态已有变化，未套用成本；请重新抓取。';showIssue();return;}
        if(!result.prices||priceKeys.some(name=>!Number.isFinite(result.prices[name])||result.prices[name]<0)||result.prices.disc1>1||result.prices.disc2>1||!(net(result.prices)>0))throw Error('参考价不完整或成本不大于零');
        row.pendingReference={prices:result.prices,at:result.capturedAt,source:'POINTBASE',context:manual};
        applyReference(row);caughtRows.add(key);state.issueTone='complete';state.issue='成本已填入计算器 · 原 Net Cost RM '+money(before)+' → 新 RM '+money(calculation(row).averageCostCtn);showIssue();paintReferences();api.cache();
      }).catch(error=>{if(active()){state.issueTone='problem';state.issue='抓取失败：'+error.message+'；原输入保留，请重试。';showIssue();}}).finally(()=>{if(referenceRequest===request){referenceRequest=null;paintReferences();}});
    }
    function applyReference(row){const ref=row.pendingReference;if(!ref||ref.context!==referenceContext(row)||rowLocked(row))return;for(const name of priceKeys){row.raw[name]=displayPrice(ref.prices[name],name);row.originalRaw[name]=row.raw[name];row.originalPrices[name]=ref.prices[name];}row.moneySource='PRICES';row.reference={at:ref.at,source:ref.source};row.pendingReference=null;row.manual=[];row.edited=[];row.status='draft';state.dirty=true;api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))renderRows();}
    function click(control){
      if(control.dataset.allocationPo){const row=state?.rows.find(item=>item.key===control.dataset.allocationPo);if(!row||state.running||api.savePending())return true;if(!row.taskId||changed(row,workspace().tasks.find(saved=>saved.id===row.taskId))){state.issueTone='pending';document.querySelector('#allocationIssue').className='allocation-issue pending';state.issue='请先保存分单，再输入 PO；当前输入已保留。';document.querySelector('#allocationIssue').textContent=state.issue;return true;}api.openPo?.(row.taskId);return true;}
      if(control.dataset.allocationCatch){reference(control.dataset.allocationCatch);return true;}
      if(control.dataset.allocationSave){if(!state||state.running||state.current||api.savePending())return true;const row=state.rows.find(item=>item.key===control.dataset.allocationSave);if(!row?.supplierId)return true;const problem=validate(submissionState(state,workspace(),row.key),workspace());if(problem){state.issueTone='problem';state.issue=problem;document.querySelector('#allocationIssue').className='allocation-issue problem';document.querySelector('#allocationIssue').textContent=problem;return true;}state.saveKey=row.key;state.running=true;state.reopen=true;next();return true;}
      if(control.id==='applySupplierAllocation'){if(!state||state.running||state.current||api.savePending())return true;state.saveKey=null;const problem=validate(state,workspace());if(problem){state.issueTone='problem';state.issue=problem;document.querySelector('#allocationIssue').className='allocation-issue problem';document.querySelector('#allocationIssue').textContent=problem;return true;}state.running=true;state.reopen=true;next();return true;}
      if(control.id==='discardSupplierAllocation'){if(state&&!state.running&&!api.savePending()&&api.confirm('Cancel unsaved supplier allocation / 取消未提交的供应商草稿？已确认的来源不会撤销。')){state=null;api.cache();api.modal().close();}return true;}
      return false;
    }
    function serialize(){const parked=[...parkedDrafts.values()].filter(item=>item.dirty||item.running).map(item=>copy(item));if(state?.dirty||state?.running)return {...copy(state),parkedDrafts:parked};return parked.length?{company:api.company(),parkedDrafts:parked}:null;}
    function restore(saved){
      if(!saved||saved.company!==api.company())return;
      for(const item of saved.parkedDrafts||[]){if(item.company!==api.company()||!Array.isArray(item.rows)||!item.rootId)continue;const draft=copy(item);draft.running=false;draft.current=null;draft.reopen=true;parkedDrafts.set(draft.rootId,draft);}
      if(Array.isArray(saved.rows)){state=copy(saved);delete state.parkedDrafts;parkedDrafts.delete(state.rootId);state.running=false;state.reopen=true;if(!api.savePending())state.current=null;state.issueTone='pending';state.issue='Draft restored / 草稿已恢复；请核对后明确应用，不自动重发。';}
    }
    return {open,click,edit,format,keyDown,receipt,rejected,receivedWorkspace,serialize,restore,sourceDirty:id=>[state,...parkedDrafts.values()].some(context=>context?.dirty&&context.rows.some(row=>row.taskId===id&&changed(row,workspace().tasks.find(saved=>saved.id===id)))),dirty:()=>Boolean(state?.dirty||state?.running||[...parkedDrafts.values()].some(item=>item.dirty||item.running))};
  }
  window.purchaseSupplierAllocation={create,validate,values,net,rowDraft,changed,calculation};
})();
