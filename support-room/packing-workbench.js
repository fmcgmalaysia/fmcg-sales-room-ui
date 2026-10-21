const {changePackingList,packingAvailability}=window.SupportPacking;
// Deliberately isolated candidate: no network, browser storage or production save.
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tasks=[
 {taskId:'A1',company:'NCT',customerId:'168',customerName:'168 LTD',currency:'USD',remaining:50,ready:50,barcode:'9556404007035',name:'7 UP (CAN)',packing:'320ML × 24',cbm:0.0118,weight:8.4},
 {taskId:'A2',company:'NCT',customerId:'168',customerName:'168 LTD',currency:'USD',remaining:50,ready:50,barcode:'955558920293',name:'A&W SARSAPARILLA PET',packing:'500ML × 24',cbm:0.0185,weight:12},
 {taskId:'A3',company:'NCT',customerId:'168',customerName:'168 LTD',currency:'USD',remaining:100,ready:20,barcode:'EXAMPLE-03',name:'CHOCOLATE BISCUITS',packing:'24 × 1',cbm:null,weight:null},
 {taskId:'B1',company:'NCT',customerId:'SCOMM',customerName:'SCOMM (MYR)',currency:'MYR',remaining:200,ready:100,barcode:'4710363521543',name:'MAGICLEAN TOILET BLEACH POWER - LEMON',packing:'500ML × 12',cbm:0.0144,weight:6},
 {taskId:'G1',company:'GHR',customerId:'GHR-C',customerName:'GHR EXAMPLE CUSTOMER',currency:'USD',remaining:30,ready:30,barcode:'GHR-EXAMPLE',name:'EXAMPLE PRODUCT',packing:'12 × 1',cbm:null,weight:null}
];
let company='NCT',actor='SUPPORT',view='unarranged',lists=[],sequence=0,selection=new Set(),editing=null,opened=null;
const labels={DRAFT:'Draft 草稿',SENT:'Sent 已发送',PROCESSING:'Processing 货仓处理中',COMPLETED:'Loading Complete 装柜完成',CANCELLED:'Cancelled 已取消'};
const context=()=>({tasks:tasks.filter(task=>task.company===company),lists:lists.filter(list=>list.company===company)});
const available=exclude=>packingAvailability(context(),exclude);
const taskFor=id=>tasks.find(task=>task.taskId===id);
const product=line=>'<small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small>';
function act(list,action,extra={}){
 const next=changePackingList({list,input:{action,revision:list?.revision,company,...extra},context:context(),actor,id:'PL-'+String(++sequence).padStart(4,'0'),revision:'REV-'+sequence,at:new Date().toISOString()});
 lists=lists.filter(row=>row.id!==next.id).concat(next);$('notice').textContent='Candidate updated 候选已更新 · '+next.id+' · '+labels[next.status];render();return next;
}
function filtered(rows){const query=$('search').value.trim().toLowerCase(),customer=$('customer').value;return rows.filter(row=>(!customer||row.customerId===customer)&&(!query||JSON.stringify(row).toLowerCase().includes(query)));}
function render(){
 $('department').innerHTML=actor==='SUPPORT'?'Support Department <small>支持部</small>':'Warehouse Department <small>货仓部</small>';
 $('unarranged-tab').hidden=actor!=='SUPPORT';$('unarranged-tab').classList.toggle('active',view==='unarranged');$('lists-tab').classList.toggle('active',view==='lists');$('lists-tab').textContent=actor==='SUPPORT'?'Packing Lists 备货单':'Outgoing 发货任务';
 $('title').innerHTML=view==='unarranged'?'To Arrange <small>待安排发货</small>':actor==='SUPPORT'?'Packing Lists <small>备货单</small>':'Outgoing <small>发货任务</small>';
 $('create').hidden=view!=='unarranged'||actor!=='SUPPORT';$('create').disabled=!selection.size;
 $('help').textContent=view==='unarranged'?'Select one customer. Sending occupies quantities; drafts do not. 勾选同一客户；发送才占用数量，草稿不占用。':'Support and Warehouse share one list. Both planned and actual quantities remain visible. 两部门共用同一备货单，保留计划与实装数量。';
 if(view==='unarranged'){
  const rows=filtered(available().filter(row=>row.unarranged>0));
  $('head').innerHTML='<tr><th></th><th>Customer 客户</th><th>Description 产品</th><th class="num">Remaining 待发</th><th class="num">Held 已安排</th><th class="num">To Arrange 未安排</th><th class="num">Ready 可备</th><th class="num">CBM/CTN</th><th class="num">Net kg/CTN</th></tr>';
  const selectedTask=taskFor([...selection][0]);
  $('rows').innerHTML=rows.map(row=>'<tr class="'+(selection.has(row.taskId)?'selected':'')+'"><td><input type="checkbox" data-select="'+esc(row.taskId)+'" aria-label="Select '+esc(row.name)+'" '+(selection.has(row.taskId)?'checked ':'')+(selectedTask&&selectedTask.customerId!==row.customerId?'disabled':'')+'></td><td>'+esc(row.customerName)+'</td><td class="product">'+product(row)+'</td><td class="num">'+row.remaining+'</td><td class="num">'+row.held+'</td><td class="num">'+row.unarranged+'</td><td class="num">'+row.readyToArrange+'</td><td class="num">'+(row.cbm??'')+'</td><td class="num">'+(row.weight??'')+'</td></tr>').join('');$('count').textContent=rows.length+' rows 行';
 }else{
  const rows=filtered(context().lists.filter(list=>actor==='SUPPORT'||list.status!=='DRAFT'));
  $('head').innerHTML='<tr><th>Packing List 备货单</th><th>Customer 客户</th><th class="num">Products 项数</th><th class="num">Plan 计划</th><th class="num">Packed 已备</th><th class="num">Loaded 实装</th><th class="num">Unloaded 未装</th><th>Status 状态</th></tr>';
  $('rows').innerHTML=rows.map(list=>{const sum=field=>list.lines.reduce((n,line)=>n+line[field],0);return '<tr><td><button class="row-action" data-open="'+esc(list.id)+'">'+esc(list.id)+'</button></td><td>'+esc(taskFor(list.lines[0].taskId).customerName)+'</td><td class="num">'+list.lines.length+'</td><td class="num">'+sum('quantity')+'</td><td class="num">'+sum('packed')+'</td><td class="num">'+sum('loaded')+'</td><td class="num">'+(sum('quantity')-sum('loaded'))+'</td><td><span class="state '+(['COMPLETED','CANCELLED'].includes(list.status)?'':'pending')+'">'+labels[list.status]+'</span>'+(list.change?' · Change pending 变更待确认':'')+'</td></tr>';}).join('');$('count').textContent=rows.length+' lists 单';
 }
 if(!$('rows').innerHTML)$('rows').innerHTML='<tr><td colspan="9">No matching tasks 没有符合条件的任务</td></tr>';
}
function openEdit(list=null){
 editing=list;const ids=list?list.lines.map(line=>line.taskId):[...selection],rows=available(list?.id).filter(row=>ids.includes(row.taskId));
 $('edit-customer').textContent=rows[0]?.customerName||'';$('edit-title').textContent=list?.status==='PROCESSING'?'Change Request 提交变更':'Packing Draft 备货草稿';
 $('edit-help').textContent=list?.status==='PROCESSING'?'Warehouse must acknowledge the change before it takes effect. 变更经货仓确认后生效。':'Plan may include waiting stock. Sending requires usable customer stock. 可先安排待到货需求，发送时必须已有可备货。';
 $('edit-lines').innerHTML=rows.map(row=>'<tr><td>'+product(row)+'</td><td class="num">'+row.readyToArrange+'</td><td class="num"><input type="number" min="1" max="'+row.unarranged+'" step="1" data-plan="'+esc(row.taskId)+'" aria-label="Planned '+esc(row.name)+'" value="'+(list?.lines.find(line=>line.taskId===row.taskId)?.quantity||Math.min(row.unarranged,row.readyToArrange)||row.unarranged)+'"></td></tr>').join('');
 $('edit-reason').value='';$('edit-error').textContent='';$('save-edit').textContent=list?.status==='PROCESSING'?'Submit Change 提交变更':'Save Draft 保存草稿';$('edit').showModal();
}
function openDetail(list){
 opened=list;$('detail-customer').textContent=taskFor(list.lines[0].taskId).customerName;$('detail-title').textContent=list.id;$('detail-status').textContent=labels[list.status];
 $('pending-change').hidden=!list.change;$('pending-change').textContent=list.change?'Change pending 变更待确认 · '+list.change.reason+' · '+list.change.lines.map(line=>line.name+': '+(list.lines.find(old=>old.taskId===line.taskId)?.quantity||0)+' → '+line.quantity).join(' · '):'';
 const editable=actor==='WAREHOUSE'&&list.status==='PROCESSING';
 $('detail-lines').innerHTML=list.lines.map(line=>'<tr data-progress="'+esc(line.taskId)+'"><td>'+product(line)+'</td><td class="num">'+line.quantity+'</td><td class="num">'+(editable?'<input data-packed type="number" min="0" step="1" max="'+line.quantity+'" aria-label="Packed '+esc(line.name)+'" value="'+line.packed+'">':line.packed)+'</td><td class="num">'+(editable?'<input data-loaded type="number" min="0" step="1" max="'+line.quantity+'" aria-label="Loaded '+esc(line.name)+'" value="'+line.loaded+'">':line.loaded)+'</td><td>'+(editable?'<input data-reason maxlength="1000" aria-label="Reason '+esc(line.name)+'" value="'+esc(line.reason)+'">':esc(line.reason))+'</td></tr>').join('');
 $('remainders').textContent=list.status==='COMPLETED'?'Unloaded remainders are available for the next arrangement; customer demand and stock ownership remain. 未装余量已回待安排，保留客户需求与货物归属。':'';
 $('action-reason').value='';$('detail-error').textContent='';let actions='<button data-close="detail">Close 关闭</button>';
 const button=(action,label)=>'<button data-action="'+action+'" class="primary">'+label+'</button>';
 if(actor==='SUPPORT'){
  if(['DRAFT','SENT'].includes(list.status)){actions+=button('EDIT','Edit 修改');if(list.status==='DRAFT')actions+=button('SEND','Send to Warehouse 发送货仓');actions+=button('CANCEL','Cancel List 取消备货单');}
  if(list.status==='PROCESSING'&&!list.change)actions+=button('CHANGE','Request Change 提交变更');
 }else{
  if(list.status==='SENT')actions+=button('START','Start Packing 开始备货');
  if(list.status==='PROCESSING'){actions+=button('PROGRESS','Save Progress 保存进度');if(list.change)actions+=button('ACCEPT_CHANGE','Accept Change 确认变更')+button('REJECT_CHANGE','Reject Change 拒绝变更');else actions+=button('COMPLETE','Loading Complete 确认装柜完成');}
  if(list.status==='COMPLETED')actions+=button('REOPEN','Reopen Loading 重新装柜');
 }
 $('detail-actions').innerHTML=actions;if(!$('detail').open)$('detail').showModal();
}
$('create').onclick=()=>openEdit();
$('save-edit').onclick=()=>{try{const lines=[...document.querySelectorAll('[data-plan]')].map(input=>({taskId:input.dataset.plan,quantity:Number(input.value)})),task=taskFor(lines[0]?.taskId);act(editing,editing?.status==='PROCESSING'?'CHANGE':editing?'EDIT':'CREATE',{customerId:task.customerId,currency:task.currency,lines,reason:$('edit-reason').value});$('edit').close();selection.clear();view='lists';render();}catch(error){$('edit-error').textContent=error.message;}};
$('rows').onclick=event=>{const button=event.target.closest('[data-open]');if(button)openDetail(lists.find(list=>list.id===button.dataset.open));};
$('rows').onchange=event=>{const id=event.target.dataset.select;if(id){if(event.target.checked)selection.add(id);else selection.delete(id);render();}};
$('detail-actions').onclick=event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
 if(action==='EDIT'||action==='CHANGE'){$('detail').close();openEdit(opened);return;}
 try{const extra={reason:$('action-reason').value};if(action==='PROGRESS')extra.lines=[...document.querySelectorAll('[data-progress]')].map(row=>({taskId:row.dataset.progress,packed:Number(row.querySelector('[data-packed]').value),loaded:Number(row.querySelector('[data-loaded]').value),reason:row.querySelector('[data-reason]').value}));
  openDetail(act(opened,action,extra));
 }catch(error){$('detail-error').textContent=error.message;}
};
document.addEventListener('click',event=>{const close=event.target.closest('[data-close]');if(close)$(close.dataset.close).close();});
$('role').onchange=()=>{actor=$('role').value;selection.clear();view=actor==='WAREHOUSE'?'lists':'unarranged';render();};
$('company').onchange=()=>{company=$('company').value;selection.clear();populateCustomers();$('company-name').textContent=company==='NCT'?'North Cape Trading Sdn. Bhd.':'Global HR';render();};
$('customer').onchange=()=>{selection.clear();render();};$('search').oninput=render;
$('unarranged-tab').onclick=()=>{view='unarranged';render();};$('lists-tab').onclick=()=>{view='lists';render();};
function populateCustomers(){$('customer').innerHTML='<option value="">All Customers 全部客户</option>'+[...new Map(tasks.filter(task=>task.company===company).map(task=>[task.customerId,task.customerName]))].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');}
populateCustomers();render();
