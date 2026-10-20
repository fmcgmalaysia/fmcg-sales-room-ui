import { timingSafeEqual } from 'crypto';
import { getSecret } from 'wix-secrets-backend';
import { readCustomerFulfilment, saveCustomerFulfilment, saveCustomerAccountDocument } from 'backend/customerFulfilmentService.js';
export async function handleSalesFulfilment(request){
 const secret=await getSecret('MASTER_INTAKE_SHARED_SECRET'),keys=Object.keys(request.headers||{}).filter(key=>key.toLowerCase()==='authorization'),expected=Buffer.from('Bearer '+secret),actual=Buffer.from(keys.length===1?String(request.headers[keys[0]]):'');
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return {status:401,body:{ok:false,error:'Unauthorized request.'}};
 try{const body=await request.body.json();if(!['NCT','GHR'].includes(body.company)||typeof body.customerId!=='string'||!body.customerId||body.customerId.length>100||typeof body.customerName!=='string'||!body.customerName||body.customerName.length>200||typeof body.staff?.staffId!=='string'||!body.staff.staffId||body.staff.staffId.length>100||typeof body.staff?.staffName!=='string'||!body.staff.staffName||body.staff.staffName.length>200||!['READ','SELECT','CANCEL','DOCUMENT','PLAN','ORDER_DATE','ADJUST'].includes(body.action))throw Error('Invalid Sales fulfilment request.');
 const staff={memberId:'SOURCE_SALES/'+body.staff.staffId,staffId:body.staff.staffId,staffName:body.staff.staffName,customerId:body.customerId,customerName:body.customerName,canSelectShipment:true,canUploadCustomerDocument:true,canEditShipmentDate:true};
 const result=body.action==='READ'?await readCustomerFulfilment(body.company,staff,body.customerId):await (body.action==='DOCUMENT'?saveCustomerAccountDocument:saveCustomerFulfilment)({company:body.company,staff,requestId:body.requestId,input:{...body.input,action:body.action,customerId:body.customerId}});return {status:200,body:{ok:true,result}};
 }catch(error){return {status:400,body:{ok:false,error:String(error?.message||'Sales fulfilment could not be confirmed.')}};}
}
