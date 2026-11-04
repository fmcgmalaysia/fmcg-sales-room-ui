/* Own-tab original CBM retention only: no stock read, role grant or cache scan. */
(()=>{'use strict';
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function valid(request,company){return request?.type==='WAREHOUSE_CBM_REQUEST'&&request.company===company
  &&/^[a-f0-9-]{36}$/i.test(request.requestId||'')&&/^[a-f0-9]{32}$/i.test(request.taskId||'')
  &&request.stockProtocol===1&&typeof request.stockBuild==='string'&&!!request.stockBuild
  &&Number.isSafeInteger(request.stockGeneration)&&request.stockGeneration>=0
  &&request.stockIdentity&&Object.keys(request.stockIdentity).length===2
  &&['staffId','memberId'].every(field=>typeof request.stockIdentity[field]==='string'&&!!request.stockIdentity[field]&&request.stockIdentity[field].length<=200)
  &&Object.keys(request).every(key=>['type','company','requestId','taskId','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))&&JSON.stringify(request).length<=2000;}
 function key(company,staff){if(!['NCT','GHR'].includes(company)||['staffId','memberId'].some(field=>typeof staff?.[field]!=='string'||!staff[field]||staff[field].length>200))throw Error('Original Warehouse identity required');
  return'fmcg-warehouse-cbm-v1/'+company+'/'+staff.staffId+'/'+staff.memberId;}
 function pending(company,staff){const cached=JSON.parse(sessionStorage.getItem(key(company,staff))||'null');
  if(cached===null)return null;if(!valid(cached,company)||cached.stockIdentity.staffId!==staff.staffId||cached.stockIdentity.memberId!==staff.memberId)throw Error('Original CBM cache requires review');return cached;}
 function retain(request,staff){if(!valid(request,request?.company))throw Error('Original bounded current CBM request required');
  if(request.stockIdentity.staffId!==staff?.staffId||request.stockIdentity.memberId!==staff?.memberId)throw Error('Original CBM session changed');
  const address=key(request.company,staff),cached=pending(request.company,staff);
  if(cached&&!same(cached,request))throw Error('Another original CBM request is retained');
  if(!cached)sessionStorage.setItem(address,JSON.stringify(request));
  if(!same(pending(request.company,staff),request))throw Error('Original CBM request not retained');}
 function clear(request,staff){const address=key(request.company,staff);if(!same(pending(request.company,staff),request))throw Error('Original CBM request changed');
  sessionStorage.removeItem(address);if(sessionStorage.getItem(address)!==null)throw Error('Original CBM cache cleanup unconfirmed');}
 window.warehouseCurrentCbm={valid,pending,retain,clear};
})();
