import { collections, items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { createHash } from 'crypto';
const COHORT="MASTER_20261024_R2";
const contracts={"NCT":{"ORDERS":{"collection":"R2NCTOrders","fields":{"company":"TEXT","stockCommitVersion":"TEXT","estimatedShipmentDate":"DATE","masterReceivedTime":"DATETIME","salesSubmissionTime":"DATETIME","title":"TEXT","description":"TEXT","image":"TEXT","imageAltText":"TEXT","customerId":"TEXT","customerCompanyName":"TEXT","customerPoNumber":"TEXT","transactionCurrency":"TEXT","buyerReceivedBy":"TEXT","submittedByStaffId":"TEXT","submittedByStaffName":"TEXT","submissionId":"TEXT","intakeStatus":"TEXT","sourceSiteId":"TEXT","salesInvoiceNumber":"TEXT","financialLockedBy":"TEXT","sourceLineId":"TEXT","orderId":"NUMBER","adminFxSource":"NUMBER","cbmCtn":"NUMBER","sellingPricePc":"NUMBER","orderQtyInCtn":"NUMBER"}},"TASKS":{"collection":"R2NCTTasks","fields":{"company":"TEXT","stockCommitVersion":"TEXT","stockCounterSchema":"NUMBER","stockDispatchedCumulative":"NUMBER","stockCounterGeneration":"NUMBER","lastCostCaptureTime":"DATETIME","title":"TEXT","description":"TEXT","imageAltText":"TEXT","supplierId":"TEXT","ourPoNumber":"TEXT","costStatus":"TEXT","costErrorReason":"TEXT","purchaseStage":"TEXT","riskReason":"TEXT","specialPurchaseReason":"TEXT","rowPosition":"NUMBER","purchaseQtyInCtn":"NUMBER","receivedQtyInCtn":"NUMBER","lpPc":"NUMBER","lpCtn":"NUMBER","disc1":"NUMBER","disc2":"NUMBER","disc3":"NUMBER","originalCostSnapshot":"OBJECT","latestCostReference":"OBJECT","manualCostField":"ARRAY","risk":"BOOLEAN","specialPurchase":"BOOLEAN"}},"JOURNAL":{"collection":"R2NCTActivity","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","mode":"TEXT","action":"TEXT","lenderSourceId":"TEXT","replacementSourceId":"TEXT","generation":"NUMBER","transferIndexVersion":"NUMBER","repaidQuantity":"NUMBER","pending":"OBJECT","participantTaskIds":"ARRAY_STRING","details":"OBJECT","activityTime":"DATETIME","title":"TEXT","description":"TEXT","image":"TEXT","imageAltText":"TEXT","actorType":"TEXT","initiatedByStaffId":"TEXT","initiatedByStaffName":"TEXT","result":"TEXT","message":"TEXT","cohort":"TEXT","bootstrapMemberId":"TEXT","bootstrapRequestId":"TEXT","writerBuild":"TEXT","activationRequestId":"TEXT","activationMemberId":"TEXT","activationEvidenceDigest":"TEXT"}},"PURCHASE_ORDERS":{"collection":"R2PurchaseOrders","fields":{"company":"TEXT","stockCommitVersion":"TEXT","title":"TEXT","details":"OBJECT"}},"PRODUCTS":{"collection":"R2StockProducts","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","barcode":"TEXT","name":"TEXT","packing":"TEXT","ea":"NUMBER","reviewCodes":"ARRAY_STRING","reviewRequired":"BOOLEAN","onHand":"NUMBER","isolated":"NUMBER","reservedUsable":"NUMBER","available":"NUMBER","lifecycleVersion":"NUMBER","nextBorrowSequence":"NUMBER"}},"POSITIONS":{"collection":"R2StockPositions","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","barcode":"TEXT","name":"TEXT","packing":"TEXT","ea":"NUMBER","sourceKind":"TEXT","sourceId":"TEXT","sourceTaskId":"TEXT","poId":"TEXT","poNumber":"TEXT","reviewCodes":"ARRAY_STRING","receiptAccepted":"NUMBER","replacementReceived":"NUMBER","supplierReturned":"NUMBER","dispatched":"NUMBER","borrowRepaidCumulative":"NUMBER","onHand":"NUMBER","isolated":"NUMBER","reservedUsable":"NUMBER","available":"NUMBER"}},"CLAIMS":{"collection":"R2StockClaims","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","positionId":"TEXT","taskId":"TEXT","customerId":"TEXT","orderId":"TEXT","sourceLineId":"TEXT","reviewCodes":"ARRAY_STRING","reservedUsable":"NUMBER","isolatedAttributed":"NUMBER","dispatchedCumulative":"NUMBER"}}},"GHR":{"ORDERS":{"collection":"R2NCTOrders1","fields":{"company":"TEXT","stockCommitVersion":"TEXT","estimatedShipmentDate":"DATE","masterReceivedTime":"DATETIME","salesSubmissionTime":"DATETIME","title":"TEXT","description":"TEXT","image":"TEXT","imageAltText":"TEXT","customerId":"TEXT","customerCompanyName":"TEXT","customerPoNumber":"TEXT","transactionCurrency":"TEXT","buyerReceivedBy":"TEXT","submittedByStaffId":"TEXT","submittedByStaffName":"TEXT","submissionId":"TEXT","intakeStatus":"TEXT","sourceSiteId":"TEXT","salesInvoiceNumber":"TEXT","financialLockedBy":"TEXT","sourceLineId":"TEXT","orderId":"NUMBER","adminFxSource":"NUMBER","cbmCtn":"NUMBER","sellingPricePc":"NUMBER","orderQtyInCtn":"NUMBER"}},"TASKS":{"collection":"R2NCTTasks1","fields":{"company":"TEXT","stockCommitVersion":"TEXT","stockCounterSchema":"NUMBER","stockDispatchedCumulative":"NUMBER","stockCounterGeneration":"NUMBER","lastCostCaptureTime":"DATETIME","title":"TEXT","description":"TEXT","imageAltText":"TEXT","supplierId":"TEXT","ourPoNumber":"TEXT","costStatus":"TEXT","costErrorReason":"TEXT","purchaseStage":"TEXT","riskReason":"TEXT","specialPurchaseReason":"TEXT","rowPosition":"NUMBER","purchaseQtyInCtn":"NUMBER","receivedQtyInCtn":"NUMBER","lpPc":"NUMBER","lpCtn":"NUMBER","disc1":"NUMBER","disc2":"NUMBER","disc3":"NUMBER","originalCostSnapshot":"OBJECT","latestCostReference":"OBJECT","manualCostField":"ARRAY","risk":"BOOLEAN","specialPurchase":"BOOLEAN"}},"JOURNAL":{"collection":"R2NCTActivity1","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","mode":"TEXT","action":"TEXT","lenderSourceId":"TEXT","replacementSourceId":"TEXT","generation":"NUMBER","transferIndexVersion":"NUMBER","repaidQuantity":"NUMBER","pending":"OBJECT","participantTaskIds":"ARRAY_STRING","details":"OBJECT","activityTime":"DATETIME","title":"TEXT","description":"TEXT","image":"TEXT","imageAltText":"TEXT","actorType":"TEXT","initiatedByStaffId":"TEXT","initiatedByStaffName":"TEXT","result":"TEXT","message":"TEXT","cohort":"TEXT","bootstrapMemberId":"TEXT","bootstrapRequestId":"TEXT","writerBuild":"TEXT","activationRequestId":"TEXT","activationMemberId":"TEXT","activationEvidenceDigest":"TEXT"}},"PURCHASE_ORDERS":{"collection":"R2PurchaseOrders","fields":{"company":"TEXT","stockCommitVersion":"TEXT","title":"TEXT","details":"OBJECT"}},"PRODUCTS":{"collection":"R2StockProducts","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","barcode":"TEXT","name":"TEXT","packing":"TEXT","ea":"NUMBER","reviewCodes":"ARRAY_STRING","reviewRequired":"BOOLEAN","onHand":"NUMBER","isolated":"NUMBER","reservedUsable":"NUMBER","available":"NUMBER","lifecycleVersion":"NUMBER","nextBorrowSequence":"NUMBER"}},"POSITIONS":{"collection":"R2StockPositions","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","barcode":"TEXT","name":"TEXT","packing":"TEXT","ea":"NUMBER","sourceKind":"TEXT","sourceId":"TEXT","sourceTaskId":"TEXT","poId":"TEXT","poNumber":"TEXT","reviewCodes":"ARRAY_STRING","receiptAccepted":"NUMBER","replacementReceived":"NUMBER","supplierReturned":"NUMBER","dispatched":"NUMBER","borrowRepaidCumulative":"NUMBER","onHand":"NUMBER","isolated":"NUMBER","reservedUsable":"NUMBER","available":"NUMBER"}},"CLAIMS":{"collection":"R2StockClaims","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","positionId":"TEXT","taskId":"TEXT","customerId":"TEXT","orderId":"TEXT","sourceLineId":"TEXT","reviewCodes":"ARRAY_STRING","reservedUsable":"NUMBER","isolatedAttributed":"NUMBER","dispatchedCumulative":"NUMBER"}}}};
const stable=value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
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
async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator required');return{isAdmin:true,memberId:member._id};}
const service=createFreshCohortReadPreflight({collections,items,authenticateAdmin});
export const inspectNativeReadPrerequisites=webMethod(Permissions.Admin,async input=>{const result=await service.inspect(input);console.info('R2_NATIVE_READ_PREFLIGHT_RECEIPT '+JSON.stringify(result));return result;});
