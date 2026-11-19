import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { projectSalesDepartment } from 'backend/salesDepartmentProjection.js';
export async function readSalesDepartment({company,staff,customerIds}){
 if(!PURCHASE_COLLECTIONS[company]||!staff?.staffId||staff.memberId!=='SOURCE_SALES/'+staff.staffId)throw Error('Delegated Sales authority is required.');
 if(!Array.isArray(customerIds)||!customerIds.length||customerIds.length>200||customerIds.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(customerIds).size!==customerIds.length)throw Error('Invalid authorized customer scope.');
 return projectSalesDepartment({company,customerIds,activity:await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity)});
}
