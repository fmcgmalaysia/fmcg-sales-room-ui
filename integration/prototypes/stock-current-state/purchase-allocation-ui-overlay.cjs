'use strict';
// Candidate-only integration: cumulative allocation is supplied by CURRENT_V2,
// never inferred from receipt counts. Batch quantities require their own proof.
function allocationRowLabel(document, workspace, taskId) {
  // Display references are resolved anew; never persisted as relationship keys.
  if (workspace.tasks?.find(task => task.id === taskId)?.archived) return 'Archived 已归档';
  const numbers = [];
  for (const row of document.querySelectorAll('#taskRows tr')) {
    if (row.dataset.id !== taskId && row.dataset.splitParent !== taskId) continue;
    const number = row.querySelector('.row-number')?.textContent?.trim();
    if (/^\d+$/.test(number || '') && Number(number) > 0 && !numbers.includes(number)) numbers.push(number);
  }
  // A task may occupy several independently moved shipment rows. Showing only
  // its first row would incorrectly imply the loan belongs to that one batch.
  return numbers.length ? (numbers.length === 1 ? 'ROW ' : 'ROWS ') + numbers.join(', ') : 'Not in current view 当前未显示';
}
function grid(source) {
  function once(before,after){if(source.split(before).length!==2)throw Error('Physical receipt grid anchor changed');source=source.replace(before,()=>after);}
  once('const received=group.length===1&&!row.warehouse?row.inc:', 'const received=!child&&Number.isSafeInteger(row.stockActualReceived)?row.stockActualReceived:group.length===1&&!row.warehouse?row.inc:');
  once('group.length===1&&Number.isFinite(row.inc)', 'group.length===1&&(row.stockHasReceipt??Number.isFinite(row.inc))');
  once('const shownReceived=!child&&', 'const shownReceived=!child&&Number.isSafeInteger(row.stockActualReceived)?Math.min(row.stockActualReceived,row.ord,sum.customerQty):!child&&');
  once('entitlement?.metrics.received??take(Math.min(received,row.ord))',"stockAllocationView==='CURRENT_V2'?(row.stockReceiptBatches?.find(entry=>entry.id===batchId)?.received??''):entitlement?.metrics.received??take(Math.min(received,row.ord))");
  source = source.replace('selectedDisplayRows=new Set()}', 'selectedDisplayRows=new Set(),allocations,stockAllocationView}');
  const anchor = '    return active&&window.purchaseDisplayRows';
  if (source.split(anchor).length !== 2) throw Error('Allocation grid return anchor changed');
  source = source.replace('    const markup=roots.map', '    let markup=roots.map');
  return source.replace(anchor, `    if(active){const repaymentShown=new Set();markup=markup.replace(/<tr\\b([^>]*)>([\\s\\S]*?)<\\/tr>/g,(all,attrs,body)=>{
      const rootId=(attrs.match(/data-id="([^"]+)"/)||attrs.match(/data-split-parent="([^"]+)"/))?.[1];
      const row=tasks.find(t=>t.id===rootId),split=/data-split-parent=/.test(attrs);
      let cell='<td class="allocated-quantity"></td>',repaymentBadge='',repaymentRow=false;
      if(row){
        const known=stockAllocationView==='CURRENT_V2'&&Array.isArray(allocations);
        const batchId=split?attrs.match(/data-split-batch="([^"]+)"/)?.[1]:null;
        const batch=split?row.stockAllocatedBatches?.find(b=>escape(b.id)===batchId):null;
        const raw=split?batch?.allocated:row.stockAllocatedCumulative;
        const amount=known&&Number.isSafeInteger(raw)&&raw>=0?raw:null;
        const links=sources(row,tasks).some(t=>t.stockTransferOutstanding===true);
        const entitlement=split?row.batchEntitlements?.find(entry=>escape(entry.id)===batchId):null;
        const purchased=split?(Array.isArray(entitlement?.sources)&&entitlement.sources.every(s=>Number.isSafeInteger(s.quantity)&&s.quantity>=0)
          ?entitlement.sources.reduce((n,s)=>n+s.quantity,0):null):totals(sources(row,tasks)).customerQty;
        // Unpurchased demand belongs to ORDER, not an ALLOC borrowing alert.
        const deficit=amount!==null&&Number.isSafeInteger(purchased)&&purchased>=0&&amount<Math.min(split?batch.demand:row.ord,purchased);
        cell='<td class="allocated-quantity">'+(amount===null?'':quantity(amount))
          +((deficit||links||split)?'<button class="btn '+(deficit?'danger':'')+'" data-current-allocation="'+escape(row.id)+'" '+(split?'data-current-batch="'+batchId+'" ':'')+'aria-label="Allocation 调配 '+escape(row.barcode)+'">'+(deficit?'ALERT':split?'View 查看':'Links 关系')+'</button>':'')+'</td>';
        const owed=known&&Number.isSafeInteger(row.stockBorrowedOutstanding)&&row.stockBorrowedOutstanding>=0?row.stockBorrowedOutstanding:null;
        if(known&&!repaymentShown.has(row.id)){
          if(owed>0){const label=(split?'Whole line owed 整行待补回 ':'To repay 待补回 ')+owed+' CTN';
            repaymentBadge='<span class="borrow-repay-status" aria-label="'+label+'" title="Outstanding borrowing only; not Warehouse receipt 借货待补回，不属于货仓实收">'+quantity(owed)+'</span><span class="borrow-repay-caption">'+(split?'Line total 整行待补回':'To repay 待补回')+'</span>';
            repaymentRow=!split;
          }else if(owed===null&&links)repaymentBadge='<span class="borrow-repay-unknown" aria-label="Borrowing repayment unconfirmed 待补回尚未确认">Unconfirmed 待核对</span>';
          if(repaymentBadge)repaymentShown.add(row.id);
        }
      }
      return '<tr'+attrs+'>'+body.replace(/(<td class="received-quantity">)([\\s\\S]*?)(<\\/td>)/,(_,open,receipt,close)=>(repaymentRow?open.replace('received-quantity','received-quantity has-borrow-repay'):open)+receipt+repaymentBadge+close+cell)+'</tr>';
    });}
` + anchor);
}
function app(source) {
  function once(before,after){if(source.split(before).length!==2)throw Error('Allocation app anchor changed: '+before.slice(0,50));source=source.replace(before,()=>after);}
  once('quantityCells:sourceQuantityCells,drafts,riskDeal', 'quantityCells:sourceQuantityCells,allocations:data.allocations,stockAllocationView:data.stockAllocationView,drafts,riskDeal');
  once("'Net Cost','Rcv Qty','Line Cost'", "'Net Cost','Rcv Qty','Alloc Qty','Line Cost'");
  once('[56,40,90,128,null,96,128,92,104,96,132]', '[56,40,90,128,null,96,128,92,104,110,96,132]');
  once("(view==='active'?11:18)", "(view==='active'?12:18)");
  once('    if(control.dataset.planTask)', `    if(control.dataset.currentAllocation){
      if(savePending||drafts.size||sequenceDraft||costRetry||allocationUi()?.dirty()){showStatus('Save or cancel existing edits first 请先处理现有修改或保存。',true);return;}
      const rootId=control.dataset.currentAllocation,row=data.tasks.find(t=>t.id===rootId&&!t.procurementSource);if(!row)return;
      const rowLabel=id=>(${allocationRowLabel.toString()})(document,data,id);
      formDialog('Allocation 调配',row.barcode,'<p>'+esc(row.name)+'</p><div id="currentAllocationChoice"></div><div id="currentAllocationRelations"></div><div id="currentAllocationApproval"></div>','','task');
      const canSubmit=()=>!savePending&&!drafts.size&&!sequenceDraft&&!costRetry&&!allocationUi()?.dirty();
      window.purchaseBorrowApproval?.mountAllocation({container:document.querySelector('#currentAllocationChoice'),workspace:data,rootId,batchId:control.dataset.currentBatch,esc,canSubmit,
        submitArrangement:input=>{if(!canSubmit())throw Error('Existing save pending');mutate('PURCHASE_SAVE_REQUEST',{operation:'ARRANGE_AVAILABLE',input});},
        showBorrow:()=>window.purchaseBorrowApproval.mount({container:document.querySelector('#currentAllocationApproval'),workspace:data,rootId,read:readOperation,rowLabel,esc,canSubmit,submit:input=>{if(!canSubmit())throw Error('Existing save pending');mutate('PURCHASE_SAVE_REQUEST',{operation:'BORROW_APPROVE',input});}})});
      window.purchaseBorrowRelations?.mount({container:document.querySelector('#currentAllocationRelations'),workspace:data,rootId,read:readOperation,rowLabel,esc,canSubmit,submitReturn:input=>{if(!canSubmit())throw Error('Existing save pending');mutate('PURCHASE_SAVE_REQUEST',{operation:'BORROW_RETURN',input});}});return;
    }
    if(control.dataset.planTask)`);
  return source;
}
module.exports={grid,app,allocationRowLabel};
