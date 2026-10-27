import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
const endpoint='https://fmcg999.wixstudio.com/fmcgmalaysia/_functions/masterSupportCustomers';
export async function requestSupportCustomers({company,staff,requestId,input}){
 if(!['NCT','GHR'].includes(company)||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support access is required.');
 const action=input?'SAVE':'READ',body={company,action,staff:{department:'SUPPORT',memberId:staff.memberId,staffId:staff.staffId,staffName:staff.staffName},...(input?{requestId,input}:{})};
 const response=await fetch(endpoint,{method:'post',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await getSecret('MASTER_INTAKE_SHARED_SECRET')},body:JSON.stringify(body)}),result=await response.json();
 if(!response.ok||result?.ok!==true||result.company!==company)throw Error(result?.error||'Customer profiles could not be confirmed.');
 if(action==='READ'&&!Array.isArray(result.customers))throw Error('Customer directory is unavailable.');
 if(action==='SAVE'&&(result.requestId!==requestId||result.customerId!==input.customerId||result.saved!==true))throw Error('Customer profile save could not be confirmed.');
 return result;
}
