// Master site only. Staff/Supplier field IDs require fresh native readback before deployment.
import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { createPurchaseMarginRefresh } from 'backend/purchaseMarginRefresh.js';
const options = { suppressAuth: true, consistentRead: true };
const refreshMargins = createPurchaseMarginRefresh({ readRates: readCurrentAdminFx, store: {
  async read(collection, id) { const found = await wixData.query(collection).eq('_id', id).limit(2).find(options); if (found.items.length > 1) throw Error('Ambiguous margin record.'); return found.items[0] || null; },
  async insert(collection, row) { return wixData.insert(collection, row, { suppressAuth: true }); },
  async update(collection, row) { return wixData.update(collection, row, { suppressAuth: true }); },
  async remove(collection, id) { return wixData.remove(collection, id, { suppressAuth: true }); }
} });
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
  const workspace = projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff });
  const margins = await refreshMargins({ company, names: ids, orders, tasks, workspace });
  return { ...workspace, tasks: workspace.tasks.map(row => ({ ...row, gp: margins.get(row.id) ?? null })) };
});
