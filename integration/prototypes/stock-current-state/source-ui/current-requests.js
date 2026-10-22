/* Candidate-only own-tab Sales request retention. No source credentials, direct
   stock/backend reads, cache enumeration, grants or file/network calls. Existing
   parent READ messages retain their original server authorization. */
(()=>{'use strict';
 const copy=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),callbacks=new Map(),views=new Map();
 function identity(staff){if(typeof staff?.staffId!=='string'||!staff.staffId||staff.staffId.length>100||staff.memberId!=='SOURCE_SALES/'+staff.staffId)throw Error('Original source Sales identity required');return staff;}
 function key(company,staff){identity(staff);if(!['NCT','GHR'].includes(company))throw Error('Original Sales company required');return'fmcg-source-sales-current-v1/'+company+'/'+encodeURIComponent(staff.staffId)+'/'+encodeURIComponent(staff.memberId);}
 function metadata(meta){if(meta?.schema!=='CURRENT_STOCK_V2'||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0)throw Error('Original Sales current version required');return identity(meta.stockIdentity);}
 const requestMeta=request=>request?.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'?request.stockCurrent:request?.input?.stockCurrent;
 function valid(entry,company,staff){const request=entry?.request,meta=requestMeta(request);
  if(request?.type==='SALES_ROOM_ORDER_PLANNING_UPDATE')return entry.schema===1&&entry.ui?.kind==='DATE'&&request.company===company
   &&typeof request.customerId==='string'&&!!request.customerId&&request.customerId.length<=100&&/^[a-f0-9-]{36}$/i.test(request.requestId||'')
   &&typeof request.orderId==='string'&&!!request.orderId&&typeof request.customerPoNumber==='string'&&typeof request.estimatedShipmentDate==='string'
   &&Number.isSafeInteger(request.expectedRevision)&&request.expectedRevision>=0&&typeof request.expectedShipmentRevision==='string'
   &&meta?.schema==='CURRENT_STOCK_V2'&&meta.stockProtocol===1&&typeof meta.stockBuild==='string'&&!!meta.stockBuild&&Number.isSafeInteger(meta.stockGeneration)&&meta.stockGeneration>=0
   &&meta.stockIdentity?.staffId===staff.staffId&&meta.stockIdentity?.memberId===staff.memberId
   &&Object.keys(request).every(field=>['type','company','customerId','requestId','orderId','customerPoNumber','estimatedShipmentDate','expectedRevision','expectedShipmentRevision','stockCurrent'].includes(field))
   &&['PROGRESS','REVIEW'].includes(entry.ui.scope)&&entry.ui.order?.orderId===request.orderId&&entry.ui.order.customerId===request.customerId&&entry.ui.order.destination===company
   &&entry.ui.order.masterReceipt?.submissionId&&entry.ui.order.shipmentDateRevision===request.expectedShipmentRevision&&JSON.stringify(entry).length<=200000;
  return entry?.schema===1&&['ADJUST','SHIPMENT'].includes(entry.ui?.kind)&&request?.type==='SALES_ROOM_SHIPMENT_REQUEST'&&request.company===company
   &&typeof request.customerId==='string'&&!!request.customerId&&request.customerId.length<=100&&/^[a-f0-9-]{36}$/i.test(request.requestId||'')
   &&['ADJUST','SELECT','CANCEL','PLAN'].includes(request.action)&&request.input&&typeof request.input==='object'&&!Array.isArray(request.input)
   &&meta?.schema==='CURRENT_STOCK_V2'&&meta.stockProtocol===1&&typeof meta.stockBuild==='string'&&!!meta.stockBuild&&Number.isSafeInteger(meta.stockGeneration)&&meta.stockGeneration>=0
   &&meta.stockIdentity?.staffId===staff.staffId&&meta.stockIdentity?.memberId===staff.memberId
   &&Object.keys(request).every(field=>['type','company','customerId','requestId','action','input'].includes(field))
   &&(request.action==='ADJUST'?entry.ui.kind==='ADJUST'&&entry.ui.selection?.company===company&&entry.ui.selection?.customerId===request.customerId
     &&entry.ui.selection?.orderId===request.input.orderId&&entry.ui.data?.line?.taskId===request.input.taskId&&entry.ui.mode===request.input.mode&&['INCREASE','SPLIT','REDUCE'].includes(entry.ui.mode)
     &&same(entry.ui.data.stockCurrent,meta):entry.ui.kind==='SHIPMENT'&&entry.ui.company===company&&entry.ui.customer===request.customerId&&same(entry.ui.data?.stockCurrent,meta))&&JSON.stringify(entry).length<=200000;
 }
 function read(company,staff){const entry=JSON.parse(sessionStorage.getItem(key(company,staff))||'null');if(entry===null)return null;if(!valid(entry,company,staff))throw Error('Original Sales cache requires review');return entry;}
 function retain(request,ui){const staff=metadata(requestMeta(request)),entry=copy({schema:1,request,ui});
  if(!valid(entry,request.company,staff))throw Error('Original bounded Sales request required');const address=key(request.company,staff),prior=read(request.company,staff);
  if(prior&&!same(prior,entry))throw Error('Another original Sales save is retained');if(!prior)sessionStorage.setItem(address,JSON.stringify(entry));
  if(!same(read(request.company,staff),entry))throw Error('Original Sales request not retained');
 }
 function finish(request,result){const staff=metadata(requestMeta(request)),entry=read(request.company,staff);
  if(!entry||!same(entry.request,request)||result?.ok!==true||result.requestId!==request.requestId||result.company!==request.company||!Number.isSafeInteger(result.stockGeneration)||result.stockGeneration<=requestMeta(request).stockGeneration
   ||request.type==='SALES_ROOM_ORDER_PLANNING_UPDATE'&&(result.orderId!==request.orderId||typeof result.shipmentDateRevision!=='string'||!result.shipmentDateRevision)
   ||request.action==='ADJUST'&&(result.taskId!==request.input.taskId||!Number.isSafeInteger(result.requested)||result.requested<1)
   ||request.action==='SELECT'&&(result.status!=='REQUESTED'||typeof result.shipmentId!=='string'||!result.shipmentId)
   ||request.action==='CANCEL'&&(result.status!=='CANCELLED'||result.shipmentId!==request.input.id)
   ||request.action==='PLAN'&&(typeof result.planId!=='string'||!result.planId))throw Error('Original Sales save unconfirmed');
  const address=key(request.company,staff);sessionStorage.removeItem(address);if(sessionStorage.getItem(address)!==null)throw Error('Original Sales cache cleanup unconfirmed');
 }
 function authorize(company,customerId,kind='AUTH'){if(!['NCT','GHR'].includes(company)||typeof customerId!=='string'||!customerId||customerId.length>100)return Promise.reject(Error('Original Sales customer required'));
  const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(callbacks.get(requestId)?.timer!==timer)return;callbacks.delete(requestId);reject(Error('Original Sales recovery identity timed out'));},30000);
   callbacks.set(requestId,{company,customerId,kind,timer,resolve,reject});window.parent.postMessage({type:'SALES_ROOM_SHIPMENT_REQUEST',company,customerId,action:'READ',requestId,...(kind==='AUTH'?{input:{resume:'SOURCE_SALES_V1'}}:{})},'*');});
 }
 window.addEventListener('message',event=>{const message=event.data||{},pending=callbacks.get(message.requestId);
  if(event.source!==window.parent||!pending||message.type!=='SALES_ROOM_SHIPMENT_RESULT'||message.company!==pending.company)return;
  clearTimeout(pending.timer);callbacks.delete(message.requestId);const result=message.result;
  if(pending.kind==='READ'){try{if(message.ok!==true||result?.company!==pending.company)throw Error(message.error||'Original Sales read unconfirmed');if(result.stockCurrent!==undefined)metadata(result.stockCurrent);pending.resolve(copy(result));}catch(error){pending.reject(error);}return;}
  if(message.ok!==true||result?.ok!==true||result.schema!=='SOURCE_SALES_RESUME_V1'||result.company!==pending.company||result.customerId!==pending.customerId){pending.reject(Error('Original Sales recovery identity unconfirmed'));return;}
  try{identity(result.staff);pending.resolve(result);}catch(error){pending.reject(error);}
 });
 async function authorizedEntry(company,customerId,staff){let entry=read(company,staff);if(!entry)return null;
  // Fresh original authorization of the CACHED customer before returning any old
  // business view, even when another customer was clicked after reload.
  const original=await authorize(company,entry.request.customerId);if(original.staff.staffId!==staff.staffId||original.staff.memberId!==staff.memberId)throw Error('Original Sales employee changed');
  const current=read(company,staff);if(!same(current,entry))throw Error('Original Sales request changed during recovery');return copy(current);
 }
 function checkRead(company,customerId,meta,onResume,onError){const staff=metadata(meta);if(!read(company,staff))return false;
  authorizedEntry(company,customerId,staff).then(onResume).catch(onError);return true;
 }
 async function recover(company,customerId){const current=await authorize(company,customerId);return authorizedEntry(company,customerId,current.staff);}
 // View routing is local presentation only; neither registration nor restoration
 // authorizes a save. Recovery callers must first use the original authorization.
 function register(kind,restore){if(!['ADJUST','SHIPMENT','DATE'].includes(kind)||typeof restore!=='function'||views.has(kind))throw Error('Original Sales view already registered');views.set(kind,restore);}
 function restore(entry){const render=views.get(entry?.ui?.kind);if(!render)throw Error('Original Sales view is unavailable');render(copy(entry));}
 window.sourceSalesCurrent={retain,finish,checkRead,recover,register,restore,readCurrent:(company,customerId)=>authorize(company,customerId,'READ')};
})();
