import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { createStockControlReader } from 'backend/stockControlService.js';

const read = createStockControlReader({
  readMember: () => currentMember.getMember({ fieldsets: ['FULL'] }),
  readStaffRecords: () => fulfilmentStore.all('StaffMasterAccess'),
  readContext: readFulfilmentContext
});
export const getWarehouseStockControl = webMethod(Permissions.SiteMember, (company, input) => read(company, input));
