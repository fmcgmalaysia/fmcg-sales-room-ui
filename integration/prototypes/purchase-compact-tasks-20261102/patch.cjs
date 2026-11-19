'use strict';
const assert=require('node:assert/strict');
const build='20261102-purchase-compact-tasks-v1';
const helpers=String.raw`
  // Display counts reuse the Dashboard classification, with each customer root counted once.
  function customerTaskCounts() {
    const tasks=new Map(data.tasks.map(task=>[task.id,task])), states=new Map();
    for(const group of window.purchaseDashboard.workQueues(data,poData?.orders||[]).groups){
      const issue=window.purchaseDashboard.issueGroup(group);
      const ids=group.task?[group.task.id]:group.po?.taskIds||[];
      for(const id of ids){
        const source=tasks.get(id),task=source?.procurementSource?tasks.get(source.customerDemandTaskId):source;
        if(!task||task.archived||!task.customerId)continue;
        const previous=states.get(task.id);
        states.set(task.id,{customerId:task.customerId,issue:issue||previous?.issue===true});
      }
    }
    const counts=new Map([['',{pending:0,issues:0}]]);
    for(const state of states.values()){
      if(!counts.has(state.customerId))counts.set(state.customerId,{pending:0,issues:0});
      const key=state.issue?'issues':'pending';counts.get(state.customerId)[key]++;counts.get('')[key]++;
    }
    return counts;
  }
  function compactTaskHeading() {
    const counts=customerTaskCounts(),ready=Boolean(poData),customers=[{id:'',name:'All Customers 全部客户'},...data.customers];
    const badges=id=>{const count=counts.get(id)||{pending:0,issues:0};return [['pending','Pending 待办'],['issues','Issues 有问题']].map(([key,label])=>'<span class="task-count-pill '+(!ready||!count[key]?'neutral':key)+'" title="'+(ready?label:'Status not yet confirmed 状态尚未确认')+'" aria-label="'+(ready?label+' '+count[key]:'Status not yet confirmed')+'">'+(ready?count[key]:'—')+'</span>').join('');};
    const current=customers.find(customer=>customer.id===activeCustomer)||customers[0];
    return '<section class="roomhead active-order-heading compact-task-heading"><h1>Purchase Tasks <small class="ao-title-zh">采购任务</small></h1><div class="compact-task-controls"><details class="task-customer-picker"><summary aria-label="Choose customer 选择客户"><span class="task-customer-name">'+esc(current.shortName||current.name)+'</span>'+badges(current.id)+'<span class="task-picker-chevron" aria-hidden="true">⌄</span></summary><div class="task-customer-options" role="group" aria-label="Customers 客户">'+customers.map(customer=>'<button type="button" data-dashboard-entry="true" data-customer="'+esc(customer.id)+'" aria-pressed="'+String(customer.id===activeCustomer)+'"><span class="task-customer-name">'+esc(customer.shortName||customer.name)+'</span>'+badges(customer.id)+'</button>').join('')+'</div></details><button class="btn ao-move" data-active-move="true" title="Move rows 移动行">Move rows ↕</button></div></section>';
  }
`;
function patchApp(input){
 let source=input;const replace=(a,b)=>{assert.equal(source.split(a).length,2,'Unique app anchor: '+a.slice(0,80));source=source.replace(a,b);};
 replace('  function room(){',helpers+'\n  function room(){');
 const work=source.split('\n').find(line=>line.includes('const workTabs=view==='));assert(work);replace(work,'');
 replace("    const notices=view==='active'?activeOrderNotices(rows):null;",'');
 const start=source.indexOf('    return `<section class="${view===\'active\'?\'roomhead active-order-heading\''),end=source.indexOf('${workTabs}',start);
 assert(start>0&&end>start);const oldHeading=source.slice(start+'    return `'.length,end);
 // Only Active uses the compact heading. The legacy room branch retains its original text.
 replace('    return `'+oldHeading+'${workTabs}','    return `${view===\'active\'?compactTaskHeading():`'+oldHeading+'`}');
 const customerSelect=source.match(/\$\{view==='active'\?`<select id="activeCustomer"[\s\S]*?<\/select>`:''\}/);assert(customerSelect);replace(customerSelect[0],'');
 const filters=source.match(/<select id="allocationFilter"[\s\S]*?<select id="stageFilter"[\s\S]*?<\/select>/);assert(filters);replace(filters[0],"${view==='active'?'':`"+filters[0]+'`}');
 replace("${view==='active'?'<button class=\"btn ao-move\" data-active-move=\"true\">'+(activeCustomer?'Drag rows · ⠿':'Move rows ↕')+'</button>':''}",'');
 replace("if(view==='room'){activeCustomer=customerId;view='active';}","if(view==='room'){activeCustomer=customerId;view='active';}\n    if(view==='active'){allocationFilter=false;supplierFilter='';}");
 replace("if(view==='active'&&['orders','allocation'].includes(control.dataset.activeWork)){allocationFilter=control.dataset.activeWork==='allocation';return render();}",'');
 replace('if(control.dataset.customer){','if(Object.prototype.hasOwnProperty.call(control.dataset,\'customer\')){selectedDisplayRows.clear();');
 replace("document.querySelector('#taskSignals').hidden=view==='dashboard'||", "document.querySelector('#taskSignals').hidden=view==='stock'||view==='dashboard'||");
 replace('  function render() {',"  function render() {\n    const taskPicker=document.querySelector('.task-customer-picker[open]'),pickerFocus=taskPicker?.contains(document.activeElement)?{customer:document.activeElement.dataset?.customer}:null;");
 replace("    paintSaveTracker();if(view==='dashboard')", "    if(view==='active'&&taskPicker){const next=app.querySelector('.task-customer-picker');if(next){next.open=true;if(pickerFocus)(pickerFocus.customer===undefined?next.querySelector('summary'):[...next.querySelectorAll('[data-customer]')].find(button=>button.dataset.customer===pickerFocus.customer))?.focus();}}\n    paintSaveTracker();if(view==='dashboard')");
 replace("if(Object.prototype.hasOwnProperty.call(control.dataset,'customer')){selectedDisplayRows.clear();", "if(Object.prototype.hasOwnProperty.call(control.dataset,'customer')){const picker=document.querySelector('.task-customer-picker');if(picker)picker.open=false;selectedDisplayRows.clear();");
 replace("  document.addEventListener('click',event=>{\n", "  document.addEventListener('click',event=>{\n    const picker=document.querySelector('.task-customer-picker[open]');if(picker&&!picker.contains(event.target))picker.open=false;\n");
 replace('  function room(){',"  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const picker=document.querySelector('.task-customer-picker[open]');if(picker){picker.open=false;picker.querySelector('summary').focus();}});\n  function room(){");
 return source;
}
const css=String.raw`
/* Compact task heading: existing row renderer, fixed columns and scroll handler are unchanged. */
#app>.active-order-heading.compact-task-heading{flex-direction:row;align-items:center;min-height:36px;gap:12px;margin:0 0 12px;padding:0}
#app>.compact-task-heading h1{margin:0;white-space:nowrap;font-size:20px;line-height:28px}
#app>.compact-task-heading h1 .ao-title-zh{display:inline;margin:0;font:inherit;color:inherit}
.compact-task-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0}
#app>.compact-task-heading .ao-move{height:32px;white-space:nowrap;margin:0;padding:4px 9px}
.task-customer-picker{position:relative;min-width:270px;max-width:430px;color:#203047;font-size:11px}
.task-customer-picker summary,.task-customer-options button{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 10px;box-sizing:border-box;font:inherit;color:inherit}
.task-customer-picker summary{list-style:none;cursor:pointer;border:1px solid #b8ccdf;border-radius:4px;background:#fff}
.task-customer-picker summary::-webkit-details-marker{display:none}
.task-customer-name{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.task-count-pill{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;min-width:25px;height:19px;padding:0 6px;border-radius:10px;font:600 11px/1 'Purchase Dashboard Inter','Segoe UI',Arial,sans-serif}
.task-count-pill.pending{background:#fff0d6;color:#975400}.task-count-pill.issues{background:#ffe1e5;color:#c41628}.task-count-pill.neutral{background:#e7eef5;color:#536b84}
.task-picker-chevron{color:#3766a2;flex:none;font-size:16px;line-height:19px}
.task-customer-options{position:absolute;right:0;top:calc(100% + 4px);z-index:12;min-width:100%;width:max-content;max-width:min(430px,90vw);max-height:300px;overflow:auto;background:#fff;border:1px solid #b8ccdf;border-radius:4px;box-shadow:0 4px 12px #17355726;padding:4px}
.task-customer-options button{width:100%;border:0;background:transparent;cursor:pointer;border-radius:3px}
.task-customer-options button[aria-pressed=true]{background:#edf4fc;color:#2563eb}
.task-customer-options button:hover{background:#f1f5fa}
.task-customer-picker summary:focus-visible,.task-customer-options button:focus-visible{outline:2px solid #3766a2;outline-offset:1px}
#app:has(>.compact-task-heading)>.tools:not(:has(.save-group:not([hidden]))):not(:has([data-active-cancel])){display:none}
#app:has(>.compact-task-heading)>.tools .count{display:none}
#app:has(>.compact-task-heading){padding-top:14px;padding-bottom:0}
/* Ordinary child rows are white; selection, issue highlighting and drag feedback remain visible. */
#app .active-order-table.draft-column-layout #taskRows tr.source-row:not(.selected):not(.highlight):not(.grip-down)>td{background:#fff!important}
@media(max-width:760px){#app>.active-order-heading.compact-task-heading{flex-wrap:wrap;gap:8px}.compact-task-controls{flex:1}.task-customer-picker{min-width:210px;flex:1}#app>.compact-task-heading h1{font-size:18px}}
@media(max-width:480px){.compact-task-controls{width:100%}.task-customer-picker{max-width:none}.task-customer-options{max-width:calc(100vw - 36px)}}
`;
function patchDashboard(source){const anchor='window.purchaseDashboard={render,model,workQueues,';assert.equal(source.split(anchor).length,2);return source.replace(anchor,'window.purchaseDashboard={render,model,workQueues,issueGroup,');}
function patchIndex(source){const anchor='<button data-view="active">Active Orders</button>';assert.equal(source.split(anchor).length,2);return source.replace(anchor,anchor+'<button data-view="stock">Stock Actions</button>').replace(/(<meta name="build(?:-version)?" content=")[^"]+/g,'$1'+build).replace(/((?:app\.js|active-orders\.css|dashboard\.js|task-info\.js)\?v=)[^"&]+/g,'$1'+build);}
function patchTaskInfo(source){const anchor="if(view.info){const line=document.createElement('small');line.className='purchase-info-note';line.append(infoButton('allocation',m));allocated.append(line);}";assert.equal(source.split(anchor).length,2);return source.replace(anchor,anchor.replace('if(view.info)',"if(view.info&&!allocated.querySelector('.purchase-info-pending,.purchase-quantity-zero'))"));}
module.exports={build,helpers,css,patchApp,patchDashboard,patchIndex,patchTaskInfo};
