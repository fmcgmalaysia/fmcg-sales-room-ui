/* Customer allocation UI uses the same pure planner and original save journal. */
(() => {
 function create(hooks){
  let selection=null;
  const {workspace,dialog,esc,quantity,mutate,status,blocked}=hooks;
  const name=(context,id)=>{const task=context.tasks.find(row=>row.id===id);return workspace().customers.find(row=>row.id===task?.customerId)?.name||task?.customerId||id;};
  function open(taskId,batchId='WHOLE',borrowing=false){
   if(blocked()){status('请先完成或取消当前保存与编辑。',true);return;}
   const context=workspace().allocationContext,api=window.customerAllocationPlan;
   if(!context||!api){status('分配资料尚未就绪，请刷新后再试。',true);return;}
   try{
    const input={action:'ALLOCATE',planMode:'CUSTOMER',version:context.version,taskId,batchId},quote=api.quoteCustomerAllocation(context,input),row=workspace().tasks.find(row=>row.id===taskId);
    selection={input,context,quote};
    const debts=context.loans.filter(loan=>loan.outstanding>0&&(loan.borrowerTaskId===taskId||loan.lenderTaskId===taskId));
    const summary='<div class="task-identity"><b>'+esc(row?.name||'')+'</b><span>'+esc(row?.packing||'')+'</span></div><table class="rowlist"><tbody>'+[['Demand 需求',quote.demand],['Reserved 已预留',quote.assigned],['Free stock 可调用库存',quote.freeQuantity],['Use free stock 本次调用',quote.useFree],['Still short 尚缺',quote.shortage]].map(([label,value])=>'<tr><td>'+label+'</td><td>'+quantity(value)+' CTN</td></tr>').join('')+'</tbody></table>'+debts.map(loan=>'<p>待补回 '+esc(name(context,loan.lenderTaskId))+'：<strong>'+quantity(loan.outstanding)+' CTN</strong> <button class="btn" data-repay-loan="'+esc(loan.id)+'">Repay 补回</button> <button class="btn" data-return-loan="'+esc(loan.id)+'">Return unshipped 退回未出货</button></p>').join('');
    if(borrowing){
     const donors=quote.donors.filter(donor=>donor.quantity>=quote.shortage);
     dialog('Borrow Stock 借货',name(context,taskId),'<div class="task-identity"><b>'+esc(row?.name||'')+'</b><span>'+esc(row?.packing||'')+'</span></div><p>需求 '+quantity(quote.demand)+' CTN · 已覆盖 '+quantity(quote.assigned+quote.useFree)+' CTN · 尚缺 <strong>'+quantity(quote.shortage)+' CTN</strong></p><label>Borrow from 向客户借货<select id="borrowCustomer">'+donors.map(donor=>'<option value="'+esc(donor.taskId)+'">'+esc(name(context,donor.taskId))+' · 可借 '+quantity(donor.quantity)+' CTN</option>').join('')+'</select></label><p>'+(donors.length?'本次借货 <strong>'+quantity(quote.shortage)+' CTN</strong>，将保留补回责任。':'目前没有足够的已实收、未占用客户库存可借，请先补货或完成收货。')+'</p>',donors.length?'<button class="btn primary" id="confirmCustomerBorrow">Confirm 确认分配 '+quantity(quote.demand)+' 箱</button>':'','task');
    }else{
     const receivable=debts.some(loan=>loan.lenderTaskId===taskId),canSave=!receivable&&(quote.useFree>0||context.sources.some(source=>source.implicit&&source.targets.some(target=>target.taskId===taskId&&target.quantity>0)));
     dialog('Allocate Stock 库存分配',name(context,taskId),summary+(receivable?'<p>请通过 Repay 补回处理本次缺货，使分配与欠货同时结清。</p>':''),(quote.shortage>0&&!receivable?'<button class="btn" id="chooseCustomerBorrow">Borrow to complete 借货补足</button>':'')+(canSave?'<button class="btn primary" id="confirmCustomerAllocation">Confirm 分配 '+quantity(quote.assigned+quote.useFree)+' 箱</button>':''),'task');
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
  function handle(control){
   if(control.dataset.reconcileTask){correction(control.dataset.reconcileSource,control.dataset.reconcileTask,control.dataset.allocationBatch);return true;}
   if(control.dataset.allocate){
    if(blocked()){status('请先完成或取消当前保存与编辑。',true);return true;}
    const data=workspace(),source=data.tasks.find(row=>row.id===control.dataset.allocate),context=data.allocationContext;
    if(!source||!context){status('请刷新后再分配库存。',true);return true;}
    const position=context.sources.find(row=>row.id===source.id);if(position&&position.targets.reduce((n,row)=>n+row.quantity,0)>position.usableReceived){correction(source.id);return true;}
    const tasks=context.tasks.filter(task=>!task.archived&&!task.invoiceLocked&&task.barcode===source.barcode&&task.packing===source.packing&&task.ea===source.ea);
    dialog('Allocate Stock 库存分配','Select customer and batch 选择客户与出货批次','<div class="task-identity"><b>'+esc(source.name||'')+'</b><span>'+esc(source.packing||'')+'</span></div>'+tasks.map(task=>'<p><strong>'+esc(name(context,task.id))+'</strong></p>'+task.batches.map(batch=>'<button class="btn" data-customer-allocate="'+esc(task.id)+'" data-allocation-batch="'+esc(batch.id)+'">'+esc(batch.id==='WHOLE'?'This order 本订单':batch.id.split('|').at(-1))+' · '+quantity(batch.quantity)+' CTN</button>').join('')).join(''),'','task');return true;
   }
   if(control.dataset.customerAllocate){open(control.dataset.customerAllocate,control.dataset.allocationBatch||'WHOLE');return true;}
   if(control.dataset.repayLoan){repayment(control.dataset.repayLoan);return true;}
   if(control.dataset.returnLoan){repayment(control.dataset.returnLoan,true);return true;}
   if(control.id==='chooseCustomerBorrow'&&selection){open(selection.input.taskId,selection.input.batchId,true);return true;}
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
 window.purchaseCustomerAllocation={create,outstanding};
})();
