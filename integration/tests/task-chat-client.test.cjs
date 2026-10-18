const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../backend/taskChatClient.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
function client(request){const context={URL,requestPrivateDriveTransport:request,PRIVATE_DRIVE_ENDPOINT:'https://script.google.com/macros/s/test/exec',getSecret:async()=> 's'.repeat(40)};vm.runInNewContext(source+'\nthis.client=createTaskChatClient();',context);return context.client;}
const input={action:'CHAT_OPERATION',company:'NCT',kind:'PO',taskId:'a'.repeat(64),pair:'ACCOUNT:PURCHASE',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'};
const receipt={ok:true,company:'NCT',kind:'PO',taskId:input.taskId,summary:{pair:input.pair}};
test('private chat transport sends token only to the configured endpoint and preserves retry identity',async()=>{
 const calls=[],send=client(async(url,options)=>{calls.push({url,options});return calls.length%2?{status:302,location:'https://script.googleusercontent.com/result'}:{status:200,body:JSON.stringify(receipt)};});
 await send(input);await send(input);
 assert.equal(calls.length,4);
 for(const i of [0,2]){assert.equal(JSON.parse(calls[i].options.body).requestId,input.requestId);assert.equal(JSON.parse(calls[i].options.body).token,'s'.repeat(40));assert.equal(calls[i+1].options.method,'GET');assert.equal(calls[i+1].options.body,undefined);assert.equal(calls[i+1].options.headers,undefined);}
});
test('redirects cannot send chat credentials to another host or loop forever',async()=>{
 for(const location of ['http://script.googleusercontent.com/result','https://evil.test/result','https://script.googleusercontent.com.evil.test/result','https://user:pass@script.googleusercontent.com/result']){let calls=0;await assert.rejects(client(async()=>{calls++;return {status:302,location};})(input),/redirect rejected/);assert.equal(calls,1);}
 let calls=0;await assert.rejects(client(async()=>{calls++;return {status:302,location:'https://script.googleusercontent.com/result'};})(input),/redirect limit/);assert.equal(calls,4);
});
test('wrong company, task, pair and reordered list receipts are rejected',async()=>{
 for(const changed of [{company:'GHR'},{kind:'DELIVERY'},{taskId:'b'.repeat(64)},{summary:{pair:'PURCHASE:WAREHOUSE'}}])await assert.rejects(client(async()=>({status:200,body:JSON.stringify({...receipt,...changed})}))(input),/receipt does not match/);
 const tasks=[{kind:'PO',taskId:'a'.repeat(64),pair:input.pair},{kind:'PO',taskId:'b'.repeat(64),pair:input.pair}],threads=tasks.map(t=>({...receipt,...t,summary:{pair:t.pair}})).reverse();
 await assert.rejects(client(async()=>({status:200,body:JSON.stringify({ok:true,company:'NCT',threads})}))({action:'CHAT_SUMMARIES',company:'NCT',tasks}),/list receipt/);
});
test('ambiguous responses remain unconfirmed and remote error text is not exposed',async()=>{
 for(const response of [{status:503,body:''},{status:200,body:'not json'},{status:200,body:JSON.stringify({ok:false,error:'private debug details'})}])await assert.rejects(client(async()=>response)(input),/unconfirmed/);
 await assert.rejects(client(async()=>({status:200,body:JSON.stringify({ok:false,error:'CHAT_REQUEST_REUSED'})}))(input),/CHAT_REQUEST_REUSED/);
});
