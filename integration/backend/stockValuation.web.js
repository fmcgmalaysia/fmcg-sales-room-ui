import { webMethod, Permissions } from 'wix-web-module';
import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';
import { readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { projectStockValuationPage } from 'backend/stockValuationService.js';
import { validateStockListInput } from 'backend/stockControlService.js';

export const getFinanceStockList = webMethod(Permissions.SiteMember, async (company, input = {}) => {
  const staff = await getManagedDepartmentContext('ACCOUNT', company);
  validateStockListInput(input);
  const context = await readFulfilmentContext(company, staff);
  if (context.company !== company) throw Error('Stock company mismatch.');
  return { ...projectStockValuationPage(context, input, new Date().toISOString()), staff: { staffName: staff.staffName } };
});
