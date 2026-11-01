import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
// Called only after the source-site salesperson and exact assigned directory are verified.
export async function requestSalesDepartment({company,staff,customerIds}){
 const response=await fetch('https://fmcg999.wixstudio.com/master/_functions/salesFulfilment',{method:'post',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await getSecret('MASTER_INTAKE_SHARED_SECRET')},body:JSON.stringify({action:'SALES_DEPARTMENT',company,staff:{staffId:staff.staffId,staffName:staff.staffName},customerIds})});
 const value=await response.json();if(!response.ok||value?.ok!==true)throw Error(value?.error||'Sales account records could not be confirmed.');return value.result;
}
