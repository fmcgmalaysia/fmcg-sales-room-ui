import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';
import { requirePurchaseStaff } from 'backend/r2purchaseProjection.js';
import { createPurchaseCostRetry } from 'backend/r2purchaseCostRetry.js';
import { capturePointbaseCosts } from 'backend/r2pointbaseCostClient.js';
import { fulfilmentStore } from 'backend/r2customerFulfilmentService.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentCostReferenceSave, createCurrentCostTables } from 'backend/r2stockCurrentCommands.js';
// Private existing reference-cost writer only. No new role, cost policy or webMethod.
// Actual schema/type and all writer verification are still release gates.
const writerCoverage = Object.freeze({});
export async function createCurrentCostReference(company) {
  if (!['NCT','GHR'].includes(company)) throw Error('Original Purchase company required');
  await getPurchaseStaffContext();
  const journal = company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1';
  const control = await fulfilmentStore.read(journal, operationId(company,'STOCK_CONTROL'));
  if (control?._id !== operationId(company,'STOCK_CONTROL') || control.company !== company || control.schemaVersion !== 1
    || typeof control.stockCommitVersion !== 'string' || !control.stockCommitVersion || !Number.isSafeInteger(control.generation)
    || control.generation < 0 || !['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode)) throw Error('Current reference control unavailable');
  if (control.mode === 'LEGACY') { if (control.pending !== null) throw Error('Legacy reference save pending'); return {mode:'LEGACY'}; }
  if (control.mode !== 'ACTIVE') return {mode:control.mode};
  const [orders,tasks] = company === 'NCT' ? ['R2NCTOrders','R2NCTTasks'] : ['R2NCTOrders1','R2NCTTasks1'];
  const store = createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{
    [journal]:['activityTime'],[tasks]:['lastCostCaptureTime'],[orders]:['masterReceivedTime','salesSubmissionTime']}});
  const protocol = createSegmentedFencedProof({company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true});
  const save = createCurrentCostReferenceSave({company,store,protocol,coverage:writerCoverage,authorityDependencies:{
    readMember:()=>currentMember.getMember({fieldsets:['FULL']}),readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),requirePurchaseStaff,
    readCostTables:createCurrentCostTables({company,store,items}),createPurchaseCostRetry,captureCosts:capturePointbaseCosts,now:()=>new Date()}});
  return {mode:'ACTIVE',save};
}
