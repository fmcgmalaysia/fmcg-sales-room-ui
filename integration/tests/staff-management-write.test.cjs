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
  const write = vm.runInNewContext(source+'\nwriteStaffManagement',{wixData});
  return {rows,calls,write};
}

function request(overrides={}) {
  return {requestId:randomUUID(),fingerprint:'payload-hash',actorId:'admin',
    prepare:async()=>({row:{_id:'employee',title:'staff-id',staffStatus:'DISABLED'}}),
    project:row=>row,...overrides};
}

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
