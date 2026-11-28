import { Permissions, webMethod } from 'wix-web-module';
import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { financeInventoryOutlook, outlookPeriod } from 'backend/financeInventoryOutlook.js';

export const readFinanceInventoryOutlook = webMethod(Permissions.SiteMember, async (company, asOf, month) => {
  const end=outlookPeriod(company,asOf,month);
  if (end > Date.now()+86400000) throw Error('Select today or an earlier date.');
  await getManagedDepartmentContext('ACCOUNT',company);
  const names=PURCHASE_COLLECTIONS[company];
  const [orders,tasks,activity]=await Promise.all([names.orders,names.tasks,names.activity].map(name=>fulfilmentStore.all(name)));
  return financeInventoryOutlook({company,orders,tasks,activity},asOf,month);
});
