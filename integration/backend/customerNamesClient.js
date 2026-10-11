import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
const endpoint='https://fmcg999.wixstudio.com/fmcgmalaysia/_functions/masterCustomerNames';
export async function readCustomerShortNames(customerIds) {
  if(!customerIds.length)return [];
  const secret=await getSecret('MASTER_INTAKE_SHARED_SECRET');
  if(!secret)throw Error('Customer short names connection is not configured.');
  const response=await fetch(endpoint,{method:'post',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify({customerIds})});
  if(!response.ok)throw Error('Customer short names could not be confirmed.');
  const result=await response.json();
  if(result.ok!==true||!Array.isArray(result.customers)||result.customers.length!==customerIds.length||customerIds.some(id=>result.customers.filter(row=>row.customerId===id&&typeof row.shortName==='string'&&row.shortName.length<=100).length!==1))throw Error('Customer short names could not be confirmed.');
  return result.customers;
}
