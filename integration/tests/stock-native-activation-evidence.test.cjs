'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createNativeActivationEvidence, inspectRetainedEmployeeTerminals, sha256 } = require('../prototypes/stock-current-state/native-activation-evidence.cjs');
const { createFreshCohortActivation, REQUIRED } = require('../prototypes/stock-current-state/fresh-cohort-activation.cjs');
const { COHORT } = require('../prototypes/stock-current-state/isolated-cohort.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = value => structuredClone(value), build = 'a'.repeat(40);
async function retainedEmployees(contract) {
  const {createEmployeeTerminalAcceptance,terminalPrefixes} = require('../prototypes/stock-current-state/r2-employee-terminal-acceptance.cjs');
  const rows = new Map(), calls = [];
  const items = { query: collection => {
    assert.equal(collection,'StockProtocolTest'); let ids;
    const q = {hasSome:(key,value)=>{assert.equal(key,'_id');ids=value;return q;},limit:()=>q,
      find:async options=>{assert.equal(options.consistentRead,true);calls.push([...ids]);
        const found = ids.map(id=>rows.get(id)).filter(Boolean);return{items:copy(found),totalCount:found.length};}};
    return q;
  }, insert:async (_collection,row)=>{rows.set(row._id,copy(row));return row;} };
  for (const profile of ['PURCHASE','WAREHOUSE']) {
    const probe = async () => {
      for (const [index,name] of ['CONDITIONAL','BULK-A','BULK-B'].entries()) await items.insert('StockProtocolTest',
        {_id:terminalPrefixes[profile]+name,company:'NCT',stockCommitVersion:index?'AUTH-BULK':'AUTH-V1',
          details:{probe:'R2_AUTHORITY_V1',value:index||17,zero:0,absent:null,tags:['same','request']}});
      return {ok:true,stage:'NATIVE_METHODS_CONFIRMED',fixedCollection:'StockProtocolTest',fixedRecordCount:3,retainedRecords:3,
        mutationAttempted:true,deletions:0,permissionsChanged:false,elevatedQueryConfirmed:true,elevatedInsertConfirmed:true,
        elevatedBulkInsertConfirmed:true,elevatedPatchConfirmed:true,staleConditionRejected:true,ordinaryStaffAuthorizationAccepted:true,
        ordinaryReadDenied:true,finalValue:17,operations:{queries:4,inserts:1,bulkInserts:1,patchAttempts:2}};
    };
    const service = createEmployeeTerminalAcceptance({profile,...contract,items,elevate:fn=>fn,probe,
      authenticate:async()=>({memberId:'ACTUAL-TEST-MEMBER',staffId:profile+'-STAFF'}),enabled:true});
    assert.equal((await service.execute({step:'RUN'})).terminalReceiptVerified,true);
    assert.equal((await service.execute({step:'INSPECT'})).terminalReceiptVerified,true);
  }
  calls.length=0;
  return {rows,calls,prefixes:terminalPrefixes,readItems:{query:items.query}};
}
function fixture(company = 'NCT') {
  const f = { owner: 'ADMIN', calls: [], images: new Map(), changeAfterRead: false, reads: 0,
    bindings: { cohort: COHORT, company, build, checks: {}, writers: {} },
    empty: { cohort: COHORT, company, emptyBusiness: true, pending: false, unknownRecords: false },
    audit: { schema: 'R2_ACTIVATION_AUDIT_SCHEMA_V1', cohort: COHORT, activationAuditSchemaMatches: true,
      issues: [], mutationCapability: false, rows: ['R2NCTActivity','R2NCTActivity1'].map(collection =>
        ({ collection, metadataSha256: 'b'.repeat(64), requiredFieldsReviewed: 14 })) } };
  for (const [kind, subject] of [...REQUIRED.filter(name => !['nativeSchema','nativeQueries','nativeConditionalWrites'].includes(name)).map(name => ['CHECK',name]), ...WRITERS.map(name => ['WRITER',name])]) {
    const row = { _id: 'SPT-R2ACCEPT-' + company + ':' + subject, company, stockCommitVersion: 'V1',
      details: { schema: 'R2_NATIVE_ACCEPTANCE_TERMINAL_V1', cohort: COHORT, company, build, kind, subject,
        outcome: 'VERIFIED', source: 'SERVER_NATIVE_PROCEDURE', procedureSha256: 'c'.repeat(64), observationsSha256: 'd'.repeat(64),
        realInvoiceEnabled: false, physicalDispatchEnabled: false } };
    f.images.set(row._id, row);
    (kind === 'CHECK' ? f.bindings.checks : f.bindings.writers)[subject] = { id: row._id, sha256: sha256(row) };
  }
  f.options = { company, build, bindings: f.bindings,
    employeeContract:{authorityBuild:'f'.repeat(40),probeSourceSha256:'9'.repeat(64)},
    inspectEmployeeTerminals:async()=>['PURCHASE','WAREHOUSE'].map(profile=>({schema:'R2_EMPLOYEE_TERMINAL_ACCEPTANCE_V1',cohort:COHORT,
      profile,authorityBuild:'f'.repeat(40),probeSourceSha256:'9'.repeat(64),step:'INSPECT',ok:true,stage:'READ_ONLY_TERMINAL_INSPECTION',
      retainedRecords:4,terminalReceiptVerified:true,ordinaryStaffWriteAccepted:true,mutationAttempted:false,oldFixturesAccessed:false,
      businessAuthorizationAccepted:false,writerCoverageAccepted:false,activationAllowed:false})),
    authenticateAdmin: async () => ({ isAdmin: !!f.owner, memberId: f.owner }),
    readTerminalImages: async ids => {
      f.calls.push(['TERMINAL_READ',...ids]); f.reads++;
      const rows = ids.map(id => copy(f.images.get(id) || null));
      if (f.changeAfterRead && f.reads === 2) rows[0].stockCommitVersion = 'CHANGED';
      return rows;
    }, inspectReadPrerequisites: async ({company,scope}) => {
      f.calls.push(['NATIVE_READ',scope]);
      return { schema: 'R2_NATIVE_READ_PREFLIGHT_V1', cohort: COHORT, company, scope, schemaMatches: true, issues: [],
        metadataSha256: 'e'.repeat(64), queriesExecuted: 2, queries: ['EXACT_ID','EXACT_ID_BATCH'].map(name =>
          ({ name,totalCount: 0,returnedRows: 0 })), mutationCapability: false, ...f.badRead };
    }, inspectAuditSchema: async () => copy(f.audit), inspectFreshBusiness: async () => copy(f.empty) };
  f.scope = { cohort: COHORT, company, build };
  f.service = () => createNativeActivationEvidence(f.options);
  return f;
}
test('fresh native readings and exact retained proofs feed the existing one-CAS activation for both companies', async () => {
  for (const company of ['NCT','GHR']) {
    const f = fixture(company), service = f.service(); let mutations = 0;
    let control = { _id: hash(company,'STOCK_CONTROL'), company, cohort: COHORT, mode: 'MAINTENANCE', generation: 0,
      pending: null, schemaVersion: 1, transferIndexVersion: 2, _version: 'GENESIS', bootstrapMemberId: 'ORIGINAL', bootstrapRequestId: 'BOOTSTRAP' };
    const activation = createFreshCohortActivation({ company, build,
      authenticateAdmin: f.options.authenticateAdmin, inspectFreshBusiness: f.options.inspectFreshBusiness,
      verifyNativeAcceptance: service.verify,
      store: { read: async () => copy(control), compareAndSet: async (table,id,version,after) => {
        assert.equal(table, company === 'NCT' ? 'R2NCTActivity' : 'R2NCTActivity1');
        assert.equal(version,control._version); control = copy(after); mutations++;
      } } });
    const result = await activation.activate({ requestId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(result.mode,'ACTIVE'); assert.equal(mutations,1);
    assert.equal(f.calls.filter(row => row[0] === 'NATIVE_READ').length,7);
    assert.match(control.activationEvidenceDigest,/^[a-f0-9]{64}$/);
  }
});
test('empty bindings expose every missing proof without promoting the earlier SDK/borrowing fixtures', async () => {
  const f = fixture(); f.bindings.checks = {}; f.bindings.writers = {};
  const service = f.service(), result = await service.inspect(f.scope);
  assert.equal(result.activationAllowed,false); assert.equal(result.gaps.length,24);
  assert.equal(result.checks.nativeConditionalWrites,true);
  assert.equal(Object.values(result.writers).some(row => row.verified),false);
  assert.equal(f.calls.some(row => row[0] === 'TERMINAL_READ'),false);
  await assert.rejects(service.verify(f.scope),/Native acceptance incomplete/);
});
test('a native receipt for another company, build, subject, procedure type or dispatch policy never authorizes', async () => {
  for (const patch of [{company:'GHR'},{build:'f'.repeat(40)},{subject:'RECEIPT'},{source:'LOCAL_TEST'},
    {outcome:'PENDING'},{procedureSha256:null},{observationsSha256:'unknown'},{physicalDispatchEnabled:true},{realInvoiceEnabled:true}]) {
    const f = fixture(), id = f.bindings.writers.BORROWING.id, row = f.images.get(id);
    Object.assign(row.details,patch);
    // Even a newly pinned hash cannot disguise a receipt with the wrong semantics.
    f.bindings.writers.BORROWING.sha256 = sha256(row);
    const result = await f.service().inspect(f.scope);
    assert.equal(result.writers.BORROWING.verified,false,JSON.stringify(patch));
    assert.equal(result.activationAllowed,false);
  }
});
test('missing, changed, duplicate, foreign or reordered storage observations fail closed', async () => {
  const missing = fixture(); missing.images.delete(missing.bindings.writers.BORROWING.id);
  assert.equal((await missing.service().inspect(missing.scope)).writers.BORROWING.verified,false);
  const changed = fixture(); changed.images.get(changed.bindings.writers.BORROWING.id).details.outcome = 'CHANGED';
  assert.equal((await changed.service().inspect(changed.scope)).writers.BORROWING.verified,false);
  for (const mutate of [rows => rows.reverse(), rows => rows.slice(1), rows => rows.map(() => rows[0]), rows => rows.map(row => ({...row,_id:'FOREIGN'}))]) {
    const f = fixture(), read = f.options.readTerminalImages;
    f.options.readTerminalImages = async ids => mutate(await read(ids));
    await assert.rejects(f.service().inspect(f.scope),/Ordered exact/);
  }
  const racing = fixture(); racing.changeAfterRead = true;
  await assert.rejects(racing.service().inspect(racing.scope),/changed during verification/);
});
test('browser coverage, coercible scope, changed administrator and invalid contract do no work', async () => {
  for (const change of [scope => ({...scope,verified:true}), scope => ({...scope,company:'GHR'}),
    scope => ({...scope,build:[]}), () => null]) {
    const f = fixture(); await assert.rejects(f.service().inspect(change(f.scope)),/server-owned evidence scope/);
    assert.equal(f.calls.length,0);
  }
  const anonymous = fixture(); anonymous.owner = null;
  await assert.rejects(anonymous.service().inspect(anonymous.scope),/actual administrator/);
  assert.equal(anonymous.calls.length,0);
  const changed = fixture(); let count = 0;
  changed.options.authenticateAdmin = async () => ({isAdmin:true,memberId:++count === 1 ? 'A' : 'B'});
  await assert.rejects(changed.service().inspect(changed.scope),/actual administrator/);
  for (const patch of [f => f.bindings.writers.UNKNOWN = {}, f => f.bindings.checks.nativeSchema = {},
    f => f.bindings.writers.BORROWING.id = 'SPT-R2BORROW-20261025-6c93:TERMINAL',
    f => f.bindings.writers.BORROWING = f.bindings.writers.RECEIPT]) {
    const f = fixture(); patch(f); assert.throws(() => f.service()); assert.equal(f.calls.length,0);
  }
});
test('fresh schema, query and empty-business observations remain mandatory even with every pinned terminal', async () => {
  for (const badRead of [{cohort:'OLD'},{schemaMatches:false},{queriesExecuted:3},{queries:[]},{mutationCapability:true},
    {queries:[{name:'A',totalCount:1,returnedRows:0},{name:'B',totalCount:0,returnedRows:0}]}]) {
    const f = fixture(); f.badRead = badRead;
    await assert.rejects(f.service().verify(f.scope),/read prerequisites/);
  }
  for (const patch of [{activationAuditSchemaMatches:false},{rows:[]},{mutationCapability:true}]) {
    const f = fixture(); Object.assign(f.audit,patch);
    await assert.rejects(f.service().verify(f.scope),/NATIVE_AUDIT_SCHEMA/);
  }
  for (const patch of [{emptyBusiness:false},{pending:true},{unknownRecords:true},{company:'GHR'}]) {
    const f = fixture(); Object.assign(f.empty,patch);
    await assert.rejects(f.service().verify(f.scope),/FRESH_BUSINESS_NOT_EMPTY/);
  }
});
test('captured bindings cannot be changed later to accept another terminal image', async () => {
  const f = fixture(), service = f.service(), row = f.images.get(f.bindings.writers.BORROWING.id);
  row.stockCommitVersion = 'REPLACED'; f.bindings.writers.BORROWING.sha256 = sha256(row);
  assert.equal((await service.inspect(f.scope)).writers.BORROWING.verified,false);
});

test('compiled native endpoint is Admin-only, composes actual native readers and refuses browser success flags', async () => {
  const vm = require('node:vm'), {createHash} = require('node:crypto');
  const {source,businessBuild,bindings,employeeContract} = require('../prototypes/stock-current-state/build-native-activation-evidence.cjs');
  const grants = [], f = fixture(), calls = [];
  const retained = await retainedEmployees(employeeContract);
  const inspect = vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'') + ';inspectNativeActivation;', {
    createHash, Permissions:{Admin:'ADMIN'}, webMethod:(permission,fn)=>{grants.push(permission);return fn;},
    currentMember:{getMember:async()=>({_id:'ADMIN',status:'APPROVED'})},
    items:retained.readItems,
    inspectNativeReadPrerequisites:async input=>{calls.push(['READ',input.scope]);return f.options.inspectReadPrerequisites(input);},
    inspectActivationAuditSchema: f.options.inspectAuditSchema,
    inspectFreshCohort:async input=>{assert.deepEqual(Object.keys(input),[]);return{cohort:COHORT,system:'MASTER',emptyBusiness:true,rows:Array.from({length:12},()=>({}))};},
    console:{info:()=>{}}
  });
  assert.deepEqual(grants,['ADMIN','ADMIN']);
  for (const input of [{company:'NCT',verified:true},{company:'NCT',build:businessBuild},{company:'OLD'},null]) {
    await assert.rejects(inspect(input),/fixed company/);
  }
  assert.equal(calls.length,0);
  const result = await inspect({company:'NCT'});
  assert.equal(result.build,businessBuild);assert.equal(result.activationAllowed,false);
  assert.equal(result.gaps.length,24);assert.equal(calls.length,7);
  assert.equal(result.checks.nativeConditionalWrites,true);
  assert.equal(retained.calls.length,1);
  assert.equal(retained.calls[0].length,8);
  assert.equal(Object.keys(bindings.NCT.writers).length,0);
  assert.doesNotMatch(source,/Permissions\.(Anyone|SiteMember)|items\.(insert|bulkInsert|patch|remove)|\.activate\(|enabled\s*=\s*true/);
});

test('bounded native employee reader accepts no flags and makes exactly one eight-ID query',async()=>{
  const vm=require('node:vm'),{createHash}=require('node:crypto');
  const {source,employeeContract}=require('../prototypes/stock-current-state/build-native-activation-evidence.cjs');
  const retained=await retainedEmployees(employeeContract),logs=[];
  const read=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';inspectRetainedEmployeeEvidence;',{
    createHash,Permissions:{Admin:'ADMIN'},webMethod:(_permission,fn)=>fn,
    currentMember:{getMember:async()=>({_id:'ADMIN',status:'APPROVED'})},items:retained.readItems,
    console:{info:value=>logs.push(value)}
  });
  for(const input of [null,{enabled:true},{step:'RUN'},{company:'NCT'},{ids:[]}])await assert.rejects(read(input),/Empty fixed/);
  assert.equal(retained.calls.length,0);
  const result=await read({});assert.equal(result.nativeMethodsVerified,true);assert.equal(result.activationAllowed,false);
  assert.equal(result.writerCoverageAccepted,false);assert.equal(retained.calls.length,1);
  assert.equal(logs.length,1);assert.equal(logs[0].includes('ACTUAL-TEST-MEMBER'),false);
});

test('administrator inspector verifies the exact existing employee terminal after-images with one read and no write capability',async()=>{
  const contract={authorityBuild:'f'.repeat(40),probeSourceSha256:'9'.repeat(64)},f=await retainedEmployees(contract);
  const inspect=()=>inspectRetainedEmployeeTerminals({items:f.readItems,contract,prefixes:f.prefixes});
  const before=copy([...f.rows]);const result=await inspect();
  assert.equal(result.every(row=>row.terminalReceiptVerified&&row.mutationAttempted===false),true);
  assert.equal(result.every(row=>row.inspectionAuthority==='ADMIN_FIXED_RETAINED_IMAGES'),true);
  assert.equal(JSON.stringify(result).includes('ACTUAL-TEST-MEMBER'),false);
  assert.deepEqual(copy([...f.rows]),before);assert.equal(f.calls.length,1);
  for(const mutate of [row=>row.details.value=999,row=>row.stockCommitVersion='STALE',row=>row.company='GHR']){
    const old=copy(f.rows.get(f.prefixes.PURCHASE+'CONDITIONAL'));
    mutate(f.rows.get(old._id));
    if(f.rows.get(old._id).company==='GHR')await assert.rejects(inspect(),/fixed employee terminal images/);
    else assert.equal((await inspect())[0].terminalReceiptVerified,false);
    f.rows.set(old._id,old);
  }
  const terminal=f.rows.get(f.prefixes.PURCHASE+'TERMINAL');terminal.details.evidence.staleConditionRejected=false;
  // Recomputing the outer hash must not conceal a missing native assertion.
  terminal.stockCommitVersion=sha256(terminal.details).slice(0,32);
  assert.equal((await inspect())[0].terminalReceiptVerified,false);
});

test('employee SDK subproof is reusable only through exact read-only terminal inspection and cannot imply writer acceptance',async()=>{
  for(const patch of [{authorityBuild:'0'.repeat(40)},{probeSourceSha256:'0'.repeat(64)},{step:'RUN'},{retainedRecords:3},
    {mutationAttempted:true},{terminalReceiptVerified:false},{ordinaryStaffWriteAccepted:false},{businessAuthorizationAccepted:true},
    {writerCoverageAccepted:true},{activationAllowed:true},{oldFixturesAccessed:true},{profile:'ADMIN'}]){
    const f=fixture(),read=f.options.inspectEmployeeTerminals;
    f.options.inspectEmployeeTerminals=async()=>{const rows=await read();Object.assign(rows[0],patch);return rows;};
    const result=await f.service().inspect(f.scope);
    assert.equal(result.checks.nativeConditionalWrites,false,JSON.stringify(patch));
    assert.equal(result.activationAllowed,false);
  }
});
