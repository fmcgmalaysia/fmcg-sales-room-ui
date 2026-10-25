'use strict';
module.exports=function overlay(app){
 const once=(before,after)=>{if(app.split(before).length!==2)throw Error('Packing arrangement UI anchor changed');app=app.replace(before,()=>after);};
 once('function openEdit(list=null){','let purchaseArrangementDraft=null;\nfunction openEdit(list=null){\n purchaseArrangementDraft=null;');
 once("product(row)+'</td><td class=\"num\">'+row.remaining",`product(row)+(row.purchaseArrangements||[]).map(i=>'<small>Purchase 采购安排 '+esc(i.quantity)+' CTN'+(i.batchId?' · '+esc(i.batchId):'')+'</small>'
   +(i.status==='PENDING_SUPPORT'&&live&&actor==='SUPPORT'?'<button type="button" class="row-action" data-purchase-arrangement="'+esc(i.revision)+'" data-arrangement-task="'+esc(row.taskId)+'">Prepare draft 创建备货草稿</button>':i.packingListId?'<small>Linked 已接备货单 '+esc(i.packingListId)+'</small>':'')).join('')+'</td><td class="num">'+row.remaining`);
 once("$('rows').onclick=event=>{",`$('rows').onclick=event=>{
 const arrange=event.target.closest('[data-purchase-arrangement]');
 if(arrange){
   if(!live||actor!=='SUPPORT'||busy||needsRead||transport?.hasPending()||$('edit').open||$('detail').open)return;
   try{const task=available().find(t=>t.taskId===arrange.dataset.arrangementTask),instruction=task?.purchaseArrangements?.find(i=>i.revision===arrange.dataset.purchaseArrangement&&i.status==='PENDING_SUPPORT');
     if(!task||task.review||!instruction||!Number.isSafeInteger(instruction.quantity)||instruction.quantity<1
       ||instruction.quantity>task.readyToArrange||instruction.quantity>task.unarranged)throw Error('Purchase instruction or available stock changed. Refresh before arranging. 采购安排或可用库存已变化，请刷新。');
     selection.clear();selection.add(task.taskId);openEdit();
     purchaseArrangementDraft={taskId:task.taskId,batchId:instruction.batchId,revision:instruction.revision};
     const quantity=[...document.querySelectorAll('[data-plan]')].find(el=>el.dataset.plan===task.taskId);quantity.value=String(instruction.quantity);
     $('edit-help').textContent='Purchase requested '+instruction.quantity+' CTN. Saving creates a draft; sending still checks current usable stock. 采购要求'+instruction.quantity+'箱；保存仅建立草稿，发送仍核对当前可用库存。';
   }catch(error){$('notice').textContent=error.message;}return;
 }
`);
 once("{customerId:task.customerId,currency:task.currency,lines,reason:$('edit-reason').value}","{...(purchaseArrangementDraft&&!editing?{purchaseArrangement:purchaseArrangementDraft}:{}),customerId:task.customerId,currency:task.currency,lines,reason:$('edit-reason').value}");
 return app;
};
