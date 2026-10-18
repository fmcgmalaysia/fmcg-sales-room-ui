const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createHash}=require('node:crypto');
function fixture(){
 const core={},service={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps-script/purchase-documents/TaskChatState.gs'),'utf8'),core);vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/taskChatService.js'),'utf8').replaceAll('export ',''),service);
 const clone=x=>x?JSON.parse(JSON.stringify(x)):null,hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),heads=new Map(),pages=new Map(),indices=new Map();let inserted=0,pageReads=0,failIndex=false,failUpdate=false;
 const store={head:k=>clone(heads.get(k)),putHead:(k,v)=>heads.set(k,clone(v)),page:(k,p,n)=>{pageReads++;return clone(pages.get(k+p+n));},putPage:(k,p,n,v)=>pages.set(k+p+n,clone(v))};
 store.findMessage=(k,p,id)=>clone([...pages.entries()].filter(([key])=>key.startsWith(k+p)).flatMap(([,page])=>page.messages).find(m=>m.id===id));
 const run=input=>{const result=clone(core.taskChatRun_(store,input,hash,()=>new Date('2026-10-18T13:00:00Z').toISOString()));return {...result,fileId:heads.has(hash([input.company,input.kind,input.taskId]))?'DriveFileIdentity0000001':null};};
 const drive=async input=>input.action==='CHAT_SUMMARIES'?{ok:true,company:input.company,threads:input.tasks.map(t=>run({...t,actor:input.actor,company:input.company,operation:'SUMMARY'}))}:run(input);
 const index={read:async id=>clone(indices.get(id)),find:async ids=>ids.map(id=>clone(indices.get(id))).filter(Boolean),insert:async row=>{if(failIndex){failIndex=false;throw Error('Index outage');}if(indices.has(row._id))throw Error('Duplicate index');inserted++;indices.set(row._id,clone(row));},update:async row=>{if(failUpdate){failUpdate=false;throw Error("Index outage");}indices.set(row._id,clone(row));}};
 const old={id:'f'.repeat(32),from:'ACCOUNT',to:['PURCHASE'],body:'Old saved message',requiresAck:true,at:'2026-10-17T12:00:00.000Z',by:'Finance',byStaffId:'A',receipts:[]};
 const records=[{kind:'PO',id:'a'.repeat(32),title:'Supplier',number:'PO1',legacy:[old],closed:false},{kind:'DELIVERY',id:'b'.repeat(32),title:'Customer',number:'Batch1',legacy:[],closed:false}];
 const resolve=async({company,department})=>{if(!['NCT','GHR'].includes(company))throw Error('Invalid company');return {tasks:records.flatMap(t=>{const peers=t.kind==='PO'?{PURCHASE:['ACCOUNT','WAREHOUSE'],ACCOUNT:['PURCHASE'],WAREHOUSE:['PURCHASE']}:{PURCHASE:['WAREHOUSE'],WAREHOUSE:['PURCHASE','SUPPORT'],SUPPORT:['WAREHOUSE']};return peers[department]?[{...clone(t),peers:peers[department]}]:[];})};};
 const operations=service.createTaskChatService({drive,index,resolve,hash}),staff={staffId:'P',staffName:'Purchaser',memberId:'member-P'},account={staffId:'A',staffName:'Finance',memberId:'member-A'},warehouse={staffId:'W',staffName:'Warehouse',memberId:'member-W'},support={staffId:'S',staffName:'Support',memberId:'member-S'};
 const base={company:'NCT',department:'PURCHASE',staff},input={kind:'PO',taskId:records[0].id,peer:'ACCOUNT'},uuid=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
 return {operations,base,input,uuid,staff,account,warehouse,support,indices,heads,pages,records,old,get inserted(){return inserted;},get pageReads(){return pageReads;},failIndex:()=>failIndex=true,failUpdate:()=>failUpdate=true};
}
test('many sends and read receipts update one CMS task index; list does not scan body pages',async()=>{
 const f=fixture();for(let i=0;i<35;i++)await f.operations.save({...f.base,requestId:f.uuid(i),input:{...f.input,action:'SEND',body:'New '+i,requiresAck:false,baseSequence:i}});
 assert.equal(f.inserted,1);assert.equal(f.indices.size,1);assert.equal(f.pages.size,2);
 for(let i=1;i<=35;i++)await f.operations.save({...f.base,department:'ACCOUNT',staff:f.account,requestId:f.uuid(100+i),input:{kind:'PO',taskId:f.input.taskId,peer:'PURCHASE',action:'READ',sequence:i}});
 assert.equal(f.inserted,1);const before=f.pageReads;const list=await f.operations.list({...f.base,department:'ACCOUNT',staff:f.account});assert.equal(f.pageReads,before);assert.equal(list.threads[0].unread,0);assert.equal(list.threads[0].lastIncoming.body,'New 34');
});
test('a saved message whose CMS confirmation failed is retried without creating another message',async()=>{
 const f=fixture(),request={...f.base,requestId:f.uuid(1),input:{...f.input,action:'SEND',body:'Keep exactly once',requiresAck:false,baseSequence:0}};f.failUpdate();await assert.rejects(f.operations.save(request),/Index outage/);const result=await f.operations.save(request);assert.equal(result.unchanged,true);assert.equal(f.inserted,1);assert.equal([...f.pages.values()][0].messages.length,1);
});
test('legacy content remains readable and personal READ/ACK create no activity events',async()=>{
 const f=fixture();let page=await f.operations.page({...f.base,input:f.input});assert.equal(page.messages[0].legacy,true);assert.equal(page.messages[0].body,f.old.body);
 await f.operations.save({...f.base,requestId:f.uuid(1),input:{...f.input,action:'LEGACY_READ',messageId:f.old.id}});await f.operations.save({...f.base,requestId:f.uuid(2),input:{...f.input,action:'LEGACY_ACK',messageId:f.old.id}});
 page=await f.operations.page({...f.base,input:f.input});assert(page.messages[0].receipts.some(r=>r.kind==='READ'));assert(page.messages[0].receipts.some(r=>r.kind==='ACK'));assert.equal(f.inserted,1);assert.equal(f.pages.size,0);assert.equal(f.old.receipts.length,0);f.records[0].closed=true;assert.equal((await f.operations.list(f.base)).threads[0].closed,true);
});
test('delivery P and S conversations stay independent and warehouse cannot target finance',async()=>{
 const f=fixture(),delivery={kind:'DELIVERY',taskId:f.records[1].id};
 await f.operations.save({company:'NCT',department:'WAREHOUSE',staff:f.warehouse,requestId:f.uuid(1),input:{...delivery,peer:'SUPPORT',action:'SEND',body:'Loaded450',requiresAck:false,baseSequence:0}});
 const supportPage=await f.operations.page({company:'NCT',department:'SUPPORT',staff:f.support,input:{...delivery,peer:'WAREHOUSE'}});assert.equal(supportPage.messages[0].body,'Loaded450');
 const purchasePage=await f.operations.page({...f.base,input:{...delivery,peer:'WAREHOUSE'}});assert.equal(purchasePage.messages.length,0);
 await assert.rejects(f.operations.save({company:'NCT',department:'WAREHOUSE',staff:f.warehouse,requestId:f.uuid(2),input:{kind:'PO',taskId:f.records[0].id,peer:'ACCOUNT',action:'SEND',body:'Wrong route',requiresAck:false,baseSequence:0}}),/not permitted/);assert.equal(f.indices.size,1);
});

test('new browser can discover a committed message after its CMS summary receipt fails',async()=>{
 const f=fixture(),request={...f.base,requestId:f.uuid(71),input:{...f.input,action:'SEND',body:'Discover after browser closes',requiresAck:false,baseSequence:0}};
 f.failUpdate();await assert.rejects(f.operations.save(request),/Index outage/);
 const list=await f.operations.list({...f.base,department:'ACCOUNT',staff:f.account});
 assert.equal(list.threads[0].lastIncoming.body,'Discover after browser closes');assert.equal(f.indices.size,1);assert.equal(f.inserted,1);
});
test('first index failure stops before any Drive message is written',async()=>{
 const f=fixture();f.failIndex();await assert.rejects(f.operations.save({...f.base,requestId:f.uuid(72),input:{...f.input,action:'SEND',body:'Not yet saved',requiresAck:false,baseSequence:0}}),/Index outage/);
 assert.equal(f.pages.size,0);assert.equal(f.heads.size,0);assert.equal(f.indices.size,0);
});
