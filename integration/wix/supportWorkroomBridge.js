import { getSupportCustomers, saveSupportCustomer, getSupportBookings, saveSupportBooking, getSupportInvoiceState, issueSupportInvoice, withdrawSupportInvoice, getSupportDocuments, uploadSupportDocument } from 'backend/supportWorkroom.web';
const actions={SUPPORT_CUSTOMER_READ_REQUEST:getSupportCustomers,SUPPORT_CUSTOMER_SAVE_REQUEST:saveSupportCustomer,SUPPORT_BOOKING_READ_REQUEST:getSupportBookings,SUPPORT_BOOKING_SAVE_REQUEST:saveSupportBooking,SUPPORT_INVOICE_READ_REQUEST:getSupportInvoiceState,SUPPORT_INVOICE_SAVE_REQUEST:issueSupportInvoice,SUPPORT_INVOICE_CANCEL_REQUEST:withdrawSupportInvoice,SUPPORT_DOCUMENT_READ_REQUEST:getSupportDocuments,SUPPORT_DOCUMENT_SAVE_REQUEST:uploadSupportDocument};
export async function handleSupportWorkroom(message,reply){
 const action=actions[message?.type];if(!Object.hasOwn(actions,message?.type))return false;
 if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>(message.type==='SUPPORT_DOCUMENT_SAVE_REQUEST'?4200000:40000))return true;
 const type=message.type.replace('_REQUEST','_RESULT');
 try{const result=message.type.endsWith('_READ_REQUEST')?await action(message.company):await action(message.company,message.requestId,message.input);reply({type,company:message.company,requestId:message.requestId,ok:true,result});}
 catch(error){reply({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Support save could not be confirmed.'});}
 return true;
}
