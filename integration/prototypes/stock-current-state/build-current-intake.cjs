'use strict';
// Build only isolated original receiver/private root; never install or publish.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../..');
function once(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Exact original intake anchor changed');
  return source.replace(before, () => after);
}
let receiver = fs.readFileSync(path.join(root, 'integration/backend/nctReceiver.js'), 'utf8').replace(/\r\n/g, '\n');
receiver = "import { createCurrentOrderIntake } from 'backend/stockCurrentOrderIntake.js';\n" + receiver;
receiver = once(receiver,
  "    try { return { status: 200, body: body?.action === 'READ_RECEIPT' ? await readReceipt(body.submission) : await receive(body) }; }",
  "    try {\n      const submission = body?.action === 'READ_RECEIPT' ? body.submission : body;\n      const current = await createCurrentOrderIntake({ company: submission?.destination, captureCosts });\n      if (current?.mode === 'LEGACY') return { status: 200, body: body?.action === 'READ_RECEIPT' ? await readReceipt(body.submission) : await receive(body) };\n      if (current?.mode !== 'ACTIVE') throw Error('Current intake unavailable; retain original source order');\n      return { status: 200, body: body?.action === 'READ_RECEIPT' ? await current.readReceipt(body.submission) : await current.receive(body) };\n    }");
const native = `import { items } from '@wix/data';
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
`;
for (const [name, source] of Object.entries({ 'nctReceiver.candidate.js': receiver, 'stockCurrentOrderIntake.js': native })) {
  new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  const filename = path.join(__dirname, name);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Current original intake candidate differs: ' + name);
  } else fs.writeFileSync(filename, source);
}
process.stdout.write('Original authenticated intake/private current root ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; not installed\n');
