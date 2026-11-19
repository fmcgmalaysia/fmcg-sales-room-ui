// Master site only. Staff/Supplier field IDs require fresh native readback before deployment.
import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { applyPurchaseProgress } from 'backend/purchaseProgress.js';
import { purchaseOrderList, purchaseOrderReadResult } from 'backend/purchaseOrderWorkflow.js';
import { readPurchaseMargins } from 'backend/purchaseMarginRefresh.js';
import { readCustomerShortNames } from 'backend/customerNamesClient.js';
import { purchaseReceiptInfo } from 'backend/purchaseReceiptInfo.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
const options = { suppressAuth: true, consistentRead: true };
async function all(query) {
  let page = await query.limit(1000).find(options), rows = [...page.items];
  while (page.hasNext()) { page = await page.next(); rows.push(...page.items); }
  return rows;
}
async function purchaseActivity(collection) {
  // Save/result recovery still reads its original receipts directly. The task
  // projection needs result receipts only for confirmed historical row ordering.
  const rows = await all(wixData.query(collection).ne('action','PURCHASE_OPERATION_RESULT').ne('action','CUSTOMER_ACCOUNT_DOCUMENT_SAVED').ne('action','CUSTOMER_ACCOUNT_ALLOCATION_SAVED').or(wixData.query(collection).isEmpty('action')));
  const legacyResults = [...new Set(rows.filter(row=>row.action==='PURCHASE_OPERATION_PREPARED'&&row.details?.plan?.displayOrder).map(row=>operationId(row.title,'RESULT')))];
  for(let index=0;index<legacyResults.length;index+=100) rows.push(...await all(wixData.query(collection).hasSome('title',legacyResults.slice(index,index+100))));
  return rows;
}
export const getPurchaseWorkspace = webMethod(Permissions.SiteMember, async company => {
  if (!PURCHASE_COLLECTIONS[company]) throw Error('Select NCT or GHR.');
  const staff = await getPurchaseStaffContext(company);
  const ids = PURCHASE_COLLECTIONS[company];
  const [orders, tasks, activity, suppliers, purchaseRecords] = await Promise.all([
    all(wixData.query(ids.orders)), all(wixData.query(ids.tasks)), purchaseActivity(ids.activity),
    all(wixData.query('SharedSuppliers')), all(wixData.query('PurchaseOrders').eq('company',company))
  ]);
  const workspace = projectPurchaseWorkspace({ company, orders, tasks, activity, suppliers, staff });
  let customerNamesError='';
  const [customerNames,margins]=await Promise.all([
    readCustomerShortNames(workspace.customers.map(row=>row.id)).catch(()=>{customerNamesError='客户 Short Name 暂时无法读取，请核对客户资料。';return [];}),
    readPurchaseMargins({ company, orders, tasks, workspace, activity })
  ]);
  workspace.customers=workspace.customers.map(row=>({...row,shortName:customerNames.find(item=>item.customerId===row.id)?.shortName||''}));
  const purchaseOrders=purchaseOrderList({company,workspace,records:purchaseRecords,staff});
  applyPurchaseProgress(workspace,activity,purchaseOrders);
  const receiptInfo = purchaseReceiptInfo(purchaseOrders, activity);
  const purchaseOrdersResult=purchaseOrderReadResult({company,rows:purchaseOrders,names:customerNames,customerNamesError:customerNamesError?'客户 Short Name 暂时无法读取，采购单保留已保存名称。':customerNames.some(row=>!row.shortName)?'客户 Short Name 尚未填写；该客户暂显示已保存名称。':''});
  return { ...workspace, customerNamesError, purchaseOrders:purchaseOrdersResult, tasks: workspace.tasks.map(row => ({ ...row, receiptHistory: receiptInfo.get(row.id) || [], gp: margins.get(row.id) ?? null, sourceGp: margins.get('SOURCE:'+row.id) ?? null })) };
});
