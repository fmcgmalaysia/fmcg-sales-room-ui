/* Personal display preferences only. No business records or server writes. */
(() => {
 const key=(id,batch='')=>JSON.stringify([id,batch]);
 let scope='',storage=null,preferences=new Map(),unwritten=new Set();
 const sessions=new Map();
 function readPreferences(){try{const value=JSON.parse(storage?.getItem(scope)||'null');return new Map(Array.isArray(value)?value.filter(item=>Array.isArray(item)&&typeof item[0]==='string'&&Array.isArray(item[1])&&item[1].every(id=>typeof id==='string')):[]);}catch{return null;}}
 function configure(data,company){
  const staff=data?.staff,next=staff?.staffId&&staff?.memberId&&company===data.company?'fmcg-purchase-row-order-v1/'+JSON.stringify([company,staff.staffId,staff.memberId]):'';
  if(next!==scope){if(scope)sessions.set(scope,{preferences,unwritten});scope=next;const session=sessions.get(scope);preferences=session?.preferences||new Map();unwritten=session?.unwritten||new Set();}
  try{storage=scope&&typeof localStorage!=='undefined'?localStorage:null;}catch{storage=null;}
  const saved=readPreferences();if(saved)for(const [id,rows]of saved)if(!unwritten.has(id))preferences.set(id,rows);
 }
 function reconcile(data,customerId,saved){
  const list=entries(data,customerId),allowed=new Set(list.map(row=>row.key)),rows=[];
  for(const id of saved){let matches=allowed.has(id)?[id]:[];if(!matches.length){try{const taskId=JSON.parse(id)[0];matches=list.filter(row=>row.taskId===taskId).map(row=>row.key);}catch{}}
   for(const match of matches)if(!rows.includes(match))rows.push(match);
  }
  for(const row of list)if(!rows.includes(row.key)){const last=Math.max(-1,...list.filter(item=>item.taskId===row.taskId).map(item=>rows.indexOf(item.key)));if(last>=0)rows.splice(last+1,0,row.key);else rows.push(row.key);}return rows;
 }
 function remember(data,customerId,rows){
  if(!scope)return {persisted:false};
  const normalized=reconcile(data,customerId,rows),before=preferences.get(customerId);
  if(JSON.stringify(before)===JSON.stringify(normalized)&&!unwritten.has(customerId))return {persisted:!!storage};
  const saved=readPreferences();if(saved)for(const [id,value]of saved)if(!unwritten.has(id))preferences.set(id,value);
  preferences.set(customerId,normalized);unwritten.add(customerId);sessions.set(scope,{preferences,unwritten});
  try{if(!storage)return {persisted:false};storage.setItem(scope,JSON.stringify([...preferences]));unwritten.clear();return {persisted:true};}catch{return {persisted:false};}
 }
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const attr=(html,name)=>{const match=html.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'));return match?match[1].replace(/&(amp|lt|gt|quot|#39);/g,(_,s)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[s])):'';};
 function entries(data,customerId){return data.tasks.filter(task=>!task.archived&&!task.procurementSource&&task.customerId===customerId).flatMap(task=>{
  const plan=(data.shipmentPlans||[]).find(plan=>plan.customerId===customerId&&plan.orderId===task.orderId&&plan.batches.some(batch=>batch.lines.some(line=>line.taskId===task.id)));
  const batches=(plan?.batches||[]).flatMap(batch=>{const line=batch.lines.find(line=>line.taskId===task.id);return line?[{key:key(task.id,plan.id+'|'+batch.sequence),taskId:task.id,batchId:plan.id+'|'+batch.sequence,label:task.name+' · '+line.quantity+' · '+batch.label}]:[];});
  return batches.length>1?batches:[{key:key(task.id),taskId:task.id,batchId:'',label:task.name+' · '+task.ord}];
 });}
 function current(data,customerId,draft){return reconcile(data,customerId,draft||(scope?preferences.get(customerId):null)||data.purchaseDisplayOrder?.[customerId]?.rows||[]);}
 function taskSequence(data,customerId,rows){const ids=[];for(const rowKey of rows){const id=JSON.parse(rowKey)[0];if(!ids.includes(id))ids.push(id);}const tasks=data.tasks.filter(task=>!task.archived&&task.customerId===customerId);return ids.flatMap(id=>[id,...tasks.filter(task=>task.customerDemandTaskId===id).map(task=>task.id)]);}
 function forTaskOrder(data,customerId,taskIds){const rows=current(data,customerId);return taskIds.filter(id=>data.tasks.some(task=>task.id===id&&!task.procurementSource)).flatMap(id=>rows.filter(rowKey=>JSON.parse(rowKey)[0]===id));}
 function decorate(markup,{tasks,shipmentPlans=[],purchaseDisplayOrder={},draft=null,selected=new Set(),canMove=true}){
  const data={tasks,shipmentPlans,purchaseDisplayOrder},groups=[];
  for(const html of markup.match(/<tr\b[\s\S]*?<\/tr>/g)||[]){const parent=attr(html,'data-split-parent')||attr(html,'data-id');if(parent){const task=tasks.find(task=>task.id===parent),batch=attr(html,'data-split-batch');groups.push({html,task,key:key(parent,batch),batch,index:groups.length});}else if(groups.length)groups[groups.length-1].html+=html;}
  const ranks=new Map();for(const customerId of new Set(groups.map(group=>group.task.customerId))){const ordered=current(data,customerId,draft?.customerId===customerId?draft.rows:null);ordered.forEach((id,index)=>ranks.set(id,index));}
  const customers=[...new Set(groups.map(group=>group.task.customerId))];
  groups.sort((a,b)=>a.task.customerId===b.task.customerId?(ranks.get(a.key)??a.index)-(ranks.get(b.key)??b.index):customers.indexOf(a.task.customerId)-customers.indexOf(b.task.customerId));
  return groups.map((group,index)=>{let html=group.html;html=html.replace(/^<tr\b/,'<tr data-display-key="'+esc(group.key)+'"');html=html.replace(/<td class="row-number">[^<]*<\/td>/,'<td class="row-number">'+String(index+1).padStart(3,'0')+'</td>');
   const cell=html.match(/<td\b[\s\S]*?<\/td>/)?.[0]||'',checkbox=group.batch?'<input class="check rowcheck" type="checkbox" data-select-batch="'+esc(group.key)+'" aria-label="Select shipment row for moving 选择发货行以移动 '+esc(group.task.name)+'" '+(selected.has(group.key)?'checked':'')+'>':cell.match(/<input\b[^>]*>/)?.[0]||'';
   const handle=canMove?'<button class="handle" draggable="true" data-display-drag="'+esc(group.key)+'" aria-label="Move shipment row 移动发货行 '+esc(group.task.name)+'">⠿</button>':'';
   return html.replace(cell,'<td><div class="row-controls">'+handle+checkbox+'</div></td>');
  }).join('');
 }
 window.purchaseDisplayRows={key,entries,current,taskSequence,forTaskOrder,decorate,configure,remember};
})();
