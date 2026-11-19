/* Candidate-only own-tab receipt retention. No inventory read, legacy write,
   cache enumeration, cross-user lookup, timeout unlock or activation authority. */
(()=>{'use strict';
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function valid(request,company){return request?.type==='WAREHOUSE_RECEIPT_REQUEST'&&request.company===company
  &&/^[a-f0-9-]{36}$/i.test(request.requestId||'')&&request.stockProtocol===1&&typeof request.stockBuild==='string'&&!!request.stockBuild
  &&Number.isSafeInteger(request.stockGeneration)&&request.stockGeneration>=0&&['RECEIVE','CORRECT'].includes(request.input?.action)
  &&Array.isArray(request.input.lines)&&request.input.lines.length>0&&request.input.lines.length<=300
  &&['staffId','memberId'].every(field=>typeof request.stockIdentity?.[field]==='string'&&!!request.stockIdentity[field])
  &&Object.keys(request).every(key=>['type','company','requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
  &&JSON.stringify(request).length<=1000000;}
 function key(company,staff){if(!['NCT','GHR'].includes(company)||['staffId','memberId'].some(field=>typeof staff?.[field]!=='string'||!staff[field]))throw Error('Original Warehouse identity required');
  return 'fmcg-warehouse-receipt-v1/'+company+'/'+staff.staffId+'/'+staff.memberId;}
 function pending(company,staff){const cached=JSON.parse(sessionStorage.getItem(key(company,staff))||'null');
  if(cached===null)return null;if(!valid(cached,company)||cached.stockIdentity.staffId!==staff.staffId||cached.stockIdentity.memberId!==staff.memberId)throw Error('Original Warehouse receipt cache requires review');return cached;}
 function retain(request,staff){if(!valid(request,request?.company))throw Error('Original current receipt required');
  if(request.stockIdentity.staffId!==staff?.staffId||request.stockIdentity.memberId!==staff?.memberId)throw Error('Original Warehouse receipt session changed');
  const address=key(request.company,staff),cached=pending(request.company,staff);
  if(cached&&!same(cached,request))throw Error('Another original Warehouse receipt is retained');
  if(!cached)sessionStorage.setItem(address,JSON.stringify(request));
  if(!same(pending(request.company,staff),request))throw Error('Original Warehouse receipt not retained');}
 function clear(request,staff){const address=key(request.company,staff);
  if(!same(pending(request.company,staff),request))throw Error('Original Warehouse receipt changed');
  sessionStorage.removeItem(address);if(sessionStorage.getItem(address)!==null)throw Error('Original receipt cache cleanup unconfirmed');}
 async function recover(company){
  if(!['NCT','GHR'].includes(company))throw Error('Known Warehouse company required');
  const requestId=crypto.randomUUID();
  const context=await new Promise((resolve,reject)=>{
   let timer;const done=()=>{clearTimeout(timer);window.removeEventListener('message',reply);};
   function reply(event){const message=event.data||{};
    if(event.source!==window.parent||message.type!=='WAREHOUSE_RESUME_CONTEXT_RESULT'||message.company!==company||message.requestId!==requestId)return;
    done();message.ok?resolve(message.result):reject(Error('Original Warehouse identity unconfirmed'));}
   window.addEventListener('message',reply);timer=setTimeout(()=>{done();reject(Error('Original Warehouse identity timed out'));},30000);
   window.parent.postMessage({type:'WAREHOUSE_RESUME_CONTEXT_REQUEST',company,requestId},'*');
  });
  if(context?.ok!==true||context.company!==company||context.schema!=='WAREHOUSE_RESUME_CONTEXT_V1'||typeof context.staff?.staffName!=='string'||!context.staff.staffName)throw Error('Original Warehouse identity unconfirmed');
  return{request:pending(company,context.staff),staff:context.staff};
 }
 window.warehouseCurrentReceipt={valid,pending,retain,clear,recover};
})();
