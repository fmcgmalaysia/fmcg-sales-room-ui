import { operationId } from 'backend/purchaseOperationJournal.js';
import { createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { createStockControlReader } from 'backend/stockControlService.js';

const read = createStockControlReader({
  readMember: () => currentMember.getMember({ fieldsets: ['FULL'] }),
  readStaffRecords: () => fulfilmentStore.all('StaffMasterAccess'),
  readContext: async(company,staff)=>{
    const id=operationId(company,'STOCK_CONTROL'),journal=company==='NCT'?'NCTActivity':'NCTActivity1';let initial;
    const router=createCurrentWarehouseOrdersRouter({company,
      readControl:async()=>{initial=await fulfilmentStore.read(journal,id);return initial;},
      readCurrent:async()=>{throw Error('Inventory changed. Refresh the updated Stock Control page.');},
      readLegacy:async()=>{
        const context=await readFulfilmentContext(company,staff),after=await fulfilmentStore.read(journal,id);
        if(!after||after._id!==id||after.company!==company||after.stockCommitVersion!==initial.stockCommitVersion||after.mode!=='LEGACY'||after.pending!==null||after.generation!==initial.generation||after.schemaVersion!==initial.schemaVersion)throw Error('Inventory changed during the original stock read. Refresh before using stock.');
        return context;
      }});return router();
  }
});
export const getWarehouseStockControl = webMethod(Permissions.SiteMember, (company, input) => read(company, input));
