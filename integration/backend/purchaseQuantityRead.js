import { timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { projectPurchaseQuantities } from 'backend/purchaseQuantityProjection.js';
const options={suppressAuth:true,consistentRead:true};
async function rows(collection,field,ids){let result=await wixData.query(collection).hasSome(field,ids).limit(1000).find(options),all=[...result.items];while(result.hasNext()){result=await result.next();all.push(...result.items);}return all;}
export async function readPurchaseQuantities(request){
  const secret=await getSecret('MASTER_INTAKE_SHARED_SECRET');
  const keys=Object.keys(request.headers||{}).filter(key=>key.toLowerCase()==='authorization'),auth=keys.length===1?request.headers[keys[0]]:'';
  const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(typeof auth==='string'?auth:'');
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return {status:401,body:{ok:false,error:'Unauthorized request.'}};
  try {const body=await request.body.json();if(body.company!=='NCT'||typeof body.customerId!=='string'||body.customerId.length>100||!Array.isArray(body.orders)||!body.orders.length||body.orders.length>100)throw Error('Invalid request.');
    const ids=body.orders.map(row=>row.orderId);if(ids.some(id=>typeof id!=='string'||id.length>160))throw Error('Invalid order.');
    const [orders,tasks,activity]=await Promise.all([rows('NCTOrders','title',ids),rows('NCTTasks','description',ids),rows('NCTActivity','description',ids)]);
    return {status:200,body:projectPurchaseQuantities({customerId:body.customerId,requests:body.orders,orders,tasks,activity})};
  }catch(error){return {status:503,body:{ok:false,error:'Current purchase quantities could not be confirmed. Please refresh.'}};}
}
