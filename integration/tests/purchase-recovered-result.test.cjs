const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),load=require('./load-master-module.cjs');
const source=fs.readFileSync(path.join(__dirname,'../backend/purchaseOperations.web.js'),'utf8'),{operationId}=load('purchaseOperationJournal.js'),requestId='11111111-1111-4111-8111-111111111111',key=operationId('NCT/PURCHASE',requestId,'MEMBER');
function endpoint(record,lock,auth=async()=>({memberId:'MEMBER'})){
 const context={webMethod:(_,fn)=>fn,Permissions:{SiteMember:1},getPurchaseStaffContext:auth,PURCHASE_COLLECTIONS:{NCT:{activity:'NCTActivity'}},operationId,store:{read:async(c,id)=>id===operationId(key,'RESULT')?record:id===operationId('NCT/PURCHASE','LOCK')?lock:null}};
 vm.runInNewContext(source.slice(source.indexOf('export const getPurchaseSaveResult=')).replace('export const getPurchaseSaveResult=','this.readResult='),context);return context.readResult;
}
test('recovered result is not reported complete while its cleanup still owns the company lock',async()=>{
 const outcome={ok:true,requestId},record={details:{recovered:true,outcome}};
 const result=await endpoint(record,{details:{owner:key}})('NCT',requestId,null);assert.equal(result.ok,false);assert.equal(result.pending,true);assert.match(result.error,/recovery is pending/);
});
test('completed recovery and ordinary original receipts are returned without touching another operation lock',async()=>{
 const outcome={ok:true,requestId};for(const lock of [null,{details:{owner:'ANOTHER'}}])assert.equal(await endpoint({details:{recovered:true,outcome}},lock)('NCT',requestId,null),outcome);
 assert.equal(await endpoint({details:{outcome}},{details:{owner:key}})('NCT',requestId,null),outcome);
});
test('missing receipts stay pending and authorization still precedes any result lookup',async()=>{
 assert.equal((await endpoint(null,null)('NCT',requestId,null)).pending,true);
 await assert.rejects(endpoint(null,null,async()=>{throw Error('Access denied');})('NCT',requestId,null),/Access denied/);
});
