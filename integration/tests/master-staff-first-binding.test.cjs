const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');

function fixture(options={}) {
  const member={_id:'member-a',loginEmail:'employee@example.com',status:'APPROVED'};
  const rows=new Map([['employee',{_id:'employee',title:'staff-a',staffEmail:member.loginEmail,
    staffName:'Employee',staffStatus:'ACTIVE',role:'STAFF',description:'',staffAccess:{},...options.row}]]);
  const calls=[];
  function collection(name) {assert.equal(name,'StaffMasterAccess','no Activity or other collection is allowed');}
  const wixData={
    query(name){collection(name);const filters=[];const builder={filters,
      eq(key,value){filters.push(row=>row[key]===value);return builder;},
      or(other){filters.push(...other.filters);return builder;},limit(){return builder;},
      async find(){return {items:[...rows.values()].filter(row=>filters.some(f=>f(row)))};}
    };return builder;},
    async insert(name,row){collection(name);if(rows.has(row._id))throw Error('duplicate');rows.set(row._id,{...row});calls.push('insert');return row;},
    async update(name,row){collection(name);rows.set(row._id,{...row});calls.push('update');return row;},
    async get(name,id){collection(name);return rows.get(id);},
    async remove(name,id){collection(name);rows.delete(id);calls.push('remove');}
  };
  const load=(file,bindings,names)=>{
    const source=fs.readFileSync(path.join(__dirname,'../backend',file),'utf8')
      .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
    return vm.runInNewContext(source+'\n({'+names.join(',')+'})',bindings);
  };
  const writer=load('staffManagementWrite.js',{wixData},['writeStaffManagement']);
  const api=load('staffManagementAccess.js',{...policy,...writer,wixData,createHash,
    currentMember:{getMember:async()=>member},
    members:{getCurrentMember:async()=>{
      if(options.beforeVerify)options.beforeVerify(rows);
      return {member:{...member,loginEmailVerified:true,...options.verified}};
    }}
  },['readManagedStaffIdentity']);
  return {...api,rows,calls};
}

test('verified first binding stores one identity and subsequent checks are read-only',async()=>{
  const f=fixture();
  const first=await f.readManagedStaffIdentity();
  assert.equal(first.record.title,'staff-a');assert.equal(first.record.description,'member-a');
  assert.equal(f.rows.size,1);
  const calls=[...f.calls];
  for(let i=0;i<10;i++)await f.readManagedStaffIdentity();
  assert.deepEqual(f.calls,calls);assert.equal(f.rows.size,1);
});

test('approval without verified email cannot create a binding',async()=>{
  for(const verified of [{loginEmailVerified:false},{loginEmail:'other@example.com'},{_id:'other-member'}]){
    const f=fixture({verified});
    await assert.rejects(f.readManagedStaffIdentity(),/verified Google/);
    assert.deepEqual(f.calls,[]);assert.equal(f.rows.get('employee').description,'');
  }
});

test('disabled or pending staff do not create login or Activity records',async()=>{
  for(const staffStatus of ['DISABLED','PENDING']){
    const f=fixture({row:{staffStatus}});
    await assert.rejects(f.readManagedStaffIdentity(),/not authorized/);
    assert.deepEqual(f.calls,[]);assert.equal(f.rows.size,1);
  }
});

test('revocation during verified identity lookup is rechecked before binding',async()=>{
  const f=fixture({beforeVerify:rows=>{rows.get('employee').staffStatus='DISABLED';}});
  await assert.rejects(f.readManagedStaffIdentity(),/identity changed/);
  assert.equal(f.rows.get('employee').description,'');
  assert.equal(f.calls.includes('update'),false);assert.equal(f.rows.size,1);
});

test('existing member association is not rebound to a different member',async()=>{
  const f=fixture({row:{description:'previous-member'}});
  await assert.rejects(f.readManagedStaffIdentity(),/not authorized/);
  assert.equal(f.rows.get('employee').description,'previous-member');
  assert.deepEqual(f.calls,[]);
});
