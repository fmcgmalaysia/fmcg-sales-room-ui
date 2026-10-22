const {changePackingList,packingAvailability}=window.SupportPacking;
// Default local candidate is isolated. Official Wix entry explicitly selects live=1.
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parameters=new URLSearchParams(location.search),live=parameters.get('live')==='1',embedded=parameters.get('embedded')==='warehouse';
let tasks=[
 {taskId:'A1',company:'NCT',customerId:'168',customerName:'168 LTD',currency:'USD',remaining:50,ready:50,barcode:'9556404007035',name:'7 UP (CAN)',packing:'320ML × 24',cbm:0.0118,weight:8.4},
 {taskId:'A2',company:'NCT',customerId:'168',customerName:'168 LTD',currency:'USD',remaining:50,ready:50,barcode:'955558920293',name:'A&W SARSAPARILLA PET',packing:'500ML × 24',cbm:0.0185,weight:12},
 {taskId:'A3',company:'NCT',customerId:'168',customerName:'168 LTD',currency:'USD',remaining:100,ready:20,barcode:'EXAMPLE-03',name:'CHOCOLATE BISCUITS',packing:'24 × 1',cbm:null,weight:null},
 {taskId:'B1',company:'NCT',customerId:'SCOMM',customerName:'SCOMM (MYR)',currency:'MYR',remaining:200,ready:100,barcode:'4710363521543',name:'MAGICLEAN TOILET BLEACH POWER - LEMON',packing:'500ML × 12',cbm:0.0144,weight:6},
 {taskId:'G1',company:'GHR',customerId:'GHR-C',customerName:'GHR EXAMPLE CUSTOMER',currency:'USD',remaining:30,ready:30,barcode:'GHR-EXAMPLE',name:'EXAMPLE PRODUCT',packing:'12 × 1',cbm:null,weight:null}
];
if(live)tasks=[];
let company=parameters.get('company')==='GHR'?'GHR':'NCT',actor=parameters.get('department')==='WAREHOUSE'?'WAREHOUSE':'SUPPORT',view=actor==='WAREHOUSE'?'lists':'unarranged',lists=[],sequence=0,selection=new Set(),editing=null,opened=null,version='',busy=false,needsRead=live;
const labels={DRAFT:'Draft 草稿',SENT:'Sent 已发送',PROCESSING:'Processing 货仓处理中',COMPLETED:'Loading Complete 装柜完成',CANCELLED:'Cancelled 已取消'};
const context=()=>({tasks:tasks.filter(task=>task.company===company),lists:lists.filter(list=>list.company===company)});
const available=exclude=>packingAvailability(context(),exclude);
const taskFor=id=>tasks.find(task=>task.taskId===id);
const product=line=>'<small>'+esc(line.barcode)+'</small><strong>'+esc(line.name)+'</strong><small>'+esc(line.packing)+'</small>';
const transport=live?window.createPackingTransport({company:()=>company,department:()=>actor,onBusy:value=>{busy=value;const pending=Boolean(transport?.hasPending());$('retry').hidden=!pending;for(const element of document.querySelectorAll('[data-retry],[data-login]'))element.hidden=!pending;for(const element of document.querySelectorAll('#company,#create,#save-edit,[data-action]'))element.disabled=value||pending;notifyLayout();}}):null;
function notifyLayout(){if(embedded&&parent!==window){let origin='';try{origin=new URL(document.referrer).origin;}catch(_){}if(origin===location.origin)parent.postMessage({type:'PACKING_LAYOUT',company,busy:busy||Boolean(transport?.hasPending())||Boolean(document.querySelector('dialog[open]'))||Boolean(window.departmentMessages?.isBusy?.()),height:document.documentElement.scrollHeight},origin);}}
async function readLive(){if(!live)return;if(transport.hasPending())throw Error('Retry the previous save before refreshing.');const result=await transport.read();if(result?.company!==company||result.department!==actor||!Array.isArray(result.tasks)||!Array.isArray(result.lists)||!result.version)throw Error('Packing response requires review.');tasks=result.tasks;lists=result.lists;version=result.version;needsRead=false;selection.clear();$('login').hidden=true;document.querySelector('header>b').textContent=result.staff?.staffName||'';populateCustomers();render();}
async function act(list,action,extra={}){
 if(live){if(needsRead)throw Error('Refresh current packing data before saving.');const result=await transport.save({action,id:list?.id,revision:list?.revision,version,company,...extra});needsRead=true;try{await readLive();}catch(_){throw Error('Saved. Close this dialog and refresh to confirm the latest list. 已保存；请关闭弹窗并刷新核对。');}const saved=lists.find(row=>row.id===result.id);if(!saved)throw Error('Saved; refresh to confirm this list.');$('notice').textContent='Saved 已保存 · '+saved.id;return saved;}
 const next=changePackingList({list,input:{action,revision:list?.revision,company,...extra},context:context(),actor,id:'PL-'+String(++sequence).padStart(4,'0'),revision:'REV-'+sequence,at:new Date().toISOString()});
 lists=lists.filter(row=>row.id!==next.id).concat(next);$('notice').textContent='Candidate updated 候选已更新 · '+next.id+' · '+labels[next.status];render();return next;
}
function filtered(rows){const query=$('search').value.trim().toLowerCase(),customer=$('customer').value;return rows.filter(row=>(!customer||row.customerId===customer)&&(!query||JSON.stringify(row).toLowerCase().includes(query)));}
function render(){
 $('company-name').textContent=company==='NCT'?'North Cape Trading Sdn. Bhd.':'Global HR';
 $('department').innerHTML=actor==='SUPPORT'?'Support Department <small>支持部</small>':'Warehouse Department <small>货仓部</small>';
 $('unarranged-tab').hidden=actor!=='SUPPORT';$('unarranged-tab').classList.toggle('active',view==='unarranged');$('lists-tab').classList.toggle('active',view==='lists');$('lists-tab').textContent=actor==='SUPPORT'?'Packing Lists 备货单':'Outgoing 发货任务';
 $('title').innerHTML=view==='unarranged'?'To Arrange <small>待安排发货</small>':actor==='SUPPORT'?'Packing Lists <small>备货单</small>':'Outgoing <small>发货任务</small>';
 $('create').hidden=view!=='unarranged'||actor!=='SUPPORT';$('create').disabled=!selection.size;
 $('help').textContent=view==='unarranged'?'Select one customer. Sending occupies quantities; drafts do not. 勾选同一客户；发送才占用数量，草稿不占用。':'Support and Warehouse share one list. Both planned and actual quantities remain visible. 两部门共用同一备货单，保留计划与实装数量。';
 if(view==='unarranged'){
  const rows=filtered(available().filter(row=>row.unarranged>0));
  $('head').innerHTML='<tr><th></th><th>Customer 客户</th><th>Description 产品</th><th class="num">Remaining 待发</th><th class="num">Held 已安排</th><th class="num">To Arrange 未安排</th><th class="num">Ready 可备</th><th class="num">CBM/CTN</th><th class="num">Net kg/CTN</th></tr>';
  const selectedTask=taskFor([...selection][0]);
  $('rows').innerHTML=rows.map(row=>'<tr class="'+(selection.has(row.taskId)?'selected':'')+'"><td><input type="checkbox" data-select="'+esc(row.taskId)+'" aria-label="Select '+esc(row.name)+'" '+(selection.has(row.taskId)?'checked ':'')+(selectedTask&&selectedTask.customerId!==row.customerId?'disabled':'')+'></td><td>'+esc(row.customerName)+'</td><td class="product">'+product(row)+'</td><td class="num">'+row.remaining+'</td><td class="num">'+row.held+'</td><td class="num">'+row.unarranged+'</td><td class="num">'+(row.review?'Review 待核对':row.readyToArrange)+'</td><td class="num">'+(row.cbm??'')+'</td><td class="num">'+(row.weight??'')+'</td></tr>').join('');$('count').textContent=rows.length+' rows 行';
 }else{
  const rows=filtered(context().lists.filter(list=>actor==='SUPPORT'||list.status!=='DRAFT'));
  $('head').innerHTML='<tr><th>Packing List 备货单</th><th>Customer 客户</th><th class="num">Products 项数</th><th class="num">Plan 计划</th><th class="num">Packed 已备</th><th class="num">Loaded 实装</th><th class="num">Unloaded 未装</th><th>Status 状态</th></tr>';
  $('rows').innerHTML=rows.map(list=>{const sum=field=>list.lines.reduce((n,line)=>n+line[field],0);return '<tr><td><button class="row-action" data-open="'+esc(list.id)+'">'+esc(list.id)+'</button></td><td>'+esc(list.customerName||taskFor(list.lines[0].taskId)?.customerName||list.customerId)+'</td><td class="num">'+list.lines.length+'</td><td class="num">'+sum('quantity')+'</td><td class="num">'+sum('packed')+'</td><td class="num">'+sum('loaded')+'</td><td class="num">'+(sum('quantity')-sum('loaded'))+'</td><td><span class="state '+(['COMPLETED','CANCELLED'].includes(list.status)?'':'pending')+'">'+labels[list.status]+'</span>'+(list.change?' · Change pending 变更待确认':'')+'</td></tr>';}).join('');$('count').textContent=rows.length+' lists 单';
 }
 if(!$('rows').innerHTML)$('rows').innerHTML='<tr><td colspan="9">No matching tasks 没有符合条件的任务</td></tr>';
 notifyLayout();
}
function openEdit(list=null){
 editing=list;const ids=list?list.lines.map(line=>line.taskId):[...selection],rows=available(list?.id).filter(row=>list?row.customerId===list.customerId&&row.currency===list.currency&&(row.unarranged>0||ids.includes(row.taskId)):ids.includes(row.taskId));
 $('edit-customer').textContent=rows[0]?.customerName||'';$('edit-title').textContent=list?.status==='PROCESSING'?'Change Request 提交变更':'Packing Draft 备货草稿';
 $('edit-help').textContent=list?.status==='PROCESSING'?'Warehouse must acknowledge the change before it takes effect. 变更经货仓确认后生效。':'Plan may include waiting stock. Sending requires usable customer stock. 可先安排待到货需求，发送时必须已有可备货。';
 $('edit-lines').innerHTML=rows.map(row=>'<tr><td><input type="checkbox" data-include="'+esc(row.taskId)+'" aria-label="Include '+esc(row.name)+'" '+(ids.includes(row.taskId)?'checked':'')+'></td><td>'+product(row)+'</td><td class="num">'+(row.review?'Review 待核对':row.readyToArrange)+'</td><td class="num"><input type="number" min="1" max="'+row.unarranged+'" step="1" data-plan="'+esc(row.taskId)+'" aria-label="Planned '+esc(row.name)+'" value="'+(list?.lines.find(line=>line.taskId===row.taskId)?.quantity||Math.min(row.unarranged,row.readyToArrange)||row.unarranged)+'"></td></tr>').join('');
 $('edit-reason').value='';$('edit-error').textContent='';$('save-edit').textContent=list?.status==='PROCESSING'?'Submit Change 提交变更':'Save Draft 保存草稿';$('edit').showModal();notifyLayout();
}
function openDetail(list){
 opened=list;$('detail-customer').textContent=list.customerName||taskFor(list.lines[0].taskId)?.customerName||list.customerId;$('detail-title').textContent=list.id;$('detail-status').textContent=labels[list.status];
 $('pending-change').hidden=!list.change&&!list.stockDamageReviewRequired;$('pending-change').textContent=(list.stockDamageReviewRequired?"Damage recheck required 待复核破损影响 · Inspect usable goods, correct Packed and Loaded with a reason, then save progress. 检查实货，更正备货与装柜数量，填写原因后保存进度。 · ":'')+(list.change?'Change pending 变更待确认 · '+list.change.reason+' · '+list.change.lines.map(line=>line.name+': '+(list.lines.find(old=>old.taskId===line.taskId)?.quantity||0)+' → '+line.quantity).join(' · '):'');
 const editable=actor==='WAREHOUSE'&&list.status==='PROCESSING';
 $('detail-lines').innerHTML=list.lines.map(line=>'<tr data-progress="'+esc(line.taskId)+'"><td>'+product(line)+'</td><td class="num">'+line.quantity+'</td><td class="num">'+(editable?'<input data-packed type="number" min="0" step="1" max="'+Math.min(line.quantity,line.stockUsableForList??line.quantity)+'" aria-label="Packed '+esc(line.name)+'" value="'+line.packed+'">':line.packed)+'</td><td class="num">'+(editable?'<input data-loaded type="number" min="0" step="1" max="'+Math.min(line.quantity,line.stockUsableForList??line.quantity)+'" aria-label="Loaded '+esc(line.name)+'" value="'+line.loaded+'">':line.loaded)+'</td><td>'+(editable?'<input data-reason maxlength="1000" aria-label="Reason '+esc(line.name)+'" value="'+esc(line.reason)+'">':esc(line.reason))+'</td></tr>').join('');
 $('remainders').textContent=list.status==='COMPLETED'?'Unloaded remainders are available for the next arrangement; customer demand and stock ownership remain. 未装余量已回待安排，保留客户需求与货物归属。':'';
 renderEvidence(list);
 $('action-reason').value='';$('detail-error').textContent='';let actions='<button data-close="detail">Close 关闭</button><button data-login hidden>Sign in 登入</button><button data-retry hidden>Retry Same Save 重试本次保存</button>';
 const button=(action,label)=>'<button data-action="'+action+'" class="primary">'+label+'</button>';
 if(actor==='SUPPORT'){
  if(['DRAFT','SENT'].includes(list.status)){actions+=button('EDIT','Edit 修改');if(list.status==='DRAFT')actions+=button('SEND','Send to Warehouse 发送货仓');actions+=button('CANCEL','Cancel List 取消备货单');}
  if(list.status==='PROCESSING'&&!list.change)actions+=button('CHANGE','Request Change 提交变更');
 }else{
  if(list.status==='SENT')actions+=button('START','Start Packing 开始备货');
  if(list.status==='PROCESSING'){actions+=button('PROGRESS','Save Progress 保存进度');if(list.change)actions+=button('ACCEPT_CHANGE','Accept Change 确认变更')+button('REJECT_CHANGE','Reject Change 拒绝变更');else actions+=button('COMPLETE','Loading Complete 确认装柜完成');}
  if(list.status==='COMPLETED')actions+=button('REOPEN','Reopen Loading 重新装柜');
 }
 $('detail-actions').innerHTML=actions;if(!$('detail').open)$('detail').showModal();notifyLayout();
}
$('create').onclick=()=>openEdit();
$('save-edit').onclick=async()=>{if(busy)return;try{const included=new Set([...document.querySelectorAll('[data-include]')].filter(input=>input.checked).map(input=>input.dataset.include)),lines=[...document.querySelectorAll('[data-plan]')].filter(input=>included.has(input.dataset.plan)).map(input=>({taskId:input.dataset.plan,quantity:Number(input.value)})),task=taskFor(lines[0]?.taskId);if(!task)throw Error('Choose at least one product. 至少勾选一项产品。');await act(editing,editing?.status==='PROCESSING'?'CHANGE':editing?'EDIT':'CREATE',{customerId:task.customerId,currency:task.currency,lines,reason:$('edit-reason').value});$('edit').close();selection.clear();view='lists';render();}catch(error){$('edit-error').textContent=error.message;}};
$('rows').onclick=event=>{const button=event.target.closest('[data-open]');if(button)openDetail(lists.find(list=>list.id===button.dataset.open));};
$('rows').onchange=event=>{const id=event.target.dataset.select;if(id){if(event.target.checked)selection.add(id);else selection.delete(id);render();}};
$('detail-actions').onclick=async event=>{const button=event.target.closest('[data-action]');if(!button||busy)return;const action=button.dataset.action;
 if(action==='EDIT'||action==='CHANGE'){$('detail').close();openEdit(opened);return;}
 try{const extra={reason:$('action-reason').value};if(action==='PROGRESS')extra.lines=[...document.querySelectorAll('[data-progress]')].map(row=>({taskId:row.dataset.progress,packed:Number(row.querySelector('[data-packed]').value),loaded:Number(row.querySelector('[data-loaded]').value),reason:row.querySelector('[data-reason]').value}));
  openDetail(await act(opened,action,extra));
 }catch(error){$('detail-error').textContent=error.message;}
};
document.addEventListener('click',event=>{if(event.target.closest('[data-retry]'))retrySave();if(event.target.closest('[data-login]'))transport?.login(actor);const close=event.target.closest('[data-close]');if(close&&!busy&&!transport?.hasPending()){$(close.dataset.close).close();notifyLayout();}});
$('role').onchange=()=>{actor=$('role').value;selection.clear();view=actor==='WAREHOUSE'?'lists':'unarranged';render();};
$('company').onchange=()=>{if(busy||transport?.hasPending()||window.departmentMessages?.isBusy?.()){$('company').value=company;return;}company=$('company').value;selection.clear();if(live){tasks=[];lists=[];version='';needsRead=true;readLive().catch(showReadError);}populateCustomers();$('company-name').textContent=company==='NCT'?'North Cape Trading Sdn. Bhd.':'Global HR';render();};
$('customer').onchange=()=>{selection.clear();render();};$('search').oninput=render;
$('unarranged-tab').onclick=()=>{view='unarranged';render();};$('lists-tab').onclick=()=>{view='lists';render();};
function populateCustomers(){$('customer').innerHTML='<option value="">All Customers 全部客户</option>'+[...new Map([...tasks.filter(task=>task.company===company),...lists.filter(list=>list.company===company)].map(task=>[task.customerId,task.customerName||task.customerId]))].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');}
function showReadError(error){$('notice').textContent=error.message;$('login').hidden=false;}
$('refresh').onclick=()=>readLive().catch(showReadError);$('login').onclick=()=>transport?.login(actor);
$('retry').onclick=retrySave;
async function retrySave(){if(!transport||busy)return;try{await transport.retry();needsRead=true;try{await readLive();}catch(_){throw Error('Saved. Close this dialog and refresh to confirm the latest list. 已保存；请关闭弹窗并刷新核对。');}$('edit').close();$('detail').close();view='lists';render();}catch(error){$('notice').textContent=error.message;if($('edit').open)$('edit-error').textContent=error.message;if($('detail').open)$('detail-error').textContent=error.message;}}
if(live){document.querySelector('.example-role').hidden=true;$('refresh').hidden=false;document.querySelector('.draft-label').textContent='Packing Lists 备货单';document.querySelector('.preview-note').textContent='Send confirmed customer stock to Warehouse. Loading completion releases only unshipped scheduling quantities; it does not cancel the customer order or post stock dispatch. 发送客户已到可用货；装柜完成只释放未装安排，不取消订单或扣减出库库存。';document.querySelector('header>b').textContent='';}
if(embedded){document.body.classList.add('embedded');$('company').hidden=true;}
window.addEventListener('message',event=>{if(!live||event.source!==parent)return;let expected='';try{expected=new URL(document.referrer).origin;}catch(_){}if(event.origin!==expected)return;const message=event.data||{};if(message.type==='PACKING_REFRESH'&&message.company===company&&!busy&&!transport.hasPending()&&!$('edit').open&&!$('detail').open)readLive().catch(showReadError);if(['FULFILMENT_LOGIN_RESULT','WAREHOUSE_LOGIN_RESULT'].includes(message.type)&&message.ok===true&&!transport.hasPending())readLive().catch(showReadError);});
for(const dialog of document.querySelectorAll('dialog')){dialog.addEventListener('close',notifyLayout);dialog.addEventListener('cancel',event=>{if(busy||transport?.hasPending())event.preventDefault();});}
const editFooter=$('edit').querySelector('footer');for(const [attribute,label] of [['data-login','Sign in 登入'],['data-retry','Retry Same Save 重试本次保存']]){const button=document.createElement('button');button.setAttribute(attribute,'');button.textContent=label;button.hidden=true;editFooter.appendChild(button);}
const evidence=document.createElement('section');evidence.id='packing-evidence';$('remainders').after(evidence);
function renderEvidence(list){
 const photos=[...list.lines,...(list.retiredLines||[])].flatMap(line=>(line.photos||[]).map(photo=>({...photo,product:line.name})));
 let html='<details><summary>Photos 照片 · '+photos.length+'</summary>'+photos.map(photo=>'<p>'+esc(photo.product)+' · <a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+encodeURIComponent(photo.fileId)+'/view">'+esc(photo.stage==='PACKING'?'Packing 备货':'Loading 装货')+' · '+esc(photo.at)+'</a></p>').join('');
 if(live&&actor==='WAREHOUSE'&&['PROCESSING','COMPLETED'].includes(list.status))html+='<p>Save quantity changes before adding photos. 先保存数量，再补充照片。</p><div class="photo-tools"><select id="photo-product" aria-label="Photo product">'+list.lines.map(line=>'<option value="'+esc(line.taskId)+'">'+esc(line.name)+'</option>').join('')+'</select><select id="photo-stage" aria-label="Photo stage"><option value="PACKING">Packing 备货</option><option value="LOADING">Loading 装货</option></select><label class="row-action">📷 Camera 相机<input data-packing-photo type="file" accept="image/*" capture="environment" hidden></label><label class="row-action">Gallery 相册<input data-packing-photo type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div>';
 html+='</details>';
 if(live)html+='<details><summary>Messages 留言</summary>'+list.lines.map(line=>'<p>'+esc(line.name)+' '+(line.chatContexts||[]).map(context=>(actor==='WAREHOUSE'?['SUPPORT']:['WAREHOUSE','SALES']).map(peer=>'<button class="row-action" data-packing-chat="'+esc(context.id)+'" data-peer="'+peer+'">'+(peer==='WAREHOUSE'?'W':peer==='SALES'?'Sales':'S')+' · '+esc(context.label)+'</button>').join('')).join(' · ')+'</p>').join('')+'</details>';
 evidence.innerHTML=html;
}
async function compressPhoto(file){
 if(!file.type.startsWith('image/')||file.size>25*1024*1024)throw Error('Choose a photo under 25 MB. 请选择25MB以内照片。');
 let image;try{image=await createImageBitmap(file);}catch(_){throw Error('Choose JPEG, PNG or WebP. 请选择 JPEG、PNG 或 WebP 照片。');}
 const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));if(!blob||blob.size>650*1024)throw Error('Choose a smaller photo. 请选择较小照片。');
 const bytes=new Uint8Array(await blob.arrayBuffer()),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return {mimeType:'image/jpeg',base64:btoa(binary),sha256};
}
evidence.addEventListener('change',async event=>{
 const input=event.target.closest('[data-packing-photo]');if(!input||!live||busy||transport.hasPending())return;
 try{
  if(!input.files.length||input.files.length>3)throw Error('Choose one to three photos. 每次一至三张照片。');
  if([...document.querySelectorAll('[data-progress]')].filter(row=>row.querySelector('[data-packed]')).some(row=>{const line=opened.lines.find(line=>line.taskId===row.dataset.progress);return Number(row.querySelector('[data-packed]').value)!==line.packed||Number(row.querySelector('[data-loaded]').value)!==line.loaded||row.querySelector('[data-reason]').value!==line.reason;}))throw Error('Save progress before adding photos. 请先保存进度，再补充照片。');
  const taskId=$('photo-product').value,photoStage=$('photo-stage').value,line=opened.lines.find(line=>line.taskId===taskId);if(!line||(photoStage==='PACKING'?!line.packed:!line.loaded))throw Error('Confirm packed or loaded cartons first. 请先确认备货或装柜数量。');
  busy=true;for(const field of evidence.querySelectorAll('input,select'))field.disabled=true;notifyLayout();$('detail-error').textContent='Preparing photos… 正在处理照片…';const photos=[];for(const file of input.files)photos.push(await compressPhoto(file));busy=false;
  openDetail(await act(opened,'PHOTOS',{taskId,photoStage,photos}));
 }catch(error){$('detail-error').textContent=error.message;}finally{if(!transport.hasPending())busy=false;for(const field of evidence.querySelectorAll('input,select'))field.disabled=Boolean(transport.hasPending());input.value='';notifyLayout();}
});
evidence.addEventListener('click',event=>{const button=event.target.closest('[data-packing-chat]');if(!button||busy||transport?.hasPending())return;if(!window.departmentMessages){$('detail-error').textContent='Messages are loading. 请稍后打开留言。';return;}$('detail').close();const chat=document.querySelector('.tc-dialog');if(chat)chat.addEventListener('close',()=>{if(!$('detail').open)$('detail').showModal();notifyLayout();},{once:true});window.departmentMessages.open(button.dataset.packingChat,button.dataset.peer,'DELIVERY');notifyLayout();});
if(live){if(actor==='WAREHOUSE')document.querySelector('nav').setAttribute('aria-label','Warehouse navigation');const link=document.createElement('link');link.rel='stylesheet';link.href='../master-shared/task-chat.css?v=20261020-sales-messages-v1';document.head.appendChild(link);const script=document.createElement('script');script.src='../master-shared/task-chat.js?v=20261021-packing-v1';document.body.appendChild(script);new MutationObserver(notifyLayout).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});}
new ResizeObserver(notifyLayout).observe(document.body);
populateCustomers();$('company').value=company;render();if(live)readLive().catch(showReadError);
