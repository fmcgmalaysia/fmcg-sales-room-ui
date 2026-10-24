import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { items, collections } from '@wix/data';
import { createHash } from 'crypto';
const COHORT="MASTER_20261024_R2";
const COLLECTIONS={"MASTER":{"NCTOrders":"R2NCTOrders","NCTTasks":"R2NCTTasks","NCTActivity":"R2NCTActivity","NCTOrders1":"R2NCTOrders1","NCTTasks1":"R2NCTTasks1","NCTActivity1":"R2NCTActivity1","PurchaseOrders":"R2PurchaseOrders","StockPositions":"R2StockPositions","StockClaims":"R2StockClaims","StockProducts":"R2StockProducts","DepartmentChatIndex":"R2DepartmentChatIndex","AccountReadIndex":"R2AccountReadIndex"}};
const fields={"cohort":"TEXT","company":"TEXT","mode":"TEXT","schemaVersion":"NUMBER","transferIndexVersion":"NUMBER","generation":"NUMBER","pending":"OBJECT","stockCommitVersion":"TEXT"};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function createFreshCohortBootstrap({ system, items, collections, authenticateAdmin }) {
  if (!Object.hasOwn(COLLECTIONS, system) || typeof items?.query !== 'function' || typeof items?.insert !== 'function'
    || typeof collections?.getDataCollection !== 'function' || typeof authenticateAdmin !== 'function') throw Error('Native empty-cohort dependencies required');
  const mapping = COLLECTIONS[system], journals = ['R2NCTActivity', 'R2NCTActivity1'];
  async function authorize(owner) {
    const admin = await authenticateAdmin();
    if (admin?.isAdmin !== true || typeof admin.memberId !== 'string' || !admin.memberId || owner && owner !== admin.memberId) throw Error('Actual same approved administrator required');
    return admin.memberId;
  }
  const id = company => digest([company, 'STOCK_CONTROL']);
  function validControl(row) {
    return row && ['NCT', 'GHR'].includes(row.company) && row._id === id(row.company) && row.cohort === COHORT
      && row.mode === 'MAINTENANCE' && row.schemaVersion === 1 && row.transferIndexVersion === 2 && row.generation === 0
      && row.pending === null && /^[a-f0-9]{32}$/.test(row.stockCommitVersion || '')
      && typeof row.bootstrapMemberId === 'string' && /^[a-f0-9-]{36}$/i.test(row.bootstrapRequestId || '');
  }
  async function inspectNative() {
    const result = [];
    for (const [original, target] of Object.entries(mapping)) {
      const metadata = await collections.getDataCollection(target, { consistentRead: true });
      if (metadata?._id !== target || !['string', 'number'].includes(typeof metadata.revision) || !String(metadata.revision)
        || !Array.isArray(metadata.fields) || metadata.fields.length > 500
        || new Set(metadata.fields.map(field => field.key)).size !== metadata.fields.length
        || ['read', 'insert', 'update', 'remove'].some(op => metadata.permissions?.[op] !== 'ADMIN')) throw Error('Complete Admin-only new cohort metadata required: ' + target);
      if (journals.includes(target)) {
        for (const [key, type] of Object.entries({ ...fields, bootstrapMemberId: 'TEXT', bootstrapRequestId: 'TEXT' })) {
          if (metadata.fields.find(field => field.key === key)?.type !== type) throw Error('New cohort control field missing or mistyped: ' + target + '.' + key);
        }
      }
      const page = await items.query(target).limit(3).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
        || page.items.length !== Math.min(3, page.totalCount)) throw Error('Complete new-cohort emptiness observation required');
      if (page.totalCount > (journals.includes(target) ? 1 : 0)
        || page.items.some(row => !validControl(row) || row.company !== (target === 'R2NCTActivity' ? 'NCT' : 'GHR'))) {
        throw Error('New cohort already contains business or unknown records; never clear or migrate');
      }
      result.push({ original, target, total: page.totalCount, control: page.items[0] || null,
        metadataDigest: digest([metadata._id, metadata.revision, metadata.fields, metadata.permissions]) });
    }
    return result;
  }
  function request(input, initializing = false) {
    const names = initializing ? 'company,requestId' : '';
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== names
      || initializing && (system !== 'MASTER' || !['NCT', 'GHR'].includes(input.company) || !/^[a-f0-9-]{36}$/i.test(input.requestId || ''))) throw Error('Exact server-owned empty-cohort request required');
  }
  async function inspect(input) {
    request(input); const owner = await authorize(), rows = await inspectNative(); await authorize(owner);
    return { cohort: COHORT, system, emptyBusiness: true, rows, activationAllowed: false };
  }
  async function initialize(input) {
    request(input, true); const owner = await authorize(), before = await inspectNative();
    const journal = input.company === 'NCT' ? journals[0] : journals[1];
    const expected = { _id: id(input.company), company: input.company, cohort: COHORT, mode: 'MAINTENANCE', schemaVersion: 1,
      transferIndexVersion: 2, generation: 0, pending: null, bootstrapMemberId: owner, bootstrapRequestId: input.requestId,
      stockCommitVersion: digest([COHORT, input.company, input.requestId, owner, 'EMPTY_GENESIS']) };
    const business = row => row && Object.fromEntries(Object.keys(expected).map(key => [key, row[key]]));
    const existing = before.find(row => row.target === journal).control;
    if (existing && !same(business(existing), expected)) throw Error('Existing cohort control differs; never replace');
    await authorize(owner); const fresh = await inspectNative();
    if (!same(before, fresh)) throw Error('New-cohort metadata/content changed during initialization');
    // A timeout propagates; no automatic read-and-reinsert or duplicate request.
    if (!existing) await items.insert(journal, expected);
    const after = await inspectNative();
    if (!same(business(after.find(row => row.target === journal).control), expected)) throw Error('New maintenance control unconfirmed; retain original request');
    await authorize(owner);
    return { cohort: COHORT, company: input.company, requestId: input.requestId, initialized: true, created: !existing,
      mode: 'MAINTENANCE', activationAllowed: false };
  }
  return { inspect, initialize };
}
async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator identity required');return{isAdmin:true,memberId:member._id};}
const service=createFreshCohortBootstrap({system:"MASTER",items,collections,authenticateAdmin});
export const inspectFreshCohort=webMethod(Permissions.Admin,input=>service.inspect(input));
export const initializeFreshCohort=webMethod(Permissions.Admin,input=>service.initialize(input));
function createFreshCohortDefinitionInspector({ system, collections, authenticateAdmin }) {
  if (!Object.hasOwn(COLLECTIONS, system) || typeof collections?.getDataCollection !== 'function'
    || typeof authenticateAdmin !== 'function') throw Error('Native definition-read dependencies required');
  async function admin(owner) {
    const actor = await authenticateAdmin();
    if (actor?.isAdmin !== true || typeof actor.memberId !== 'string' || !actor.memberId || owner && actor.memberId !== owner) throw Error('Actual same administrator required');
    return actor.memberId;
  }
  async function inspect(input) {
    if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'collection'
      || !Object.values(COLLECTIONS[system]).includes(input.collection)) throw Error('Exact new-cohort collection definition required');
    const owner = await admin(), target = input.collection;
    const before = await collections.getDataCollection(target, { consistentRead: true });
    if (before?._id !== target || !['string', 'number'].includes(typeof before.revision) || !String(before.revision)
      || !Array.isArray(before.fields) || before.fields.length > 500 || new Set(before.fields.map(field => field.key)).size !== before.fields.length
      || ['read', 'insert', 'update', 'remove'].some(op => before.permissions?.[op] !== 'ADMIN')) throw Error('Complete private collection metadata required');
    // Index API path stopped after native WDE0144 both normally and with the
    // user's narrowly approved elevation. Do not repeat it or infer ACTIVE.
    const after = await collections.getDataCollection(target, { consistentRead: true });
    if (!same(before, after)) throw Error('Collection definition changed during readback');
    await admin(owner);
    return { cohort: COHORT, system, collection: target, metadata: before, indexes: null,
      fieldsComplete: true, indexesComplete: false, permissionsComplete: true,
      indexReadStatus: 'NOT_READ_API_PATH_STOPPED_WDE0144',
      activationAllowed: false, businessRowsRead: false, mutationCapability: false };
  }
  return { inspect };
}
const definitions=createFreshCohortDefinitionInspector({system:"MASTER",collections,authenticateAdmin});
export const inspectFreshCollectionDefinition=webMethod(Permissions.Admin,input=>definitions.inspect(input));
