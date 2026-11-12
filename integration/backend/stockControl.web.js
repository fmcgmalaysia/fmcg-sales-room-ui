import { webMethod, Permissions } from 'wix-web-module';
import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';
import { readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { projectStockControlPage, validateStockListInput } from 'backend/stockControlService.js';

export const getWarehouseStockControl = webMethod(Permissions.SiteMember, async (company, input = {}) => {
  const staff = await getManagedDepartmentContext('WAREHOUSE', company);
  validateStockListInput(input);
  const context = await readFulfilmentContext(company, staff);
  if (context.company !== company) throw Error('Stock company mismatch.');
  return { ...projectStockControlPage(context, input, new Date().toISOString()), staff: { staffName: staff.staffName } };
});
