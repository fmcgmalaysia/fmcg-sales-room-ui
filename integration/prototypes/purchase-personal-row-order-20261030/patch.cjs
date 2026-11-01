'use strict';
const assert=require('node:assert/strict');
// Apply identical isolated edits to the source and the assembled production client.
function patch(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'unique row-order patch: '+before.slice(0,90));source=source.replace(before,()=>after);};
 const functionLine=(name,next)=>{const line=source.split('\n').find(line=>line.startsWith('  function '+name+'('));assert(line,name);replace(line,next);};
 const begin=source.indexOf('  function stageDisplayRows('),end=source.indexOf('  function displayMoveDialog(',begin);
 assert(begin>=0&&end>begin);
 replace(source.slice(begin,end),`  function stageDisplayRows(id,rows){
    if(savePending)return false;
    const result=displayRows().remember(data,id,rows);
    if(!result.persisted)showStatus('排列已调整；此浏览器暂时无法记住排列，本页仍可继续工作。');
    return true;
  }
  function migrateRowOrder(){
    if(savePending||!sequenceDraft)return;
    const id=sequenceCustomerId,rows=displaySequenceDraft||displayRows().forTaskOrder(data,id,sequenceDraft);
    stageDisplayRows(id,rows);sequenceDraft=null;sequenceVersions=null;sequenceCustomerId='';displaySequenceDraft=null;displayOrderVersion=null;cacheDraft();
  }
`);
 replace('restoreDraft(); document.querySelector', 'displayRows().configure(result,company);restoreDraft();migrateRowOrder(); document.querySelector');
 replace('Only display order changes. Click Save afterwards.<br>只调整排列，完成后请点击 Save；PO 和收货记录不变。','Your row order is remembered automatically on this browser.<br>仅调整个人排列，自动记忆，无需 Save。');
 replace('仅调整采购任务的排列，移动后请点击 Save 保存。','仅调整个人排列，自动记忆，无需 Save。');
 replace('按住产品主行左侧 ⠿ 拖动；子行一起移动，完成后点击 Save。','按住产品主行左侧 ⠿ 拖动；子行一起移动，个人排列自动记忆。');
 functionLine('roomRows',`  function roomRows(){const rows=(data?.tasks||[]).filter(row=>(view==='active'?(!activeCustomer||row.customerId===activeCustomer):row.customerId===customerId)&&!row.archived);return [...new Set(rows.map(row=>row.customerId))].flatMap(id=>{const ordered=sequenceDraft&&sequenceCustomerId===id?sequenceDraft:displayRows().taskSequence(data,id,displayRows().current(data,id)),ranks=new Map(ordered.map((key,index)=>[key,index]));return rows.filter(row=>row.customerId===id).sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));});}`);
 const oldSave='if(!drafts.size&&!sequenceDraft&&!savePending)return;const edits=[...drafts].map(([taskId,item])=>({taskId,version:item.version,changes:item.changes}));const input={edits};if(sequenceDraft){Object.assign(input,{customerId:sequenceCustomerId,taskIds:sequenceDraft,versions:sequenceVersions});if(data.purchaseDisplayOrder?.[sequenceCustomerId])Object.assign(input,{displayRows:displaySequenceDraft||displayRows().forTaskOrder(data,sequenceCustomerId,sequenceDraft),displayOrderVersion:displayOrderVersion||data.purchaseDisplayOrder[sequenceCustomerId].version});}';
 replace(oldSave,'if(!drafts.size)return;const edits=[...drafts].map(([taskId,item])=>({taskId,version:item.version,changes:item.changes}));const input={edits};');
 replace("savePending=null;saveOrigin=null;saveDialog=null;document.querySelector('#companySelect').disabled=false;if(draftConflict&&view==='room')render();", "savePending=null;saveOrigin=null;saveDialog=null;const hadRowOrder=!!sequenceDraft;migrateRowOrder();document.querySelector('#companySelect').disabled=false;if(hadRowOrder||draftConflict&&view==='room')render();");
 const apply=source.split('\n').find(line=>line.includes("if(control.id==='applyMove')"));
 replace(apply,`    if(control.id==='applyMove'){const ids=roomRows().map(row=>row.id),moving=ids.filter(id=>selected.has(id)),rest=ids.filter(id=>!selected.has(id)),target=document.querySelector('#moveTarget').value,pos=target==='top'?0:target==='bottom'?rest.length:rest.indexOf(target);if(!moving.length||pos<0)return;rest.splice(pos,0,...moving);if(!stageDisplayRows(customerId,displayRows().forTaskOrder(data,customerId,groupSequence(rest))))return;modal.close();return render();}`);
 const drop=source.split('\n').find(line=>line.includes("const target=event.target.closest('tr[data-id]');if(!target||!dragId"));
 const first=drop.indexOf('if(!sequenceVersions)'),last=drop.indexOf("render();showStatus('行已移动，请点击 Save 保存。');",first);
 assert(first>0&&last>first);
 replace(drop,drop.slice(0,first)+`if(!stageDisplayRows(source.customerId,displayRows().forTaskOrder(data,source.customerId,groupSequence(ids)))){dragId=null;clearDragFeedback();return;}render();`+drop.slice(last+"render();showStatus('行已移动，请点击 Save 保存。');".length));
 replace("render();showStatus('行已移动，请点击 Save 保存。');","render();");
 return source;
}
module.exports={patch};
