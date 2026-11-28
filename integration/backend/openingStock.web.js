import { webMethod, Permissions } from 'wix-web-module';
import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
import { createOpeningStockOperations } from 'backend/openingStockOperations.js';
import { operationId } from 'backend/purchaseOperationJournal.js';

const openingStock = createOpeningStockOperations({
  store: fulfilmentStore, names: PURCHASE_COLLECTIONS,
  readContext: (company, staff) => readFulfilmentContext(company, staff, { includeSuppliers: false }),
  resolveProduct: async barcode => {
    const product = (await capturePointbaseCosts([barcode]))[barcode];
    return product?.unitBarcode === barcode
      ? { name: product.itemName, packing: product.packingSize, ea: product.eaPerCtn } : null;
  }
});

async function openingStockStaff(company) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Select NCT or GHR.');
  const staff = await getManagedDepartmentContext('ACCOUNT', company, 'EDIT');
  return { ...staff, canPostOpeningStock: true };
}

export const previewOpeningStock = webMethod(Permissions.SiteMember, async (company, barcode) => {
  const staff = await openingStockStaff(company);
  try { return { ok: true, ...await openingStock.preview(company, staff, barcode) }; }
  catch (error) {
    if (error?.code === 'OPENING_STOCK_INPUT') return { ok: false, rejected: true, error: error.message };
    throw error;
  }
});
export const postOpeningStock = webMethod(Permissions.SiteMember, async (company, requestId, input) => {
  const staff = await openingStockStaff(company);
  try { return await openingStock.save({ company, staff, requestId, input }); }
  catch (error) {
    if (error?.code === 'OPENING_STOCK_INPUT') return { ok: false, rejected: true, error: error.message };
    throw error;
  }
});
export const getOpeningStockAccess = webMethod(Permissions.SiteMember, async company => {
  const staff = await openingStockStaff(company);
  return { allowed: true, recoveryScope: operationId('OPENING_STOCK_ACCOUNT', company, staff.memberId) };
});
