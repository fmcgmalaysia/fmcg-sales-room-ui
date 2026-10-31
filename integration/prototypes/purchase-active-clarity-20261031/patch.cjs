'use strict';
const assert=require('node:assert/strict');
function patchGrid(source){
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'unique clarity hunk: '+before.slice(0,90));source=source.replace(before,()=>after);};
 replace('  function sources(row,tasks)',`  const localDay=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));};
  const receivedDate=value=>{const day=localDay(value);return day?day.slice(8,10)+'-'+day.slice(5,7)+'-'+day.slice(2,4):'';};
  const sinceDate=value=>{const date=receivedDate(value);return date?'<small class="task-received-date" aria-label="Task received 收到任务日期 '+date+'">'+date+'</small>':'';};
  const poLeadTime=(received,assigned)=>{const start=localDay(received),end=localDay(assigned);if(!start||!end||Date.parse(assigned)<Date.parse(received))return '';const days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;return days===0?'Same day':'In '+days+(days===1?' Day':' Days');};
  const extraBadge=n=>'<span class="extra-stock-badge" role="img" aria-label="Extra purchased 额外采购 '+n+' CTN" title="Purchased above customer demand 采购超过客户需求；不代表当前可用库存"><svg viewBox="0 0 50 22" aria-hidden="true"><path d="M4 1h34l11 10-11 10H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z"/><circle cx="40" cy="11" r="1.7"/><text x="5" y="14.5">EXTRA</text></svg><b>'+n+'</b></span>';
  function sources(row,tasks)`);
 replace("poTime=poEntered&&Number.isFinite(Date.parse(poEntered))?new Intl.DateTimeFormat", "poTime=active?poLeadTime(parent?.masterReceivedAt||row.masterReceivedAt,poEntered):poEntered&&Number.isFinite(Date.parse(poEntered))?new Intl.DateTimeFormat");
 replace("const poEntered=(row.history||[]).find(event=>event.action==='PURCHASE_PO_ASSIGNED'&&event.result==='SAVED')?.time,", "const poEntered=(row.history||[]).filter(event=>event.action==='PURCHASE_PO_ASSIGNED'&&event.result==='SAVED'&&Number.isFinite(Date.parse(event.time))).map(event=>event.time).sort((a,b)=>Date.parse(a)-Date.parse(b))[0],");
 replace('orderedCtn:Math.min(row.ord,coverage(original).covered)', 'orderedCtn:active&&sum.ordered>row.ord?sum.ordered:Math.min(row.ord,coverage(original).covered)');
 replace("'<small class=\"extra-stock\">Stock 库存 +'+(sum.ordered-row.ord)+'</small>'", "active?extraBadge(sum.ordered-row.ord):'<small class=\"extra-stock\">Stock 库存 +'+(sum.ordered-row.ord)+'</small>'");
 replace("(active&&child?'':escape(age(row.masterReceivedAt)))", "(active&&child?'':escape(age(row.masterReceivedAt))+(active?sinceDate(row.masterReceivedAt):''))");
 replace("escape(age(row.masterReceivedAt))+(batchIndex?", "escape(age(row.masterReceivedAt))+sinceDate(row.masterReceivedAt)+(batchIndex?");
 replace("aria-description=\"PO 首次录入时间\"", "aria-description=\"Task received to first PO 收任务至首次开单用时\"");
 replace("loans.length?'Borrowed Stock 借入库存':replenished?", "loans.length?(loans.every(loan=>loan.outstanding===0)?'Borrowed · Repaid 借入已补回':'Borrowed Stock 借入库存'):replenished?");
 replace('window.purchaseTaskGrid={stockCoverage,', 'window.purchaseTaskGrid={receivedDate,poLeadTime,stockCoverage,');
 return source;
}
const gridStyle=`\n/* Purchase clarity: read-only extra quantity and real task receipt dates. */\n.purchase-tasks .extra-stock-badge{display:flex;align-items:center;justify-content:center;gap:4px;width:max-content;margin:3px auto 0;padding:2px 5px;border-radius:4px;background:#eaf2ff;color:#24549b;font-size:11px;line-height:18px;white-space:nowrap}\n.extra-stock-badge svg{width:38px;height:18px}.extra-stock-badge svg path{fill:#cfe1fa;stroke:#95b8e9;stroke-width:1}.extra-stock-badge svg circle{fill:#fff}.extra-stock-badge svg text{font:700 9px Arial;fill:#24549b}.extra-stock-badge b{font-weight:600}\n.purchase-tasks .task-received-date{display:block;margin-top:2px;color:#63758a;font-size:10px;white-space:nowrap}\n`;
const dashboardStyle=`\n/* Show small directories completely; scroll only once the list exceeds available space. */\n#app .purchase-dashboard .pd-directory-scroll{height:auto;max-height:clamp(220px,calc(100dvh - 370px),460px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#a9bacb transparent}\n#app .purchase-dashboard .pd-directory-scroll::-webkit-scrollbar{width:7px;height:7px}#app .purchase-dashboard .pd-directory-scroll::-webkit-scrollbar-thumb{background:#a9bacb;border-radius:5px}#app .purchase-dashboard .pd-directory-scroll::-webkit-scrollbar-track{background:transparent}\n`;
module.exports={patchGrid,gridStyle,dashboardStyle};
