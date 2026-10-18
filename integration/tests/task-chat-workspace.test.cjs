const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/taskChatWorkspace.js'),'utf8').replaceAll('export ',''),context);const build=input=>JSON.parse(JSON.stringify(context.buildTaskChatWorkspace(input)));
test('Support chat uses existing active member/employee binding and explicit department privilege',()=>{
 const member={_id:'MEMBER',status:'APPROVED',loginEmail:'staff@example.com'},row={title:'STAFF',staffName:'Staff',staffEmail:'STAFF@example.com',description:'MEMBER',staffStatus:'ACTIVE',role:'STAFF',departments:['SUPPORT']};
 assert.equal(context.requireSupportChatStaff(member,[row]).staffId,'STAFF');
 for(const records of [[{...row,description:'OTHER'}],[{...row,staffStatus:'INACTIVE'}],[{...row,departments:['WAREHOUSE']}],[row,row]])assert.throws(()=>context.requireSupportChatStaff(member,records),/Chat /);
 assert.throws(()=>context.requireSupportChatStaff({...member,status:'PENDING'},[row]),/Chat /);
});
test('closed PO and retired delivery metadata keep immutable identities without granting another company access',()=>{
 const base={company:'NCT',department:'WAREHOUSE',orders:[{company:'NCT',id:'PO',number:'PO1',supplierName:'Supplier',supplierAccount:{closed:true}}],delivery:[{id:'D',taskId:'T',barcode:'123',customerName:'Customer'}],legacy:{threads:[]},indexHistory:[{company:'NCT',taskKind:'DELIVERY',taskId:'OLD-D',details:{authority:'DRIVE_V1',task:{number:'Old batch',title:'Old customer',id:'forged'}}},{company:'GHR',taskKind:'DELIVERY',taskId:'OTHER',details:{authority:'DRIVE_V1',task:{}}}]};
 const result=build(base);assert.equal(result.tasks[0].closed,true);assert.deepEqual(result.tasks[0].peers,['PURCHASE']);assert.deepEqual(result.tasks[1].peers,['PURCHASE','SUPPORT']);assert.equal(result.tasks[2].id,'OLD-D');assert.equal(result.tasks[2].closed,true);assert.equal(result.tasks.length,3);
 const support=build({...base,department:'SUPPORT'});assert(support.tasks.every(t=>t.kind==='DELIVERY'));assert(support.tasks.every(t=>t.peers.join()==='WAREHOUSE'));
});
test('legacy Warehouse/Finance conversations remain a read-only archive and never authorize a new pair',()=>{
 const message={id:'M',from:'WAREHOUSE',to:['ACCOUNT'],body:'Earlier chat'},base={company:'NCT',department:'ACCOUNT',orders:[{company:'NCT',id:'P',number:'PO',supplierName:'S'}],delivery:[],legacy:{threads:[{id:'P',messages:[message],updates:[{body:'Payment reminder updated'},{body:'Payment or document recorded'}]}]}};
 const result=build(base);assert.deepEqual(result.tasks[0].peers,['PURCHASE']);assert.equal(result.legacyArchive[0].legacyOnly,true);assert.equal(result.legacyArchive[0].messages[0].body,'Earlier chat');assert.equal(result.tasks[0].updates.length,1);
});
