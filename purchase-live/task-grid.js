/* Shared Purchase Room / Active Orders presentation; mutations remain in app.js. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number.isFinite(value) ? value.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
  const quantity = value => Number.isSafeInteger(value) ? value : '—';
  const labels = ['P.O. / 采购单','Documents / 文件核齐','Payment / 付款','Receiving / 收货','Allocation / 分货','Sales INV / 销售发票','Dispatch / 发货'];
  const localDay=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));};
  const receivedDate=value=>{const day=localDay(value);return day?day.slice(8,10)+'-'+day.slice(5,7)+'-'+day.slice(2,4):'';};
  const sinceDate=value=>{const date=receivedDate(value);return date?'<small class="task-received-date" aria-label="Task received 收到任务日期 '+date+'">'+date+'</small>':'';};
  const poLeadTime=(received,assigned)=>{const start=localDay(received),end=localDay(assigned);if(!start||!end||Date.parse(assigned)<Date.parse(received))return '';const days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;return days===0?'Same day':'In '+days+(days===1?' Day':' Days');};
  const extraBadge=n=>'<span class="extra-stock-badge" role="img" aria-label="Extra purchased 额外采购 '+n+' CTN" title="Purchased above customer demand 采购超过客户需求；不代表当前可用库存"><svg viewBox="0 0 50 22" aria-hidden="true"><path d="M4 1h34l11 10-11 10H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z"/><circle cx="40" cy="11" r="1.7"/><text x="5" y="14.5">EXTRA</text></svg><b>'+n+'</b></span>';
  function sources(row,tasks) {const added=item=>(item.history||[]).find(event=>event.action==='PURCHASE_SOURCE_ADDED')?.time||'';return [row,...tasks.filter(item=>item.customerDemandTaskId===row.id).sort((a,b)=>added(a).localeCompare(added(b))||a.id.localeCompare(b.id))];}
  function cost(row){return row.procurement?.costing?.averageCostCtn??(['lpCtn','disc1','disc2','disc3'].every(key=>Number.isFinite(row[key]))?row.lpCtn*(1-row.disc1)*(1-row.disc2)-row.disc3:row.netCostCtn);}
  function totals(rows) {
    const valid = rows.every(row => Number.isSafeInteger(row.procurement?.totalCtn) && Number.isFinite(cost(row)));
    const ordered = rows.reduce((sum,row) => sum + (row.procurement?.totalCtn || 0),0);
    const cents = valid ? rows.reduce((sum,row) => sum + (row.procurement.costing?.amountCents??Math.round(cost(row) * row.procurement.totalCtn * 100)),0) : null;
    const customerQty=rows.reduce((sum,row)=>sum+Math.max(0,(row.procurement?.totalCtn||0)-(row.procurement?.expectedExtra||0)),0),customerCents=valid?rows.reduce((sum,row)=>sum+Math.round(cost(row)*Math.max(0,row.procurement.totalCtn-(row.procurement.expectedExtra||0))*100),0):null;
    return {ordered,customerQty,amount:cents === null ? null : cents / 100,cost:customerQty && customerCents !== null ? customerCents / 100 / customerQty : null};
  }
  // Display coverage only: procurement and confirmed ownership overlap by source.
  // Never add an allocation to the same source's already planned cartons twice.
  function stockCoverage(row,tasks,allocations=[],batchId='') {
    const group=sources(row,tasks),entitlement=batchId?row.batchEntitlements?.find(item=>item.id===batchId):null;
    const sourceAssigned={},originalPurchase=group.reduce((n,source)=>n+totals([source]).customerQty,0);
    const planned=new Map(group.map(source=>{
      const saved=allocations.find(item=>item.sourceTaskId===source.id),target=saved?.targets?.find(item=>item.taskId===row.id),original=totals([source]).customerQty;
      const elsewhere=(saved?.targets||[]).filter(item=>item.taskId!==row.id).reduce((n,item)=>n+item.quantity,0);
      const redirected=Math.max(0,elsewhere-Math.max(0,(source.procurement?.totalCtn||0)-original));
      const hasIncoming=allocations.some(item=>!group.some(own=>own.id===item.sourceTaskId)&&item.targets?.some(target=>target.taskId===row.id&&target.quantity>0));
      const ownedPlan=Math.min(Math.max(0,original-redirected),hasIncoming&&saved?(target?.quantity||0):original),earmark=batchId?(entitlement?.sources||[]).filter(item=>item.id===source.id).reduce((n,item)=>n+item.quantity,0):original;
      sourceAssigned[source.id]=target?.quantity??(saved?0:original);
      const contribution=batchId&&redirected>0?Math.min(earmark,(target?.batches||[]).filter(item=>item.id===batchId).reduce((n,item)=>n+item.quantity,0)):Math.min(earmark,ownedPlan);
      return [source.id,contribution];
    }));
    const entries=allocations.flatMap(allocation=>{
      const target=allocation.targets?.find(item=>item.taskId===row.id);if(!target)return [];
      const assigned=batchId?(target.batches||[]).filter(item=>item.id===batchId).reduce((n,item)=>n+item.quantity,0):target.quantity;
      const own=group.find(item=>item.id===allocation.sourceTaskId),extra=Math.max(0,target.quantity-(own?totals([own]).customerQty:0));
      let quantity=extra;
      if(batchId){let left=extra;quantity=0;for(const batch of row.batchEntitlements||[]){const saved=target.batches?.find(item=>item.id===batch.id)?.quantity||0,earmark=(batch.sources||[]).filter(item=>item.id===allocation.sourceTaskId).reduce((n,item)=>n+item.quantity,0),portion=Math.min(left,Math.max(0,saved-earmark));if(batch.id===batchId)quantity=portion;left-=portion;}}
      return Number.isSafeInteger(quantity)&&quantity>0?[{sourceTaskId:allocation.sourceTaskId,quantity,assigned,at:allocation.at,by:allocation.by}]:[];
    });
    const stock=entries.reduce((n,item)=>n+item.quantity,0),purchase=[...planned.values()].reduce((n,value)=>n+value,0);
    const demand=batchId?(entitlement?.quantity??row.ord):row.ord;
    return {entries,stock,purchase,originalPurchase,sourceAssigned,covered:purchase+stock,remaining:Math.max(0,demand-purchase-stock)};
  }
  function progress(rows,orders) {
    const related = orders.filter(po => rows.some(row => po.taskIds.includes(row.id)));
    const allOrders = related.length > 0 && rows.every(row => related.some(po => po.taskIds.includes(row.id)));
    return [rows.every(row=>Boolean(row.po)),allOrders && related.every(po=>po.invoiceChecked),allOrders && related.every(po=>po.paymentCompleted),rows.every(row=>!(row.warehouse?.stock?.cases||[]).some(item=>item.status!=='RESOLVED')&&(row.progressFacts?.receiptResolved||row.warehouse?.hasPhysicalReceipt && row.warehouse.accepted===row.procurement?.totalCtn && !row.warehouse.issue)),rows.every(row=>row.procurement?.availableCtn>=0 && row.procurement.availableCtn<=(row.procurement.expectedExtra||0) && row.warehouse?.accepted>0),rows.every(row=>row.salesInvoiceLocked || row.salesFulfilment?.sourceInvoicedQty>0 && row.salesFulfilment.sourceInvoicedQty===(row.warehouse?.stock?.usableReceived??row.warehouse?.accepted)),rows.every(row=>row.progressFacts?.sourceRequired>0&&row.progressFacts.sourceDispatchedQty===row.progressFacts.sourceRequired||row.archived)];
  }
  function progressStates(rows,orders){
    const receiptProblem=rows.some(row=>row.warehouse?.issue||(row.warehouse?.stock?.cases||[]).some(item=>item.status!=='RESOLVED'));
    const reviewProblem=orders.some(po=>po.reviewRequired&&rows.some(row=>po.taskIds.includes(row.id)));
    return progress(rows,orders).map((done,i)=>(i===3&&receiptProblem||i===1&&reviewProblem)?'problem':done?'complete':'pending');
  }
  function summaryProgressStates(root,rows,orders){return progressStates(rows,orders).map(state=>totals(rows).customerQty<root.ord&&state==='complete'?'pending':state);}
  function render({rows,tasks,allocations=[],allocationContext=null,allocationOrigins=null,deskDeliveries=[],customers,suppliers,selected,selectedSources,selectionIssue=()=>'',expanded,active,canMove,orders,age,shipmentDate=value=>value||'—',quantityCells,drafts,riskDeal,supplierIcon,shipmentPlans=[],purchaseDisplayOrder={},displayDraft=null,selectedDisplayRows=new Set()}) {
    if(active)window.purchaseTaskInfo?.setContext({tasks,allocations,allocationContext,allocationOrigins,deskDeliveries,customers});
    const roots = rows.filter(row=>!row.procurementSource), name = id=>suppliers.find(row=>row.id===id)?.shortName || suppliers.find(row=>row.id===id)?.name || 'Select Supplier 选择供应商';
    const shortName = row=>customers.find(item=>item.id===row.customerId)?.shortName || customers.find(item=>item.id===row.customerId)?.name || row.customerId;
    const person=(state,source)=>'<span class="supplier-head '+state+'" '+(source?.procurement?.transportMode==='SELF_COLLECT'?'data-self-collect="true"':'')+' aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="5" r="4"/><path d="M2 19v-3a8 7 0 0 1 16 0v3z"/></svg></span>';
    const assigned=row=>Boolean(row.supplierId&&row.procurement?.revision&&row.procurement.totalCtn>0&&(!drafts.get(row.id)?.changes?.supplierId||row.supplierId===tasks.find(item=>item.id===row.id)?.supplierId));
    function activeColumns(html){html=html.replaceAll("aria-label=\"Supplier sources / 采购来源\"","aria-label=\"Supplier sources 采购来源\"").replaceAll("aria-label=\"Unplaced / 未采购 ","aria-label=\"Unplaced 未采购 ").replaceAll("aria-label=\"Receiving issue / 收货异常 ","aria-label=\"Receiving issue 收货异常 ").replaceAll("aria-description=\"Resolved / 已解决\"","aria-description=\"Resolved 已解决\"").replaceAll("aria-label=\"Resolve shortage / 处理差额\"","aria-label=\"Resolve shortage 处理差额\"");if(!active)return html;const cells=html.match(/<td\b[\s\S]*?<\/td>/g);return html.replace(/(<tr\b[^>]*>)[\s\S]*(<\/tr>)$/,(_,open,close)=>open+[0,1,2,3,4,5,7,8,6,9,10].map(i=>cells[i]).join('')+close);}
    const childMarker='<span class="ao-child-marker" role="img" aria-label="Sub-row 子行"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v7h8m-3-3 3 3-3 3"/></svg></span>';
    const coverage=(row,batch='')=>stockCoverage(row,tasks,allocations,batch);
    const box='<span class="stock-source-icon" aria-hidden="true"></span>';
    function stockRows(row,batch=''){
      return coverage(row,batch).entries.map(entry=>{
        const source=tasks.find(item=>item.id===entry.sourceTaskId),position=allocationContext?.sources?.find(item=>item.id===entry.sourceTaskId);
        const loans=(allocationContext?.loans||[]).filter(loan=>loan.borrowerTaskId===row.id&&loan.sources.some(item=>item.sourceTaskId===entry.sourceTaskId));
        const replenished=(allocationContext?.loans||[]).some(loan=>loan.lenderTaskId===row.id&&loan.borrowerTaskId===(source?.customerDemandTaskId||source?.id)&&loan.quantity-loan.outstanding>=entry.quantity);
        const origin=loans.length?window.purchaseTaskInfo?.model(row.id,batch)?.sources.filter(item=>item.id===entry.sourceTaskId):null,known=origin?.length>0&&origin.every(item=>item.kind!=='Source')&&origin.reduce((sum,item)=>sum+item.quantity,0)===entry.quantity;
        const borrowed=known&&origin.some(item=>item.kind==='Borrowed'),mixed=borrowed&&origin.some(item=>item.kind!=='Borrowed');
        const problem=position?.quarantined===true,label=problem?'Stock review 库存待核对':loans.length?(!known?'Stock source 库存来源':mixed?'Mixed Stock 混合来源':borrowed?(loans.every(loan=>loan.outstanding===0)?'Borrowed · Repaid 借入已补回':'Borrowed Stock 借入库存'):'Ready Stock 现有库存'):replenished?'Replenished Stock 补回库存':'Ready Stock 现有库存';
        return activeColumns('<tr class="source-row ready-stock-row" data-stock-for="'+escape(row.id)+'" data-stock-source="'+escape(entry.sourceTaskId)+'"><td></td><td></td><td></td>'+(active?'<td class="customer-child">'+childMarker+'</td>':'')+'<td class="product-stack"><span class="stock-source-label '+(problem?'problem':'complete')+'">'+label+'</span></td><td class="order-quantity">'+quantity(entry.quantity)+'</td><td class="received-quantity"></td><td class="supplier-cell"><button type="button" class="stock-source-view" data-stock-detail="'+escape(row.id)+'" data-stock-source="'+escape(entry.sourceTaskId)+'" data-stock-batch="'+escape(batch)+'" aria-label="View stock source 查看库存来源 '+escape(row.barcode)+'">'+box+'<span>Info</span></button></td><td></td><td></td><td></td><td></td><td></td></tr>');
      }).join('');
    }
    function line(original,index,parent,sourceIndex) {
      const row={...original,...drafts.get(original.id)?.changes},child=Boolean(parent),group=(child?[row]:sources(row,tasks)).map(item=>({...item,...drafts.get(item.id)?.changes})),sum=totals(group),states=child?progressStates(group,orders):summaryProgressStates(row,group,orders),pos=String(index+1).padStart(3,'0')+(child?'-'+String.fromCharCode(65+sourceIndex):'');
      const savedRows=child?[original]:sources(original,tasks),savedTotals=totals(savedRows),costsReady=savedTotals.ordered>0&&savedRows.every(item=>(item.procurement?.revision||item.po)&&(item.procurement?.costing?Number.isSafeInteger(item.procurement.costing.amountCents):['lpCtn','disc1','disc2','disc3'].every(key=>Number.isFinite(item[key])))),purchaseAmount=costsReady?savedTotals.amount:null,purchaseCost=Number.isFinite(purchaseAmount)?purchaseAmount/savedTotals.ordered:null;
      const ids=[...new Set(group.map(item=>item.supplierId).filter(Boolean))],posNumbers=[...new Set(group.map(item=>item.po).filter(Boolean))],multiple=!child&&(group.length>1||active&&row.procurement?.revision&&sum.customerQty>0&&sum.customerQty<row.ord);
      const remaining=!child?coverage(original).remaining:0,supplierMarkup=multiple?'<span class="supplier-heads">'+group.filter(assigned).map(source=>person('complete',source)+escape(name(source.supplierId))).join(' ')+(remaining>0?person('pending'):'')+'</span>':assigned(row)?person('complete',row)+escape(name(row.supplierId))+(!child&&remaining>0?person('pending'):''):remaining>0||child?person('pending'):'';
      const received=group.length===1&&!row.warehouse?row.inc:group.reduce((n,item)=>n+(item.warehouse?.stock?.usableReceived??item.warehouse?.accepted??0),0),hasReceipt=group.some(item=>item.warehouse?.hasPhysicalReceipt)||group.length===1&&Number.isFinite(row.inc),problem=group.some(item=>item.warehouse?.issue||(item.warehouse?.stock?.cases||[]).some(stock=>stock.status!=='RESOLVED')),done=progress(group,orders);
      let product=child?'<span class="source-label">'+(row.procurement?.costing?.mode==='FOC'?'FOC 采购':'普通采购')+'</span>'+(row.procurement?.costing?.mode==='FOC'?'<small class="source-costing">付费 '+quantity(row.procurement.costing.paidCtn)+' + FOC '+quantity(row.procurement.costing.freeCtn)+' CTN</small>':''):'<span class="barcode">'+escape(row.barcode)+(!active&&riskDeal(row)?'<span class="risk-deal">⚠ Risk Deal</span>':'')+'</span><b class="itemname" aria-description="'+escape(row.name)+'">'+escape(row.name)+'</b><span class="packing">'+escape(row.packing)+'</span>';
      const poEntered=(row.history||[]).filter(event=>event.action==='PURCHASE_PO_ASSIGNED'&&event.result==='SAVED'&&Number.isFinite(Date.parse(event.time))).map(event=>event.time).sort((a,b)=>Date.parse(a)-Date.parse(b))[0],poTime=active?poLeadTime(parent?.masterReceivedAt||row.masterReceivedAt,poEntered):poEntered&&Number.isFinite(Date.parse(poEntered))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(poEntered)):'';
      const partialSource=child&&totals(sources(parent,tasks)).customerQty<parent.ord,shownGp=child?row.sourceGp:row.gp;
      const gp = (!child||partialSource)&&costsReady&&Number.isFinite(purchaseCost)&&(child?savedTotals.customerQty>0:savedTotals.customerQty>=row.ord)&&!group.some(item=>drafts.has(item.id))&&Number.isFinite(shownGp)?number(shownGp*100)+'%':child?'':'—';
      if(active&&gp!==''&&gp!=='—'){const percent=gp,badge='<span class="gp gp-badge '+(shownGp<0.06?'gp-low':'gp-good')+'" aria-description="GP" aria-label="GP '+escape(percent)+'">'+escape(percent)+'</span>';product=child?product.replace('</span>','</span>'+badge):product.replace('<span class="barcode">'+escape(row.barcode),'<span class="barcode">'+escape(row.barcode)+badge);}
      if(row.procurementSavePending)product+='<small class="procurement-save-pending" role="status">Save pending 保存待恢复</small>';
      const fixedShares=group.some(item=>Number.isSafeInteger(item.procurement?.customerCtn)),customerReceived=fixedShares?group.reduce((n,item)=>n+Math.min(item.warehouse?.stock?.usableReceived??item.warehouse?.accepted??0,item.procurement?.customerCtn??Math.max(0,(item.procurement?.totalCtn||0)-(item.procurement?.expectedExtra||0))),0):received;
      const shownReceived=!child&&Number.isSafeInteger(row.ord)&&Number.isFinite(received)?Math.min(customerReceived,row.ord,fixedShares?sum.customerQty:sum.ordered):received;const stockIssues=group.flatMap(item=>item.warehouse?.stock?.cases||[]).filter(item=>item.status!=='RESOLVED'),stockQty=stockIssues.reduce((n,item)=>n+item.quantity,0);
      let qtyMarkup=quantityCells({...row,procurementSource:child||row.procurementSource,quantityCases:child?row.quantityCases:group.some(item=>Array.isArray(item.quantityCases))?group.flatMap(item=>item.quantityCases||[]):undefined,sourcing:child?null:{orderedCtn:active&&sum.ordered>row.ord?sum.ordered:Math.min(row.ord,coverage(original).covered),hasReceipt,receivedCtn:shownReceived,sourceIds:group.map(item=>item.id)},warehouse:!child&&(hasReceipt||problem)?{...(row.warehouse||{}),issue:problem}:row.warehouse}).replace('</td>',(!active&&!child&&remaining>0?'<small class="waiting-demand">WAITING '+quantity(remaining)+' CTN</small>':'')+(!child&&sum.ordered>row.ord?active?extraBadge(sum.ordered-row.ord):'<small class="extra-stock">Stock 库存 +'+(sum.ordered-row.ord)+'</small>':'')+'</td>').replace(/<small>(?:This P.O. (?:\/ )?本单|Extra P.O. (?:\/ )?补采购|本单)[^<]*<\/small>/g,'').replace(/<\/td>$/,(stockQty?'<button class="quantity-case pending" data-stock-task="'+escape(row.id)+'" aria-label="Stock issues 库存异常 '+stockQty+'">−'+stockQty+'</button>':'')+(!child&&Number.isFinite(received)&&received>shownReceived?'<small class="extra-stock">Stock rcv 库存实收 +'+(received-shownReceived)+'</small>':'')+'</td>');
      if(child){const actual=coverage(parent).sourceAssigned[original.id],ordered=totals([original]).customerQty;if(Number.isSafeInteger(actual)&&actual!==ordered){qtyMarkup=qtyMarkup.replace(/(<td class="order-quantity">)([\s\S]*?)(<\/td>)/,(_,open,value,close)=>open+'<span class="source-actual" aria-label="Customer source 本客户来源 '+quantity(actual)+' CTN">'+quantity(actual)+'</span>'+close);}}
      if(active)qtyMarkup=qtyMarkup.replace(/<button class="quantity-case [^"]*" data-quantity-case="[^"]*" aria-label="Unplaced \/ 未采购 [^"]*"[^>]*>[\s\S]*?<\/button>/g,'');
      if(active&&!child)qtyMarkup=qtyMarkup.replace(/<button class="(quantity-reference[^"]*)" data-sources="[^"]*" aria-label="Supplier sources \/ 采购来源">([\s\S]*?)<\/button>/,'<span class="$1" aria-description="Demand / Planned · 需求 / 已安排">$2</span>');
      if(active)qtyMarkup=qtyMarkup.replace(/(<td class="received-quantity">)<button class="(quantity-reference[^"]*)" data-sources="[^"]*">([\s\S]*?)<\/button>/,'$1<span class="$2" aria-description="Received 实收">$3</span>');

      const stockOnly=!child&&coverage(original).stock>0&&coverage(original).purchase===0&&remaining===0;
      const selectionReason=selectionIssue(row);
      const checkbox='<input class="check rowcheck" type="checkbox" data-select="'+escape(row.id)+'" data-select-kind="'+(child?'source':'demand')+'" '+(row.archived||multiple||selectionReason?'disabled ':'')+(selectionReason?'aria-description="'+escape(selectionReason)+'" ':'')+(multiple?'title="请选择下方供应商来源" ':'')+'aria-label="Select '+(child?'supplier source ':'')+escape(row.id)+'" '+((child?selectedSources.has(row.id):!multiple&&selected.has(row.id)&&!selectedSources.has(row.id))?'checked':'')+'>';
      return activeColumns('<tr '+(child?'data-source-id':'data-id')+'="'+escape(row.id)+'" class="'+(child?'source-row ':'')+((child?selectedSources.has(row.id):!multiple&&selected.has(row.id)&&!selectedSources.has(row.id))?'selected':'')+'"><td><div class="row-controls">'+(!child&&canMove?'<button class="handle" draggable="true" aria-description="Drag to move · 拖动排列" data-drag="'+escape(row.id)+'" aria-label="Move '+escape(row.id)+'">⠿</button>':'')+(child?'':checkbox)+'</div></td><td class="row-number">'+(child?checkbox:pos)+'</td><td class="received-age">'+(active&&child?'':escape(age(row.masterReceivedAt))+(active?sinceDate(row.masterReceivedAt):''))+'</td>'+(active?'<td class="customer-short" aria-description="'+escape(child?'Supplier source 供应商子行':shortName(row))+'">'+(child?childMarker:escape(shortName(row))+'<small class="customer-shipment" aria-description="Est. Shipment 预计发货">ETD: '+escape(shipmentDate(row.estimatedShipmentDate||'—'))+'</small>')+'</td>':'')+'<td class="product-stack">'+product+'</td>'+qtyMarkup+'<td class="supplier-cell">'+(stockOnly?'<span class="stock-source-label">Stock supplied 库存供货</span>':'<button class="supplier-plan-link" '+(child?'data-plan-source':'data-plan-task')+'="'+escape(row.id)+'" aria-label="Supplier plan '+escape(row.barcode)+'" '+(row.archived?'disabled':'')+'>'+supplierMarkup+'</button>')+'</td><td class="amount net-cost-cell" aria-description="已保存采购 '+quantity(savedTotals.ordered)+' CTN · 含 FOC 与库存余量">'+number(purchaseCost)+'</td><td class="amount">'+number(purchaseAmount)+'</td><td>'+(stockOnly?'':multiple?'<span class="po-summary '+(group.every(item=>item.po)?'complete':'pending')+'">'+escape(posNumbers.length?posNumbers.length+' P.O.':group.length+' Sources')+'</span>':'<button class="po-reference '+(row.po?'complete':'pending')+'" '+(child?'data-source-po-task':'data-po-task')+'="'+escape(row.id)+'">'+escape(row.po||'P.O.')+'</button>')+(!multiple&&row.po&&poTime?'<small class="po-entered-time" aria-description="Task received to first PO 收任务至首次开单用时">'+escape(poTime)+'</small>':'')+'</td><td class="amount"><b class="gp'+(active&&!child&&gp!=='—'&&row.gp<0.06?' gp-low':'')+'">'+gp+'</b></td><td>'+(multiple?'':'<div class="row-progress" aria-label="Progress '+escape(row.barcode)+'">'+labels.map((label,i)=>'<button class="progress-node '+states[i]+'" data-progress-task="'+escape(row.id)+'" data-progress-index="'+i+'" data-progress-is-source="'+child+'" aria-label="'+escape(label.replace(' / ',' '))+(states[i]==='problem'?' · Problem':states[i]==='complete'?' · Completed':' · Pending')+'" aria-description="'+escape(label.replace(' / ',' '))+'">'+(active?'<span aria-hidden="true">'+(i+1)+'</span>':'')+'</button>').join('')+'</div>')+'</td></tr>');
    }
    function waiting(row){
      const remaining=coverage(row).remaining;if(!remaining)return '';
      return activeColumns('<tr class="source-row waiting-row" data-waiting-for="'+escape(row.id)+'"><td></td><td></td><td></td>'+(active?'<td class="customer-child">'+childMarker+'</td>':'')+'<td class="product-stack"><span class="source-label">待安排需求</span></td><td class="order-quantity">'+quantity(remaining)+'</td><td class="received-quantity">—</td><td class="supplier-cell"><button class="supplier-plan-link" data-plan-task="'+escape(row.id)+'" aria-label="Arrange remaining demand '+escape(row.barcode)+'" '+(row.archived?'disabled':'')+'>'+person('pending')+'</button></td><td></td><td></td><td></td><td></td><td></td></tr>');
    }
    function splitRows(row,index,plan){
      const batches=plan.batches.flatMap(batch=>{const entry=batch.lines.find(entry=>entry.taskId===row.id);return entry?[{...batch,quantity:entry.quantity}]:[];});
      if(batches.length<2)return null;
      const original=line(row,index,null,0),cells=original.match(/<td\b[\s\S]*?<\/td>/g),group=sources(row,tasks),sum=totals(group),received=group.reduce((n,source)=>n+(source.warehouse?.stock?.usableReceived??source.warehouse?.accepted??0),0);
      let offset=0;const shownSources=new Set();
      return batches.map((batch,batchIndex)=>{
        const copy=[...cells],take=total=>Math.min(batch.quantity,Math.max(0,total-offset)),batchId=plan.id+'|'+batch.sequence,entitlement=row.batchEntitlements?.find(entry=>entry.id===batchId),planned=entitlement?(entitlement.sources||[]).reduce((sum,source)=>sum+source.quantity,0):take(sum.customerQty);
        copy[0]='<td></td>';copy[1]='<td class="row-number">'+String(index+1).padStart(3,'0')+'-'+batch.sequence+'</td>';
        copy[2]='<td class="received-age">'+escape(age(row.masterReceivedAt))+sinceDate(row.masterReceivedAt)+(batchIndex?'<small><button class="split-origin-link" data-split-origin="'+escape(plan.id)+'" data-split-task="'+escape(row.id)+'">Split Row</button></small>':'')+'</td>';
        copy[4]=copy[4].replace('</td>','<small class="split-batch-label">'+escape(batch.label)+'</small></td>');
        copy[5]='<td class="order-quantity"><span class="qty-pair">'+batch.quantity+' | '+(entitlement?Math.min(batch.quantity,coverage(row,batchId).covered):planned)+'</span></td>';
        const assignedHere=entitlement?group.filter(source=>entitlement.sources.some(item=>item.id===source.id&&item.quantity>0)):group.filter(assigned);
        copy[6]='<td class="supplier-cell"><button class="supplier-plan-link" data-plan-task="'+escape(row.id)+'" data-plan-batch="'+escape(batchId)+'" aria-label="Supplier plan '+escape(batch.label)+'" '+(row.archived?'disabled':'')+'>'+assignedHere.map(source=>person('complete',source)+escape(name(source.supplierId))).join(' ')+(coverage(row,batchId).remaining>0?person('pending'):'')+'</button></td>';
        copy[7]='<td class="amount net-cost-cell">—</td>';copy[8]='<td class="received-quantity">'+(group.some(source=>source.warehouse?.hasPhysicalReceipt)?entitlement?.metrics.received??take(Math.min(received,row.ord)):'—')+'</td>';copy[9]='<td class="amount">—</td>';
        const inline=entitlement&&assignedHere.length===1&&planned===batch.quantity&&assigned(assignedHere[0])&&assignedHere[0].procurement.totalCtn===batch.quantity&&totals(assignedHere).customerQty===batch.quantity&&(row.batchEntitlements||[]).filter(entry=>entry.sources?.some(source=>source.id===assignedHere[0].id&&source.quantity>0)).length===1?assignedHere[0]:null;
        if(entitlement){const numbers=[...new Set(assignedHere.map(source=>source.po).filter(Boolean))];copy[10]='<td>'+(assignedHere.length?'<span class="po-summary '+(assignedHere.every(source=>source.po)?'complete':'pending')+'">'+escape(numbers.length?numbers.length+' P.O.':assignedHere.length+' Sources')+'</span>':'')+'</td>';}
        if(inline){
          const sourceCells=line(inline,index,row,0).match(/<td\b[\s\S]*?<\/td>/g);for(const position of [7,8,9,10])copy[position]=sourceCells[position];shownSources.add(inline.id);
          copy[4]=copy[4].replace(/<span class="gp gp-badge [^"]*"[\s\S]*?<\/span>/g,'');
          const saved=inline.procurement.costing?Number.isSafeInteger(inline.procurement.costing.amountCents):['lpCtn','disc1','disc2','disc3'].every(key=>Number.isFinite(inline[key]));
          if(saved&&!drafts.has(inline.id)&&Number.isFinite(inline.sourceGp)){const badge='<span class="gp gp-badge '+(inline.sourceGp<0.06?'gp-low':'gp-good')+'" aria-description="GP" aria-label="GP '+escape(number(inline.sourceGp*100)+'%')+'">'+escape(number(inline.sourceGp*100)+'%')+'</span>';copy[4]=copy[4].replace('<span class="barcode">'+escape(row.barcode),'<span class="barcode">'+escape(row.barcode)+badge);}
          const foc=sourceCells[4].match(/<small class="source-costing">[\s\S]*?<\/small>/)?.[0];if(foc)copy[4]=copy[4].replace('</td>',foc+'</td>');
        }
        offset+=batch.quantity;
        const html='<tr class="split-demand-row" data-split-parent="'+escape(row.id)+'" data-split-batch="'+escape(plan.id+'|'+batch.sequence)+'"'+(inline?' data-receipt-source-id="'+escape(inline.id)+'"':'')+'>'+copy.join('')+'</tr>';
        const children=(entitlement?assignedHere:batchIndex===0?group:[]).filter(source=>source.procurement?.totalCtn>0&&!shownSources.has(source.id));for(const source of children)shownSources.add(source.id);
        return html+children.map((source,i)=>line(source,index,row,i)).join('')+stockRows(row,batchId);
      }).join('');
    }
    let markup=roots.map((row,index)=>{const plan=active&&shipmentPlans.find(plan=>plan.customerId===row.customerId&&plan.orderId===row.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===row.id)));const split=plan&&splitRows(row,index,plan);return split||line(row,index,null,0)+(coverage(row).stock>0||sources(row,tasks).length>1||active&&row.procurement?.revision&&totals(sources(row,tasks)).customerQty>0&&totals(sources(row,tasks)).customerQty<row.ord?sources(row,tasks).filter(source=>!coverage(row).stock||source.procurement?.totalCtn>0).map((source,i)=>line(source,index,row,i)).join('')+stockRows(row)+waiting(row):'');}).join('').replace(/>—</g,'><');
    if(active)markup=markup.replace(/<tr\b([^>]*)>/g,(all,attrs)=>{
      const id=(attrs.match(/data-id="([^"]+)"/)||attrs.match(/data-split-parent="([^"]+)"/))?.[1];
      const row=tasks.find(task=>escape(task.id)===id);if(!row)return all;
      const batchId=attrs.match(/data-split-batch="([^"]+)"/)?.[1];
      const supply=batchId?row.supplyAllocation?.batches?.find(batch=>escape(batch.id)===batchId):row.supplyAllocation;
      const allocated=supply?.planned??(batchId?row.batchEntitlements?.find(batch=>escape(batch.id)===batchId)?.metrics?.received:row.inc);
      const intent=batchId?null:(row.requested??row.ord);
      return '<tr'+attrs+(Number.isSafeInteger(allocated)&&allocated>=0?' data-layout-allocation="'+allocated+'"':'')
        +(supply?' data-layout-gap="'+Math.max(0,supply.gap??(supply.planned-supply.received-supply.waiting))+'" data-layout-waiting="'+supply.waiting+'"':'')
        +(Number.isSafeInteger(intent)&&intent>=0?' data-layout-intent="'+intent+'"':'')+'>';
    });
    return active&&window.purchaseDisplayRows&&Object.keys(purchaseDisplayOrder).length?window.purchaseDisplayRows.decorate(markup,{tasks,shipmentPlans,purchaseDisplayOrder,draft:displayDraft,selected:selectedDisplayRows,canMove}):markup;
  }
  window.purchaseTaskGrid={receivedDate,poLeadTime,stockCoverage,render,totals,sources,progress,progressStates,summaryProgressStates,labels,cost};
})();
