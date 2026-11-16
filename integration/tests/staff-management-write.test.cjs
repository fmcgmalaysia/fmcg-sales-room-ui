const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');

function fixture(options = {}) {
  const rows = new Map(), calls = [];
  const wixData = {
    async insert(collection, row) {
      if (rows.has(row._id)) throw Error('duplicate');
      rows.set(row._id, {...row}); calls.push(['insert', row._id]); return {...row};
    },
    async update(collection, row) {
      calls.push(['update', row._id]);
      if (!options.failBefore) rows.set(row._id, {...row});
      if (options.failBefore || options.failAfter) throw Error('connection interrupted');
      return {...row};
    },
    async get(collection, id) { return rows.get(id); },
    async remove(collection, id) { calls.push(['remove',id]); rows.delete(id); },
    query() { return {eq(field,value) { return {limit() { return {async find() {
      return {items:[...rows.values()].filter(row=>row[field]===value)};
    }}; }}; }}; }
  };
  const source = fs.readFileSync(path.join(__dirname,'../backend/staffManagementWrite.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const {write,readStatus} = vm.runInNewContext(source+'\n({write:writeStaffManagement,readStatus:readStaffSaveStatus})',{wixData});
  return {rows,calls,write,readStatus,wixData};
}

function request(overrides={}) {
  return {requestId:randomUUID(),fingerprint:'payload-hash',actorId:'admin',
    prepare:async()=>({row:{_id:'employee',title:'staff-id',staffStatus:'DISABLED'}}),
    project:row=>row,...overrides};
}

test('an unchanged edit returns the projected employee without writing a lock or receipt', async () => {
  const f = fixture();
  const unchanged = {staffId:'staff-id', name:'Example'};
  assert.equal(await f.write(request({unchanged, prepare: () => assert.fail('unexpected edit')})), unchanged);
  assert.deepEqual(f.calls, []);
});

test('a reused request cannot hide a conflicting receipt behind an unchanged edit', async () => {
  const f = fixture();
  const input = request();
  await f.write(input);
  await assert.rejects(f.write({...input, unchanged: {staffId:'staff-id'}, fingerprint:'different'}), /does not match/);
  assert.equal(f.calls.filter(([action]) => action === 'update').length, 1);
});

test('a second management save cannot overwrite an in-flight change',async()=>{
  const f=fixture(); let resume;
  const gate=new Promise(resolve=>{resume=resolve;});
  const first=request({prepare:async()=>{await gate;return {row:{_id:'employee',staffStatus:'DISABLED'}};}});
  const pending=f.write(first);
  await assert.rejects(f.write(request()),/Another employee change/);
  resume();await pending;
  assert.equal(f.rows.get('employee').staffStatus,'DISABLED');
  assert.equal(f.rows.has('staff-management-write-lock'),false);
});

test('a committed write with a lost response recovers without writing twice',async()=>{
  const f=fixture({failAfter:true}), input=request();
  const result=await f.write(input);
  assert.equal(result.staffStatus,'DISABLED');
  assert.equal(f.calls.filter(call=>call[0]==='update').length,1);
  assert.equal(f.rows.has('staff-management-write-lock'),false);
  await f.write(input);
  assert.equal(f.calls.filter(call=>call[0]==='update').length,1);
});

test('save status distinguishes clear, unconfirmed and confirmed locks without writing', async () => {
  const f = fixture({failBefore:true}), input = request();
  assert.equal((await f.readStatus()).state, 'CLEAR');
  await assert.rejects(f.write(input), /awaiting confirmation/);
  assert.equal((await f.readStatus()).state, 'UNCONFIRMED');
  f.rows.set('employee', {staffManagementRequestId:input.requestId,staffManagementFingerprint:input.fingerprint});
  const writes = f.calls.length;
  const status = await f.readStatus();
  assert.equal(status.state, 'CONFIRMED_LOCK_HELD');
  assert.equal(status.requestId, input.requestId);
  assert.equal(f.calls.length, writes);
  assert.equal(f.rows.has('staff-management-write-lock'), true);
});

test('exact receipt survives lock release and projects only the managed employee', async () => {
  const f = fixture({failAfter:true}), input = request();
  await f.write(input);
  const calls = f.calls.length;
  const receipt = await f.readStatus(input.requestId, row => ({ staffId: row.title }));
  assert.equal(receipt.state, 'CONFIRMED');
  assert.equal(receipt.requestId, input.requestId);
  assert.equal(receipt.employee.staffId, 'staff-id');
  assert.equal(receipt.employee.staffManagementFingerprint, undefined);
  assert.equal(f.calls.length, calls);
});

test('missing or contradictory exact receipts do not replay changes or release the lock', async () => {
  const f = fixture({failBefore:true}), input = request();
  await assert.rejects(f.write(input), /awaiting confirmation/);
  const calls = f.calls.length;
  const project = () => assert.fail('Unconfirmed employee projected');
  assert.equal((await f.readStatus(input.requestId, project)).state, 'PENDING');
  assert.equal((await f.readStatus(randomUUID(), project)).state, 'PENDING');
  f.rows.set('employee', {staffManagementRequestId:input.requestId,staffManagementFingerprint:'mismatch'});
  assert.equal((await f.readStatus(input.requestId, project)).state, 'PENDING');
  await assert.rejects(f.readStatus('not-a-request', project), /Invalid employee save request/);
  assert.equal(f.calls.length, calls);
  assert.equal(f.rows.has('staff-management-write-lock'), true);
});

test('an unconfirmed write stays blocked and a different request cannot steal the lock',async()=>{
  const f=fixture({failBefore:true}), input=request();
  await assert.rejects(f.write(input),/awaiting confirmation/);
  await assert.rejects(f.write(input),/awaiting confirmation/);
  await assert.rejects(f.write({...input,fingerprint:'changed'}),/Another employee change/);
  await assert.rejects(f.write({...input,actorId:'other-admin'}),/Another employee change/);
  assert.equal(f.rows.has('staff-management-write-lock'),true);
  assert.equal(f.calls.filter(call=>call[0]==='update').length,1);
});

test('validation failure releases the lock without changing staff',async()=>{
  const f=fixture();
  await assert.rejects(f.write(request({prepare:async()=>{throw Error('stale');}})),/stale/);
  assert.equal(f.rows.size,0);
  assert.equal(f.calls.some(call=>call[0]==='update'),false);
});

test('a retry must not release the original writer lock while its readback is pending',async()=>{
  const f=fixture(); let resume, reached;
  const ready=new Promise(resolve=>{reached=resolve;});
  const gate=new Promise(resolve=>{resume=resolve;});
  const first=request({project:row=>row});
  // Pause the owner's readback after commit but before it releases its lock.
  // In the fixture the readback is held using the Map read for this row.
  const get=f.rows.get.bind(f.rows); let pause=true;
  f.rows.get=id=>{
    const value=get(id);
    if(id==='employee' && pause){pause=false;reached();return gate.then(()=>value);}
    return value;
  };
  const pending=f.write(first); await ready;
  const retried=await f.write(first);
  assert.equal(retried.staffStatus,'DISABLED');
  await assert.rejects(f.write(request()),/Another employee change/);
  resume(); await pending;
  assert.equal(f.rows.has('staff-management-write-lock'),false);
});

const employee={_id:'employee',title:'staff-id',staffName:'Rinn',staffEmail:'rinn@example.com',
  role:'STAFF',staffStatus:'ACTIVE',description:'old-member',staffAccess:{},_updatedDate:'2026-11-13T00:00:00Z'};
const update=(overrides={})=>({staffId:employee.title,revision:policy.staffManagementRevision(employee),
  name:'Rinn',email:employee.staffEmail,status:'ACTIVE',access:{},...overrides});

test('the actual staff update entry point checks authority and treats reordered access as unchanged',async()=>{
  const fixtureStore = fixture();
  const staff = {...employee, staffAccess:{companyIds:['NCT','GHR'],departmentAccess:{PURCHASE:'EDIT',SUPPORT:'VIEW'}}};
  const admin = {_id:'admin',title:'admin-id',staffName:'Admin',staffEmail:'admin@example.com',role:'SUPER ADMIN',staffStatus:'ACTIVE',description:'admin-member'};
  fixtureStore.rows.set(staff._id, staff);
  fixtureStore.rows.set(admin._id, admin);
  const source = fs.readFileSync(path.join(__dirname,'../backend/staffManagement.web.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const api = vm.runInNewContext(source + '\nupdateManagedStaff', {
    ...policy, ...require('node:crypto'), webMethod: (_, fn) => fn, Permissions: {SiteMember: 1},
    currentMember: {getMember: async () => ({_id:'admin-member', loginEmail:admin.staffEmail, status:'APPROVED'})},
    wixData: {query(collection) { return {...fixtureStore.wixData.query(collection), limit() {
      return {find: async () => ({items:[...fixtureStore.rows.values()], hasNext:()=>false})};
    }}; }}, writeStaffManagement: fixtureStore.write
  });
  const input = update({requestId:randomUUID(),revision:policy.staffManagementRevision(staff),
    name:' Rinn ',email:'RINN@example.com',access:{companyIds:['GHR','NCT'],departmentAccess:{SUPPORT:'VIEW',PURCHASE:'EDIT'}}});
  const result = await api(input);
  assert.equal(result.staffId, staff.title);
  assert.deepEqual(fixtureStore.calls, []);
  await api({...input, requestId:randomUUID(), name:'Rinn Lee'});
  assert.equal(fixtureStore.rows.get('employee').staffName,'Rinn Lee');
  assert.equal(fixtureStore.calls.filter(([action]) => action === 'update').length,1);
});

test('email changes revoke the old binding and keep the employee identity',()=>{
  const changed=policy.prepareStaffUpdate(update({email:'NEW@example.com'}),[employee],'admin');
  assert.equal(changed.description,'');assert.equal(changed.staffStatus,'PENDING');
  assert.equal(changed._id,employee._id);assert.equal(changed.title,employee.title);
  assert.equal(changed.staffEmail,'new@example.com');
});

test('stale forms, duplicate emails and administrator edits are rejected',()=>{
  assert.throws(()=>policy.prepareStaffUpdate(update(),[{...employee,staffStatus:'DISABLED'}],'admin'),/changed/);
  assert.throws(()=>policy.prepareStaffUpdate(update({email:'other@example.com'}),[employee,{_id:'other',staffEmail:'other@example.com'}],'admin'),/already registered/);
  assert.throws(()=>policy.prepareStaffUpdate(update(),[employee],employee.title),/Administrator/);
  assert.throws(()=>policy.prepareStaffUpdate(update(),[{...employee,role:'SUPER ADMIN'}],'admin'),/Administrator/);
});

test('disabling keeps member history while removing current access',()=>{
  const changed=policy.prepareStaffUpdate(update({status:'DISABLED',access:{departmentAccess:{PURCHASE:'EDIT'},companyIds:['NCT']}}),[employee],'admin');
  assert.equal(changed.description,employee.description);
  assert.equal(policy.canEnterDepartment(changed,'PURCHASE','EDIT','NCT'),false);
});
