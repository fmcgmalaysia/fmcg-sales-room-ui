const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createDepartmentMessageOperations,projectDepartmentMessages,requireMessageStaff,messageDepartments}=load('departmentMessages.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const records=new Map(),activity=()=>[...records.values()].filter(e=>e.action),po={id:'PO',company:'NCT',number:'NCT-PO-001',supplierName:'Supplier',taskIds:['T'],warehouse:{issues:true},shortageIssues:[{taskId:'T',barcode:'123',name:'Short item'}],documentIssues:[{id:'DOC',type:'INV',reason:'Wrong date',status:'OPEN'}],history:[],finance:{paidCents:30000},supplierAccount:{closed:false,canClose:false}};
 const store={read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,e)=>{if(records.has(c+'/'+e._id))throw Error('duplicate');records.set(c+'/'+e._id,clone(e));return e;},remove:async(c,id)=>records.delete(c+'/'+id)};
 const staff=(id,departments)=>({memberId:'MEM-'+id,staffId:id,staffName:id,role:'STAFF',departments});
 const purchase=staff('P',['PURCHASE']),warehouse=staff('W',['WAREHOUSE']),finance=staff('F',['ACCOUNT']);let n=0;
 const next=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12,'0')}`;
 const ops=createDepartmentMessageOperations({store,names:{NCT:{activity:'A'},GHR:{activity:'B'}},readContext:async()=>({activity:activity()}),listOrders:async company=>company==='NCT'?[po]:[],now:()=>new Date('2026-10-18T08:00:00Z')});
 const save=(staff,department,input,requestId=next(),company='NCT')=>ops({staff,department,input,requestId,company});
 const project=(staff,department,company='NCT')=>projectDepartmentMessages({company,department,staff,orders:[po],activity:activity()});
 return {records,activity,store,po,purchase,warehouse,finance,save,project,staff,next};
}
test('one shared message supports personal reads and department acknowledgement without resolving shortages',async()=>{
 const f=setup(),before=clone(f.po),sent=await f.save(f.warehouse,'WAREHOUSE',{action:'MESSAGE_SEND',poId:'PO',to:['PURCHASE','ACCOUNT'],body:'Short 20 cartons',requiresAck:true});
 assert.equal(f.project(f.purchase,'PURCHASE').threads[0].unread,1);
 await f.save(f.purchase,'PURCHASE',{action:'MESSAGE_READ',poId:'PO',messageId:sent.messageId});
 assert.equal(f.project(f.purchase,'PURCHASE').threads[0].unread,0);
 assert.equal(f.project(f.staff('P2',['PURCHASE']),'PURCHASE').threads[0].unread,1);
 await f.save(f.purchase,'PURCHASE',{action:'MESSAGE_ACK',poId:'PO',messageId:sent.messageId});
 const sender=f.project(f.warehouse,'WAREHOUSE').threads[0];assert.equal(sender.messages[0].receipts.filter(r=>r.kind==='ACK').length,1);
 assert.equal(f.project(f.finance,'ACCOUNT').threads[0].unread,1);
 assert.deepEqual(f.po,before);assert.equal(sender.issues[0].kind,'RECEIVING');assert.equal(f.po.finance.paidCents,30000);assert.equal(f.po.supplierAccount.canClose,false);
});
test('ordinary message acknowledgement, forged departments, recipients and another company are rejected',async()=>{
 const f=setup();await assert.rejects(f.save(f.purchase,'ACCOUNT',{action:'MESSAGE_SEND',poId:'PO',to:['WAREHOUSE'],body:'bad',requiresAck:false}),/not authorized/);
 for(const to of [['BUYER'],['PURCHASE'],['ACCOUNT','ACCOUNT']])await assert.rejects(f.save(f.purchase,'PURCHASE',{action:'MESSAGE_SEND',poId:'PO',to,body:'bad',requiresAck:false}),/receiving department/);
 await assert.rejects(f.save(f.purchase,'PURCHASE',{action:'MESSAGE_SEND',poId:'PO',to:['ACCOUNT'],body:'bad',requiresAck:false},f.next(),'GHR'),/not available/);
 const sent=await f.save(f.purchase,'PURCHASE',{action:'MESSAGE_SEND',poId:'PO',to:['WAREHOUSE'],body:'hello',requiresAck:false});
 await assert.rejects(f.save(f.warehouse,'WAREHOUSE',{action:'MESSAGE_ACK',poId:'PO',messageId:sent.messageId}),/does not require/);
 await assert.rejects(f.save(f.finance,'ACCOUNT',{action:'MESSAGE_READ',poId:'PO',messageId:sent.messageId}),/not addressed/);
 assert.equal(f.project(f.finance,'ACCOUNT').threads[0].messages.length,0);assert.equal(f.project(f.purchase,'PURCHASE','GHR').threads.length,0);
});
test('a new message creates a new unread marker while repeat read is a no-op',async()=>{
 const f=setup(),input={action:'MESSAGE_SEND',poId:'PO',to:['ACCOUNT'],body:'Please review',requiresAck:true},sent=await f.save(f.purchase,'PURCHASE',input),read={action:'MESSAGE_READ',poId:'PO',messageId:sent.messageId};
 await f.save(f.finance,'ACCOUNT',read);const count=f.activity().filter(e=>e.action==='DEPARTMENT_MESSAGE_READ').length;
 const duplicate=await f.save(f.finance,'ACCOUNT',read);assert.equal(duplicate.unchanged,true);assert.equal(f.activity().filter(e=>e.action==='DEPARTMENT_MESSAGE_READ').length,count);
 await f.save(f.purchase,'PURCHASE',{...input,body:'New instruction'});assert.equal(f.project(f.finance,'ACCOUNT').threads[0].unread,1);
});
test('lost acknowledgement retries original identity once and receipts use server actor',async()=>{
 const f=setup(),insert=f.store.insert;let fail=true;
 f.store.insert=async(c,e)=>{const out=await insert(c,e);if(e.action==='DEPARTMENT_MESSAGE_SENT'&&fail){fail=false;throw Error('lost result');}return out;};
 const requestId=f.next(),input={action:'MESSAGE_SEND',poId:'PO',to:['ACCOUNT'],body:'Please review',requiresAck:true,by:'Forged',at:'2000-01-01'};
 await assert.rejects(f.save(f.purchase,'PURCHASE',input,requestId),/lost result/);await f.save(f.purchase,'PURCHASE',input,requestId);
 const row=f.project(f.finance,'ACCOUNT').threads[0];assert.equal(row.messages.length,1);assert.equal(row.messages[0].by,'P');assert.equal(row.messages[0].at,'2026-10-18T08:00:00.000Z');
 await assert.rejects(f.save(f.purchase,'PURCHASE',{...input,body:'changed'},requestId),/different changes/);
});
test('reply preserves audience; Warehouse does not receive Finance-only notes or document issues',async()=>{
 const f=setup(),sent=await f.save(f.finance,'ACCOUNT',{action:'MESSAGE_SEND',poId:'PO',to:['PURCHASE'],body:'Check bank reference',requiresAck:false});
 await assert.rejects(f.save(f.purchase,'PURCHASE',{action:'MESSAGE_SEND',poId:'PO',replyTo:sent.messageId,to:['WAREHOUSE'],body:'forward private',requiresAck:false}),/original recipients/);
 assert.equal(f.project(f.warehouse,'WAREHOUSE').threads[0].messages.length,0);assert.equal(f.project(f.warehouse,'WAREHOUSE').threads[0].issues.some(i=>i.kind==='DOCUMENT'),false);
});
test('closing a supplier account does not prevent historical communication or silently reopen it',async()=>{
 const f=setup();f.po.supplierAccount={closed:true,canClose:false};const before=clone(f.po);
 await f.save(f.purchase,'PURCHASE',{action:'MESSAGE_SEND',poId:'PO',to:['ACCOUNT'],body:'Question about closed account',requiresAck:true});assert.deepEqual(f.po,before);
});
test('message access inherits the existing three department authorizers, including management and inactive rejection',()=>{
 const guards={PURCHASE:load('purchaseProjection.js').requirePurchaseStaff,ACCOUNT:load('accountPurchaseReview.js').requireAccountStaff,WAREHOUSE:load('warehouseReceiving.js').requireWarehouseStaff};
 const member={_id:'M',loginEmail:'staff@example.invalid',status:'APPROVED'},record={title:'S',description:'M',staffName:'Staff',staffEmail:member.loginEmail,staffStatus:'ACTIVE',role:'EMPLOYEE',departments:['PURCHASE']};
 assert.equal(JSON.stringify(messageDepartments(requireMessageStaff(member,[record],guards))),JSON.stringify(['PURCHASE']));
 for(const role of ['TOP MANAGEMENT','SUPER ADMIN'])assert.equal(JSON.stringify(messageDepartments(requireMessageStaff(member,[{...record,role,departments:['SUPPORT']}],guards))),JSON.stringify(['PURCHASE','ACCOUNT','WAREHOUSE']));
 assert.throws(()=>requireMessageStaff(member,[{...record,departments:['SUPPORT']}],guards),/not authorized/);
 assert.throws(()=>requireMessageStaff(member,[{...record,staffStatus:'INACTIVE'}],guards),/not authorized/);
 assert.throws(()=>requireMessageStaff({...member,status:'PENDING'},[record],guards),/not authorized/);
});

test('STOP decision is one authored purchasing conversation item from the existing event',()=>{
 const f=setup(),event={title:'DECISION',action:'PURCHASE_QUANTITY_CASE_DECIDED',result:'SAVED',imageAltText:'T',activityTime:'2026-10-26T15:21:00.000Z',initiatedByStaffName:'Buyer',details:{company:'NCT',kind:'RECEIPT',supplierDeliveryDecision:'STOP',supplierDecision:'CN_PROMISED'}};
 f.records.set('A/DECISION',event);const before=JSON.stringify([...f.records]);
 for(const [staff,department]of [[f.warehouse,'WAREHOUSE'],[f.finance,'ACCOUNT'],[f.purchase,'PURCHASE']]){const t=f.project(staff,department).threads[0],d=t.updates.find(u=>u.id==='DECISION');assert.equal(d.presentation,'MESSAGE');assert.equal(d.from,'PURCHASE');assert.equal(d.by,'Buyer');assert.equal(d.at,event.activityTime);assert.equal(d.body,'Stop Waiting');assert.equal(d.bodyZh,'停止等货');assert.equal(t.messages.length,0);}
 assert.equal(JSON.stringify([...f.records]),before);
});
