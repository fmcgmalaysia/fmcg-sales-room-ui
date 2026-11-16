const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createHash}=require('node:crypto');
const read=file=>fs.readFileSync(require('node:path').join(__dirname,'../backend',file),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
const api=vm.runInNewContext('(function(){'+read('purchaseOperationJournal.js')+'\n'+read('sharedSupplierOperations.js').replace('const version =','const supplierVersion =').replaceAll('version(', 'supplierVersion(')+'\nreturn {createSharedSupplierOperations};})()', {createHash,Date,JSON,Error,Object,Array,Number,Promise,Set,String});
function fixture(){const rows=new Map(),writes=[],copy=x=>JSON.parse(JSON.stringify(x));let fail=false;
 const store={read:async(c,k)=>copy(rows.get(c+'/'+k)||null),one:async(c,criteria)=>copy([...rows].filter(([key])=>key.startsWith(c+'/')).map(([,r])=>r).find(r=>Object.entries(criteria).every(([k,v])=>r[k]===v))||null),
 insert:async(c,r)=>{writes.push(['insert',c]);if(rows.has(c+'/'+r._id))throw Error('duplicate');rows.set(c+'/'+r._id,copy(r));if(fail&&c==='SharedSuppliers'){fail=false;throw Error('response lost');}return copy(r);},update:async(c,r)=>{writes.push(['update',c]);rows.set(c+'/'+r._id,copy(r));return copy(r);},remove:async(c,k)=>{writes.push(['remove',c]);return rows.delete(c+'/'+k);}};
 const service=api.createSharedSupplierOperations({store,brandOptions:async()=>['CADBURY','MAGGI']});
 const input={requestId:'11111111-1111-4111-8111-111111111111',staff:{staffId:'S',staffName:'LAW',memberId:'M'},values:{companyName:'test supplier',shortName:'test',email:'KeepCase@example.com',companyWebsite:'https://example.com/CaseSensitive',salesContacts:[{name:'Alice',role:'Warehouse',phone:'123',email:'Alice@example.com'}],brands:['cadbury']}};
 return {rows,writes,store,service,input,fail:()=>fail=true};}
test('supplier save normalizes company and roles, preserves email/URL, and replays one actual record',async()=>{const f=fixture(),result=await f.service.save(f.input);const profile=await f.service.profile(result.supplierId);assert.equal(profile.companyName,'TEST SUPPLIER');assert.equal(profile.salesContacts[0].role,'WAREHOUSE');assert.equal(profile.email,'KeepCase@example.com');assert.equal(profile.companyWebsite,'https://example.com/CaseSensitive');assert.equal(profile.version,result.version);assert.equal((await f.service.save(f.input)).supplierId,result.supplierId);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('SharedSuppliers/')).length,1);});
test('lost response resumes inserted supplier without duplication and only then records success',async()=>{const f=fixture();f.fail();await assert.rejects(f.service.save(f.input),/response lost/);const result=await f.service.save(f.input);assert.equal(result.ok,true);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('SharedSuppliers/')).length,1);});
test('stale revision and reused save identity cannot overwrite subsequent profile changes',async()=>{const f=fixture(),first=await f.service.save(f.input);const edit={...f.input,supplierId:first.supplierId,expectedVersion:first.version,requestId:'22222222-2222-4222-8222-222222222222',values:{...f.input.values,companyName:'edited'}};await f.service.save(edit);await assert.rejects(f.service.save({...edit,requestId:'33333333-3333-4333-8333-333333333333',values:{...edit.values,companyName:'stale'}}),/changed/);await assert.rejects(f.service.save({...f.input,values:{...f.input.values,companyName:'reuse'}}),/different changes/);});
test('unknown brand/role/arbitrary fields are rejected without creating a supplier',async()=>{const f=fixture();await assert.rejects(f.service.save({...f.input,values:{...f.input.values,brands:['FAKE']}}),/POINTBASE/);await assert.rejects(f.service.save({...f.input,values:{...f.input.values,ourPoNumber:'X'}}),/Unsupported/);await assert.rejects(f.service.save({...f.input,values:{...f.input.values,salesContacts:[{name:'A',role:'ADMIN'}]}}),/Role/);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('SharedSuppliers/')).length,0);});


test('supplier bank fields round-trip as text with leading zeros and saved operation replay',async()=>{const f=fixture();f.input.values.bankName='maybank';f.input.values.bankAccountNo='001234-ABcd';const result=await f.service.save(f.input),profile=await f.service.profile(result.supplierId);assert.equal(profile.bankName,'MAYBANK');assert.equal(profile.bankAccountNo,'001234-ABcd');assert.equal((await f.service.save(f.input)).version,result.version);});
test('old supplier versions stay exact when bank fields are absent or blank',async()=>{const f=fixture(),result=await f.service.save(f.input),profile=await f.service.profile(result.supplierId);const fields=['companyName','shortName','registrationNo','address','officeTel','email','companyWebsite','collectionAddress','paymentTerm','supplierStatus','notes','salesContacts','brands'];const stored=[...f.rows].find(([k])=>k.startsWith('SharedSuppliers/'))[1];const oldVersion=createHash('sha256').update(JSON.stringify([fields.map(k=>[k,stored[k]??null])])).digest('hex').slice(0,32);assert.equal(profile.version,oldVersion);assert.equal(profile.bankName,'');assert.equal(profile.bankAccountNo,'');});
test('one-sided, non-text, overlong and control-character bank data are rejected',async()=>{for(const extra of [{bankName:'MAYBANK'},{bankAccountNo:'00123'},{bankName:'MAYBANK',bankAccountNo:123},{bankName:'MAYBANK',bankAccountNo:'1'.repeat(65)},{bankName:'MAYBANK',bankAccountNo:'00\n123'}]){const f=fixture();await assert.rejects(f.service.save({...f.input,values:{...f.input.values,...extra}}),/Bank Name|Invalid supplier|bank details/);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('SharedSuppliers/')).length,0);}});
test('bank updates reject stale versions while edits from older clients retain existing bank values',async()=>{const f=fixture(),a=await f.service.save({...f.input,values:{...f.input.values,bankName:'MAYBANK',bankAccountNo:'001234'}});const b=await f.service.save({...f.input,supplierId:a.supplierId,expectedVersion:a.version,requestId:'22222222-2222-4222-8222-222222222222',values:{...f.input.values,companyName:'edited supplier'}});assert.equal((await f.service.profile(a.supplierId)).bankAccountNo,'001234');await assert.rejects(f.service.save({...f.input,supplierId:a.supplierId,expectedVersion:a.version,requestId:'33333333-3333-4333-8333-333333333333',values:{...f.input.values,bankName:'OTHER',bankAccountNo:'009999'}}),/changed/);assert.notEqual(a.version,b.version);});

test('new registration, TIN and warehouse address round-trip without replacing legacy data',async()=>{
 const {rows,service,input}=fixture();
 const created=await service.save({...input,values:{...input.values,registrationNo:'OLD-1',registrationNoNew:'001200340056',tinNo:'C00123',address:'Office 1',warehouseAddress:'Warehouse 9',warehouseSameAsOffice:false,collectionAddress:'Pickup 8'}});
 const profile=await service.profile(created.supplierId);
 assert.equal(profile.registrationNo,'OLD-1');
 assert.equal(profile.registrationNoNew,'001200340056');
 assert.equal(profile.tinNo,'C00123');
 assert.equal(profile.address,'OFFICE 1');
 assert.equal(profile.warehouseAddress,'WAREHOUSE 9');
 assert.equal(profile.collectionAddress,'PICKUP 8');
 const edit=await service.save({...input,supplierId:created.supplierId,expectedVersion:created.version,requestId:'22222222-2222-4222-8222-222222222222',values:{...input.values,warehouseAddress:'Warehouse 10'}});
 assert.notEqual(edit.version,created.version);
 assert.equal((await service.profile(created.supplierId)).tinNo,'C00123');
 assert.equal([...rows.keys()].filter(key=>key.startsWith('SharedSuppliers/')).length,1);
});

test('same-address choice follows later office edits, survives retries and can be switched off',async()=>{
 const f=fixture();
 const create={...f.input,values:{...f.input.values,address:'Office 1',warehouseAddress:'Stale address',warehouseSameAsOffice:true}};
 f.fail();
 await assert.rejects(f.service.save(create),/response lost/);
 const first=await f.service.save(create);
 assert.equal((await f.service.profile(first.supplierId)).warehouseAddress,'OFFICE 1');
 const edit={...f.input,supplierId:first.supplierId,expectedVersion:first.version,requestId:'22222222-2222-4222-8222-222222222222',values:{...f.input.values,address:'Office 2'}};
 const second=await f.service.save(edit);
 const profile=await f.service.profile(first.supplierId);
 assert.equal(profile.warehouseAddress,'OFFICE 2');
 assert.equal(profile.warehouseSameAsOffice,true);
 await f.service.save({...edit,expectedVersion:second.version,requestId:'33333333-3333-4333-8333-333333333333',values:{...edit.values,warehouseSameAsOffice:false,warehouseAddress:'Warehouse 3'}});
 const final=await f.service.profile(first.supplierId);
 assert.equal(final.warehouseAddress,'WAREHOUSE 3');
 assert.equal(final.warehouseSameAsOffice,false);
});

test('legacy revisions are preserved when new fields are blank, and malformed field types are rejected',async()=>{
 const {service,input}=fixture();
 const first=await service.save(input);
 const edit={...input,supplierId:first.supplierId,expectedVersion:first.version,requestId:'22222222-2222-4222-8222-222222222222',values:{...input.values,registrationNoNew:'',tinNo:'',warehouseAddress:'',warehouseSameAsOffice:false}};
 assert.equal((await service.save(edit)).version,first.version);
 for(const extra of [{tinNo:123},{warehouseSameAsOffice:'false'}]){
  await assert.rejects(service.save({...input,values:{...input.values,...extra}}),/Invalid/);
 }
});

test('missing company name returns an editable failure before any receipt or supplier write',async()=>{
 const {rows,service,input}=fixture();
 const rejected=await service.save({...input,values:{...input.values,companyName:'  ',address:'Temporary address'}});
 assert.equal(rejected.ok,false);
 assert.equal(rejected.error,'Company Name is required.');
 assert.equal(rejected.requestId,input.requestId);
 assert.equal(rows.size,0);
 assert.equal((await service.save(input)).ok,true);
});

test('unchanged supplier form creates zero writes, including journal and lock',async()=>{
 const f=fixture();
 const created=await f.service.save({...f.input,values:{...f.input.values,brands:['CADBURY','MAGGI']}});
 const before=f.writes.length;
 const edit={...f.input,supplierId:created.supplierId,expectedVersion:created.version,requestId:'22222222-2222-4222-8222-222222222222',
   values:{...f.input.values,companyName:' TEST SUPPLIER ',brands:['MAGGI','cadbury'],tinNo:'',warehouseAddress:'',warehouseSameAsOffice:false}};
 const result=await f.service.save(edit);
 assert.equal(result.ok,true);
 assert.equal(result.unchanged,true);
 assert.equal(result.version,created.version);
 assert.equal(f.writes.length,before);
 const changed=await f.service.save({...edit,requestId:'33333333-3333-4333-8333-333333333333',values:{...edit.values,email:'keepcase@example.com'}});
 assert.notEqual(changed.version,created.version);
 assert.equal(f.writes.slice(before).filter(row=>row[0]==='update'&&row[1]==='SharedSuppliers').length,1);
});

test('a confirmed edit keeps its original receipt even if the new profile already matches',async()=>{
 const f=fixture(),created=await f.service.save(f.input);
 const edit={...f.input,supplierId:created.supplierId,expectedVersion:created.version,requestId:'22222222-2222-4222-8222-222222222222',values:{...f.input.values,companyName:'new name'}};
 const result=await f.service.save(edit),writes=f.writes.length;
 const replay=await f.service.save(edit);
 assert.equal(replay.savedAt,result.savedAt);
 assert.equal(replay.version,result.version);
 assert.equal(replay.unchanged,undefined);
 assert.equal(f.writes.length,writes);
});

test('an edit that looks unchanged cannot mask a concurrent supplier version change',async()=>{
 const f=fixture(),created=await f.service.save(f.input);
 const original=f.store.read;
 let intervened=false;
 f.store.read=async(collection,id)=>{
  if(collection==='SharedSuppliers'&&!intervened){
   intervened=true;
   f.rows.get(collection+'/'+id).companyName='OTHER EDITOR CHANGE';
  }
  return original(collection,id);
 };
 await assert.rejects(f.service.save({...f.input,supplierId:created.supplierId,expectedVersion:created.version,requestId:'22222222-2222-4222-8222-222222222222'}),/Supplier changed/);
 assert.equal((await f.service.profile(created.supplierId)).companyName,'OTHER EDITOR CHANGE');
});
