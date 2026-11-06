import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { createStockValuationReader } from 'backend/stockValuationService.js';

const read = createStockValuationReader({
  readMember: () => currentMember.getMember({ fieldsets: ['FULL'] }),
  readStaffRecords: () => fulfilmentStore.all('StaffMasterAccess'),
  readContext: readFulfilmentContext
});
export const getFinanceStockList = webMethod(Permissions.SiteMember, (company, input) => read(company, input));
