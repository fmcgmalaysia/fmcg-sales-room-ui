import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { items as sdkItems } from '@wix/data';
import { auth } from '@wix/essentials';
import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';
import { requirePurchaseStaff, projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/r2purchaseProjection.js';
import { createPurchaseMarginRefresh } from 'backend/r2purchaseMarginRefresh.js';
import { readCurrentAdminFx } from 'backend/r2adminFxClient.js';
import { readCustomerShortNames } from 'backend/r2customerNamesClient.js';
import { applyPurchaseProgress } from 'backend/r2purchaseProgress.js';
import { createPurchaseOperations } from 'backend/r2purchaseOperations.js';
import { createPurchaseSourceOperations } from 'backend/r2purchaseSources.js';
import { taskEditVersion } from 'backend/r2purchaseTaskIdentity.js';
import { PURCHASE_CURRENT_DISPLAY_ORDER_VERSION } from 'backend/r2purchaseDisplayOrder.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/r2customerFulfilmentService.js';
import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { readAllocations, createPlannerAllocationOperations, ALLOCATION_CURRENT_VIEW_VERSION } from 'backend/r2plannerAllocation.js';
import { createShortageOperations } from 'backend/r2purchaseShortage.js';
import { createQuantityCaseOperations, projectQuantityCases } from 'backend/r2purchaseQuantityCases.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readPackingLists } from 'backend/r2packingListOperations.js';
import { packingHeld } from 'backend/r2packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/r2warehousePreparation.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseBorrowGateway, createCurrentPurchaseTables, createCurrentPurchaseTaskGateway, readCurrentPurchaseProjection, createCurrentPurchaseWorkspaceRead, createBorrowCurrentQuery } from 'backend/r2stockCurrentCommands.js';
// Deliberately empty until actual ALL-writer verification and production permission,
// schemas, initialization, shadow and capacity acceptance. Browser cannot set this.
const writerCoverage = Object.freeze({});
const requiredWriters = Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
// Original journal and both companies' order/task Date fields inspected in CMS.
// Exact native SDK roundtrips remain a gate; never infer types from field names.
const verifiedDateFields = Object.freeze({ R2NCTActivity: ['activityTime'], R2NCTActivity1: ['activityTime'] });
async function privateGateway(company, taskCommands = false, workspaceRead = false) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Known Purchase company required');
  await getPurchaseStaffContext(); // Original authorization BEFORE any stock data.
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  if (!Object.hasOwn(verifiedDateFields, journal)) throw Error('Current company schema not verified');
  const items=Object.freeze({query:auth.elevate(sdkItems.query),insert:auth.elevate(sdkItems.insert),bulkInsert:auth.elevate(sdkItems.bulkInsert),patch:auth.elevate(sdkItems.patch),remove:()=>{throw Error('R2 privileged deletion not enabled');}});
  const store = createSdkConditionalStore({ company, items, collections: planCollections(company, true),
    dateTimeFields: { [journal]: verifiedDateFields[journal],
      [company==='NCT'?'R2NCTOrders':'R2NCTOrders1']:['masterReceivedTime','salesSubmissionTime'],
      [company==='NCT'?'R2NCTTasks':'R2NCTTasks1']:['lastCostCaptureTime'] } });
  const protocol = createSegmentedFencedProof({company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,batchNewInserts:true});
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
      return (await fulfilmentStore.all('R2PurchaseOrders')).filter(row => row.company === company);
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
      const collection = company === 'NCT' ? 'R2NCTTasks' : 'R2NCTTasks1', rows = [];
      for (const id of ids) rows.push(await store.read(collection, id));
      return rows;
    }, now: () => new Date()
  };
  if (taskCommands || workspaceRead) {
    const readTables = createCurrentPurchaseTables({ company, store, readOriginalTable: collection => fulfilmentStore.all(collection) });
    const readCurrentContext = async (selectedCompany, staff, control) => {
          if(selectedCompany!==company||PURCHASE_CURRENT_PROJECTION_VERSION!==2)throw Error('Paired original current margin context required');
          const tables=await readTables(company,staff),names=company==='NCT'?{orders:'R2NCTOrders',tasks:'R2NCTTasks',activity:'R2NCTActivity'}:{orders:'R2NCTOrders1',tasks:'R2NCTTasks1',activity:'R2NCTActivity1'};
          const originalArguments={company,staff,orders:tables[names.orders],tasks:tables[names.tasks],activity:tables[names.activity],suppliers:tables.SharedSuppliers};
          const context={...projectPurchaseWorkspace(originalArguments),activity:tables[names.activity]};
          const current=await readCurrentPurchaseProjection({...authorityDependencies,company,context,staff,control,items,store,originalArguments,
            projectPurchaseWorkspace,currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,
            readPurchaseRecords:async()=>tables.R2PurchaseOrders});
          return {tables,workspace:current.workspace};
        };
    if (workspaceRead) return createCurrentPurchaseWorkspaceRead({company,protocol:guardedProtocol,authenticate:getPurchaseStaffContext,
      readCurrentContext,readRates:readCurrentAdminFx,createPurchaseMarginRefresh,readCustomerShortNames,projectPurchaseOrders,applyPurchaseProgress,now:authorityDependencies.now,
      readOutstanding:(selectedCompany,input,staff)=>createBorrowCurrentQuery({company,items,protocol:guardedProtocol,authenticate:async()=>staff})(selectedCompany,input)});
    return createCurrentPurchaseTaskGateway({ company, items, store, protocol: guardedProtocol, coverage: writerCoverage,
      currentDisplayOrderVersion: PURCHASE_CURRENT_DISPLAY_ORDER_VERSION, authorityDependencies: { ...authorityDependencies,
        createPurchaseMarginRefresh, readRates: readCurrentAdminFx, readMarginContext:readCurrentContext,
        readTables, createPurchaseOperations, createPurchaseSourceOperations, taskEditVersion, operationId, projectPurchaseWorkspace,
        createPlannerAllocationOperations, allocationViewVersion: ALLOCATION_CURRENT_VIEW_VERSION,
        createShortageOperations, createQuantityCaseOperations, projectQuantityCases,
        currentDisplayOrderVersion: PURCHASE_CURRENT_DISPLAY_ORDER_VERSION } });
  }
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
export const savePurchaseTasksCurrent = webMethod(Permissions.SiteMember, async (company, request) => {
  try {
    if (!request || !/^[a-f0-9-]{36}$/i.test(request.requestId || '') || JSON.stringify(request).length > 200000) throw Error('Bounded original Purchase task save required');
    return await (await privateGateway(company, true))(company, request);
  } catch (_) {
    return { ok: false, requestId: typeof request?.requestId === 'string' && request.requestId.length <= 100 ? request.requestId : '',
      error: 'Purchase save unconfirmed. Retain and retry the original request. 采购保存尚未确认，请保留并重试原请求。' };
  }
});
// Identity only: unlike a workspace, this ORIGINAL Purchase authorization does
// not read pending inventory or produce actionable stock/coverage metadata.
export const getPurchaseResumeContextCurrent = webMethod(Permissions.SiteMember, async company => {
  try {
    if (!['NCT', 'GHR'].includes(company)) throw Error('Known Purchase company required');
    const staff = await getPurchaseStaffContext();
    if (['staffId','staffName','memberId'].some(key => typeof staff?.[key] !== 'string' || !staff[key]
      || staff[key].length > 200)) throw Error('Original Purchase identity required');
    return { ok: true, schema: 'PURCHASE_RESUME_CONTEXT_V1', company,
      staff: { staffId: staff.staffId, staffName: staff.staffName, memberId: staff.memberId } };
  } catch (_) {
    return { ok: false, error: 'Original Purchase identity unconfirmed. 原采购员工身份尚未确认。' };
  }
});
export const getPurchaseWorkspaceCurrent = webMethod(Permissions.SiteMember, async company => {
  try { return await (await privateGateway(company,false,true))(company); }
  catch (_) { throw Error('Current Purchase workspace unavailable. Preserve the original draft or save. 当前采购资料尚未确认，请保留原草稿或保存请求。'); }
});
