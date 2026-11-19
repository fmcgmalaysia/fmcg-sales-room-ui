import { timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { createSupportCustomerOperations } from 'backend/supportCustomerProfile.js';
const options={suppressAuth:true,consistentRead:true};
const read=async(collection,id)=>{const result=await wixData.query(collection).eq('_id',id).limit(2).find(options);if(result.items.length>1)throw Error('Duplicate record.');return result.items[0]||null;};
const operate=createSupportCustomerOperations({store:{
 async customers(){let page=await wixData.query('WixCustomers').limit(1000).find(options),rows=[...page.items];while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;},
 customer:id=>read('WixCustomers',id),audit:id=>read('CustomerProfileAudit',id),
 updateCustomer:row=>wixData.update('WixCustomers',row,{suppressAuth:true}),insertAudit:row=>wixData.insert('CustomerProfileAudit',row,{suppressAuth:true})
}});
// Only the existing authenticated MASTER server bridge calls this endpoint.
// Staff identity and Support authority are derived there, never from iframe fields.
export async function handleMasterSupportCustomers(request){
 const secret=await getSecret('MASTER_INTAKE_SHARED_SECRET'),keys=Object.keys(request.headers||{}).filter(key=>key.toLowerCase()==='authorization'),supplied=keys.length===1?request.headers[keys[0]]:'';
 const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(typeof supplied==='string'?supplied:'');
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return {status:401,body:{ok:false,error:'Not authorized.'}};
 try{const body=await request.body.json();if(JSON.stringify(body).length>15000)throw Error('Customer profile request is too large.');return {status:200,body:{ok:true,...await operate(body)}};}catch(error){return {status:400,body:{ok:false,error:String(error?.message||'Customer profile request could not be confirmed.')}};}
}
