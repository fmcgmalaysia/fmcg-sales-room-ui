'use strict';
const assert=require('node:assert/strict');
const actionsCode=` function actions(workspace,esc,quantity){
  const context=workspace.allocationContext,issues=(context?.sources||[]).filter(source=>source.company===context.company&&Number.isSafeInteger(source.usableReceived)&&source.targets.reduce((n,target)=>n+target.quantity,0)>source.usableReceived);
  const loans=outstanding(workspace,esc,quantity);
  const review=issues.length?'<section class="panel reallocation-panel"><h3>Allocation Review 分配异常</h3><div class="tablewrap"><table class="rowlist"><thead><tr><th>Product 产品</th><th>Source P.O. 来源采购单</th><th>Usable 可用实物</th><th>Assigned 已分配</th><th>Excess 超出</th><th></th></tr></thead><tbody>'+issues.map(source=>{const task=workspace.tasks.find(row=>row.id===source.id),assigned=source.targets.reduce((n,target)=>n+target.quantity,0);return '<tr><td><b>'+esc(task?.name||source.barcode)+'</b><small>'+esc(source.barcode)+' · '+esc(source.packing)+'</small></td><td>'+esc(task?.po||'—')+'</td><td>'+quantity(source.usableReceived)+'</td><td>'+quantity(assigned)+'</td><td>'+quantity(assigned-source.usableReceived)+'</td><td><button class="btn" data-reconcile-source="'+esc(source.id)+'">Review 处理</button></td></tr>';}).join('')+'</tbody></table></div></section>':'';
  return '<p class="reallocation-note">Use ALLOC on the customer task to allocate stock. 请从客户任务 ALLOC 分配库存。</p>'+loans+review+(!loans&&!review?'<section class="panel reallocation-panel"><p>No outstanding borrowing or allocation review. 暂无待补回借货或分配异常。</p></section>':'');
 }
`;
function patchApp(source){
 const before=source.slice(source.indexOf('  function expectedStock('),source.indexOf('\n',source.indexOf('  function expectedStock(')));
 assert(before.includes('data-allocate='));
 source=source.replace(before,`  function expectedStock(inline=false){return '<div class="heading reallocation-heading"><div><'+(inline?'h2':'h1')+'>Stock Actions<small>库存处理</small></'+(inline?'h2':'h1')+'><span class="purchase-company-caption">'+esc(company==='NCT'?'North Cape Trading Sdn. Bhd.':companyName())+'</span></div>'+(inline?'':'<button class="btn" data-view="dashboard">Back</button>')+'</div>'+window.purchaseCustomerAllocation.actions(data,esc,qtyDigits);}`);
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,before);source=source.replace(before,()=>after);};
 replace("['allocation','Stock Allocation','库存分配']","['allocation','Stock Actions','库存处理']");
 replace('>Stock Allocation</option>','>Stock Actions</option>');
 replace("if(!task)return;customerId=task.customerId;view='room';render();if(entry.action==='allocate')allocationEditor(task.id);else if(entry.action.startsWith('quantity-case:'))", "if(!task)return;if(entry.action==='allocate'){activeCustomer=task.customerId;customerId='';view='active';query='';supplierFilter='';stageFilter='';allocationFilter=false;render();showStatus('请从对应客户任务的 ALLOC 继续分配。');return;}customerId=task.customerId;view='room';render();if(entry.action.startsWith('quantity-case:'))");
 replace('确认多余数量进入 Stock Allocation，不增加客户需求。','确认多余数量留作库存，不增加客户需求；之后从客户任务 ALLOC 分配。');
 return source;
}
function patchAllocation(source){
 const start=source.indexOf('   if(control.dataset.allocate){'),end=source.indexOf('   if(control.dataset.customerAllocate)',start);
 assert(start>0&&end>start);
 source=source.slice(0,start)+`   if(control.dataset.reconcileSource){
    if(blocked()){status('请先完成或取消当前保存与编辑。',true);return true;}
    const context=workspace().allocationContext,source=context?.sources.find(row=>row.id===control.dataset.reconcileSource);
    if(!source||!Number.isSafeInteger(source.usableReceived)||source.targets.reduce((n,row)=>n+row.quantity,0)<=source.usableReceived){status('分配资料已更新，请核对最新库存。',true);return true;}
    correction(source.id);return true;
   }
`+source.slice(end);
 const exportLine=' window.purchaseCustomerAllocation={create,outstanding};';assert.equal(source.split(exportLine).length,2);
 return source.replace(exportLine,actionsCode+' window.purchaseCustomerAllocation={create,outstanding,actions};');
}
module.exports={patchApp,patchAllocation};
