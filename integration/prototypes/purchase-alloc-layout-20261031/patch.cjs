'use strict';
const assert=require('node:assert/strict');
const summaryCode=` function allocationSummary(row,quote,esc,quantity,borrowed=0){
  const total=quote.assigned+quote.useFree+borrowed,remaining=Math.max(0,quote.shortage-borrowed);
  const card=(en,zh,value,kind)=>'<div class="alloc-source '+kind+'"><span>'+en+'<small>'+zh+'</small></span><strong>'+quantity(value)+' CTN</strong></div>';
  return '<section class="alloc-summary"><div class="alloc-product"><b>'+esc(row?.name||'')+'</b><span>'+esc(row?.packing||'')+'</span></div><div class="alloc-demand"><span aria-label="Demand 需求">Customer demand<small>客户需求</small></span><strong>'+quantity(quote.demand)+' CTN</strong></div><div class="alloc-sources '+(borrowed?'with-borrow':'')+'">'+card('Reserved','本客户已预留',quote.assigned,'reserved')+card('Use stock','本次调用库存',quote.useFree,'free')+(borrowed?card('Borrow plan','本次拟借货',borrowed,'borrow'):'')+'</div><div class="alloc-total"><span>Allocate now<small>本次分配方案</small></span><strong>'+quantity(total)+' CTN</strong></div><div class="alloc-meter" role="img" aria-label="'+quantity(total)+' of '+quantity(quote.demand)+' CTN"><span class="reserved" style="flex:'+quote.assigned+'"></span><span class="free" style="flex:'+quote.useFree+'"></span><span class="borrow" style="flex:'+borrowed+'"></span><span class="remaining" style="flex:'+remaining+'"></span></div><details class="alloc-stock-details"><summary>Stock details 库存详情</summary><p>Free stock 可调用库存 <strong>'+quantity(quote.freeQuantity)+' CTN</strong></p></details></section>';
 }
`;
function patchAllocation(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,before.slice(0,100));source=source.replace(before,()=>after);};
 replace(' function create(hooks){',summaryCode+' function create(hooks){');
 const oldSummary=source.split('\n').find(line=>line.includes('    const summary='));assert(oldSummary.includes("<table class=\"rowlist\""));
 replace(oldSummary,'    const summary=allocationSummary(row,quote,esc,quantity)'+oldSummary.slice(oldSummary.indexOf('+debts.map')));
 const oldDialog=source.split('\n').find(line=>line.includes("     dialog('Allocate Stock 库存分配'"));assert(oldDialog.includes('id="chooseCustomerBorrow"'));
 replace(oldDialog,`     dialog('Allocate Stock 库存分配',name(context,taskId),summary+'<div class="alloc-outcome '+(quote.shortage>0?'has-gap':'covered')+'"><div><span>Still short<small>尚缺</small></span><strong>'+quantity(quote.shortage)+' CTN</strong></div>'+(quote.shortage>0&&!receivable?'<button class="btn alloc-borrow" id="chooseCustomerBorrow">Choose borrowing 选择借货 →</button>':'')+'</div>'+(receivable?'<p>请通过 Repay 补回处理本次缺货，使分配与欠货同时结清。</p>':''),(canSave?'<button class="btn primary" id="confirmCustomerAllocation">Confirm 分配 '+quantity(quote.assigned+quote.useFree)+' 箱</button>':''),'task');`);
 const borrowStart="'<div class=\"task-identity\"><b>'+esc(row?.name||'')+'</b><span>'+esc(row?.packing||'')+'</span></div><p>需求 '+quantity(quote.demand)+' CTN · 已覆盖 '+quantity(quote.assigned+quote.useFree)+' CTN · 尚缺 <strong>'+quantity(quote.shortage)+' CTN</strong></p><label>Borrow from 向客户借货<select id=\"borrowCustomer\">'";
 replace(borrowStart,"allocationSummary(row,quote,esc,quantity,donors.length?quote.shortage:0)+'<label class=\"alloc-lender\">Borrow from 向客户借货<select id=\"borrowCustomer\">'");
 return source;
}
const style=`
/* ALLOC presentation only; all original handlers and guards remain authoritative. */
dialog.task-dialog:has(.alloc-summary){width:520px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);color:#173557}
dialog.task-dialog:has(.alloc-summary) .dialoghead{padding:12px 16px}
dialog.task-dialog:has(.alloc-summary) .dialoghead h2{font-size:14px;font-weight:800}
dialog.task-dialog:has(.alloc-summary) .close{width:32px;height:32px;min-width:32px;min-height:32px;font-size:22px}
dialog.task-dialog:has(.alloc-summary) .dialogbody{padding:14px 16px;max-height:calc(100dvh - 170px);overflow:auto}
dialog.task-dialog:has(.alloc-summary) #dialogError:empty{display:none}
.alloc-summary{font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums}
.alloc-product{display:flex;flex-direction:column;gap:3px;margin-bottom:14px;overflow-wrap:anywhere}
.alloc-product b{font-size:12px;font-weight:700;color:#0c2e55}
.alloc-product>span{font-size:10px;color:#5d7186}
.alloc-demand,.alloc-total{display:flex;justify-content:space-between;align-items:center;gap:12px}
.alloc-summary small,.alloc-outcome small{display:block;margin-top:2px;font-size:10px;font-weight:400;color:#5d7186}
.alloc-demand>strong,.alloc-total>strong{font-size:20px;line-height:1.2;font-weight:800;white-space:nowrap}
.alloc-demand{padding-bottom:12px;border-bottom:1px solid #dce7f1}
.alloc-sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0 14px}
.alloc-sources.with-borrow{grid-template-columns:repeat(3,minmax(0,1fr))}
.alloc-source{display:flex;flex-direction:column;gap:8px;min-width:0;padding:11px 12px;border:1px solid #dce7f1;border-radius:5px;background:#f2f6fb}
.alloc-source.free{background:#edf5ff}.alloc-source.borrow{background:#fff4df;border-color:#f7d99e}
.alloc-source>strong{font-size:18px;font-weight:800;line-height:1.2;white-space:nowrap}
.alloc-total{margin-bottom:9px}.alloc-total>strong{color:#215a9a}
.alloc-meter{height:7px;display:flex;gap:2px;overflow:hidden;border-radius:4px;background:#e6edf5}
.alloc-meter>span{min-width:0}.alloc-meter .reserved{background:#3766a2}.alloc-meter .free{background:#7baae2}.alloc-meter .borrow{background:#f0b44d}.alloc-meter .remaining{background:#e6edf5}
.alloc-stock-details{margin-top:9px;font-size:10px;color:#5d7186}.alloc-stock-details>summary{cursor:pointer;width:fit-content;color:#3766a2}.alloc-stock-details p{margin:6px 0 0}
.alloc-outcome{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:10px 12px;border-radius:5px;background:#f2f6fb;border:1px solid #dce7f1}
.alloc-outcome.has-gap{background:#fff4df;border-color:#f7d99e}.alloc-outcome>div{display:flex;align-items:center;gap:12px}.alloc-outcome strong{font-size:16px;font-weight:800;white-space:nowrap;color:#173557}
dialog.task-dialog:has(.alloc-summary) .alloc-borrow{border:0;background:transparent;color:#215a9a;font-size:11px;font-weight:700;min-height:32px;padding:4px}
dialog.task-dialog:has(.alloc-summary) .alloc-borrow:hover{background:#fff9ee;text-decoration:underline}
dialog.task-dialog:has(.alloc-summary) .dialogfoot{padding:10px 16px;justify-content:flex-end}
dialog.task-dialog:has(.alloc-summary) .dialogfoot>.muted{display:none}
dialog.task-dialog:has(.alloc-summary) .dialogfoot .actions{width:100%;justify-content:space-between;gap:10px;flex-wrap:wrap}
dialog.task-dialog:has(.alloc-summary) .dialogfoot .btn{min-height:34px;font-size:11px}
.alloc-lender{display:block;margin-top:12px}.alloc-lender select{width:100%;height:32px;min-height:32px;margin-top:5px;padding:5px 7px;border:1px solid #b8cadb;border-radius:4px;background:white}
@media(max-width:420px){.alloc-sources{gap:7px}.alloc-source{padding:9px}.alloc-source>strong{font-size:16px}.alloc-sources.with-borrow{grid-template-columns:repeat(2,minmax(0,1fr))}.alloc-source.borrow{grid-column:1 / -1;flex-direction:row;justify-content:space-between;align-items:center}.alloc-outcome{align-items:flex-start}.alloc-outcome>div{gap:8px}.alloc-outcome .alloc-borrow{max-width:150px;text-align:right}}
`;
module.exports={patchAllocation,style};
