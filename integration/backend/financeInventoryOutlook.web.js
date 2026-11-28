import { Permissions, webMethod } from 'wix-web-module';
import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { financeInventoryOutlook, outlookPeriod } from 'backend/financeInventoryOutlook.js';
import { closingShipmentMonth, confirmOriginalMonthEnd, prepareOriginalMonthEnd } from 'backend/financeOriginalMonthEnd.js';
import { createFinanceMonthEndArchive } from 'backend/financeMonthEndArchive.js';

const collection = 'FinanceMonthEndOriginals';
const archive = createFinanceMonthEndArchive({
  get: id => fulfilmentStore.read(collection,id),
  insert: row => fulfilmentStore.insert(collection,row)
});

async function readRows(company) {
  const names = PURCHASE_COLLECTIONS[company];
  const [orders,tasks,activity] = await Promise.all([names.orders,names.tasks,names.activity].map(name=>fulfilmentStore.all(name)));
  return {company,orders,tasks,activity};
}

export const readFinanceInventoryOutlook = webMethod(Permissions.SiteMember, async (company, asOf, month) => {
  const end=outlookPeriod(company,asOf,month);
  if (end > Date.now()+86400000) throw Error('Select today or an earlier date.');
  await getManagedDepartmentContext('ACCOUNT',company);
  return financeInventoryOutlook(await readRows(company),asOf,month);
});

export const readFinanceMonthEnd = webMethod(Permissions.SiteMember, async (company, asOf) => {
  closingShipmentMonth(company,asOf,new Date());
  await getManagedDepartmentContext('ACCOUNT',company);
  return archive.read(company,asOf);
});

export const previewFinanceMonthEnd = webMethod(Permissions.SiteMember, async (company, asOf) => {
  const now = new Date();
  closingShipmentMonth(company,asOf,now);
  await getManagedDepartmentContext('ACCOUNT',company,'EDIT');
  const prior = await archive.read(company,asOf);
  if (prior) return {original:prior};
  const prepared = prepareOriginalMonthEnd(await readRows(company),company,asOf,now);
  return {preview:prepared.report,revision:prepared.revision};
});

export const saveFinanceMonthEnd = webMethod(Permissions.SiteMember, async (company, asOf, revision) => {
  if (!/^[a-f0-9]{32}$/.test(revision || '')) throw Error('Review the closing balance before confirming.');
  const staff = await getManagedDepartmentContext('ACCOUNT',company,'EDIT');
  return confirmOriginalMonthEnd({company,asOf,closedBy:staff.staffName,now:new Date(),archive,readRows,revision});
});
