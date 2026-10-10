import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { createPurchaseCostRetry } from 'backend/purchaseCostRetry.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
const options = { suppressAuth:true, consistentRead:true };
const store = {
  async one(collection, criteria) {
    let query=wixData.query(collection);for(const [field,value] of Object.entries(criteria))query=query.eq(field,value);
    const result=await query.limit(2).find(options);if(result.items.length>1)throw Error('Duplicate operational record.');return result.items[0]||null;
  },
  async read(collection,key){return this.one(collection,{_id:key});},
  insert:(collection,record)=>wixData.insert(collection,record,{suppressAuth:true}),
  update:(collection,record)=>wixData.update(collection,record,{suppressAuth:true}),
  remove:(collection,key)=>wixData.remove(collection,key,{suppressAuth:true})
};
const retry=createPurchaseCostRetry({store,captureCosts:capturePointbaseCosts});
export const retryPurchaseTaskCost=webMethod(Permissions.SiteMember,async(company,taskId,requestId)=>{
  const staff=await getPurchaseStaffContext();return retry({company,taskId,requestId,staff});
});
