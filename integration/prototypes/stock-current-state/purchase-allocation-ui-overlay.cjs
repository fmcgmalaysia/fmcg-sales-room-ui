'use strict';
// Candidate-only integration: cumulative allocation is supplied by CURRENT_V2,
// never inferred from receipt counts. Batch quantities require their own proof.
function grid(source) {
  source = source.replace('selectedDisplayRows=new Set()}', 'selectedDisplayRows=new Set(),allocations,stockAllocationView}');
  const anchor = '    return active&&window.purchaseDisplayRows';
  if (source.split(anchor).length !== 2) throw Error('Allocation grid return anchor changed');
  source = source.replace('    const markup=roots.map', '    let markup=roots.map');
  return source.replace(anchor, `    if(active)markup=markup.replace(/<tr\\b([^>]*)>([\\s\\S]*?)<\\/tr>/g,(all,attrs,body)=>{
      const rootId=(attrs.match(/data-id="([^"]+)"/)||attrs.match(/data-split-parent="([^"]+)"/))?.[1];
      const row=tasks.find(t=>t.id===rootId),split=/data-split-parent=/.test(attrs);
      let cell='<td class="allocated-quantity"></td>';
      if(row){
        const known=stockAllocationView==='CURRENT_V2'&&Array.isArray(allocations);
        const batchId=split?attrs.match(/data-split-batch="([^"]+)"/)?.[1]:null;
        const batch=split?row.stockAllocatedBatches?.find(b=>escape(b.id)===batchId):null;
        const raw=split?batch?.allocated:row.stockAllocatedCumulative;
        const amount=known&&Number.isSafeInteger(raw)&&raw>=0?raw:null;
        const links=sources(row,tasks).some(t=>t.stockTransferOutstanding===true);
        const deficit=amount!==null&&amount<(split?batch.demand:row.ord);
        cell='<td class="allocated-quantity">'+(amount===null?'':quantity(amount))
          +((deficit||links||split)?'<button class="btn '+(deficit?'danger':'')+'" data-current-allocation="'+escape(row.id)+'" '+(split?'data-current-batch="'+batchId+'" ':'')+'aria-label="Allocation 调配 '+escape(row.barcode)+'">'+(deficit?'ALERT':split?'View 查看':'Links 关系')+'</button>':'')+'</td>';
      }
      return '<tr'+attrs+'>'+body.replace(/(<td class="received-quantity">[\\s\\S]*?<\\/td>)/,'$1'+cell)+'</tr>';
    });
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
      const rowLabel=id=>{const entries=[...document.querySelectorAll('#taskRows tr')],entry=entries.find(el=>el.dataset.id===id||el.dataset.splitParent===id);return entry?'ROW '+(entry.querySelector('.row-number')?.textContent||''):'';};
      formDialog('Allocation 调配',row.barcode,'<p>'+esc(row.name)+'</p><div id="currentAllocationChoice"></div><div id="currentAllocationRelations"></div><div id="currentAllocationApproval"></div>','','task');
      const canSubmit=()=>!savePending&&!drafts.size&&!sequenceDraft&&!costRetry&&!allocationUi()?.dirty();
      window.purchaseBorrowApproval?.mountAllocation({container:document.querySelector('#currentAllocationChoice'),workspace:data,rootId,batchId:control.dataset.currentBatch,esc,canSubmit,
        showBorrow:()=>window.purchaseBorrowApproval.mount({container:document.querySelector('#currentAllocationApproval'),workspace:data,rootId,read:readOperation,rowLabel,esc,canSubmit,submit:input=>{if(!canSubmit())throw Error('Existing save pending');mutate('PURCHASE_SAVE_REQUEST',{operation:'BORROW_APPROVE',input});}})});
      window.purchaseBorrowRelations?.mount({container:document.querySelector('#currentAllocationRelations'),workspace:data,rootId,read:readOperation,rowLabel,esc,canSubmit,submitReturn:input=>{if(!canSubmit())throw Error('Existing save pending');mutate('PURCHASE_SAVE_REQUEST',{operation:'BORROW_RETURN',input});}});return;
    }
    if(control.dataset.planTask)`);
  return source;
}
module.exports={grid,app};
