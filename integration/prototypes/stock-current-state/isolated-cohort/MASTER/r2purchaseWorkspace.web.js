import { createCurrentPurchaseReadRouter } from 'backend/r2stockCurrentCommands.js';
import { getPurchaseWorkspaceCurrent } from 'backend/r2stockCurrentBorrow.web.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
// Master site only. Staff/Supplier field IDs require fresh native readback before deployment.
import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/r2purchaseProjection.js';
import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';
import { readCurrentAdminFx } from 'backend/r2adminFxClient.js';
import { applyPurchaseProgress } from 'backend/r2purchaseProgress.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { createPurchaseMarginRefresh } from 'backend/r2purchaseMarginRefresh.js';
import { readCustomerShortNames } from 'backend/r2customerNamesClient.js';
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
  return createCurrentPurchaseReadRouter({company,readCurrent:getPurchaseWorkspaceCurrent,
    readControl:async()=>{const page=await wixData.query(PURCHASE_COLLECTIONS[company].activity).eq('_id',operationId(company,'STOCK_CONTROL')).limit(2).find(options);
      if(!Array.isArray(page?.items)||page.items.length>1)throw Error('Ambiguous Purchase stock control');return page.items[0]||null;},readLegacy:async()=>{
  const ids = PURCHASE_COLLECTIONS[company];
  const [orders, tasks, activity, suppliers, purchaseRecords] = await Promise.all([
    all(wixData.query(ids.orders)), all(wixData.query(ids.tasks)), all(wixData.query(ids.activity)),
    all(wixData.query('SharedSuppliers')), all(wixData.query('R2PurchaseOrders'))
  ]);
  const workspace = projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff });
  let customerNamesError='';
  const [customerNames,margins]=await Promise.all([
    readCustomerShortNames(workspace.customers.map(row=>row.id)).catch(()=>{customerNamesError='客户 Short Name 暂时无法读取，请核对客户资料。';return [];}),
    refreshMargins({ company, names: ids, orders, tasks, workspace, activity })
  ]);
  workspace.customers=workspace.customers.map(row=>({...row,shortName:customerNames.find(item=>item.customerId===row.id)?.shortName||''}));
  const purchaseOrders=projectPurchaseOrders({company,workspace,records:purchaseRecords});
  applyPurchaseProgress(workspace,activity,purchaseOrders);
  return { ...workspace, customerNamesError, tasks: workspace.tasks.map(row => ({ ...row, gp: margins.get(row.id) ?? null, sourceGp: margins.get('SOURCE:'+row.id) ?? null })) };
  }})();
});
