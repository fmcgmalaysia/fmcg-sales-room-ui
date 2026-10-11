const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../backend/purchaseDocumentClient.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
const {createPurchaseDocumentClient}=vm.runInNewContext('(function(){'+source+';return {createPurchaseDocumentClient};})()',{URL,Promise,Error,JSON,getSecret:async()=>'',httpsRequest:()=>{throw Error('unexpected real request');}});
test('Apps Script output redirect never receives the shared secret or PDF',async()=>{
 const calls=[],client=createPurchaseDocumentClient({secret:async()=>'test-only-credential-12345678901234567890',request:async(url,options)=>{calls.push({url,options});return calls.length===1?{status:302,location:'https://script.googleusercontent.com/macros/echo?test=1'}:{status:200,body:JSON.stringify({ok:true,fileId:'generated_file_123'})};}});
 assert.equal((await client({action:'ALLOCATE',company:'NCT'})).fileId,'generated_file_123');
 assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.body,undefined);assert.equal(calls[1].options.headers,undefined);
});
test('untrusted redirect is rejected before it receives data',async()=>{
 let count=0;const client=createPurchaseDocumentClient({secret:async()=>'test-only-credential-12345678901234567890',request:async()=>{count++;return {status:302,location:'https://example.org/steal'};}});
 await assert.rejects(client({action:'ALLOCATE',company:'NCT'}),/redirect rejected/);assert.equal(count,1);
});
test('wrong PO upload receipt cannot be accepted',async()=>{
 const client=createPurchaseDocumentClient({secret:async()=>'test-only-credential-12345678901234567890',request:async()=>({status:200,body:JSON.stringify({ok:true,fileId:'generated_file_123',poId:'wrong',company:'NCT'})})});
 await assert.rejects(client({action:'UPLOAD',fileId:'generated_file_123',poId:'expected',company:'NCT'}),/does not match/);
});
