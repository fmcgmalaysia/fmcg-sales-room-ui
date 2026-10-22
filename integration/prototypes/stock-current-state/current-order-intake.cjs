'use strict';

const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { prepareOrderIntake, intakeProtocolIdentity } = require('./order-intake-plan.cjs');
const { evaluateStockAdmission } = require('./stock-admission.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

// PRIVATE, reachable only after the unchanged nctReceiver bearer check. The source
// keeps its original immutable destination/order lock across every pending response.
// No browser generation, routing override, staff grant or new submission identity.
function createCurrentOrderIntakeOperations({ company, store, protocol, coverage = {},
  createNctIntake, createNctReceiptReader, readOppositePreparation, captureCosts, now = () => new Date() }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2') throw Error('Private current intake scope required');
  for (const fn of [store?.read, protocol?.commit, protocol?.readSnapshot, protocol?.readControl,
    createNctIntake, createNctReceiptReader, readOppositePreparation, captureCosts, now]) {
    if (typeof fn !== 'function') throw Error('Original current intake dependency required');
  }
  const [orders, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const otherJournal = company === 'NCT' ? 'NCTActivity1' : 'NCTActivity';
  const originalReceipt = createNctReceiptReader({ store });
  async function validate(body) {
    if (body?.destination !== company) throw Error('Original intake company conflict');
    // Run the ORIGINAL full input validator without touching a real collection.
    await createNctReceiptReader({ store: { read: async () => null } })(body);
    intakeProtocolIdentity(body);
  }
  function admit(control, operation) {
    const result = evaluateStockAdmission({ company, writer: 'ORDER_INTAKE', control, coverage, operation,
      request: { stockProtocol: 1, stockBuild: control.writerBuild,
        stockGeneration: operation?.replay ? operation.baseGeneration : control.generation } });
    if (result.route !== 'FENCED_CURRENT') throw Error('Current intake requires ACTIVE; no legacy fallback');
    return result;
  }
  async function readReceipt(body) {
    await validate(body);
    const snapshot = await protocol.readSnapshot(async control => {
      admit(control);
      return originalReceipt(copy(body));
    });
    return copy(snapshot.rows);
  }
  async function receive(body) {
    await validate(body);
    const input = copy(body), identity = intakeProtocolIdentity(input);
    // An already accepted original delivery is a read-only replay, not an empty
    // stock commit. Pending saves must resume below; even ORDER_RECEIVED alone is
    // not a final receipt until all current images/generation have been verified.
    const initial = await protocol.readControl();
    if (!initial.pending) {
      const prior = await readReceipt(input);
      if (prior.ok === true) return prior;
    }
    let admittedGeneration;
    const result = await protocol.commit({ ...identity, input,
      authorize: operation => { admittedGeneration = admit(operation.control, operation).generation; },
      prepare: async () => {
        const snapshot = await protocol.readSnapshot(async control => {
          if (control.generation !== admittedGeneration) throw Error('Intake checkpoint changed');
          admit(control);
          const base = [input.sourceSiteId, input.orderId];
          const tables = { [orders]: [], [tasks]: [], [journal]: [], [otherJournal]: [] };
          const exact = async (collection, id) => {
            const row = collection === otherJournal ? await readOppositePreparation(collection, id) : await store.read(collection, id);
            if (row !== null) {
              if (!row || row._id !== id || row.company && row.company !== (collection === otherJournal ? (company === 'NCT' ? 'GHR' : 'NCT') : company)) throw Error('Exact intake record identity conflict');
              tables[collection].push(copy(row));
            }
          };
          await exact(journal, hash(...base, 'PREPARED'));
          await exact(journal, hash(...base, 'ACCEPTED'));
          await exact(otherJournal, hash(...base, 'PREPARED'));
          for (const line of input.lines) {
            await exact(orders, hash(...base, line.sourceLineId, 'ORDER'));
            await exact(tasks, hash(...base, line.sourceLineId, 'TASK'));
            await exact(journal, hash(...base, line.sourceLineId, 'INITIAL_COST'));
          }
          const products = new Map();
          for (const line of input.lines) {
            const product = { company, barcode: line.unitBarcode, packing: line.packingSize, ea: line.eaPerCtn };
            const key = stockKey(product);
            if (!products.has(key)) products.set(key, { identity: product, row: await store.read('StockProducts', hash(company, key)) });
          }
          return prepareOrderIntake({ company, body: input, tables, createNctIntake, createNctReceiptReader,
            captureCosts, now, planFormat: 'SEGMENTED_V2', generation: control.generation, productRows: [...products.values()] });
        });
        if (snapshot.rows.replay || !snapshot.rows.plan.writes.length || snapshot.generation !== admittedGeneration) throw Error('Intake changed before preparation; review original receipt');
        return snapshot.rows.plan;
      } });
    if (result?.ok === false && result.pending === true && result.requestId === identity.requestId
      && ['BEFORE', 'APPLY', 'VERIFY'].includes(result.phase) && Number.isSafeInteger(result.completedCount)
      && Number.isSafeInteger(result.totalRecords) && result.totalRecords > 0 && result.completedCount >= 0 && result.completedCount <= result.totalRecords) {
      return { ok: false, pending: true, orderId: input.orderId, destination: company, submissionId: input.submissionId,
        phase: result.phase, completedCount: result.completedCount, totalRecords: result.totalRecords };
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.generation) || result.generation < 1) throw Error('Current intake commit unconfirmed');
    const receipt = await readReceipt(input);
    if (receipt.ok !== true) throw Error('Original accepted receipt unconfirmed');
    return receipt;
  }
  return { receive, readReceipt };
}
module.exports = { createCurrentOrderIntakeOperations };
