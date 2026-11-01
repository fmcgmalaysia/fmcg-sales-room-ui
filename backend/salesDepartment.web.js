import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { createSalesDepartmentReader } from 'backend/salesDepartmentAccess.js';
import { requestSalesDepartment } from 'backend/salesDepartmentClient.js';
const read=createSalesDepartmentReader({
 authorize:getCurrentStaffContext,
 async readAssignedCustomers(staffId){
  let page=await wixData.query('WixCustomers').eq('assignedStaffId',staffId).limit(1000).find({suppressAuth:true,consistentRead:true}),rows=[...page.items];
  while(page.hasNext()){page=await page.next();rows.push(...page.items);}return rows;
 },
 readCompany:requestSalesDepartment
});
// No client-selected employee, customer scope, admin override or financial write.
export const getSalesDepartment=webMethod(Permissions.SiteMember,async()=>{
 try{return {ok:true,result:await read()};}
 catch(error){return {ok:false,accessDenied:error?.code==='SALES_ACCESS_DENIED',error:'Sales access or account records could not be confirmed.'};}
});
