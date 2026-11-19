/* Customer allocation UI uses the same pure planner and original save journal. */
(() => {
 function allocationSummary(row,quote,esc,quantity,borrowed=0){
  const total=quote.assigned+quote.useFree+borrowed,remaining=Math.max(0,quote.shortage-borrowed);
  const card=(en,zh,value,kind)=>'<div class="alloc-source '+kind+'"><span>'+en+'<small>'+zh+'</small></span><strong>'+quantity(value)+' CTN</strong></div>';
  return '<section class="alloc-summary"><div class="alloc-product"><b>'+esc(row?.name||'')+'</b><span>'+esc(row?.packing||'')+'</span></div><div class="alloc-demand"><span aria-label="Demand 需求">Customer demand<small>客户需求</small></span><strong>'+quantity(quote.demand)+' CTN</strong></div><div class="alloc-sources '+(borrowed?'with-borrow':'')+'">'+card('Covered','已覆盖',quote.assigned,'reserved')+card('Use stock','本次调用库存',quote.useFree,'free')+(borrowed?card('Borrow plan','本次拟借货',borrowed,'borrow'):'')+'</div><div class="alloc-total"><span>After change<small>调整后覆盖</small></span><strong>'+quantity(total)+' CTN</strong></div><div class="alloc-meter" role="img" aria-label="'+quantity(total)+' of '+quantity(quote.demand)+' CTN"><span class="reserved" style="flex:'+quote.assigned+'"></span><span class="free" style="flex:'+quote.useFree+'"></span><span class="borrow" style="flex:'+borrowed+'"></span><span class="remaining" style="flex:'+remaining+'"></span></div><details class="alloc-stock-details"><summary>Stock details 库存详情</summary><p>Incoming 待到货 <strong>'+quantity(quote.waiting||0)+' CTN</strong></p><p>Free stock 可调用库存 <strong>'+quantity(quote.freeQuantity)+' CTN</strong></p></details></section>';
 }
 function borrowQuote(context,taskId){
  if(!context||!window.customerAllocationPlan)return null;
  try{
   const input={taskId,batchId:"WHOLE",version:context.version,fulfilNow:true};
   const quote=window.customerAllocationPlan.quoteCustomerAllocation(context,input);
   const donor=!quote.waiting&&quote.shortage>0&&quote.donors.find(item=>item.quantity>=quote.shortage);
   if(!donor)return null;
   window.customerAllocationPlan.planCustomerAllocation(context,{...input,borrow:true,donorTaskId:donor.taskId});
   return quote;
  }catch{return null;}
 }
 function create(hooks){
  let selection=null;
  const {workspace,dialog,esc,quantity,mutate,status,blocked}=hooks;
  const name=(context,id)=>{const task=context.tasks.find(row=>row.id===id);return workspace().customers.find(row=>row.id===task?.customerId)?.name||task?.customerId||id;};
  function open(taskId,batchId='WHOLE',borrowing=false,fulfilNow=false){
   if(blocked()){status('请先完成或取消当前保存与编辑。',true);return;}
   const context=workspace().allocationContext,api=window.customerAllocationPlan;
   if(!context||!api){status('分配资料尚未就绪，请刷新后再试。',true);return;}
   try{
    const input={action:'ALLOCATE',planMode:'CUSTOMER',version:context.version,taskId,batchId,fulfilNow},quote=api.quoteCustomerAllocation(context,input),row=workspace().tasks.find(row=>row.id===taskId);
    selection={input,context,quote};
    const debts=context.loans.filter(loan=>loan.outstanding>0&&(loan.borrowerTaskId===taskId||loan.lenderTaskId===taskId));
    const early=quote.waiting>0?(fulfilNow?'<p>Use received stock now 提前配货；原采购仍待到货，借货需补回。</p>':'<p>Waiting for '+quantity(quote.waiting)+' CTN 等待到货 <button class="btn" id="chooseEarlyAllocation">Use stock now 提前配货</button></p>'):'';
    const summary=allocationSummary(row,quote,esc,quantity)+early+debts.map(loan=>'<p>待补回 '+esc(name(context,loan.lenderTaskId))+'：<strong>'+quantity(loan.outstanding)+' CTN</strong> <button class="btn" data-repay-loan="'+esc(loan.id)+'">Repay 补回</button> <button class="btn" data-return-loan="'+esc(loan.id)+'">Return unshipped 退回未出货</button></p>').join('');
    if(borrowing){
     const donors=quote.shortage>0?quote.donors.filter(donor=>donor.quantity>=quote.shortage):[];
     dialog('Borrow Stock 借货',name(context,taskId),allocationSummary(row,quote,esc,quantity,donors.length?quote.shortage:0)+'<label class="alloc-lender">Borrow from 向客户借货<select id="borrowCustomer" required><option value="">Select a customer 请选择客户</option>'+donors.map(donor=>'<option value="'+esc(donor.taskId)+'">'+esc(name(context,donor.taskId))+' · 可借 '+quantity(donor.quantity)+' CTN</option>').join('')+'</select></label><p>'+(donors.length?'本次借货 <strong>'+quantity(quote.shortage)+' CTN</strong>，将保留补回责任。':'目前没有足够的已实收、未占用客户库存可借，请先补货或完成收货。')+'</p>',donors.length?'<button class="btn primary" id="confirmCustomerBorrow" disabled>Confirm borrowing 确认借货 '+quantity(quote.shortage)+' 箱</button>':'','task');
     const borrower=document.querySelector('#borrowCustomer'),confirm=document.querySelector('#confirmCustomerBorrow');
     if(confirm)borrower.addEventListener('change',()=>{confirm.disabled=!borrower.value;});
    }else{
     const receivable=debts.some(loan=>loan.lenderTaskId===taskId),canSave=!receivable&&quote.useFree>0;
     dialog('Allocate Stock 库存分配',name(context,taskId),summary+'<div class="alloc-outcome '+(quote.shortage>0?'has-gap':'covered')+'"><div><span>Still short<small>尚缺</small></span><strong>'+quantity(quote.shortage)+' CTN</strong></div>'+(quote.shortage>0&&!receivable?'<button class="btn alloc-borrow" id="chooseCustomerBorrow">Choose borrowing 选择借货 →</button>':'')+'</div>'+(receivable?'<p>请通过 Repay 补回处理本次缺货，使分配与欠货同时结清。</p>':''),(canSave?'<button class="btn primary" id="confirmCustomerAllocation">Confirm 分配 '+quantity(quote.assigned+quote.useFree)+' 箱</button>':''),'task');
    }
   }catch(error){status(error.message,true);}
  }
  function repayment(loanId,returning=false){
   if(blocked())return;const context=workspace().allocationContext,loan=context?.loans.find(row=>row.id===loanId);if(!loan?.outstanding)return;
   selection={context,input:{action:'ALLOCATE',planMode:returning?'RETURN':'REPAY',version:context.version,loanId}};
   dialog(returning?'Return Borrowed Stock 退回借货':'Repay Borrowed Stock 补回借货',name(context,loan.lenderTaskId),'<p>尚欠 <strong>'+quantity(loan.outstanding)+' CTN</strong></p><label>Quantity 箱数<input id="repayQuantity" type="number" min="1" max="'+loan.outstanding+'" step="1" value="'+loan.outstanding+'"></label><p>'+(returning?'仅退回原来源的未出库借货；请先解除未开始的 Desk 任务。':'使用已实收的未分配库存补回；到货不会自动清除欠货。')+'</p>','<button class="btn primary" id="confirmCustomerRepayment">Confirm 确认</button>','task');
  }
  function correction(sourceId,taskId,batchId){
   if(blocked())return;const context=workspace().allocationContext,source=context.sources.find(row=>row.id===sourceId);if(!source)return;
   if(!taskId){
    dialog('Review Quarantined Stock 核对隔离货物','Select affected customer batch 选择受影响的客户批次','<p>本来源可用 '+quantity(source.usableReceived)+' CTN，已分配 '+quantity(source.targets.reduce((n,row)=>n+row.quantity,0))+' CTN。请按实际异常选择需减少的份额。</p>'+source.targets.filter(target=>target.quantity>0).map(target=>{const task=context.tasks.find(row=>row.id===target.taskId);return task.batches.map(batch=>'<p>'+esc(name(context,task.id))+' <button class="btn" data-reconcile-task="'+esc(task.id)+'" data-reconcile-source="'+esc(sourceId)+'" data-allocation-batch="'+esc(batch.id)+'">'+esc(batch.id==='WHOLE'?'This order 本订单':batch.id.split('|').at(-1))+'</button></p>').join('');}).join(''),'','task');return;
   }
   const task=context.tasks.find(row=>row.id===taskId),target=source.targets.find(row=>row.taskId===taskId),before=task.batches.length===1?target.quantity:target.batches?.find(row=>row.id===batchId)?.quantity||0;
   selection={context,input:{action:'ALLOCATE',planMode:'RECONCILE',version:context.version,sourceTaskId:sourceId,taskId,batchId}};
   dialog('Reconcile Allocation 核对分配',name(context,taskId),'<p>本批当前分配 '+quantity(before)+' CTN；历史实收和隔离记录保持独立。</p><label>Correct allocation 更正分配<input id="reconcileQuantity" type="number" min="0" max="'+before+'" step="1" value="'+before+'"></label><label>Reason 原因<textarea id="reconcileReason" maxlength="2000"></textarea></label>','<button class="btn primary" id="confirmCustomerReconciliation">Confirm 确认</button>','task');
  }
  function stockDetail(taskId,sourceId,batchId=''){
   if(blocked()){status('请先完成或取消当前保存与编辑。',true);return;}
   const data=workspace(),row=data.tasks.find(item=>item.id===taskId),source=data.tasks.find(item=>item.id===sourceId);
   const entry=row&&window.purchaseTaskGrid.stockCoverage(row,data.tasks,data.allocations||[],batchId).entries.find(item=>item.sourceTaskId===sourceId);
   if(!entry){status('库存分配已改变，请按最新任务资料查看。',true);return;}
   const context=data.allocationContext,position=context?.sources.find(item=>item.id===sourceId);
   const loans=(context?.loans||[]).filter(loan=>loan.borrowerTaskId===taskId&&loan.sources.some(item=>item.sourceTaskId===sourceId));
   const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
   const origin=loans.length?window.purchaseTaskInfo?.model(taskId,batchId,'',data)?.sources.filter(item=>item.id===sourceId):null,breakdown=origin?.length>0&&origin.reduce((sum,item)=>sum+item.quantity,0)===entry.quantity?origin:[];
   const fields=[['Customer source 本客户来源',quantity(entry.quantity)+' CTN'],['Original P.O. quantity 原采购数量',quantity(source?.procurement?.totalCtn)+' CTN'],['Original supplier 原供应商',data.suppliers.find(item=>item.id===source?.supplierId)?.name||''],['Source P.O. 来源采购单',source?.po||''],['Receiving updated 收货更新时间',date(source?.warehouse?.updatedAt)],['Source allocation updated 来源分配更新时间',date(entry.at)],['Updated by 更新员工',entry.by||''],...breakdown.map(item=>[item.kind+(item.repaid?' · Repaid':''),quantity(item.quantity)+' CTN'])];
   dialog('Stock Source 库存来源',row.name,'<table class="rowlist"><tbody>'+fields.map(([label,value])=>'<tr><td>'+label+'</td><td>'+esc(value)+'</td></tr>').join('')+'</tbody></table>'+(position?.quarantined?'<p>Stock requires review 库存异常待核对；此数量不代表全部可装货。</p>':'')+loans.map(loan=>'<p>Borrowed from 借自 <strong>'+esc(name(context,loan.lenderTaskId))+'</strong> · Outstanding 尚欠 '+quantity(loan.outstanding)+' CTN'+(loan.outstanding===0?' · Repaid 已补回':'')+'</p>').join('')+'<p>Read only 只读。调整分配请使用原 ALLOC 入口；已 Loaded 数量不能退回。</p>','','task');
  }
  function handle(control){
   if(control.dataset.stockDetail){stockDetail(control.dataset.stockDetail,control.dataset.stockSource,control.dataset.stockBatch||'');return true;}

   if(control.dataset.reconcileTask){correction(control.dataset.reconcileSource,control.dataset.reconcileTask,control.dataset.allocationBatch);return true;}
   if(control.dataset.reconcileSource){
    if(blocked()){status('请先完成或取消当前保存与编辑。',true);return true;}
    const context=workspace().allocationContext,source=context?.sources.find(row=>row.id===control.dataset.reconcileSource);
    if(!source||!Number.isSafeInteger(source.usableReceived)||source.targets.reduce((n,row)=>n+row.quantity,0)<=source.usableReceived){status('分配资料已更新，请核对最新库存。',true);return true;}
    correction(source.id);return true;
   }
   if(control.dataset.customerBorrow){open(control.dataset.customerBorrow,"WHOLE",true,true);return true;}
   if(control.dataset.customerAllocate){open(control.dataset.customerAllocate,control.dataset.allocationBatch||'WHOLE');return true;}
   if(control.dataset.repayLoan){repayment(control.dataset.repayLoan);return true;}
   if(control.dataset.returnLoan){repayment(control.dataset.returnLoan,true);return true;}
   if(control.id==='chooseEarlyAllocation'&&selection){open(selection.input.taskId,selection.input.batchId,false,true);return true;}
   if(control.id==='chooseCustomerBorrow'&&selection){open(selection.input.taskId,selection.input.batchId,true,selection.input.fulfilNow);return true;}
   if(!['confirmCustomerAllocation','confirmCustomerBorrow','confirmCustomerRepayment','confirmCustomerReconciliation'].includes(control.id))return false;
   if(!selection||blocked())return true;
   const input={...selection.input},api=window.customerAllocationPlan;
   try{
    if(control.id==='confirmCustomerReconciliation'){input.quantity=Number(document.querySelector('#reconcileQuantity').value);input.reason=document.querySelector('#reconcileReason').value.trim();api.planCustomerReconciliation(selection.context,input);}
    else if(control.id==='confirmCustomerRepayment'){input.quantity=Number(document.querySelector('#repayQuantity').value);(input.planMode==='RETURN'?api.planCustomerReturn:api.planCustomerRepayment)(selection.context,input);}
    else{input.borrow=control.id==='confirmCustomerBorrow';if(input.borrow)input.donorTaskId=document.querySelector('#borrowCustomer').value;api.planCustomerAllocation(selection.context,input);}
    mutate('PURCHASE_SAVE_REQUEST',{operation:'ALLOCATE',input});
   }catch(error){document.querySelector('#dialogError').textContent=error.message;}
   return true;
  }
  return {open,handle};
 }
 function outstanding(workspace,esc,quantity){
  const context=workspace.allocationContext,loans=context?.loans.filter(row=>row.outstanding>0)||[];if(!loans.length)return '';
  const name=id=>{const task=context.tasks.find(row=>row.id===id);return workspace.customers.find(row=>row.id===task?.customerId)?.name||task?.customerId||id;};
  return '<section class="panel reallocation-panel"><h3>Outstanding Borrowing 待补回借货</h3><table class="rowlist"><thead><tr><th>Product 产品</th><th>Borrower 借货客户</th><th>Return to 补回客户</th><th>Outstanding 尚欠</th><th></th></tr></thead><tbody>'+loans.map(loan=>'<tr><td>'+esc(workspace.tasks.find(row=>row.id===loan.borrowerTaskId)?.name||'')+'</td><td>'+esc(name(loan.borrowerTaskId))+'</td><td>'+esc(name(loan.lenderTaskId))+'</td><td>'+quantity(loan.outstanding)+' CTN</td><td><button class="btn" data-repay-loan="'+esc(loan.id)+'">Repay 补回</button> <button class="btn" data-return-loan="'+esc(loan.id)+'">Return unshipped 退回未出货</button></td></tr>').join('')+'</tbody></table><p>本项与客户缺货对应同一补货责任。请先核对在途采购；到货后再确认补回。</p></section>';
 }
 function actions(workspace,esc,quantity){
  const context=workspace.allocationContext,issues=(context?.sources||[]).filter(source=>source.company===context.company&&Number.isSafeInteger(source.usableReceived)&&source.targets.reduce((n,target)=>n+target.quantity,0)>source.usableReceived);
  const loans=outstanding(workspace,esc,quantity);
  const review=issues.length?'<section class="panel reallocation-panel"><h3>Allocation Review 分配异常</h3><div class="tablewrap"><table class="rowlist"><thead><tr><th>Product 产品</th><th>Source P.O. 来源采购单</th><th>Usable 可用实物</th><th>Assigned 已分配</th><th>Excess 超出</th><th></th></tr></thead><tbody>'+issues.map(source=>{const task=workspace.tasks.find(row=>row.id===source.id),assigned=source.targets.reduce((n,target)=>n+target.quantity,0);return '<tr><td><b>'+esc(task?.name||source.barcode)+'</b><small>'+esc(source.barcode)+' · '+esc(source.packing)+'</small></td><td>'+esc(task?.po||'—')+'</td><td>'+quantity(source.usableReceived)+'</td><td>'+quantity(assigned)+'</td><td>'+quantity(assigned-source.usableReceived)+'</td><td><button class="btn" data-reconcile-source="'+esc(source.id)+'">Review 处理</button></td></tr>';}).join('')+'</tbody></table></div></section>':'';
  return '<p class="reallocation-note">Use ALLOC on the customer task to allocate stock. 请从客户任务 ALLOC 分配库存。</p>'+loans+review+(!loans&&!review?'<section class="panel reallocation-panel"><p>No outstanding borrowing or allocation review. 暂无待补回借货或分配异常。</p></section>':'');
 }
 window.purchaseCustomerAllocation={create,outstanding,actions,borrowQuote};
})();
