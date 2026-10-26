import { getSupportBookings, saveSupportBooking } from 'backend/supportWorkroom.web';
export async function handleSupportWorkroom(message,reply){
 if(!['SUPPORT_BOOKING_READ_REQUEST','SUPPORT_BOOKING_SAVE_REQUEST'].includes(message?.type))return false;
 if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>4000)return true;
 const type=message.type.replace('_REQUEST','_RESULT');
 try{const result=message.type==='SUPPORT_BOOKING_READ_REQUEST'?await getSupportBookings(message.company):await saveSupportBooking(message.company,message.requestId,message.input);reply({type,company:message.company,requestId:message.requestId,ok:true,result});}
 catch(error){reply({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Booking save could not be confirmed.'});}
 return true;
}
