import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
const endpoint='https://fmcg999.wixstudio.com/fmcgmalaysia/_functions/masterSupportCustomers';
export async function requestSupportCustomers({company,staff,requestId,input}){
 const action=input?'SAVE':'READ',result=await callSupportCustomers({company,staff,action,...(input?{requestId,input}:{})});
 if(action==='READ'&&!Array.isArray(result.customers))throw Error('Customer directory is unavailable.');
 if(action==='SAVE'&&(result.requestId!==requestId||result.customerId!==input.customerId||result.saved!==true))throw Error('Customer profile save could not be confirmed.');
 return result;
}
export async function readSupportCustomerPaymentTerm({company,staff,customerId}){
 const result=await callSupportCustomers({company,staff,action:'READ_TERM',input:{customerId}});
 if(result.customerId!==customerId||typeof result.paymentTerm!=='string')throw Error('Customer payment term could not be confirmed.');
 return result.paymentTerm;
}
async function callSupportCustomers({company,staff,...request}){
 if(!['NCT','GHR'].includes(company)||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support access is required.');
 const body={company,...request,staff:{department:'SUPPORT',memberId:staff.memberId,staffId:staff.staffId,staffName:staff.staffName}};
 const response=await fetch(endpoint,{method:'post',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await getSecret('MASTER_INTAKE_SHARED_SECRET')},body:JSON.stringify(body)}),result=await response.json();
 if(!response.ok||result?.ok!==true||result.company!==company)throw Error(result?.error||'Customer profiles could not be confirmed.');
 return result;
}
