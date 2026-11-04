const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createHash}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../apps-script/purchase-documents/TaskChatState.gs'),'utf8');
function fixture(){
 const heads=new Map(),pages=new Map(),clone=x=>x?JSON.parse(JSON.stringify(x)):null;let fail='';
 const store={head:k=>clone(heads.get(k)),putHead(k,v){if(fail==='head'){fail='';throw Error('Simulated head outage');}heads.set(k,clone(v));},page:(k,p,n)=>clone(pages.get(k+p+n)),putPage(k,p,n,v){pages.set(k+p+n,clone(v));if(fail==='page-result'){fail='';throw Error('Simulated lost page result');}}};
 store.findMessage=(k,p,id)=>clone([...pages.entries()].filter(([key])=>key.startsWith(k+p)).flatMap(([,page])=>page.messages).find(m=>m.id===id));
 const context={};vm.runInNewContext(source,context);const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');let requests=0;
 const actor={memberId:'member-P',staffId:'P',staffName:'Purchase',department:'PURCHASE'},other={memberId:'member-A',staffId:'A',staffName:'Finance',department:'ACCOUNT'};
 const base={company:'NCT',kind:'PO',taskId:'a'.repeat(32),pair:'ACCOUNT:PURCHASE',actor};
 const run=input=>clone(context.taskChatRun_(store,{...base,...input},hash,()=>new Date('2026-10-18T12:00:00Z').toISOString()));
 const send=(input={})=>run({operation:'SEND',body:'Message',requiresAck:false,baseSequence:0,requestId:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(++requests).padStart(12,'0'),...input});
 return {run,send,actor,other,heads,pages,fail:v=>fail=v};
}
test('one task head and bounded body pages replace per-message CMS activity rows',()=>{
 const f=fixture();for(let i=0;i<70;i++)f.send({baseSequence:i,body:'Message '+i});
 assert.equal(f.heads.size,1);assert.equal(f.pages.size,3);assert.equal([...f.pages.values()].reduce((n,p)=>n+p.messages.length,0),70);
 const result=f.run({operation:'PAGE',actor:f.other});assert.equal(result.messages.length,20);assert.equal(result.messages.at(-1).sequence,70);assert.equal(result.beforeSequence,51);assert.equal(result.summary.unread,70);
});
test('concurrent clients with the same prior sequence append distinct messages; same request retries exactly once',()=>{
 const f=fixture(),requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const first=f.send({requestId});f.send({body:'Second client'});const again=f.send({requestId,baseSequence:2});assert.equal(again.unchanged,true);assert.equal(again.message.id,first.message.id);assert.equal(again.summary.sequence,2);
 assert.throws(()=>f.send({requestId,body:'Changed content'}),/REQUEST_REUSED/);
});
test('lost page response or head commit recovers the saved message without overwriting a following sender',()=>{
 for(const failure of ['head','page-result']){const f=fixture(),requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';f.fail(failure);assert.throws(()=>f.send({requestId}),/Simulated/);const second=f.send({body:'Following sender'});assert.equal(second.summary.sequence,2);const retry=f.send({requestId});assert.equal(retry.message.sequence,1);assert.equal(retry.unchanged,true);assert.equal(f.pages.size,1);}
});
test('personal department cursors stay independent; own-author cross-department messages do not become unread',()=>{
 const f=fixture();f.send();f.send();const otherEmployee={...f.other,staffId:'A2',memberId:'member-A2'};
 f.run({operation:'READ',actor:f.other,sequence:1,requestId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});
 assert.equal(f.run({operation:'SUMMARY',actor:f.other}).summary.unread,1);assert.equal(f.run({operation:'SUMMARY',actor:otherEmployee}).summary.unread,2);
 assert.equal(f.run({operation:'SUMMARY',actor:{...f.actor,department:'ACCOUNT'}}).summary.unread,0);assert.equal(f.heads.size,1);
});
test('explicit ACK cannot resolve a business issue and cannot acknowledge a message for another department',()=>{
 const f=fixture(),m=f.send({requiresAck:true}).message,requestId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 assert.throws(()=>f.run({operation:'ACK',sequence:1,messageId:m.id,requestId}),/INVALID_ACK/);
 f.run({operation:'ACK',actor:f.other,sequence:1,messageId:m.id,requestId});const row=f.run({operation:'PAGE'}).messages[0];assert.equal(row.receipts[0].kind,'ACK');assert.equal(f.heads.size,1);assert.equal(f.pages.size,1);assert.equal(f.run({operation:'SUMMARY',actor:f.other}).summary.unread,1);
});
test('company, task and pair isolation with paginated history across segment boundaries',()=>{
 const f=fixture();for(let i=0;i<40;i++)f.send({baseSequence:i});
 assert.equal(f.run({operation:'SUMMARY',company:'GHR',actor:f.other}).summary.unread,0);assert.equal(f.run({operation:'SUMMARY',taskId:'b'.repeat(32),actor:f.other}).summary.unread,0);
 assert.throws(()=>f.run({operation:'SUMMARY',pair:'ACCOUNT:WAREHOUSE'}),/INVALID_PAIR/);
 assert.throws(()=>f.run({operation:'SUMMARY',kind:'DELIVERY'}),/INVALID_PAIR/);
 const page=f.run({operation:'PAGE',beforeSequence:21});assert.equal(page.messages.length,20);assert.equal(page.messages[0].sequence,1);assert.equal(page.beforeSequence,null);
});
