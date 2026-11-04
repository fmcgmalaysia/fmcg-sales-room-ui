'use strict';
// Read-only prerequisite checks. Never a business save or an activation receipt.
const { createHash } = require('node:crypto');
const { COHORT } = require('./isolated-cohort.cjs');
const { currentNativeSetupContract } = require('./native-setup-review.cjs');
const { activationAuditFields, stable } = require('./fresh-cohort-activation-schema.cjs');
const { wireType } = require('./native-schema-installer.cjs');
const group = (type, names) => Object.fromEntries(names.split(' ').map(name => [name, type]));
function readPreflightContract() {
  const original = Object.fromEntries(currentNativeSetupContract().entries.map(row =>
    [row.id, Object.fromEntries(Object.entries(row.fields).map(([key, type]) => [key, wireType(type)]))]));
  // Explicit fields emitted by the original nctIntake core, not guessed from CMS labels.
  const order = { ...group('TEXT', 'title description image imageAltText customerId customerCompanyName customerPoNumber transactionCurrency buyerReceivedBy submittedByStaffId submittedByStaffName submissionId intakeStatus sourceSiteId salesInvoiceNumber financialLockedBy sourceLineId'),
    ...group('NUMBER', 'orderId adminFxSource cbmCtn sellingPricePc orderQtyInCtn') };
  const task = { ...group('TEXT', 'title description imageAltText supplierId ourPoNumber costStatus costErrorReason purchaseStage riskReason specialPurchaseReason'),
    ...group('NUMBER', 'rowPosition purchaseQtyInCtn receivedQtyInCtn lpPc lpCtn disc1 disc2 disc3'),
    originalCostSnapshot: 'OBJECT', latestCostReference: 'OBJECT', manualCostField: 'ARRAY', risk: 'BOOLEAN', specialPurchase: 'BOOLEAN' };
  const journal = { ...group('TEXT', 'title description image imageAltText actorType initiatedByStaffId initiatedByStaffName result message'), ...activationAuditFields };
  return Object.fromEntries(['NCT', 'GHR'].map(company => {
    const suffix = company === 'NCT' ? '' : '1';
    const entry = (id, fields = {}) => ({ collection: 'R2' + id, fields: { ...original[id], ...fields } });
    return [company, { ORDERS: entry('NCTOrders' + suffix, order), TASKS: entry('NCTTasks' + suffix, task),
      JOURNAL: entry('NCTActivity' + suffix, journal), PURCHASE_ORDERS: entry('PurchaseOrders', { title: 'TEXT', details: 'OBJECT' }),
      PRODUCTS: entry('StockProducts'), POSITIONS: entry('StockPositions'), CLAIMS: entry('StockClaims') }];
  }));
}
const contracts = readPreflightContract();
function createFreshCohortReadPreflight({ collections, items, authenticateAdmin }) {
  if (typeof collections?.getDataCollection !== 'function' || typeof items?.query !== 'function'
    || typeof authenticateAdmin !== 'function') throw Error('Read-only native prerequisite dependencies required');
  async function authorize(owner) {
    const actor = await authenticateAdmin();
    if (actor?.isAdmin !== true || typeof actor.memberId !== 'string' || !actor.memberId
      || owner && actor.memberId !== owner) throw Error('Same actual administrator required');
    return actor.memberId;
  }
  function metadata(row, target) {
    if (row?._id !== target || !['string', 'number'].includes(typeof row.revision)
      || !String(row.revision).trim() || typeof row.revision === 'number' && !Number.isFinite(row.revision)
      || !Array.isArray(row.fields) || row.fields.length > 500
      || row.fields.some(field => typeof field?.key !== 'string' || !field.key || typeof field.type !== 'string' || !field.type)
      || new Set(row.fields.map(field => field.key)).size !== row.fields.length
      || ['read', 'insert', 'update', 'remove'].some(op => row.permissions?.[op] !== 'ADMIN')) throw Error('Complete private native metadata required');
  }
  async function inspect(input) {
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'company,scope'
      || !Object.hasOwn(contracts, input.company) || !Object.hasOwn(contracts[input.company], input.scope)) {
      throw Error('Fixed R2 read-prerequisite scope required');
    }
    const { company, scope } = input, definition = contracts[company][scope], target = definition.collection;
    const owner = await authorize(), before = await collections.getDataCollection(target, { consistentRead: true });
    metadata(before, target); const image = stable(before), issues = [], queries = [];
    for (const [key, type] of Object.entries(definition.fields)) {
      const actual = before.fields.find(field => field.key === key);
      if (!actual || actual.type !== type) issues.push({ field: key, expectedType: type,
        actualType: actual?.type || null, code: actual ? 'TYPE_CONFLICT_NO_OVERWRITE' : 'REQUIRED_FIELD_MISSING' });
    }
    async function run(name, query) {
      await authorize(owner);
      const page = await query.limit(1).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || page.items.length > 1 || !Number.isSafeInteger(page.totalCount)
        || page.totalCount < 0 || page.items.length !== Math.min(1, page.totalCount)) throw Error('Complete native read result required');
      // Do not export business content or call populated query results semantic proof.
      queries.push({ name, totalCount: page.totalCount, returnedRows: page.items.length });
    }
    // Use the actual runtime predicates and sorting, without faking an ACTIVE control
    // or invoking a workspace that may update GP/margins as a side effect.
    if (!issues.length) {
      const q = () => items.query(target), active = () => q().eq('company', company).eq('status', 'ACTIVE');
      const marker = 'R2_PREFLIGHT_READ_ONLY_NO_BUSINESS_ID';
      await run('EXACT_ID', q().eq('_id', marker));
      await run('EXACT_ID_BATCH', q().hasSome('_id', [marker, marker + '_2']));
      if (scope === 'PRODUCTS') {
        await run('ACTIVE_PRODUCT_PAGE', active().ascending('barcode', '_id').skip(0));
        await run('ACTIVE_PRODUCT_SEARCH', active().and(q().contains('barcode', marker).or(q().contains('name', marker)).or(q().contains('packing', marker))).ascending('barcode', '_id').skip(0));
      } else if (scope === 'POSITIONS') {
        await run('ACTIVE_PRODUCT_POSITIONS', active().eq('stockKey', marker).ascending('_id').skip(0));
      } else if (scope === 'CLAIMS') {
        await run('ACTIVE_POSITION_CLAIMS', active().eq('positionId', marker).ascending('_id').skip(0));
        await run('ACTIVE_TASK_CLAIMS', active().eq('taskId', marker).ascending('_id').skip(0));
      } else if (scope === 'JOURNAL') {
        await run('ACTIVE_TASK_RELATIONS', active().eq('action', 'STOCK_TRANSFER_CURRENT').eq('participantTaskIds', marker).ascending('_id').skip(0));
        await run('ACTIVE_OUTSTANDING_RELATIONS', active().eq('action', 'STOCK_TRANSFER_CURRENT').ascending('_id').skip(0));
        await run('REPAID_SOURCE', q().eq('company', company).eq('replacementSourceId', marker).gt('repaidQuantity', 0).ascending('_id'));
      }
    }
    await authorize(owner);
    const after = await collections.getDataCollection(target, { consistentRead: true }); metadata(after, target);
    if (image !== stable(after)) throw Error('Native schema changed during prerequisite read');
    await authorize(owner);
    return { schema: 'R2_NATIVE_READ_PREFLIGHT_V1', cohort: COHORT, company, scope, collection: target,
      metadataSha256: createHash('sha256').update(image).digest('hex'), requiredFieldsReviewed: Object.keys(definition.fields).length,
      schemaMatches: !issues.length, queriesExecuted: queries.length, queries, issues,
      mutationCapability: false, indexesRead: false, populatedQuerySemanticsAccepted: false,
      typedRoundtripsAccepted: false, writerCoverageAccepted: false, activationAllowed: false };
  }
  return { inspect };
}
module.exports = { readPreflightContract, contracts, createFreshCohortReadPreflight };
