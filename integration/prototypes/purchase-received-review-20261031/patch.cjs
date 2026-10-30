'use strict';
const assert=require('node:assert/strict');
function patch(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'unique received-review patch');source=source.replace(before,()=>after);};
 replace("  function receiptDecisionEditor(row,item){\n",`  function receiptDecisionEditor(row,item){
    if(item.quantity===0&&item.receivingIssue===false){
      dialogContext={kind:'receipt-review',taskId:row.id,caseId:item.id};
      formDialog('Receipt Review 收货核对',row.po,
        '<p>Goods received in full. The original receiving issue is retained for Finance reconciliation.<br><small>货物已收齐；原收货异常保留供财务核对，无需再选择等待或停止供货。</small></p><div class="receipt-feedback-summary"><div><small>P.O. Qty 采购数量</small><strong>'+qtyDigits(item.planned)+' CTN</strong></div><div><small>Received 已收</small><strong>'+qtyDigits(item.accepted)+' CTN</strong></div><div><small>Outstanding 待收</small><strong style="color:inherit">0 CTN</strong></div></div><div class="receipt-feedback-field"><label>Original warehouse feedback 原货仓反馈</label><div>'+esc(item.warehouseFeedback?.reason||'—')+'</div></div>','','task');
      modal.classList.add('receipt-feedback-dialog');
      return;
    }
`);
 const before="aria-label=\"'+(kind==='UNPLACED'?'Unplaced / 未采购':'Receiving issue / 收货异常')+' '+qtyDigits(item.quantity)+'\"";
 const after="aria-label=\"'+(kind==='RECEIPT'&&item.quantity===0&&item.receivingIssue===false?'Receipt review 收货核对':(kind==='UNPLACED'?'Unplaced / 未采购':'Receiving issue / 收货异常')+' '+qtyDigits(item.quantity))+'\"";
 replace(before,after);
 return source;
}
module.exports={patch};
