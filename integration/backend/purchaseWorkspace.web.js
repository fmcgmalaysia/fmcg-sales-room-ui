// Master site only. Staff/Supplier field IDs require fresh native readback before deployment.
import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
const options = { suppressAuth: true, consistentRead: true };
async function all(query) {
  let page = await query.limit(1000).find(options), rows = [...page.items];
  while (page.hasNext()) { page = await page.next(); rows.push(...page.items); }
  return rows;
}
export const getPurchaseWorkspace = webMethod(Permissions.SiteMember, async company => {
  if (!PURCHASE_COLLECTIONS[company]) throw Error('Select NCT or GHR.');
  const staff = await getPurchaseStaffContext();
  const ids = PURCHASE_COLLECTIONS[company];
  const [orders, tasks, activity, suppliers] = await Promise.all([
    all(wixData.query(ids.orders)), all(wixData.query(ids.tasks)), all(wixData.query(ids.activity)),
    all(wixData.query('SharedSuppliers'))
  ]);
  return projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff });
});
