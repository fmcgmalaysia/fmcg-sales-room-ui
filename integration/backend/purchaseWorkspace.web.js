// Master site only. Staff/Supplier field IDs require fresh native readback before deployment.
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { PURCHASE_COLLECTIONS, requirePurchaseStaff, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
const options = { suppressAuth: true, consistentRead: true };
async function all(query) {
  let page = await query.limit(1000).find(options), rows = [...page.items];
  while (page.hasNext()) { page = await page.next(); rows.push(...page.items); }
  return rows;
}
export const getPurchaseWorkspace = webMethod(Permissions.SiteMember, async company => {
  if (!PURCHASE_COLLECTIONS[company]) throw Error('Select NCT or GHR.');
  const member = await currentMember.getMember();
  if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') throw Error('Please sign in with your approved Master staff account.');
  const access = await all(wixData.query('StaffMasterAccess'));
  const staff = requirePurchaseStaff(member, access);
  const ids = PURCHASE_COLLECTIONS[company];
  const [orders, tasks, activity, suppliers] = await Promise.all([
    all(wixData.query(ids.orders)), all(wixData.query(ids.tasks)), all(wixData.query(ids.activity)),
    all(wixData.query('SharedSuppliers'))
  ]);
  return projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff });
});
