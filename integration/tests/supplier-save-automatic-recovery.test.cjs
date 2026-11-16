const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname,'../..');
const source = fs.readFileSync(path.join(root,'purchase-live/app.js'),'utf8');
const browserCode = source.slice(source.indexOf('  const supplierSaveCheckDelays'),source.indexOf('  function checkSaveReceipt('));
const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pending = {ok:false,pending:true,company:'NCT',requestId,sameEmployee:true};
function page() {
  const request={type:'PURCHASE_SUPPLIER_SAVE_REQUEST',company:'NCT',requestId,supplierId:'',saveMemberId:'MEMBER-1',
    values:{companyName:'SUPPLIER TEST'}};
  const posted=[], reads=[], messages=[], handlers={}, timers=new Map(), replies=[];
  let timer=0;
  const scope={
    savePending:request,saveCheckPending:false,saveInFlight:false,saveAttemptCount:1,
    document:{hidden:false,addEventListener:(name,fn)=>{handlers[name]=fn;}},
    navigator:{onLine:true},window:{addEventListener:(name,fn)=>{handlers[name]=fn;}},
    readOperation:async(type,input)=>{
      reads.push({type,input});
      const reply=replies.shift();
      if(reply instanceof Error)throw reply;
      return reply;
    },
    showStatus:text=>messages.push(text),paintSaveTracker(){},saveButtonState(){},
    saveMessage(){scope.saveAttemptCount++;posted.push(scope.savePending);},
    finishSave(){scope.savePending=null;},
    setTimeout(fn,delay){const id=++timer;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id)
  };
  const run=vm.runInNewContext(browserCode+'\ncheckSupplierSave',scope);
  async function settle(){await new Promise(resolve=>setImmediate(resolve));}
  return {request,scope,posted,reads,timers,replies,handlers,settle,run};
}
test('a lost acknowledgement automatically retries the exact supplier save once for the verified employee',async()=>{
  const qa=page();qa.replies.push(pending,pending,{ok:true,requestId});
  qa.run(qa.request);await qa.settle();
  assert.equal(qa.posted.length,1);assert.strictEqual(qa.posted[0],qa.request);
  assert.equal(qa.reads[0].input.saveMemberId,'MEMBER-1');
  qa.run(qa.request);await qa.settle();
  assert.equal(qa.posted.length,1);
  assert.equal([...qa.timers.values()][0].delay,5000);
  [...qa.timers.values()][0].fn();await qa.settle();
  assert.equal(qa.scope.savePending,null);
});

test('rejected reads or an unverified employee never trigger an automatic supplier write',async()=>{
  const qa=page();qa.replies.push(new Error('network'),{...pending,sameEmployee:false});
  qa.run(qa.request);await qa.settle();
  [...qa.timers.values()][0].fn();await qa.settle();
  assert.equal(qa.posted.length,0);assert.strictEqual(qa.scope.savePending,qa.request);
  assert.equal([...qa.timers.values()].at(-1).delay,15000);
});

test('a hidden or offline tab keeps the draft and resumes receipt checks without employee intervention',async()=>{
  const qa=page();qa.scope.document.hidden=true;
  qa.run(qa.request);assert.equal(qa.reads.length,0);
  qa.scope.document.hidden=false;qa.scope.navigator.onLine=false;
  qa.handlers.visibilitychange();assert.equal(qa.reads.length,0);
  qa.scope.navigator.onLine=true;qa.replies.push({ok:true,requestId});
  qa.handlers.online();await qa.settle();
  assert.equal(qa.scope.savePending,null);assert.equal(qa.posted.length,0);
});

test('the Wix save and receipt entry points independently enforce the original member',async()=>{
  const source=fs.readFileSync(path.join(root,'integration/backend/purchaseOperations.web.js'),'utf8');
  const module=source.slice(source.indexOf('export const saveSupplierProfile='),source.indexOf('export const getPurchaseSaveResult='))
    + source.slice(source.indexOf('export const getPurchaseSaveResult='),source.indexOf('\n});',source.indexOf('export const getPurchaseSaveResult='))+4);
  let saves=0, reads=0;
  const guards=vm.runInNewContext(module.replaceAll('export const','const')+'\n({saveSupplierProfile,getPurchaseSaveResult})',{
    webMethod:(_,handler)=>handler,Permissions:{SiteMember:1},
    getPurchaseStaffContext:async()=>({memberId:'MEMBER-1'}),
    suppliers:{save:async()=>{saves++;return {ok:true};}},
    PURCHASE_COLLECTIONS:{NCT:{activity:'ACTIVITY'}},operationId:()=> 'KEY',
    store:{read:async()=>{reads++;return null;}}
  });
  assert.equal((await guards.saveSupplierProfile(requestId,'','',{},'MEMBER-2')).ok,false);
  assert.equal((await guards.getPurchaseSaveResult('NCT',requestId,'','MEMBER-2')).sameEmployee,undefined);
  assert.equal(saves,0);assert.equal(reads,0);
  assert.equal((await guards.getPurchaseSaveResult('NCT',requestId,'','MEMBER-1')).sameEmployee,true);
  assert.equal((await guards.saveSupplierProfile(requestId,'','',{},'MEMBER-1')).ok,true);
  assert.equal((await guards.saveSupplierProfile(requestId,'','',{})).ok,true);
});
