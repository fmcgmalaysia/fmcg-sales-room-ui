const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'../wix/purchase-room-page.js'),'utf8');
const hunk=page.split('\n').find(line=>line.includes("result.retryable===false&&result.requestId===message.saveRequestId"));
const relay=(message,result)=>{const sent=[];vm.runInNewContext(hunk,{message,result,room:{postMessage:x=>sent.push(JSON.parse(JSON.stringify(x)))}});return sent;};
test('terminal failed read uses the original save identity and existing failure channel',()=>{
 const message={type:'PURCHASE_SAVE_CHECK_REQUEST',company:'NCT',requestId:'READ',saveRequestId:'SAVE'},result={ok:false,retryable:false,requestId:'SAVE',error:'Stock changed'};
 const sent=relay(message,result);assert.equal(sent.length,1);assert.equal(sent[0].requestId,'SAVE');assert.equal(sent[0].type,'PURCHASE_SAVE_RESULT');assert.equal(sent[0].ok,false);assert.deepEqual(sent[0].result,result);
});
test('unknown, success, other identities and ordinary operations do not produce a rejection relay',()=>{
 const m={type:'PURCHASE_SAVE_CHECK_REQUEST',company:'NCT',requestId:'READ',saveRequestId:'SAVE'};
 for(const result of [{ok:false,pending:true,requestId:'SAVE'},{ok:true,requestId:'SAVE'},{ok:false,retryable:false,requestId:'OTHER'}])assert.equal(relay(m,result).length,0);
 assert.equal(relay({...m,type:'PURCHASE_SAVE_REQUEST'},{ok:false,retryable:false,requestId:'SAVE'}).length,0);
 assert.match(page,/room.postMessage\(\{type:replyType,ok:true,company:message.company,requestId:message.requestId,result\}\)/);
});
