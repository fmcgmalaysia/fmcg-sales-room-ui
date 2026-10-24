import { items } from '@wix/data';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createNctIntake, createNctReceiptReader } from 'backend/nctIntake.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentOrderIntakeOperations } from 'backend/stockCurrentCommands.js';
// Original receiver invokes this ONLY after server bearer authentication.
// Coverage is deliberately empty until every real writer has platform evidence.
const writerCoverage = Object.freeze({});
export async function createCurrentOrderIntake({ company, captureCosts }) {
  if (!['NCT','GHR'].includes(company) || typeof captureCosts !== 'function') throw Error('Original intake company/dependencies required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const control = await fulfilmentStore.read(journal, operationId(company, 'STOCK_CONTROL'));
  if (control?._id !== operationId(company, 'STOCK_CONTROL') || control.company !== company || control.schemaVersion !== 1
    || typeof control.stockCommitVersion !== 'string' || !control.stockCommitVersion || !Number.isSafeInteger(control.generation)
    || control.generation < 0 || !['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode)) throw Error('Original intake inventory control unavailable');
  if (control.mode === 'LEGACY') { if (control.pending !== null) throw Error('Original intake legacy save pending'); return {mode:'LEGACY'}; }
  if (control.mode !== 'ACTIVE') return {mode:control.mode};
  const [orders, tasks] = company === 'NCT' ? ['NCTOrders','NCTTasks'] : ['NCTOrders1','NCTTasks1'];
  const store = createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{
    [journal]:['activityTime'],[orders]:['masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
  const protocol = createSegmentedFencedProof({company,store,domainWrites:true});
  const operations = createCurrentOrderIntakeOperations({company,store,protocol,coverage:writerCoverage,createNctIntake,createNctReceiptReader,captureCosts,
    readOppositePreparation:async(collection,id)=>{
      if (collection !== (company === 'NCT' ? 'NCTActivity1' : 'NCTActivity')) throw Error('Opposite intake preparation read only');
      return fulfilmentStore.read(collection,id);
    }});
  return {mode:'ACTIVE',...operations};
}
