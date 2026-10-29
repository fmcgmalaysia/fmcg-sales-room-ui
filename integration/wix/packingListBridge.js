import { getPackingLists, savePackingList } from 'backend/packingLists.web';
export async function handlePackingList(message,department,reply){
 if(!['PACKING_READ_REQUEST','PACKING_SAVE_REQUEST'].includes(message?.type))return false;
 if(!['SUPPORT','WAREHOUSE'].includes(department)||!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(message.requestId)||JSON.stringify(message).length>(department==='WAREHOUSE'&&['PHOTOS','DESK_LOAD'].includes(message.input?.action)?3100000:150000))return true;
 const type=message.type==='PACKING_READ_REQUEST'?'PACKING_READ_RESULT':'PACKING_SAVE_RESULT';
 try{const result=message.type==='PACKING_READ_REQUEST'?await getPackingLists(message.company,department):await savePackingList(message.company,department,message.requestId,message.input);reply({type,company:message.company,requestId:message.requestId,ok:true,result});}
 catch(error){const safe=String(error?.message||''),known=/^(Sign in with an approved Master staff account\.|Master staff access is not configured\.|This packing department is not authorized\.|Packing department is not authorized\.|Select NCT or GHR\.|Packing (list identity|change|evidence) requires review\.|Demand or physical stock requires review\.)$/.test(safe);reply({type,company:message.company,requestId:message.requestId,ok:false,error:known?safe:'Packing request could not be confirmed. Check staff access and retry the same save.'});}
 return true;
}
