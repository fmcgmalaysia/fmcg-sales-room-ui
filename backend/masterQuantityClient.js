import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { applyMasterQuantities } from 'backend/masterQuantityProjection.js';
const endpoint='https://fmcg999.wixstudio.com/master/_functions/purchaseQuantities';
export async function withMasterQuantities(customerId,orders){
  const accepted=orders.filter(order=>order.destination==='NCT'&&order.masterReceipt?.submissionId);
  if(!accepted.length)return orders;
  const byId=new Map();
  for(let offset=0;offset<accepted.length;offset+=100){const batch=accepted.slice(offset,offset+100),secret=await getSecret('MASTER_INTAKE_SHARED_SECRET');if(!secret)throw Error('Master quantity connection is not configured.');
    const result=await fetch(endpoint,{method:'post',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify({company:'NCT',customerId,orders:batch.map(order=>({orderId:order.orderId,submissionId:order.masterReceipt.submissionId}))})});
    if(!result.ok)throw Error('Current purchase quantities could not be confirmed. Please refresh.');
    for(const order of applyMasterQuantities(customerId,batch,await result.json()))byId.set(order.orderId,order);
  }
  return orders.map(order=>byId.get(order.orderId)||order);
}
