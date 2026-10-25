import { collections } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { createHash } from 'crypto';
const COHORT="MASTER_20261024_R2";
const targets=Object.freeze(["R2NCTActivity","R2NCTActivity1"]);
const activationAuditFields=Object.freeze({"cohort":"TEXT","company":"TEXT","mode":"TEXT","schemaVersion":"NUMBER","transferIndexVersion":"NUMBER","generation":"NUMBER","pending":"OBJECT","stockCommitVersion":"TEXT","bootstrapMemberId":"TEXT","bootstrapRequestId":"TEXT","writerBuild":"TEXT","activationRequestId":"TEXT","activationMemberId":"TEXT","activationEvidenceDigest":"TEXT"});
const stable=value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
function createFreshCohortActivationSchemaVerifier({ collections, authenticateAdmin }) {
  if (typeof collections?.getDataCollection !== 'function' || typeof authenticateAdmin !== 'function') {
    throw Error('Read-only native activation schema dependencies required');
  }
  async function authorize(owner) {
    const actor = await authenticateAdmin();
    if (actor?.isAdmin !== true || typeof actor.memberId !== 'string' || !actor.memberId
      || owner && actor.memberId !== owner) throw Error('Same actual administrator required');
    return actor.memberId;
  }
  function validate(row, target) {
    if (row?._id !== target || !['string', 'number'].includes(typeof row.revision)
      || typeof row.revision === 'number' && !Number.isFinite(row.revision)
      || !String(row.revision).trim() || !Array.isArray(row.fields) || row.fields.length > 500
      || row.fields.some(field => typeof field?.key !== 'string' || !field.key
        || typeof field.type !== 'string' || !field.type)
      || new Set(row.fields.map(field => field.key)).size !== row.fields.length
      || ['read', 'insert', 'update', 'remove'].some(op => row.permissions?.[op] !== 'ADMIN')) {
      throw Error('Complete Admin-only R2 activation metadata required: ' + target);
    }
  }
  async function inspect(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
      throw Error('Empty server-owned activation schema request required');
    }
    const owner = await authorize(), rows = [], issues = [];
    for (const target of targets) {
      const before = await collections.getDataCollection(target, { consistentRead: true });
      validate(before, target);
      // Copy the observation now: an SDK adapter must not hide a changed second
      // response by mutating a previously returned object in place.
      const image = stable(before);
      await authorize(owner);
      const after = await collections.getDataCollection(target, { consistentRead: true });
      validate(after, target);
      if (image !== stable(after)) throw Error('Activation schema changed during readback: ' + target);
      for (const [key, type] of Object.entries(activationAuditFields)) {
        const field = after.fields.find(field => field.key === key);
        if (!field || field.type !== type) issues.push({ collection: target, field: key,
          expectedType: type, code: field ? 'FIELD_TYPE_CONFLICT_NO_OVERWRITE' : 'AUDIT_FIELD_MISSING' });
      }
      rows.push({ collection: target, metadataSha256: createHash('sha256').update(image).digest('hex'),
        requiredFieldsReviewed: Object.keys(activationAuditFields).length });
    }
    await authorize(owner);
    return { schema: 'R2_ACTIVATION_AUDIT_SCHEMA_V1', cohort: COHORT,
      activationAuditSchemaMatches: issues.length === 0, rows, issues,
      indexesRead: false, businessRowsRead: false, mutationCapability: false,
      fullBusinessSchemaAccepted: false, writerCoverageAccepted: false, activationAllowed: false };
  }
  return { inspect };
}
async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator required');return{isAdmin:true,memberId:member._id};}
const service=createFreshCohortActivationSchemaVerifier({collections,authenticateAdmin});
export const inspectActivationAuditSchema=webMethod(Permissions.Admin,async input=>{const result=await service.inspect(input);console.info('R2ACTIVATION_SCHEMA_RECEIPT '+JSON.stringify(result));return result;});
