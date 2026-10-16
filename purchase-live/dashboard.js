/* Dashboard presentation only. Task actions stay with the existing Purchase handlers. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bi=(en,zh)=>'<span class="pd-bi"><span>'+esc(en)+'</span><small lang="zh-CN">'+esc(zh)+'</small></span>';
  const phrase=text=>{const parts=String(text||'').split(' / ');return parts.length>1?bi(parts.shift(),parts.join(' / ')):esc(text);};
  const owners={PURCHASE:['Purchase','采购'],ACCOUNT:['Account','财务'],WAREHOUSE:['Warehouse','货仓'],SALES:['Sales','销售'],ADMIN:['Admin','管理员']};
  function factStates(task,orders){return {po:task.po?'complete':'pending',receiving:window.purchaseTaskGrid.progressStates([task],orders)[3]};}
  function model(data,orders=[],category='all',query=''){
    const signals=window.masterTaskSignals?.project?.('PURCHASE',{tasks:data.tasks,orders})||{entries:[],categories:[]},groups=new Map();
    signals.entries.forEach((entry,index)=>{
      if(category!=='all'&&category!==entry.category)return;
      let group=groups.get(entry.id);
      if(!group){group={id:entry.id,entries:[],task:data.tasks.find(row=>row.id===entry.id),po:orders.find(row=>row.id===entry.id)};groups.set(entry.id,group);}
      if(!group.entries.some(item=>item.action===entry.action&&item.reason===entry.reason&&item.owner===entry.owner))group.entries.push({...entry,index});
    });
    const names=group=>[group.task?.barcode,group.task?.name,group.task?.po,group.po?.number,group.po?.supplierName,group.po?.customerName,data.suppliers.find(row=>row.id===group.task?.supplierId)?.name,data.customers.find(row=>row.id===group.task?.customerId)?.name,...group.entries.flatMap(item=>[item.title,item.reason,item.owner])].join(' ').toLowerCase();
    return {...signals,groups:[...groups.values()].filter(group=>names(group).includes(query.trim().toLowerCase()))};
  }
  const problemEntry=entry=>entry.category==='urgent'||entry.action==='stock'||entry.action.startsWith('quantity-case:')&&entry.reason.startsWith('Receiving issue');
  const issueGroup=group=>group.entries.some(problemEntry)||Boolean(group.task?.warehouse?.issue);
  const localDay=now=>new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
  const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&formatShipmentDate(value)!==value;
  function actionableEntry(entry,group,orders,today){
    if(entry.action==='edit'&&entry.category==='partial')return false;
    if(entry.action==='edit'&&entry.category==='blocked'&&entry.owner==='WAREHOUSE')return Boolean(validDay(group.task?.estimatedShipmentDate)&&group.task.estimatedShipmentDate<today&&factStates(group.task,orders).receiving==='pending');
    return true;
  }
  const entryRank=entry=>problemEntry(entry)?0:entry.action.startsWith('quantity-case:')?1:entry.action==='payment-proof'?2:entry.action==='allocate'?3:entry.owner==='PURCHASE'?4:5;
  function actionLabel(entry,group){
    const task=group.task;
    if(entry.action==='dashboard-receiving')return supplierAlertReasons(task)[0];
    if(entry.action.startsWith('quantity-case:')){const item=task?.quantityCases?.find(item=>item.id===entry.action.slice(14));if(item?.kind==='RECEIPT'&&Number.isSafeInteger(item.quantity)&&item.quantity>0)return 'Short received · '+item.quantity+' CTN / 少收货 · '+item.quantity+' CTN';}
    if(entry.action==='edit'&&entry.category==='todo')return !task?.supplierId?'Assign supplier / 指定供应商':task.procurement?.revision?'Create P.O. / 开采购单':'Confirm purchase plan / 确认采购方案';
    if(entry.action==='edit'&&entry.owner==='WAREHOUSE')return 'Target shipment date passed; receipt pending / 已过预计发货日，待货仓确认收货';
    if(entry.action==='payment-proof')return 'Review payment proof / 查看并确认付款证明';
    if(entry.action==='allocate')return 'Allocate received stock / 分配已收到的货物';
    return entry.reason;
  }
  function actionTarget(entry,group){
    const id=esc(group.task?.id);
    if(entry.action==='edit'&&entry.category==='todo')return group.task?.supplierId&&group.task.procurement?.revision?'data-source-po-task="'+id+'"':'data-plan-task="'+id+'"';
    if(entry.action==='dashboard-receiving'||entry.action==='edit'&&entry.owner==='WAREHOUSE')return 'data-progress-task="'+id+'" data-progress-index="3" data-progress-is-source="true"';
    return 'data-dashboard-action="'+entry.index+'"';
  }
  // Existing signal facts feed the Dashboard only; original callback indices stay intact.
  function workQueues(data,orders=[],category='all',query='',now=Date.now()){
    const raw=model(data,orders,'all',query),today=localDay(now);
    const pool=[...raw.groups];
    for(const task of data.tasks.filter(task=>!task.archived&&task.warehouse?.issue&&[task.barcode,task.name,task.po].join(' ').toLowerCase().includes(query.trim().toLowerCase())))if(!pool.some(group=>group.id===task.id))pool.push({id:task.id,task,entries:[]});
    const groups=pool.map(group=>{const entries=group.entries.filter(entry=>actionableEntry(entry,group,orders,today));if(group.task?.warehouse?.issue&&!entries.some(problemEntry))entries.push({id:group.id,category:'urgent',title:group.task.name,owner:'WAREHOUSE',action:'dashboard-receiving',reason:'Receiving issue / 收货异常'});return {...group,entries};}).filter(group=>group.entries.length).map(group=>({...group,primary:[...group.entries].sort((a,b)=>entryRank(a)-entryRank(b)||a.index-b.index)[0]}));
    groups.sort((a,b)=>Number(issueGroup(b))-Number(issueGroup(a))||(validDay(a.task?.estimatedShipmentDate)?a.task.estimatedShipmentDate:'9999').localeCompare(validDay(b.task?.estimatedShipmentDate)?b.task.estimatedShipmentDate:'9999')||(Date.parse(a.task?.masterReceivedAt||a.po?.createdAt)||Infinity)-(Date.parse(b.task?.masterReceivedAt||b.po?.createdAt)||Infinity)||a.id.localeCompare(b.id));
    const bucket=group=>issueGroup(group)?'issues':group.entries.some(entry=>entry.owner==='PURCHASE')?'mine':'waiting';
    const definitions=[['issues','Issues / 必须解决'],['mine','My actions / 待我处理'],['waiting','Waiting on others / 等待其他部门']];
    const categories=definitions.map(([key,label])=>({key,label,count:groups.filter(group=>bucket(group)===key).length}));
    return {...raw,entries:groups.flatMap(group=>group.entries),categories,groups:groups.filter(group=>category==='all'||bucket(group)===category)};
  }
  function render({data,orders=[],category='all',query='',selectedId='',companyName,customers,suppliers,lowGp=0,poLoading=false,poError=''}){
    const projected=workQueues(data,orders,category,query),selected=projected.groups.find(row=>row.id===selectedId),active=data.tasks.filter(row=>!row.archived);
    const supplier=task=>data.suppliers.find(row=>row.id===task?.supplierId)?.shortName||data.suppliers.find(row=>row.id===task?.supplierId)?.name||'—';
    const customer=task=>data.customers.find(row=>row.id===task?.customerId)?.shortName||data.customers.find(row=>row.id===task?.customerId)?.name||'—';
    const quantity=value=>Number.isSafeInteger(value)?value.toLocaleString('en-MY'):'—';
    const issue=issueGroup;
    const reason=entry=>'<button class="pd-reason '+(problemEntry(entry)?'pd-problem':'pd-pending')+'" '+actionTarget(entry,selected)+'>'+phrase(actionLabel(entry,selected))+'<span class="pd-owner">'+phrase((owners[entry.owner]||[entry.owner]).join(' / '))+'<span aria-hidden="true"> →</span></span></button>';
    const facts=(en,zh,value)=>'<div><dt>'+bi(en,zh)+'</dt><dd>'+value+'</dd></div>';
    const task=selected?.task,po=selected?.po;
    const states=task?factStates(task,orders):null;
    const poFact=task?'<button class="pd-fact pd-'+states.po+'" '+(task.po?'data-po-view':task.procurement?.revision?'data-source-po-task':'data-plan-task')+'="'+esc(task.id)+'" aria-description="'+(task.po?'P.O. linked 已关联采购单':'Enter P.O. 填写采购单')+'">'+(task.po?'✓ '+esc(task.po):bi('Enter P.O.','待输入采购单'))+'</button>':po?.number?'<span class="pd-fact pd-complete" aria-description="P.O. linked 已关联采购单">✓ '+esc(po.number)+'</span>':'—';
    const receiptFact=task?'<button class="pd-fact pd-'+states.receiving+'" data-progress-task="'+esc(task.id)+'" data-progress-index="3" data-progress-is-source="true" aria-description="Receiving status 查看收货事项">'+bi(quantity(task.warehouse?.accepted??task.inc)+' CTN · '+({complete:'Confirmed',problem:'Issue',pending:'Pending'})[states.receiving],({complete:'收货事项已确认',problem:'收货异常待解决',pending:'等待收货／核对'})[states.receiving])+'</button>':'';
    const details=selected?'<div class="pd-identity"><span>'+esc(task?.barcode||po?.number||'Stock')+'</span><strong>'+esc(task?.name||po?.supplierName||selected.entries[0].title)+'</strong><span>'+esc(task?.packing||'')+'</span></div><dl>'+facts('Supplier','供应商',esc(po?.supplierName||supplier(task)))+facts('Customer','客户',esc(po?.customerName||customer(task)))+facts('Our P.O.','采购单',poFact)+(task?facts('Ordered','采购箱数',quantity(task.procurement?.totalCtn)+' CTN')+facts('Received','实收箱数',receiptFact):'')+'</dl><h3>'+bi('Required actions','需要处理')+'</h3><div class="pd-reasons">'+selected.entries.map(reason).join('')+'</div>'+(task?'<button class="pd-open" data-dashboard-entry="true" data-customer="'+esc(task.customerId)+'">'+bi('Open Active Orders →','查看客户采购任务')+'</button>':''):'<div class="pd-empty">'+bi('No matching pending work','暂无符合条件的待办')+'</div>';
    const filters=[{key:'all',label:'All / 全部',count:new Set(projected.entries.map(entry=>entry.id)).size},...projected.categories];
    return '<section class="purchase-dashboard" aria-label="Purchase Dashboard"><div class="pd-heading"><h1>'+bi('Purchase Dashboard','采购工作台')+'</h1></div><div class="pd-filters" role="group" aria-label="Task categories 任务分类">'+filters.map(item=>'<button data-dashboard-category="'+item.key+'" aria-pressed="'+(category===item.key)+'" class="'+(category===item.key?'active ':'')+(item.count?(item.key==='issues'?'pd-problem':'pd-pending'):'')+'">'+phrase(item.label)+'<b>'+item.count+'</b></button>').join('')+'</div><div class="pd-layout '+(selected?'pd-has-selection':'pd-no-selection')+'"><div class="pd-left"><section class="pd-panel pd-queue"><div class="pd-queue-scroll"><table><colgroup><col style="width:29%"><col style="width:30%"><col style="width:19%"><col style="width:12%"><col style="width:10%"></colgroup><thead><tr><th>'+bi('Action required','需要处理')+'</th><th>'+bi('Product / P.O.','产品／采购单')+'</th><th>'+bi('Supplier · Customer','供应商 · 客户')+'</th><th>'+bi('Target shipment','预计发货')+'</th><th>'+bi('Open','进入')+'</th></tr></thead><tbody>'+projected.groups.map(group=>{const first=group.primary,owner=owners[first.owner]||[first.owner,''],parts=actionLabel(first,group).split(' / '),english=parts.shift(),secondary=[parts.join(' / '),owner.filter(Boolean).join(' ')].filter(Boolean).join(' · '),state=issue(group)?'pd-problem':'pd-pending',target=actionTarget(first,group);return '<tr class="'+(group===selected?'pd-selected':'')+'"><td><div class="pd-action-summary"><i class="'+state+'" aria-hidden="true"></i><div><strong aria-description="'+esc(english)+'">'+esc(english)+'</strong><small aria-description="'+esc(secondary)+'">'+esc(secondary)+'</small></div></div></td><td><button class="pd-select" data-dashboard-select="'+esc(group.id)+'"><span><small>'+esc(group.task?.barcode||group.po?.number||'Stock')+'</small><strong aria-description="'+esc(group.task?.name||group.po?.supplierName||first.title)+'">'+esc(group.task?.name||group.po?.supplierName||first.title)+'</strong><small>'+esc(group.task?.packing||'')+'</small></span></button></td><td><b>'+esc(group.po?.supplierShortName||supplier(group.task))+'</b><small>'+esc(group.po?.customerName||customer(group.task))+'</small></td><td class="pd-target-date">'+(validDay(group.task?.estimatedShipmentDate)?esc(formatShipmentDate(group.task.estimatedShipmentDate)):'—')+'</td><td><button class="pd-action-button '+state+'" '+target+' aria-label="'+esc(actionLabel(first,group).split(' / ')[0])+'"><span>'+(first.owner==='PURCHASE'?'Handle':'View')+'</span><span class="pd-button-arrow" aria-hidden="true">→</span></button></td></tr>';}).join('')+(projected.groups.length?'':'<tr><td colspan="5" class="pd-empty">'+bi('No action required in this view','当前分类没有需要处理的事项')+'</td></tr>')+'</tbody></table></div><div class="pd-note">'+bi('Issues first · Earlier shipment first · Oldest order first','异常优先 · 发货日早优先 · 收单早优先')+(poLoading?bi('Loading P.O. context…','正在读取采购单信息…'):poError?'<span class="pd-problem-text">'+bi('P.O. context unavailable; task list retained','采购单信息未读到，任务列表保留')+'<button id="retryPurchaseOrders">'+bi('Retry','重试')+'</button></span>':'')+'</div></section><div class="pd-directories"><section class="pd-panel"><div class="pd-tools"><input id="dashboardCustomerSearch" placeholder="Search customer 搜索客户" aria-label="Search customer"></div><div class="pd-directory-scroll">'+customers+'</div><div class="pd-footer"><span id="customerResultCount">'+data.customers.length+' customers 客户</span></div></section><section class="pd-panel"><div class="pd-tools"><input id="supplierSearch" placeholder="Supplier / brand · 搜索供应商／品牌" aria-label="Search supplier or brand"><button class="pd-add" id="addSupplier" aria-label="Add supplier"><span class="pd-add-label">+ Add supplier</span><svg class="pd-add-icon" viewBox="0 0 28 24" aria-hidden="true"><circle cx="11" cy="6" r="4"/><path d="M18 13.5a9 9 0 0 0-16 5.7c0 2.1 6 3 11.5 2.5"/><circle cx="21" cy="17.5" r="5"/><path d="M21 15v5m-2.5-2.5h5"/></svg></button></div><div class="pd-directory-scroll">'+suppliers+'</div><div class="pd-footer"><span id="supplierResultCount">'+data.suppliers.length+' suppliers 供应商</span>'+bi('Shared by NCT & GHR','两家公司共用')+'</div></section></div></div>'+(selected?'<aside class="pd-panel pd-context" aria-label="Selected work item 选中工作事项"><div class="pd-panel-title"><h2>'+bi('Work details','待办详情')+'</h2>'+(selected?'<span class="pd-state '+(issue(selected)?'pd-problem':'pd-pending')+'">'+bi(issue(selected)?'Issue':'Pending',issue(selected)?'待解决':'待处理')+'</span>':'')+'<button class="pd-close" data-dashboard-close="true" aria-label="Close details 关闭详情">×</button></div><div class="pd-context-body">'+details+'</div></aside>':'')+'</div></section>';
  }
  function supplierAlertSources(tasks){
    return tasks.filter(task=>!task.archived&&!(task.progressFacts?.sourceRequired>0&&task.progressFacts.sourceDispatchedQty===task.progressFacts.sourceRequired)).map(task=>{
      const cases=(task.quantityCases||[]).filter(item=>item.status!=='RESOLVED'&&(item.blocks||[]).includes('DISPATCH'));
      const stock=(task.warehouse?.stock?.cases||[]).some(item=>item.status!=='RESOLVED');
      const receipt=Boolean(task.warehouse?.issue||stock);
      return {task,cases,receipt,stage:receipt?3:6};
    }).filter(item=>item.receipt||item.cases.length);
  }
  const bell='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4M12 2v1"/><path d="M2 6 1 9m21-3 1 3"/></svg>';
  function supplierAlertBadge(tasks,supplierId){const count=supplierAlertSources(tasks).length;return count?'<button class="pd-shipment-alert" data-supplier-shipment-alert="'+esc(supplierId)+'" aria-label="'+count+' shipment alerts" aria-description="Shipment alerts 发货风险">'+bell+'<b>'+count+'</b></button>':'<span class="zero-risk">—</span>';}
  function supplierAlertReasons(task){
    const reasons=[],qty=value=>Number.isSafeInteger(value)&&value>=0,add=(en,zh,n)=>{const suffix=qty(n)?' · '+n+' CTN':'';reasons.push(en+suffix+' / '+zh+suffix);};
    const open=(task.quantityCases||[]).filter(item=>item.status!=='RESOLVED'),receipt=open.find(item=>item.kind==='RECEIPT'),physical=task.warehouse?.hasPhysicalReceipt===true,planned=task.procurement?.totalCtn,accepted=task.warehouse?.accepted;
    const shortage=receipt&&qty(receipt.quantity)?receipt.quantity:task.warehouse?.issue&&physical&&qty(planned)&&qty(accepted)?Math.max(0,planned-accepted):null;
    if(shortage>0)add('Short received','少收货',shortage);
    const kinds={INTERNAL_DAMAGE:['Internal damage','内部破损'],WRONG_ITEM:['Wrong item','错货'],SHORT_EXPIRY:['Short expiry','临期货']};
    for(const item of (task.warehouse?.stock?.cases||[]).filter(item=>item.status!=='RESOLVED')){
      const label=kinds[item.kind]||['Stock issue — type not recorded','库存异常，未记录类型'];add(label[0],label[1],item.quantity);
      const resolution=item.resolution||{},returned=(resolution.returns||[]).reduce((sum,row)=>sum+(qty(row.quantity)?row.quantity:0),0),replaced=(resolution.replacements||[]).reduce((sum,row)=>sum+(qty(row.quantity)?row.quantity:0),0);
      if(returned>0)add('Returned','已退货',returned);
      if(resolution.decision?.disposition==='RETURN'&&qty(item.quantity)&&returned<item.quantity)add('Return pending','待退货',item.quantity-returned);
      if(replaced>0)add('Replacement received','已收到换货',replaced);
      if(resolution.decision?.value==='REPLACE'&&qty(item.quantity)&&replaced<item.quantity)add('Replacement pending','待换货',item.quantity-replaced);
    }
    for(const item of open.filter(item=>item.kind!=='RECEIPT'&&(item.blocks||[]).includes('DISPATCH')))add(item.kind==='UNPLACED'?'Unpurchased':'Quantity issue',item.kind==='UNPLACED'?'未采购':'数量异常',item.quantity);
    if(!reasons.length)add('Receiving issue — reason not recorded','收货异常，未记录具体原因');
    return reasons;
  }
  function supplierAlertDetails(tasks,rowButton){return '<div class="pd-supplier-alerts">'+supplierAlertSources(tasks).map(({task,cases,receipt,stage})=>'<section class="pd-supplier-alert-item"><div><small>'+esc(task.barcode)+'</small><strong>'+esc(task.name)+'</strong><small>'+esc(task.po||'P.O. pending')+'</small>'+supplierAlertReasons(task).map(reason=>'<p>'+phrase(reason)+'</p>').join('')+'</div>'+(rowButton?rowButton(task):'<button class="pd-alert-open" data-progress-task="'+esc(task.id)+'" data-progress-index="'+stage+'" data-progress-is-source="true">View →</button>')+'</section>').join('')+'</div>';}
  function formatShipmentDate(value){
    return String(value).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,(original,year,month,day)=>{const d=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));return d.getUTCFullYear()===Number(year)&&d.getUTCMonth()===Number(month)-1&&d.getUTCDate()===Number(day)?day+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month)-1]+' '+year:original;});
  }
  function bilingualDirectories(host){
    if(!host?.querySelectorAll||typeof document.createElement!=='function')return;
    const labels={'Customer':['Customer','客户'],'Est. Shipment Date':['Est. shipment','预计发货'],'Tasks':['Tasks','任务'],'Risk':['Low GP','低毛利'],'Entry':['Open','进入'],'Supplier':['Supplier','供应商'],'Edit':['Edit','编辑'],'Alert':['Alert','发货提醒']};
    for(const cell of host.querySelectorAll('.pd-directories th')){const pair=labels[cell.textContent.trim()];if(pair)cell.innerHTML=bi(...pair);}
    for(const date of host.querySelectorAll('.pd-directories .shipment-summary b'))date.textContent=formatShipmentDate(date.textContent);
    for(const icon of host.querySelectorAll('.pd-directories .shipment-summary svg')){icon.setAttribute('viewBox','0 0 24 24');icon.innerHTML='<path d="M3 14.5 6 19h11l4-6.5-7 2Z"/><path d="M5 14V8h5v6m0-4h5v5M6 8V5h3v3m6 5V8h4v5"/><path d="M2 21c2-2 4 2 6 0s4 2 6 0 4 2 8 0"/>';}

  }
  window.purchaseDashboard={render,model,workQueues,bilingualDirectories,factStates,formatShipmentDate,supplierAlertSources,supplierAlertBadge,supplierAlertDetails,supplierAlertReasons};
})();
