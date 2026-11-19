import { timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
// Display-only lookup. Existing submission snapshots and customer records are not written.
export async function readMasterCustomerNames(request) {
  const secret=await getSecret('MASTER_INTAKE_SHARED_SECRET');
  const keys=Object.keys(request.headers||{}).filter(key=>key.toLowerCase()==='authorization');
  const supplied=keys.length===1?request.headers[keys[0]]:'';
  const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(typeof supplied==='string'?supplied:'');
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return {status:401,body:{ok:false}};
  try {
    const {customerIds}=await request.body.json();
    if(!Array.isArray(customerIds)||customerIds.length>200||new Set(customerIds).size!==customerIds.length||customerIds.some(id=>typeof id!=='string'||!/^CUS-[A-Z0-9-]{1,80}$/.test(id)))throw Error('Invalid customer IDs.');
    if(!customerIds.length)return {status:200,body:{ok:true,customers:[]}};
    const result=await wixData.query('WixCustomers').hasSome('customerId',customerIds).limit(1000).find({suppressAuth:true,consistentRead:true});
    const customers=customerIds.map(customerId=>{
      const matches=result.items.filter(row=>row.customerId===customerId);
      if(matches.length!==1)throw Error('Customer identity is not unique.');
      return {customerId,shortName:String(matches[0].customerShortName||'').trim()};
    });
    return {status:200,body:{ok:true,customers}};
  } catch (_) {return {status:503,body:{ok:false,error:'Customer short names could not be confirmed.'}};}
}
