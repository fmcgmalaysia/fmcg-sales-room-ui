/* Supplier planning dialog. Saves use the existing serial PLAN / ADD_SOURCE journal. */
(() => {
  const priceKeys=['lpPc','lpCtn','disc1','disc2','disc3'];
  const displayPrice=(value,key)=>!Number.isFinite(value)||value===0?'0.00':String(key==='disc1'||key==='disc2'?Number((value*100).toPrecision(12)):value);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const net=prices=>priceKeys.every(key=>Number.isFinite(prices[key]))?prices.lpCtn*(1-prices.disc1)*(1-prices.disc2)-prices.disc3:null;
  function values(row){return Object.fromEntries(priceKeys.map(key=>[key,row.originalRaw?.[key]===row.raw[key]&&Number.isFinite(row.originalPrices?.[key])?row.originalPrices[key]:row.originalRaw?.[key]===row.raw[key]&&!row.edited?.includes(key)?NaN:row.raw[key]===''?NaN:Number(row.raw[key])/(key==='disc1'||key==='disc2'?100:1)]));}
  function calculation(row){const prices=values(row),paid=row.mode==='FOC'?Number(row.paid):Number(row.qty),free=row.mode==='FOC'?Number(row.free):0,total=paid+free,cost=net(prices),amountCents=row.moneySource==='TOTAL'?Math.round(Number(row.amount)*100):Number.isFinite(cost)?Math.round(cost*paid*100):NaN;
    return {schema:1,mode:row.mode||'NORMAL',moneySource:row.moneySource||'PRICES',paidCtn:paid,freeCtn:free,totalCtn:total,prices,amountCents,averageCostCtn:total?amountCents/100/total:null,manualFields:row.manual,reference:row.reference||null};}
  const basis=value=>JSON.stringify([value.mode,value.moneySource,value.paidCtn,value.freeCtn,value.prices,value.moneySource==='TOTAL'?value.amountCents:null]);
  function changed(draft,saved){const prices=values(draft),costing=calculation(draft);return !saved?.procurement?.revision||draft.supplierId!==saved.supplierId||Number(draft.qty)!==saved.procurement.totalCtn||(saved.procurement.costing?basis(costing)!==basis(saved.procurement.costing):draft.mode==='FOC'||draft.moneySource==='TOTAL'||priceKeys.some(key=>prices[key]!==saved[key]));}
  function rowDraft(source,key){const costing=source?.procurement?.costing,original=costing?.prices||source||{},raw=Object.fromEntries(priceKeys.map(name=>[name,displayPrice(original[name],name)]));return {key,taskId:source?.id||null,version:source?.editVersion||null,supplierId:source?.supplierId||'',qty:String(source?.procurement?.totalCtn??source?.ord??''),mode:costing?.mode||'NORMAL',moneySource:costing?.moneySource||'PRICES',paid:String(costing?.paidCtn??source?.procurement?.totalCtn??source?.ord??''),free:String(costing?.freeCtn??0),amount:costing?.amountCents!==undefined?(costing.amountCents/100).toFixed(2):'',raw,originalRaw:{...raw},originalPrices:Object.fromEntries(priceKeys.map(name=>[name,Number.isFinite(original[name])?original[name]:name.startsWith('disc')?0:null])),manual:costing?.manualFields?.slice()||source?.manualCostField?.slice()||[],reference:costing?.reference||null,supplierConfirmed:false,extraKind:source?.procurement?.extraKind||'',confirmExtra:false,status:'draft'};}
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
        if(saved.po&&!row.supplierConfirmed)return '请确认已与供应商核对已有 P.O. 的本次变更。';
        if(saved.po&&row.supplierId!==saved.supplierId)return '已有 P.O. 的供应商不能更换。';
      }
      total+=qty;
    }
    if(!chosen&&!state.rows.some(row=>row.status==='saved'))return '请至少安排一家供应商。';
    if(!state.reason.trim())return '请填写 Internal Reason / 内部原因。';
    if(total>parent.ord){
      const extras=state.rows.filter(row=>row.supplierId&&row.confirmExtra);
      if(!extras.length)return '超出客户需求的箱数必须明确确认为赠品或额外采购。';
    }
    return '';
  }
  function create(api){
    let state=null,referenceRequest=null;
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
      if(state&&state.rootId!==root.id&&state.dirty){api.status('另一产品有未提交的供应商草稿；请先应用或明确取消该草稿。',true);return;}
      if(!state||state.rootId!==root.id||!state.dirty&&!state.running){const sources=[root,...data.tasks.filter(row=>row.customerDemandTaskId===root.id)];state={company:data.company,rootId:root.id,counter:0,reason:'',rows:sources.map(row=>rowDraft(row,row.id)),dirty:false,running:false,current:null,issue:'',reopen:true};}
      state.reopen=true;remainingRow();render();api.cache();
    }
    function render(){
      const root=rootTask();if(!root||!state)return;
      const customer=workspace().customers.find(row=>row.id===root.customerId);
      api.dialog('供应商分单',(customer?.shortName||customer?.name||root.customerId)+' · '+(root.transactionCurrency||''),
        '<section class="supplier-allocation"><div class="allocation-product"><div><b>'+esc(root.barcode)+'</b><strong>'+esc(root.name)+'</strong><span>'+esc(root.packing)+' · '+esc(root.estimatedShipmentDate||'—')+'</span></div><div>需求<strong>'+esc(root.ord)+' CTN</strong></div></div><div class="allocation-scroll"><table class="allocation-table"><thead><tr><th></th><th>供应商</th><th>CTN</th>'+[['LP/Pc','MYR'],['LP/Ctn','MYR'],['Disc.1','%'],['Disc.2','%'],['Disc.3','MYR'],['Net Cost','MYR/CTN'],['Catch Cost',''],['Amount','MYR']].map(([label,unit])=>'<th>'+label+'<small>'+unit+'</small></th>').join('')+'</tr></thead><tbody id="allocationRows"></tbody></table></div><div class="allocation-confirmations" id="allocationConfirmations"></div><label class="allocation-reason">原因 *<input id="allocationReason" maxlength="2000" value="'+esc(state.reason)+'"></label><div id="allocationSummary" class="allocation-summary" aria-live="polite"></div><div id="allocationIssue" class="allocation-issue" role="status">'+esc(state.issue)+'</div></section>',
        '<button class="btn" id="discardSupplierAllocation" '+(state.running?'disabled':'')+'>取消</button><button class="btn primary" id="applySupplierAllocation" '+(state.running?'disabled':'')+'>保存</button>','task');
      api.modal().classList.add('supplier-allocation-dialog');renderRows();
    }
    function rowMarkup(row,index){
      const saved=workspace().tasks.find(item=>item.id===row.taskId),locked=state.running||row.status==='saved'||saved?.archived||saved?.salesInvoiceLocked||saved?.salesInvoiceNumber;
      const supplierLocked=locked||saved?.po||saved?.procurement?.revision&&!saved.procurement.draftPlan;
      const person='<span class="allocation-person" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="5" r="3"/><path d="M4 18v-3a6 6 0 0 1 12 0v3z"/></svg><b>'+(index+1)+'</b></span>';
      const supplier='<select data-allocation-field="supplierId" aria-label="Supplier '+(index+1)+'" '+(supplierLocked?'disabled':'')+'><option value="">WAITING</option>'+workspace().suppliers.filter(s=>s.id===row.supplierId||!state.rows.some(other=>other.key!==row.key&&other.supplierId===s.id)).map(s=>'<option value="'+esc(s.id)+'" '+(s.id===row.supplierId?'selected':'')+'>'+esc(s.shortName||s.name)+'</option>').join('')+'</select>'+(saved?.po?'<small data-allocation-status>'+esc(saved.po)+'</small>':'');
      const method=row.supplierId?'<div class="allocation-method"><select data-allocation-field="mode" '+(locked?'disabled':'')+' aria-label="Supplier '+(index+1)+' costing mode"><option value="NORMAL" '+(row.mode!=='FOC'?'selected':'')+'>普通</option><option value="FOC" '+(row.mode==='FOC'?'selected':'')+'>FOC</option></select><select data-allocation-field="moneySource" '+(locked?'disabled':'')+' aria-label="Supplier '+(index+1)+' amount basis"><option value="PRICES" '+(row.moneySource!=='TOTAL'?'selected':'')+'>折扣</option><option value="TOTAL" '+(row.moneySource==='TOTAL'?'selected':'')+'>总额</option></select></div>':'';
      const quantity='<div class="allocation-number"><input type="text" inputmode="numeric" data-allocation-field="qty" value="'+esc(row.qty)+'" '+(locked?'disabled':'')+' '+(!row.supplierId||row.mode==='FOC'?'readonly':'')+' aria-label="Supplier '+(index+1)+' quantity"></div>';
      const prices=row.supplierId?priceKeys.map(key=>'<td><div class="allocation-number"><input type="text" inputmode="decimal" data-allocation-field="'+key+'" value="'+esc(row.raw[key])+'" '+(locked?'disabled':'')+' aria-label="Supplier '+(index+1)+' '+key+'">'+(['disc1','disc2'].includes(key)?'<span>%</span>':'')+'</div></td>').join('')+'<td class="amount"><b data-allocation-net>—</b></td><td class="allocation-catch"><button type="button" class="allocation-hand" data-allocation-catch="'+esc(row.key)+'" '+(locked?'disabled':'')+' aria-label="Catch Cost reference '+(index+1)+'" title="获取参考价">'+api.handIcon()+'</button></td><td class="amount"><b data-allocation-amount>—</b></td>':'<td colspan="8" class="allocation-waiting-space"></td>';
      const input=(field,value,label)=>'<label>'+label+'<input type="text" inputmode="'+(field==='amount'?'decimal':'numeric')+'" data-allocation-field="'+field+'" value="'+esc(value)+'" '+(locked?'disabled':'')+'></label>';
      const detail=row.supplierId&&(row.mode==='FOC'||row.moneySource==='TOTAL')?'<tr data-allocation-row="'+esc(row.key)+'" class="allocation-detail"><td></td><td colspan="10"><div class="allocation-detail-fields">'+(row.mode==='FOC'?input('paid',row.paid,'付费 CTN')+'<span>＋</span>'+input('free',row.free,'FOC CTN')+'':'')+(row.moneySource==='TOTAL'?input('amount',row.amount,'实际总额 MYR'):'')+'</div></td></tr>':'';
      return '<tr data-allocation-row="'+esc(row.key)+'" class="'+(!row.supplierId?'allocation-waiting':'')+'" '+(row.hidden?'hidden':'')+'><td>'+person+'</td><td>'+supplier+method+'</td><td>'+quantity+'</td>'+prices+'</tr>'+detail;
    }
    function renderRows(){
      document.querySelector('#allocationRows').innerHTML=state.rows.map(rowMarkup).join('');
      document.querySelector('#allocationConfirmations').innerHTML=state.rows.filter(row=>row.taskId).map(row=>{const saved=workspace().tasks.find(item=>item.id===row.taskId);return saved?.po?'<label><input type="checkbox" data-allocation-confirm="'+esc(row.key)+'" '+(row.supplierConfirmed?'checked':'')+' '+(state.running?'disabled':'')+'> '+esc(saved.po)+' · 已与供应商确认本次变更</label>':'';}).join('')+'<label id="allocationStockConfirmation" hidden><input type="checkbox" id="allocationStockConfirm" '+(state.rows.filter(row=>row.supplierId).every(row=>row.confirmExtra)?'checked':'')+' '+(state.running?'disabled':'')+'> 余货留库存 · 客户需求不变</label>';update();
    }
    function update(){
      if(!state||!document.querySelector('#allocationRows'))return;
      let assigned=0,amount=0,known=true;
      for(const row of state.rows){
        const element=document.querySelector('[data-allocation-row="'+row.key+'"]');if(!element)continue;
        const quantity=Number(row.qty),calc=calculation(row),cost=calc.averageCostCtn;
        const netLabel=element.querySelector('[data-allocation-net]');if(netLabel)netLabel.textContent=money(cost);
        const amountLabel=element.querySelector('[data-allocation-amount]');if(amountLabel)amountLabel.textContent=money(Number.isFinite(cost)?calc.amountCents/100:null);
        if(row.supplierId){assigned+=Number.isSafeInteger(quantity)?quantity:0;if(Number.isFinite(cost))amount+=calc.amountCents/100;else known=false;}
        if(row.auto&&document.activeElement!==element.querySelector('[data-allocation-field="qty"]'))element.querySelector('[data-allocation-field="qty"]').value=row.qty;
        element.hidden=Boolean(row.hidden);
      }
      for(const row of state.rows){const extra=document.querySelector('[data-allocation-extra="'+row.key+'"]');if(extra)extra.hidden=assigned<=rootTask().ord;}
      const stockConfirmation=document.querySelector('#allocationStockConfirmation');if(stockConfirmation)stockConfirmation.hidden=assigned<=rootTask().ord;
      document.querySelector('#allocationSummary').textContent='已安排 '+assigned+' CTN · 待安排 '+Math.max(0,rootTask().ord-assigned)+' CTN · '+(assigned>rootTask().ord?'额外库存 '+(assigned-rootTask().ord)+' CTN · ':'')+'MYR '+(known?money(amount):'—');
    }
    function edit(event){
      if(!state||state.running||!api.modal().classList.contains('supplier-allocation-dialog'))return false;
      const field=event.target;
      if(field.id==='allocationReason'){state.reason=field.value;state.dirty=true;api.cache();return true;}
      if(field.id==='allocationStockConfirm'){state.rows.forEach(row=>row.confirmExtra=field.checked);state.dirty=true;api.cache();return true;}
      const rowKey=field.closest?.('[data-allocation-row]')?.dataset.allocationRow;
      const key=rowKey||field.dataset.allocationConfirm||field.dataset.allocationExtraKind||field.dataset.allocationExtraConfirm;
      const row=state.rows.find(item=>item.key===key);if(!row)return false;
      const name=field.dataset.allocationField;
      if(name==='supplierId'){row.supplierId=field.value;row.reference=null;row.manual=[];row.edited=[];for(const price of ['lpPc','lpCtn']){row.raw[price]='0.00';row.originalRaw[price]='0.00';row.originalPrices[price]=null;}row.mode='NORMAL';row.moneySource='PRICES';row.free='0';row.amount='';}
      else if(name==='qty'){row.qty=field.value;row.auto=false;}
      else if(name==='mode'){if(field.value==='NORMAL'&&row.mode==='FOC'&&!api.confirm('全部 '+row.qty+' CTN 改为付费采购？')){field.value=row.mode;return true;}row.mode=field.value;row.paid=row.qty;row.free='0';row.auto=false;}
      else if(name==='moneySource'){row.moneySource=field.value;if(row.moneySource==='TOTAL'&&row.amount===''){const computed=calculation({...row,moneySource:'PRICES'});row.amount=Number.isFinite(computed.amountCents)?(computed.amountCents/100).toFixed(2):'';}}
      else if(name==='paid'||name==='free'){row[name]=field.value;row.qty=String(Number(row.paid)+Number(row.free));row.auto=false;}
      else if(name==='amount')row.amount=field.value;
      else if(priceKeys.includes(name)){row.raw[name]=field.value;row.edited=row.edited||[];if(!row.manual.includes(name))row.manual.push(name);if(!row.edited.includes(name))row.edited.push(name);if(['lpPc','lpCtn'].includes(name)){const ea=rootTask().ea,paired=name==='lpPc'?'lpCtn':'lpPc';if(ea>0){row.raw[paired]=String(name==='lpPc'?Number(field.value)*ea:Number(field.value)/ea);row.manual.push(paired);row.edited.push(paired);}}}
      else if(field.dataset.allocationConfirm)row.supplierConfirmed=field.checked;
      else if(field.dataset.allocationExtraKind)row.extraKind=field.value;
      else if(field.dataset.allocationExtraConfirm)row.confirmExtra=field.checked;
      state.dirty=true;const count=state.rows.length;remainingRow();if(['supplierId','mode','moneySource'].includes(name)){renderRows();api.cache();return true;}if(state.rows.length!==count){document.querySelector('#allocationRows').insertAdjacentHTML('beforeend',rowMarkup(state.rows.at(-1),state.rows.length-1));}const totalField=document.querySelector('[data-allocation-row="'+row.key+'"] [data-allocation-field="qty"]');if(row.mode==='FOC'&&totalField)totalField.value=row.qty;update();api.cache();return true;
    }
    function next(){
      if(!state?.running||state.current||api.savePending())return;
      const problem=validate(state,workspace());if(problem){pause(problem);return;}
      const candidates=state.rows.filter(row=>row.supplierId&&row.status!=='saved').filter(row=>!row.taskId||changed(row,workspace().tasks.find(item=>item.id===row.taskId)));
      // Decreases first make room for increases and new supplier sources without inventing extra stock.
      candidates.sort((a,b)=>{const rank=row=>!row.taskId?2:Number(row.qty)<(workspace().tasks.find(s=>s.id===row.taskId)?.procurement?.totalCtn||0)?0:1;return rank(a)-rank(b);});
      const row=candidates[0];if(!row){state.running=false;state.dirty=false;state.issue='已保存'+(rootTask().ord>state.rows.filter(row=>row.supplierId).reduce((sum,row)=>sum+Number(row.qty),0)?' · 部分安排':'');state.reopen=false;api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))render();api.status(state.issue);return;}
      const saved=workspace().tasks.find(item=>item.id===row.taskId),input=row.taskId?{taskId:row.taskId,version:row.version,planRevision:saved.procurement?.revision||'',totalCtn:Number(row.qty),reason:state.reason,extraKind:row.extraKind,confirmExtra:row.confirmExtra,supplierConfirmed:row.supplierConfirmed,supplierId:row.supplierId,prices:values(row),draftPlan:!saved.po}:{parentTaskId:state.rootId,version:workspace().sourcesVersion,supplierId:row.supplierId,poNumber:'',draftPlan:true,quantity:Number(row.qty),prices:values(row),reason:state.reason};
      input.costing=calculation(row);input.confirmExtra=row.confirmExtra;
      state.current=row.key;state.issue='正在保存 '+(state.rows.indexOf(row)+1)+'…';api.cache();if(api.modal().open&&api.modal().classList.contains('supplier-allocation-dialog'))render();api.mutate('PURCHASE_SAVE_REQUEST',{operation:row.taskId?'PLAN':'ADD_SOURCE',input,allocationRowKey:row.key,allocationRootId:state.rootId});
    }
    function pause(message){state.running=false;state.current=null;state.issue=message;state.reopen=true;api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))render();api.status(message,true);}
    function receipt(completed,result){
      if(!state||completed?.allocationRootId!==state.rootId||completed.allocationRowKey!==state.current)return false;
      const row=state.rows.find(item=>item.key===state.current);
      if(!row)return false;
      if(!row.taskId){if(!result?.sourceTaskId){state.running=false;state.issue='来源已收到成功回执，但缺少来源编号；请核对最新资料，不再重发。';}else row.taskId=result.sourceTaskId;}
      row.status='saved';row.auto=false;state.current=null;state.dirty=true;
      if(!api.atOrigin()){state.running=false;state.reopen=false;state.issue='当前来源已确认；其余草稿保留，返回后明确继续应用。';}
      api.cache();return true;
    }
    function receivedWorkspace(){
      if(!state||state.company!==workspace()?.company)return;
      for(const row of state.rows.filter(row=>row.status==='saved')){const saved=workspace().tasks.find(task=>task.id===row.taskId);if(!saved){pause('成功回执的采购来源未读回；停止后续提交，请核对。');return;}if(changed(row,saved)){pause('已确认来源的最新资料与本次提交不一致；停止后续提交，草稿保留。');return;}row.version=saved.editVersion;}
      if(state.running){next();return;}
      if(state.reopen&&!api.savePending()){state.reopen=false;if(api.modal().classList.contains('supplier-allocation-dialog'))render();}
    }
    function rejected(current,message,definite){if(state&&current?.allocationRootId===state.rootId){state.running=false;state.issue=message;state.reopen=true;if(definite)state.current=null;api.cache();if(definite&&api.modal().classList.contains('supplier-allocation-dialog'))render();}}
    function reference(key){
      const row=state.rows.find(item=>item.key===key);if(!row||state.running||referenceRequest)return;
      const context=state,manual=JSON.stringify([row.supplierId,row.raw,row.version]);referenceRequest=key;
      api.status('正在读取 POINTBASE 参考价；采购安排尚未提交。');
      api.read('PURCHASE_REFERENCE_REQUEST',{taskId:state.rootId}).then(result=>{
        const saved=workspace().tasks.find(item=>item.id===row.taskId);
        if(state!==context||result.company!==context.company||result.taskId!==context.rootId||JSON.stringify([row.supplierId,row.raw,row.version])!==manual||saved&&(saved.editVersion!==row.version||saved.archived||saved.salesInvoiceLocked||saved.financeSubmitted))return;
        if(!result.prices||priceKeys.some(name=>!Number.isFinite(result.prices[name])||result.prices[name]<0)||result.prices.disc1>1||result.prices.disc2>1||net(result.prices)<0)throw Error('参考价不完整');
        row.pendingReference={prices:result.prices,at:result.capturedAt,source:'POINTBASE'};
        if(row.manual.length||saved?.procurement?.revision){state.issue='参考价 '+money(net(result.prices))+' / CTN';api.cache();if(document.querySelector('#allocationIssue'))document.querySelector('#allocationIssue').innerHTML=esc(state.issue)+' <button type="button" class="btn" data-allocation-use-reference="'+esc(row.key)+'">使用参考价</button>';}
        else applyReference(row);
      }).catch(error=>{if(state===context){state.issue='参考价读取失败：'+error.message+'；原输入保留。';if(document.querySelector('#allocationIssue'))document.querySelector('#allocationIssue').textContent=state.issue;}}).finally(()=>{referenceRequest=null;});
    }
    function applyReference(row){const ref=row.pendingReference;if(!ref)return;for(const name of priceKeys){row.raw[name]=displayPrice(ref.prices[name],name);row.originalRaw[name]=row.raw[name];row.originalPrices[name]=ref.prices[name];}row.reference={at:ref.at,source:ref.source};row.pendingReference=null;row.manual=[];row.edited=[];state.dirty=true;state.issue='';api.cache();if(api.modal().classList.contains('supplier-allocation-dialog'))renderRows();}
    function click(control){
      if(control.dataset.allocationUseReference){const row=state.rows.find(item=>item.key===control.dataset.allocationUseReference);const saved=workspace().tasks.find(item=>item.id===row?.taskId);if(row&&!state.running&&(!saved||saved.editVersion===row.version&&!saved.archived&&!saved.salesInvoiceLocked&&!saved.financeSubmitted))applyReference(row);return true;}
      if(control.dataset.allocationCatch){reference(control.dataset.allocationCatch);return true;}
      if(control.id==='applySupplierAllocation'){if(!state||state.running||api.savePending())return true;const problem=validate(state,workspace());if(problem){state.issue=problem;document.querySelector('#allocationIssue').textContent=problem;return true;}state.running=true;state.reopen=true;next();return true;}
      if(control.id==='discardSupplierAllocation'){if(state&&!state.running&&!api.savePending()&&api.confirm('Cancel unsaved supplier allocation / 取消未提交的供应商草稿？已确认的来源不会撤销。')){state=null;api.cache();api.modal().close();}return true;}
      return false;
    }
    return {open,click,edit,receipt,rejected,receivedWorkspace,serialize:()=>state?.dirty||state?.running?copy(state):null,restore:saved=>{if(saved&&saved.company===api.company()&&Array.isArray(saved.rows)){state=copy(saved);state.running=false;state.reopen=true;if(!api.savePending())state.current=null;state.issue='Draft restored / 草稿已恢复；请核对后明确应用，不自动重发。';}},dirty:()=>Boolean(state?.dirty||state?.running)};
  }
  window.purchaseSupplierAllocation={create,validate,values,net,rowDraft,changed,calculation};
})();
