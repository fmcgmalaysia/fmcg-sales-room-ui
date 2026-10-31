'use strict';
const assert=require('node:assert/strict');
const coverageCode=`  // Display coverage only: procurement and confirmed ownership overlap by source.
  // Never add an allocation to the same source's already planned cartons twice.
  function stockCoverage(row,tasks,allocations=[],batchId='') {
    const group=sources(row,tasks),entitlement=batchId?row.batchEntitlements?.find(item=>item.id===batchId):null;
    const planned=new Map(group.map(source=>[source.id,batchId?(entitlement?.sources||[]).filter(item=>item.id===source.id).reduce((n,item)=>n+item.quantity,0):totals([source]).customerQty]));
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
    return {entries,stock,purchase,covered:purchase+stock,remaining:Math.max(0,demand-purchase-stock)};
  }
`;
function patchGrid(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'unique stock grid hunk: '+before.slice(0,90));source=source.replace(before,()=>after);};
 replace('  function progress(rows,orders) {',coverageCode+'  function progress(rows,orders) {');
 replace('function render({rows,tasks,customers,','function render({rows,tasks,allocations=[],allocationContext=null,customers,');
 replace('    function line(original,index,parent,sourceIndex) {',`    const coverage=(row,batch='')=>stockCoverage(row,tasks,allocations,batch);
    const box='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 1 8 4v10l-8 4-8-4V5Zm0 0v8m-8-4 8 4 8-4M10 9v10M6 3l8 4"/></svg>';
    function stockRows(row,batch=''){
      return coverage(row,batch).entries.map(entry=>{
        const source=tasks.find(item=>item.id===entry.sourceTaskId),position=allocationContext?.sources?.find(item=>item.id===entry.sourceTaskId);
        const loans=(allocationContext?.loans||[]).filter(loan=>loan.borrowerTaskId===row.id&&loan.sources.some(item=>item.sourceTaskId===entry.sourceTaskId));
        const problem=position?.quarantined===true,label=problem?'Stock review 库存待核对':loans.length?'Borrowed Stock 借入库存':'Ready Stock 现有库存';
        return activeColumns('<tr class="source-row ready-stock-row" data-stock-for="'+escape(row.id)+'" data-stock-source="'+escape(entry.sourceTaskId)+'"><td></td><td></td><td></td>'+(active?'<td class="customer-child">'+childMarker+'</td>':'')+'<td class="product-stack"><span class="stock-source-label '+(problem?'problem':'complete')+'">'+label+'</span></td><td class="order-quantity">'+quantity(entry.quantity)+'</td><td class="received-quantity"></td><td class="supplier-cell"><button type="button" class="stock-source-view" data-stock-detail="'+escape(row.id)+'" data-stock-source="'+escape(entry.sourceTaskId)+'" data-stock-batch="'+escape(batch)+'" aria-label="View stock source 查看库存来源 '+escape(row.barcode)+'">'+box+'<span>View source 查看来源</span></button></td><td></td><td></td><td></td><td></td><td></td></tr>');
      }).join('');
    }
    function line(original,index,parent,sourceIndex) {`);
 replace('const remaining=!child?Math.max(0,row.ord-sum.customerQty):0,','const remaining=!child?coverage(original).remaining:0,');
 replace("remaining>0||group.some(item=>!assigned(item))?person('pending')", "remaining>0?person('pending')");
 replace(":person('pending');", ":remaining>0||child?person('pending'):'';");
 replace("(!active&&!child&&sum.customerQty<row.ord?'<small class=\"waiting-demand\">WAITING '+quantity(row.ord-sum.customerQty)","(!active&&!child&&remaining>0?'<small class=\"waiting-demand\">WAITING '+quantity(remaining)");
 replace('const remaining=Math.max(0,row.ord-totals(sources(row,tasks).map(item=>({...item,...drafts.get(item.id)?.changes}))).customerQty);','const remaining=coverage(row).remaining;');
 replace('orderedCtn:Math.min(row.ord,sum.customerQty)','orderedCtn:Math.min(row.ord,coverage(original).covered)');
 replace("'+batch.quantity+' | '+planned+'", "'+batch.quantity+' | '+(entitlement?Math.min(batch.quantity,coverage(row,batchId).covered):planned)+'");
 replace('      const selectionReason=selectionIssue(row);','      const stockOnly=!child&&coverage(original).stock>0&&coverage(original).purchase===0&&remaining===0;\n      const selectionReason=selectionIssue(row);');
 replace("+'<td class=\"supplier-cell\"><button class=\"supplier-plan-link\" ","+'<td class=\"supplier-cell\">'+(stockOnly?'<span class=\"stock-source-label\">Stock supplied 库存供货</span>':'<button class=\"supplier-plan-link\" ");
 replace("+supplierMarkup+'</button></td><td class=\"amount net-cost-cell\"", "+supplierMarkup+'</button>')+'</td><td class=\"amount net-cost-cell\"");
 replace("+(multiple?'<span class=\"po-summary ", "+(stockOnly?'':multiple?'<span class=\"po-summary ");
 replace("planned<batch.quantity?person('pending')", "coverage(row,batchId).remaining>0?person('pending')");
 replace("return html+children.map((source,i)=>line(source,index,row,i)).join('');", "return html+children.map((source,i)=>line(source,index,row,i)).join('')+stockRows(row,batchId);");
 // Keep original source rows/selection/costs; only append non-procurement stock rows.
 replace('+(sources(row,tasks).length>1||active', '+(coverage(row).stock>0||sources(row,tasks).length>1||active');
 replace('?sources(row,tasks).map((source,i)=>line(source,index,row,i))','?sources(row,tasks).filter(source=>!coverage(row).stock||source.procurement?.totalCtn>0).map((source,i)=>line(source,index,row,i))');
 replace("+waiting(row):'');}).join('')", "+stockRows(row)+waiting(row):'');}).join('')");
 replace('window.purchaseTaskGrid={render,totals,','window.purchaseTaskGrid={stockCoverage,render,totals,');
 return source;
}
function patchApp(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'unique stock app hunk: '+before.slice(0,90));source=source.replace(before,()=>after);};
 replace('render({rows:shown,tasks:data.tasks,','render({rows:shown,tasks:data.tasks,allocations:data.allocations||[],allocationContext:data.allocationContext,');
 replace('Math.max(0,root.ord-window.purchaseTaskGrid.totals(window.purchaseTaskGrid.sources(root,rows)).customerQty)','window.purchaseTaskGrid.stockCoverage(root,data.tasks,data.allocations||[]).remaining');
 replace('row.sourcing?.unplacedCtn??Math.max(0,row.ord-(row.procurement?.totalCtn||0))','window.purchaseTaskGrid.stockCoverage(row,data.tasks,data.allocations||[]).remaining');
 replace('remaining=isSource?0:Math.max(0,row.ord-window.purchaseTaskGrid.totals(group).customerQty)','remaining=isSource?0:window.purchaseTaskGrid.stockCoverage(row,data.tasks,data.allocations||[]).remaining');
 return source;
}
function patchAllocation(source){
 const before='  function handle(control){';assert.equal(source.split(before).length,2);
 return source.replace(before,()=>`  function stockDetail(taskId,sourceId,batchId=''){
   if(blocked()){status('请先完成或取消当前保存与编辑。',true);return;}
   const data=workspace(),row=data.tasks.find(item=>item.id===taskId),source=data.tasks.find(item=>item.id===sourceId);
   const entry=row&&window.purchaseTaskGrid.stockCoverage(row,data.tasks,data.allocations||[],batchId).entries.find(item=>item.sourceTaskId===sourceId);
   if(!entry){status('库存分配已改变，请按最新任务资料查看。',true);return;}
   const context=data.allocationContext,position=context?.sources.find(item=>item.id===sourceId);
   const loans=(context?.loans||[]).filter(loan=>loan.borrowerTaskId===taskId&&loan.sources.some(item=>item.sourceTaskId===sourceId));
   const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
   const fields=[['Allocated from stock 库存覆盖',quantity(entry.quantity)+' CTN'],['Original supplier 原供应商',data.suppliers.find(item=>item.id===source?.supplierId)?.name||''],['Source P.O. 来源采购单',source?.po||''],['Receiving updated 收货更新时间',date(source?.warehouse?.updatedAt)],['Source allocation updated 来源分配更新时间',date(entry.at)],['Updated by 更新员工',entry.by||'']];
   dialog('Stock Source 库存来源',row.name,'<table class="rowlist"><tbody>'+fields.map(([label,value])=>'<tr><td>'+label+'</td><td>'+esc(value)+'</td></tr>').join('')+'</tbody></table>'+(position?.quarantined?'<p>Stock requires review 库存异常待核对；此数量不代表全部可装货。</p>':'')+loans.map(loan=>'<p>Borrowed from 借自 <strong>'+esc(name(context,loan.lenderTaskId))+'</strong> · Outstanding 尚欠 '+quantity(loan.outstanding)+' CTN'+(loan.outstanding===0?' · Repaid 已补回':'')+'</p>').join('')+'<p>Read only 只读。调整分配请使用原 ALLOC 入口；已 Loaded 数量不能退回。</p>','','task');
  }
  function handle(control){
   if(control.dataset.stockDetail){stockDetail(control.dataset.stockDetail,control.dataset.stockSource,control.dataset.stockBatch||'');return true;}
`);
}
const style=`
/* Confirmed inventory ownership is a source, never another procurement row. */
.ready-stock-row .stock-source-label{display:inline-block;padding:3px 7px;border-radius:4px;background:#eaf2ff;color:#174ba4;font-size:11px;font-weight:600}
.ready-stock-row .stock-source-label.problem{background:#fff0f2;color:#b41423}
.stock-source-view{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:#2563EB;cursor:pointer;padding:4px 0;font-family:inherit;font-size:11px;font-weight:600}
.stock-source-view svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}
.stock-source-view:hover{text-decoration:underline}.stock-source-view:focus-visible{outline:2px solid #2563EB;outline-offset:3px}
`;
module.exports={patchGrid,patchApp,patchAllocation,style};
