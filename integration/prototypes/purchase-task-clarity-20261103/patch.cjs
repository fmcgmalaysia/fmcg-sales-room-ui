const assert=require('node:assert/strict');
const build='20261103-purchase-task-clarity-v1';
function once(s,a,b){assert.equal(s.split(a).length,2,a.slice(0,85));return s.replace(a,b);}
function between(s,a,b,replacement=''){const start=s.indexOf(a),end=s.indexOf(b,start);assert(start>=0&&end>start,a);return s.slice(0,start)+replacement+s.slice(end);}
function patchApp(s){
 s=between(s,'  function displayMoveDialog(','\n  let savePending');
 s=between(s,'  function groupSequence(','  function roomRows(');
 s=between(s,'    if(control.dataset.displayDrag)','    if(control.dataset.supplierShipmentAlert)');
 s=between(s,"    if(control.id==='moveSelected'", "    if(control.id==='cancelOrder'");
 s=between(s,'  function clearDragFeedback()', '  setInterval(');
 s=once(s,'<button class="btn ao-move" data-active-move="true" title="Move rows 移动行">Move rows ↕</button>','');
 s=once(s,"['moveSelected','Move selected ↕'],['saveOrder','Save row order'],['cancelOrder','Cancel move'],",'');
 s=once(s,'canMove:true,orders:','canMove:false,orders:');
 s=once(s,'<b>${esc(row.name)}</b><small>${esc(row.barcode)} · ${esc(row.packing)}</small>','<small>${esc(row.barcode)}</small><b>${esc(row.name)}</b><small>${esc(row.packing)}</small>');
 s=between(s,'  function customerTaskCounts() {','  function compactTaskHeading()',`  function customerTaskCounts() {
    const counts=new Map([['',{pending:0,issues:0}]]);
    for(const task of data.tasks.filter(row=>!row.procurementSource&&!row.archived)){
      const group=window.purchaseTaskGrid.sources(task,data.tasks),coverage=window.purchaseTaskGrid.stockCoverage(task,data.tasks,data.allocations||[]);
      const pending=coverage.remaining>0||group.some(source=>source.procurement?.totalCtn>0&&!source.po);
      const issues=group.some(source=>source.warehouse?.issue===true||(source.quantityCases||[]).some(item=>item.kind==='RECEIPT'&&item.status!=='RESOLVED'&&item.quantity>0));
      if(!counts.has(task.customerId))counts.set(task.customerId,{pending:0,issues:0});
      for(const id of ['',task.customerId]){counts.get(id).pending+=Number(pending);counts.get(id).issues+=Number(issues);}
    }
    return counts;
  }
`);
 s=once(s,"(!ready||!count[key]?'neutral':key)","(!ready?'neutral':key)");
 s=once(s,"[['pending','Pending 待办'],['issues','Issues 有问题']]","[['pending','No PO 未开采购单'],['issues','Receiving issues 高危入库']]");
 return s;
}
function patchGrid(s){
 s=s.replace(/\+\((?:shownGp|inline.sourceGp)<0\.06\?'<svg viewBox="0 0 16 16"[\s\S]*?<\/svg>':''\)/g,'');
 assert(!s.includes('M8 1.5 15 14H1Z'),'low GP triangle remains');
 s=once(s,'<span>View source 查看来源</span>','<span>Info</span>');
 return s;
}
function patchInfo(s){return once(s,"const view=receiptView(m,row.dataset.draftHasSources==='true');",`const view=receiptView(m,row.dataset.draftHasSources==='true');
        // Customer source share is not the PO's cumulative physical receipt.
        const contributionText=row.querySelector('.order-quantity')?.textContent.trim(),contribution=/^\\d+$/.test(contributionText||'')?Number(contributionText):null;
        if(m.sourceId&&Number.isSafeInteger(contribution)&&Number.isSafeInteger(m.received)&&contribution!==m.received){view.value='';view.info=true;view.date='';}`);}
const pickIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 12 5-2 5 2-5 3-5-3Zm0 2 4 2v6l-4-2v-6Zm6 2 4-2v6l-4 2v-6ZM3 3h5l4 3 7-2 1 3-8 3-3-1-1 5-3 2-2-2 3-5-3-3V3Z" fill="currentColor"/></svg>';
function patchLayout(s){const a="warning.innerHTML='",start=s.indexOf(a),end=s.indexOf("';",start);assert(start>=0&&end>start);return s.slice(0,start)+a+pickIcon+s.slice(end);}
function patchCss(s){
 s=s.replace(/#app \.active-order-table\.draft-column-layout :is\(\[data-id\],\[data-split-parent\]\) \.draft-cost-(net|line)::before\{content:'(?:Avg|Total)';font-size:9px;color:#64758a\}\r?\n/g,'');
 assert(!s.includes("content:'Avg'")&&!s.includes("content:'Total'"));
 return s+`\n/* One compact two-line rhythm for customer, date, cost and PO cells. */
#app .active-order-table.draft-column-layout .draft-cost-stack>.draft-cost-line{font-weight:600}
#app .active-order-table.draft-column-layout :is(.customer-short,.received-age){line-height:16px}
#app .active-order-table.draft-column-layout :is(.customer-shipment,.task-received-date,.po-entered-time,.purchase-receipt-date){display:block;margin-top:2px;font:400 10px/14px var(--master-font);letter-spacing:normal;word-spacing:normal}
#app .active-order-table.draft-column-layout :is(.received-quantity,.po-reference){vertical-align:middle}
#app .active-order-table.draft-column-layout .po-reference{line-height:19px}
#app .active-order-table #taskRows .gp-badge{font-size:8px;height:15px;line-height:15px}
`;
}
function patchOrdersCss(s){return once(once(s,'.task-count-pill.pending{background:#fff0d6;color:#975400}', '.task-count-pill.pending{background:#F58A00;color:#fff}'),'.task-count-pill.issues{background:#ffe1e5;color:#c41628}', '.task-count-pill.issues{background:#E51B2B;color:#fff}');}
function patchIndex(s){s=s.replace(/(<meta name="build" content=")[^"]+/, '$1'+build);for(const f of ['app.js','task-grid.js','active-layout.js','active-layout.css','active-orders.css','task-info.js']){const re=new RegExp(f.replaceAll('.','\\.')+'\\?v=[^"&]+');assert(re.test(s),f);s=s.replace(re,f+'?v='+build);}return s;}
module.exports={build,patchApp,patchGrid,patchLayout,patchCss,patchOrdersCss,patchIndex,patchInfo,pickIcon};
