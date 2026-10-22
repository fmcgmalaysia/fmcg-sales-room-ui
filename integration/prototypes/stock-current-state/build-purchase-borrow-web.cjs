'use strict';
// Candidate root composition using ORIGINAL read-only company context/auth. No
// production install, elevation, initialization or activation is performed here.
const fs = require('node:fs'), path = require('node:path');
const { WRITERS } = require('./stock-admission.cjs');
const source = `import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { items } from '@wix/data';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { requirePurchaseStaff } from 'backend/purchaseProjection.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/warehousePreparation.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseBorrowGateway } from 'backend/stockCurrentCommands.js';
// Deliberately empty until actual ALL-writer verification and production permission,
// schemas, initialization, shadow and capacity acceptance. Browser cannot set this.
const writerCoverage = Object.freeze({});
const requiredWriters = Object.freeze(${JSON.stringify(WRITERS)});
// Both company journal activityTime fields were inspected in MASTER CMS. Other
// fields/collections and actual SDK roundtrips remain gates; never infer types.
const verifiedDateFields = Object.freeze({ NCTActivity: ['activityTime'], NCTActivity1: ['activityTime'] });
async function privateGateway(company) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Known Purchase company required');
  await getPurchaseStaffContext(); // Original authorization BEFORE any stock data.
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  if (!Object.hasOwn(verifiedDateFields, journal)) throw Error('Current company schema not verified');
  const store = createSdkConditionalStore({ company, items, collections: planCollections(company, true),
    dateTimeFields: { [journal]: verifiedDateFields[journal] } });
  const protocol = createSegmentedFencedProof({ company, store, domainWrites: true });
  const guardedProtocol = { ...protocol, readSnapshot: read => protocol.readSnapshot(control => {
    if (!control.writerBuild || requiredWriters.some(writer => writerCoverage[writer]?.verified !== true
      || writerCoverage[writer].build !== control.writerBuild)) throw Error('All current writers must be verified before actionable borrowing reads');
    return read(control);
  }) };
  // ORIGINAL readFulfilmentContext only reads/project facts. Do not call public
  // getPurchaseWorkspace here: it performs the old unfenced margin cache refresh.
  const authorityDependencies = {
    readMember: () => currentMember.getMember({ fieldsets: ['FULL'] }),
    readStaffRecords: () => fulfilmentStore.all('StaffMasterAccess'), requirePurchaseStaff,
    readContext: readFulfilmentContext,
    readPurchaseRecords: async selectedCompany => {
      if (selectedCompany !== company) throw Error('Purchase record company conflict');
      return (await fulfilmentStore.all('PurchaseOrders')).filter(row => row.company === company);
    },
    projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists,
    packingHeld, readPreparation, projectPreparation,
    readTransfer: (selectedCompany, id) => {
      if (selectedCompany !== company) throw Error('Purchase transfer company conflict');
      return store.read(journal, operationId(company, 'STOCK_TRANSFER_CURRENT', id));
    },
    readCurrentTaskRows: async (selectedCompany, ids) => {
      if (selectedCompany !== company || !Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length > 2000
        || ids.some(id => typeof id !== 'string' || !id || id.length > 128)) throw Error('Exact bounded current tasks required');
      const collection = company === 'NCT' ? 'NCTTasks' : 'NCTTasks1', rows = [];
      for (const id of ids) rows.push(await store.read(collection, id));
      return rows;
    }, now: () => new Date()
  };
  return createCurrentPurchaseBorrowGateway({ company, items, store, protocol: guardedProtocol,
    coverage: writerCoverage, authorityDependencies });
}
export const getPurchaseBorrowOptionsCurrent = webMethod(Permissions.SiteMember, async (company, input) => {
  try {
    if (!input || JSON.stringify(input).length > 6000) throw Error('Bounded borrowing options required');
    return await (await privateGateway(company)).readOptions(company, input);
  } catch (_) {
    return { ok: false, error: 'Borrowing options unavailable. Refresh and review. 可借货资料暂不可读取，请刷新核对。' };
  }
});
export const savePurchaseBorrowingCurrent = webMethod(Permissions.SiteMember, async (company, request) => {
  try {
    if (!request || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || JSON.stringify(request).length > 6000) throw Error('Bounded original borrowing save required');
    return await (await privateGateway(company)).save(company, request);
  } catch (_) {
    return { ok: false, requestId: typeof request?.requestId === 'string' && request.requestId.length <= 100 ? request.requestId : '',
      error: 'Borrowing save unconfirmed. Retain and retry the original request. 借货保存尚未确认，请保留并重试原请求。' };
  }
});
export const getPurchaseBorrowReturnOptionsCurrent = webMethod(Permissions.SiteMember, async (company, input) => {
  try {
    if (!input || JSON.stringify(input).length > 6000) throw Error('Bounded unused return options required');
    return await (await privateGateway(company)).readReturnOptions(company, input);
  } catch (_) {
    return { ok: false, error: 'Unused borrowing return unconfirmed. Refresh and review. 未使用借货的归还资料尚未确认，请刷新核对。' };
  }
});
`;
new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
const target = path.join(__dirname, 'stockCurrentBorrow.web.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Purchase borrowing web root differs from tested source');
} else fs.writeFileSync(target, source);
process.stdout.write('Original-context borrowing web root '+(process.argv.includes('--check') ? 'verified' : 'built')+'; activation/permissions remain closed; no deployment\n');
