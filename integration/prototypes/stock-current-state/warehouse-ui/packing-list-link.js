// One same-window Outgoing pane; existing execution evidence remains separate by identity.
(() => {
 // A Pages release must not switch an older Wix entry before its bridge is live.
 if(!['20261021-packing-v1','20261021-packing-company-v1','20261022-current-warehouse-v2'].includes(new URLSearchParams(location.search).get('v')))return;
 let frame=null,legacy=null,company='',busy=false;
 const requests=new Set(),origin=location.origin;let parentOrigin='';
 try{const ref=new URL(document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(ref.hostname))parentOrigin=ref.origin;}catch(_){}
 window.warehousePackingTab={
  render(container,selectedCompany,legacyHtml=''){
   if(!['NCT','GHR'].includes(selectedCompany))return;
   if(!frame?.isConnected||company!==selectedCompany){
    company=selectedCompany;busy=false;requests.clear();frame=document.createElement('iframe');frame.title='Outgoing 发货任务';frame.src='../support-room/packing-workbench.html?v=20261024-packing-arrangement-v1&live=1&department=WAREHOUSE&embedded=warehouse&company='+company;frame.style.cssText='display:block;width:100%;height:560px;border:0;background:transparent';legacy=document.createElement('details');container.replaceChildren(frame,legacy);
   }
   legacy.hidden=!legacyHtml;legacy.innerHTML='<summary>Existing packing evidence 既有备货记录</summary><p>These records retain their original photos and loading history. Support must resolve existing execution before arranging this product again. 保留原照片与装货记录；重新安排同一产品前须先处理既有执行。</p>'+legacyHtml;legacy.inert=busy;
  },
  isBusy:()=>busy||requests.size>0,
  refresh(){if(frame?.isConnected&&!busy&&!requests.size)frame.contentWindow.postMessage({type:'PACKING_REFRESH',company},origin);}
 };
 window.addEventListener('message',event=>{
  const message=event.data||{};
  if(frame?.isConnected&&event.source===frame.contentWindow&&event.origin===origin){
   if(message.company!==company)return;
   if(message.type==='PACKING_LAYOUT'){if(Number.isFinite(message.height))frame.style.height=Math.max(560,Math.min(20000,Math.ceil(message.height)))+'px';if(typeof message.busy==='boolean'){busy=message.busy;if(!busy)requests.clear();if(legacy)legacy.inert=busy;}return;}
   if(message.type==='WAREHOUSE_LOGIN_REQUEST'){if(parentOrigin)parent.postMessage({type:message.type},parentOrigin);return;}
   if(['TASK_CHAT_LIST_REQUEST','TASK_CHAT_PAGE_REQUEST','TASK_CHAT_SAVE_REQUEST'].includes(message.type)&&message.department==='WAREHOUSE'&&/^[a-f0-9-]{36}$/i.test(message.requestId||'')&&JSON.stringify(message).length<=200000&&parentOrigin){requests.add(message.requestId);parent.postMessage(message,parentOrigin);return;}
   if(!['PACKING_READ_REQUEST','PACKING_SAVE_REQUEST','PACKING_RESUME_CONTEXT_REQUEST'].includes(message.type)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>(message.input?.action==='PHOTOS'?3100000:150000)||!parentOrigin)return;
   requests.add(message.requestId);parent.postMessage(message,parentOrigin);return;
  }
  if(event.source!==parent||event.origin!==parentOrigin||!frame?.isConnected)return;
  if(['PACKING_READ_RESULT','PACKING_SAVE_RESULT','PACKING_RESUME_CONTEXT_RESULT'].includes(message.type)&&message.company===company&&requests.has(message.requestId)){requests.delete(message.requestId);frame.contentWindow.postMessage(message,origin);}
  if(['TASK_CHAT_LIST_RESULT','TASK_CHAT_PAGE_RESULT','TASK_CHAT_SAVE_RESULT'].includes(message.type)&&message.department==='WAREHOUSE'&&message.company===company&&requests.has(message.requestId)){requests.delete(message.requestId);frame.contentWindow.postMessage(message,origin);}
  if(message.type==='WAREHOUSE_LOGIN_RESULT')frame.contentWindow.postMessage(message,origin);
 });
})();
