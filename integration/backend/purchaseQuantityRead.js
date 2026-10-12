import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { timingSafeEqual } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { projectPurchaseQuantities } from 'backend/purchaseQuantityProjection.js';
const options={suppressAuth:true,consistentRead:true};
async function rows(collection,field,ids){let query=wixData.query(collection);if(field)query=query.hasSome(field,ids);let result=await query.limit(1000).find(options),all=[...result.items];while(result.hasNext()){result=await result.next();all.push(...result.items);}return all;}
export async function readPurchaseQuantities(request){
  const secret=await getSecret('MASTER_INTAKE_SHARED_SECRET');
  const keys=Object.keys(request.headers||{}).filter(key=>key.toLowerCase()==='authorization'),auth=keys.length===1?request.headers[keys[0]]:'';
  const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(typeof auth==='string'?auth:'');
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return {status:401,body:{ok:false,error:'Unauthorized request.'}};
  try {const body=await request.body.json();if(!['NCT','GHR'].includes(body.company)||typeof body.customerId!=='string'||body.customerId.length>100||!Array.isArray(body.orders)||!body.orders.length||body.orders.length>100)throw Error('Invalid request.');
    const ids=body.orders.map(row=>row.orderId);if(ids.some(id=>typeof id!=='string'||id.length>160))throw Error('Invalid order.');
    const names=PURCHASE_COLLECTIONS[body.company];
    const [orders,tasks,activity,records,suppliers]=await Promise.all([rows(names.orders),rows(names.tasks),rows(names.activity),rows('PurchaseOrders'),rows('SharedSuppliers')]);
    const workspace=projectPurchaseWorkspace({company:body.company,orders,tasks,activity,suppliers,staff:{staffId:'SYSTEM_CUSTOMER_READ',staffName:'System'}}),purchaseOrders=projectPurchaseOrders({company:body.company,workspace,records});
    return {status:200,body:projectPurchaseQuantities({customerId:body.customerId,requests:body.orders,orders,tasks,activity,purchaseOrders})};
  }catch(error){return {status:503,body:{ok:false,error:'Current purchase quantities could not be confirmed. Please refresh.'}};}
}
