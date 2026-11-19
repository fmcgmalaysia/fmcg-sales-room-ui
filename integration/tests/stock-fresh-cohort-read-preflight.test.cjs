'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { contracts, createFreshCohortReadPreflight } = require('../prototypes/stock-current-state/fresh-cohort-read-preflight.cjs');
const { createCurrentQuery } = require('../prototypes/stock-current-state/current-query.cjs');
const { prepareOrderIntake } = require('../prototypes/stock-current-state/order-intake-plan.cjs');
const { createNctIntake, createNctReceiptReader } = require('./load-master-module.cjs')('nctIntake.js');
const copy = value => structuredClone(value);
function fixture() {
  const f = { actor: 'ADMIN', calls: [], queries: [], authCalls: 0, metadata: new Map() };
  for (const definition of Object.values(contracts).flatMap(company => Object.values(company))) f.metadata.set(definition.collection, {
    _id: definition.collection, revision: '1', fields: Object.entries(definition.fields).map(([key, type]) => ({ key, type })),
    permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' }
  });
  f.items = { query(collection) {
    const trace = { collection, predicates: [], sort: [], offset: 0, size: null };
    const q = { eq: (key, value) => { trace.predicates.push(['eq', key, value]); return q; },
      hasSome: (key, value) => { trace.predicates.push(['hasSome', key, value]); return q; },
      gt: (key, value) => { trace.predicates.push(['gt', key, value]); return q; },
      contains: (key, value) => { trace.predicates.push(['contains', key, value]); return q; },
      or: other => { trace.predicates.push(['or', other.trace]); return q; },
      and: other => { trace.predicates.push(['and', other.trace]); return q; },
      ascending: (...keys) => { trace.sort = keys; return q; },
      skip: n => { trace.offset = n; return q; }, limit: n => { trace.size = n; return q; },
      find: async options => { f.queries.push({ ...copy(trace), options }); if (f.queryError) throw Error('NATIVE_QUERY_DENIED');
        return f.page || { items: [], totalCount: 0 }; }, trace };
    return q;
  } };
  f.collections = { getDataCollection: async target => { f.calls.push(target); const result = copy(f.metadata.get(target));
    if (f.change) f.change(result, f.calls.length); return result; } };
  const noMutation = () => { throw Error('NO_MUTATION_ALLOWED'); };
  for (const name of ['insert', 'patch', 'remove', 'bulkInsert']) f.items[name] = noMutation;
  f.authenticateAdmin = async () => { f.authCalls++; return { isAdmin: !!f.actor, memberId: f.actor }; };
  f.api = createFreshCohortReadPreflight(f); return f;
}
test('both companies fixed scopes read only metadata and query summaries, never grant activation', async () => {
  for (const company of ['NCT', 'GHR']) for (const scope of Object.keys(contracts[company])) {
    const f = fixture(), result = await f.api.inspect({ company, scope });
    assert.equal(result.schemaMatches, true); assert.deepEqual(result.issues, []);
    assert.deepEqual(f.calls, [result.collection, result.collection]); assert.ok(result.queriesExecuted >= 2);
    assert.ok(f.queries.every(q => q.collection === result.collection && q.size === 1 && q.options.consistentRead && q.options.returnTotalCount));
    assert.match(result.metadataSha256, /^[a-f0-9]{64}$/);
    for (const flag of ['mutationCapability','indexesRead','populatedQuerySemanticsAccepted','typedRoundtripsAccepted','writerCoverageAccepted','activationAllowed']) assert.equal(result[flag], false);
  }
});
test('actual original intake after-images fit expanded typed contract, including dates and zero/null', async () => {
  for (const company of ['NCT', 'GHR']) {
    const suffix = company === 'NCT' ? '' : '1', orders = 'NCTOrders' + suffix, tasks = 'NCTTasks' + suffix, journal = 'NCTActivity' + suffix;
    const body = { sourceSiteId:'5292b63a-30e5-4c0e-8762-a1b127bbc651', destination:company, orderId:'PRECHECK', customerId:'C',
      customerCompanyName:'Fake', submissionId:'S', submittedByStaffId:'STAFF', submittedByStaffName:'Sales',
      submittedAt:'2026-10-25T00:00:00Z', estimatedShipmentDate:'2026-11-12', transactionCurrency:'MYR', fxRate:1,
      lines:[{sourceLineId:'L',unitBarcode:'001',itemName:'Fake',packingSize:'24x1',eaPerCtn:24,qtyCtn:90,sellingPricePc:0}] };
    const result = await prepareOrderIntake({ company, body, createNctIntake, createNctReceiptReader,
      tables: { [orders]:[], [tasks]:[], [journal]:[], [company === 'NCT' ? 'NCTActivity1' : 'NCTActivity']:[] },
      now:()=>new Date(body.submittedAt), captureCosts:async()=>({ '001':{unitBarcode:'001',capturedAt:body.submittedAt,costCurrency:'MYR',costStatus:'CAPTURED',costIssues:[],lpPc:0,lpCtn:0,disc1:0,disc2:0,disc3:0,netCostCtn:0,cbmPerCtn:0} }) });
    for (const write of result.plan.writes) {
      const definition = Object.values(contracts[company]).find(row => row.collection === 'R2' + write.collection);
      for (const [key, value] of Object.entries(write.after)) {
        if (key === '_id') continue;
        assert.ok(definition.fields[key], 'unclassified real intake field ' + write.collection + '.' + key);
        if (value === null) continue;
        const type = definition.fields[key];
        if (type === 'DATETIME' || type === 'DATE') assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)));
        else if (type === 'ARRAY_STRING' || type === 'ARRAY') assert.ok(Array.isArray(value) && value.every(v => typeof v === 'string'));
        else assert.equal(typeof value, { TEXT:'string', NUMBER:'number', BOOLEAN:'boolean', OBJECT:'object' }[type], key);
      }
    }
  }
});
test('product search and page execute same predicates and stable sorting as actual runtime reader', async () => {
  const f = fixture(); await f.api.inspect({ company:'NCT', scope:'PRODUCTS' });
  const native = f.queries.filter(q => q.sort[0] === 'barcode'); f.queries.length = 0;
  const repository = createCurrentQuery({ items:{query:collection=>f.items.query('R2'+collection)}, company:'NCT' });
  const base = { company:'NCT',page:0,pageSize:1,status:'ACTIVE',consistentRead:true,order:['barcode','_id'] };
  await repository.queryProducts({ ...base,search:'' });
  await repository.queryProducts({ ...base,search:'R2_PREFLIGHT_READ_ONLY_NO_BUSINESS_ID' });
  assert.deepEqual(native, f.queries);
});
test('missing or conflicting schema returns exact field issue and performs no item query', async () => {
  for (const mode of ['missing','conflict']) {
    const f = fixture(), row = f.metadata.get('R2NCTOrders');
    if (mode === 'missing') row.fields = row.fields.filter(field => field.key !== 'sellingPricePc');
    else row.fields.find(field => field.key === 'sellingPricePc').type = 'TEXT';
    const result = await f.api.inspect({ company:'NCT',scope:'ORDERS' });
    assert.equal(result.schemaMatches,false); assert.equal(result.issues[0].field,'sellingPricePc'); assert.equal(f.queries.length,0);
  }
});
test('denied query or incomplete total response propagates once, without retry', async () => {
  for (const config of [{queryError:true},{page:{items:[]}},{page:{items:[],totalCount:1}},{page:{items:[],totalCount:NaN}}]) {
    const f = Object.assign(fixture(),config); await assert.rejects(f.api.inspect({company:'NCT',scope:'TASKS'}));
    assert.equal(f.queries.length,1); assert.equal(f.calls.length,1);
  }
});
test('schema change or access change during query cannot become positive acceptance', async () => {
  for (const change of [row=>row.revision='2',row=>row.permissions.read='ANYONE',row=>row.fields.push(row.fields[0])]) {
    const f = fixture(); f.change=(row,n)=>{if(n===2)change(row);};
    await assert.rejects(f.api.inspect({company:'GHR',scope:'JOURNAL'}),/schema changed|private native/);
  }
  const f = fixture(); let auth=0; f.api=createFreshCohortReadPreflight({...f,authenticateAdmin:async()=>({isAdmin:true,memberId:++auth>2?'OTHER':'ADMIN'})});
  await assert.rejects(f.api.inspect({company:'NCT',scope:'PRODUCTS'}),/Same actual/); assert.equal(f.queries.length,1);
});
test('unknown scope, company, collection or browser acceptance flags fail before any data read', async () => {
  for (const input of [null,[],{}, {company:'NCT',scope:'__proto__'},{company:'OTHER',scope:'TASKS'},
    {company:'NCT',scope:'TASKS',collection:'NCTTasks'},{company:'NCT',scope:'TASKS',verified:true}]) {
    const f=fixture(); await assert.rejects(f.api.inspect(input),/Fixed R2/); assert.equal(f.calls.length,0); assert.equal(f.authCalls,0);
  }
});
test('query results never disclose business rows or claim populated semantic acceptance',async()=>{
  const f=fixture();f.page={items:[{_id:'SENSITIVE',customerId:'PRIVATE'}],totalCount:1};
  const result=await f.api.inspect({company:'NCT',scope:'TASKS'});
  assert.ok(!JSON.stringify(result).includes('SENSITIVE'));assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(result.populatedQuerySemanticsAccepted,false);
});
test('compiled native web boundary is Admin-only and uses real approved member identity',async()=>{
  const {source}=require('../prototypes/stock-current-state/build-r2-read-preflight.cjs'), f=fixture();let permission;
  const code=source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');
  const make=new Function('collections','items','webMethod','Permissions','currentMember','createHash','console',code+';return inspectNativeReadPrerequisites;');
  const api=make(f.collections,f.items,(p,fn)=>{permission=p;return fn;},{Admin:'ADMIN_ONLY'},
    {getMember:async()=>({_id:'REAL_ADMIN',status:'APPROVED'})},crypto.createHash,{info:()=>{}});
  assert.equal(permission,'ADMIN_ONLY');assert.equal((await api({company:'GHR',scope:'CLAIMS'})).queriesExecuted,4);
  const denied=make(f.collections,f.items,(_p,fn)=>fn,{Admin:'ADMIN_ONLY'},
    {getMember:async()=>({_id:'REAL_ADMIN',status:'BLOCKED'})},crypto.createHash,{info:()=>{}});
  const reads=f.calls.length;await assert.rejects(denied({company:'NCT',scope:'TASKS'}),/approved administrator/);assert.equal(f.calls.length,reads);
});
