/* Read-only work queues. Closing this panel never changes or acknowledges a task. */
(function(root){
 const categories=[['todo','Not started / 未执行'],['partial','In progress / 执行中'],['urgent','Urgent / 高危'],['feedback','Needs feedback / 待反馈'],['blocked','Blocked / 等待其他部门']];
 const departmentNames={PURCHASE:'Purchase / 采购',ACCOUNT:'Account / 财务',WAREHOUSE:'Warehouse / 货仓',SALES:'Sales / 销售',ADMIN:'Admin / 管理员'};
 function project(department,{tasks=[],orders=[]}={}){
  const entries=[];const add=(id,category,title,owner,blocked,action,reason)=>entries.push({id,category,title,owner,blocked,action,reason});
  const stockCases=new Map([...tasks.flatMap(task=>task.warehouse?.stock?.cases||[]),...orders.flatMap(po=>po.stockCases||[])].map(item=>[item.id,item]));
  for(const item of stockCases.values())if(item.status!=='RESOLVED'){
   const task=tasks.find(task=>task.id===item.sourceTaskId),po=orders.find(po=>po.taskIds?.includes(item.sourceTaskId)||po.lines?.some(line=>line.taskId===item.sourceTaskId)),title=[task?.barcode||po?.number||'Stock / 库存',task?.name||po?.supplierName].filter(Boolean).join(' · '),reason=item.quantity+' CTN · '+({INTERNAL_DAMAGE:'Internal damage / 内部损坏',WRONG_ITEM:'Wrong item / 错货',SHORT_EXPIRY:'Short expiry / 保质期不足'}[item.kind]||item.kind);
   add(item.id,'urgent',title,item.owner,['SALES','ACCOUNT'],'stock',reason);
   add(item.id,item.owner===department?'feedback':'blocked',title,item.owner,['SALES','ACCOUNT'],'stock',reason);
  }
  if(department==='PURCHASE')for(const task of tasks.filter(task=>!task.archived)){
   const title=[task.barcode,task.name].filter(Boolean).join(' · '),po=orders.find(row=>row.taskIds?.includes(task.id));
   if(!task.supplierId||!task.po)add(task.id,'todo',title,'PURCHASE',['WAREHOUSE'],'edit','Assign supplier and P.O. / 选择供应商并填写采购单');
   else if(!task.salesInvoiceNumber)add(task.id,'partial',title,'PURCHASE',[],'edit','Procurement in progress / 采购处理中');
   if(task.procurement?.availableCtn>0)add(task.id,'feedback',title,'PURCHASE',['SALES'],'allocate','Allocate received stock / 分配已收到的货物，销售正在等待');
   for(const item of task.quantityCases||[]){
    if(item.status==='RESOLVED'||item.financeRequired&&po?.invoiceChecked)continue;
    const action='quantity-case:'+item.id,reason=(item.kind==='UNPLACED'?'Unplaced / 未采购 ':'Receiving issue / 收货异常 ')+item.quantity+' CTN';
    if(item.owner==='PURCHASE'){add(task.id,'feedback',title,'PURCHASE',item.blocks,action,reason);if(item.financeRequired)add(task.id,'urgent',title,'PURCHASE',item.blocks,action,reason);}
    else{add(task.id,'blocked',title,item.owner, ['PURCHASE'],action,reason);if(item.financeRequired)add(task.id,'urgent',title,item.owner,['PURCHASE'],action,reason);}
   }
   if(!Array.isArray(task.quantityCases)&&task.warehouse?.issue&&(!task.shortage||task.shortage.supplierDecision==='PENDING'||task.shortage.customerDecision==='PENDING')){add(task.id,'urgent',title,'PURCHASE',['ACCOUNT','SALES'],'shortage','Resolve shortage and advise departments / 决定少货处理方式并通知相关部门');add(task.id,'feedback',title,'PURCHASE',['ACCOUNT','SALES'],'shortage','Supplier decision required / 等待采购员与供应商确认');}
   if(!Array.isArray(task.quantityCases)&&(task.shortage?.financeRequired||po?.financialRisk)&&!po?.invoiceChecked){add(task.id,'blocked',title,'ACCOUNT',['PURCHASE'],'shortage','Financial reconciliation remains open / 财务尚未解决退款或贷项');add(task.id,'urgent',title,'ACCOUNT',['PURCHASE'],'shortage','Supplier liability remains unresolved / 供应商款项风险仍未解除');}
   if(task.po&&!(task.inc>0)&&!task.warehouse?.issue)add(task.id,'blocked',title,'WAREHOUSE',['PURCHASE'],'edit','Awaiting physical receipt and allocation / 等待实收及分货');
   if(task.demandReviewRequired)add(task.id,'blocked',title,'ADMIN',['PURCHASE'],'edit','Legacy quantity needs Admin review / 旧数量修改待管理员核实');
  }
  if(department==='ACCOUNT')for(const po of orders.filter(po=>po.state!=='HISTORY'||po.finance?.supplierCreditCents>0)){
   const title=po.number+' · '+po.supplierName;
   if(po.chasePayment)add(po.id,'todo',title,'ACCOUNT',['PURCHASE'],'settle','Payment requested / 采购正在催款');
   if(po.paymentHandoff?.reviewStale)add(po.id,'urgent',title,'ACCOUNT',['PURCHASE'],'settle','Payment documents changed / 付款文件已变更，必须重新过目');
   if(po.paymentHandoff?.paymentDue){add(po.id,'urgent',title,'ACCOUNT',['PURCHASE'],'settle','Supplier payment due / 供应商款项已到期');add(po.id,'todo',title,'ACCOUNT',['PURCHASE'],'settle','Payment due today or overdue / 今天应付款或已逾期');}
   if(po.creditorActive||po.prepaymentPending)add(po.id,'partial',title,'ACCOUNT',[],'settle','Payment or reconciliation open / 付款或对账尚未完成');
   if(po.financialRisk)add(po.id,'urgent',title,'ACCOUNT',['PURCHASE'],'settle','Shortage / overpayment must be reconciled / 少货、多付款或贷项尚待核对');
   if(!po.invoiceChecked&&po.canCheck)add(po.id,'feedback',title,'ACCOUNT',['PURCHASE'],'settle','Final check ready / 请完成最终核对，采购等待结单');
   if(!po.invoiceChecked){if(!po.documents?.some(doc=>doc.type==='INV'&&!doc.superseded))add(po.id,'blocked',title,'PURCHASE',['ACCOUNT'],'settle','Final Invoice required / 等待采购上载最终发票');
    if(!po.warehouse?.complete&&!po.finance?.receiptResolved)add(po.id,'blocked',title,po.warehouse?.issues?'PURCHASE':'WAREHOUSE',['ACCOUNT'],'settle',po.warehouse?.issues?'Shortage decision required / 等待采购处理少货':'Receiving incomplete / 等待货仓收货结果');}
  }
  if(department==='PURCHASE')for(const po of orders.filter(po=>po.paymentHandoff?.unreadCount>0))add(po.id,'feedback',po.number+' · '+po.supplierName,'PURCHASE',['WAREHOUSE'],'payment-proof','New payment proof / 财务已上传付款证明，请确认并联系供应商发货');
  if(department==='WAREHOUSE')for(const po of orders.filter(po=>po.status!=='COMPLETE')){
   const title=po.number+' · '+po.supplierName;
   add(po.id,po.status==='WAITING'?'todo':'partial',title,'WAREHOUSE',[],'receive',po.status==='WAITING'?'Awaiting delivery / 等待到货登记':'Receiving in progress / 分批收货中');
   const unresolved=po.lines?.filter(line=>line.issue&&(!line.shortage||line.shortage.supplierDecision==='PENDING'))||[];
   if(unresolved.length){add(po.id,'feedback',title,'PURCHASE',['ACCOUNT','WAREHOUSE'],'receive','Purchase must resolve receiving issue / 已通知采购处理收货异常');add(po.id,'blocked',title,'PURCHASE',['WAREHOUSE'],'receive','Awaiting supplier solution from Purchase / 等待采购确认补货或短缺结案');}
  }
  return {department,categories:categories.map(([key,label])=>({key,label,count:new Set(entries.filter(entry=>entry.category===key).map(entry=>entry.id)).size})),entries};
 }
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(host,department,data,onAction){if(!host)return;const model=project(department,data);host.innerHTML='<div class="task-signals">'+model.categories.map(category=>'<button type="button" data-task-category="'+category.key+'" class="task-signal '+category.key+(category.count?' has-work':'')+'"><b>'+category.count+'</b><span>'+category.label+'</span></button>').join('')+'</div>';
 host.querySelectorAll('[data-task-category]').forEach(button=>button.onclick=()=>{const category=model.categories.find(item=>item.key===button.dataset.taskCategory),entries=model.entries.filter(entry=>entry.category===category.key);let dialog=document.querySelector('#departmentTaskSignals');if(!dialog){dialog=document.createElement('dialog');dialog.id='departmentTaskSignals';dialog.className='task-signals-dialog';document.body.appendChild(dialog);}dialog.innerHTML='<header><strong>'+esc(category.label)+'</strong><button data-close aria-label="Close">×</button></header><div class="task-signal-list">'+(entries.length?entries.map((entry,index)=>'<button data-signal-entry="'+index+'"><b>'+esc(entry.title)+'</b><span>'+esc(entry.reason)+'</span><small>Responsible / 责任：'+esc(departmentNames[entry.owner]||entry.owner)+(entry.blocked.length?' · Blocking / 影响：'+esc(entry.blocked.map(key=>departmentNames[key]||key).join(', ')):'')+'</small></button>').join(''):'<p>No pending work / 暂无待处理工作</p>')+'</div>';dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelectorAll('[data-signal-entry]').forEach(button=>button.onclick=()=>{dialog.close();const entry=entries[Number(button.dataset.signalEntry)];if(entry.action==='stock')root.masterStockExceptions?.open();else onAction(entry);});dialog.showModal();});
 }
 root.masterTaskSignals={project,mount};
})(typeof window==='undefined'?globalThis:window);
