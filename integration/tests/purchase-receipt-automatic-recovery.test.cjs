const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../purchase-live/app.js'),'utf8');
const start=source.indexOf('  const purchaseConfirmingText');
const end=source.indexOf('  function saveMessage',start);

function fixture(action='REQUEST_PAYMENT'){
  const original={type:'PURCHASE_ORDER_SAVE_REQUEST',company:'NCT',requestId:'original',input:{action}};
  const reads=[],replies=[],completed=[],handlers={},timers=new Map();
  let next=0;
  const context={
    savePending:original,saveInFlight:false,saveCheckPending:false,saveIssue:'',
    document:{hidden:false,addEventListener:(name,listener)=>{handlers[name]=listener;}},
    navigator:{onLine:true},window:{addEventListener:(name,listener)=>{handlers[name]=listener;}},
    setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},
    clearTimeout:id=>timers.delete(id),
    saveButtonState(){},paintSaveTracker(){},showStatus(){},saveDiagnostic:(_,text)=>text,
    async readOperation(type,payload){
      reads.push({type,payload});
      const reply=replies.shift();
      if(reply instanceof Error)throw reply;
      return reply;
    },
    finishSave(result){completed.push(result);context.savePending=null;},
    saveMessage(){assert.fail('A receipt lookup must not submit another write');}
  };
  const controller=vm.runInNewContext(source.slice(start,end)+'\n({checkSaveReceipt, exhausted:()=>purchaseSaveCheck?.exhausted})',context);
  const ready=()=>new Promise(resolve=>setImmediate(resolve));
  function tick(){
    const entry=timers.entries().next().value;
    assert.ok(entry,'Expected a scheduled status check');
    const [id,{fn,delay}]=entry;
    timers.delete(id);
    fn();
    return delay;
  }
  return {context,original,reads,replies,completed,handlers,timers,controller,ready,tick};
}
const receipt={ok:true,company:'NCT',requestId:'original'};

test('a network error, foreign company and stale receipt cannot complete a PO; the matching receipt completes without a write',async()=>{
  const page=fixture();
  page.replies.push(new Error('connection lost'),{...receipt,company:'GHR'},{...receipt,requestId:'stale'},receipt);
  page.controller.checkSaveReceipt(page.original);
  await page.ready();
  for(const delay of [5000,15000,45000]){
    assert.equal(page.completed.length,0);
    assert.equal(page.tick(),delay);
    await page.ready();
  }
  assert.equal(page.completed.length,1);
  assert.equal(page.context.savePending,null);
  assert.equal(page.timers.size,0);
  assert.equal(page.reads.length,4);
  for(const read of page.reads){
    assert.equal(read.type,'PURCHASE_SAVE_CHECK_REQUEST');
    assert.equal(read.payload.saveRequestId,page.original.requestId);
    assert.equal(read.payload.supplierId,null);
  }
});

test('reconnect resumes the original operation; visibility events cannot duplicate an active lookup',async()=>{
  const page=fixture('DOCUMENT');
  page.context.document.hidden=true;
  page.controller.checkSaveReceipt(page.original);
  assert.equal(page.reads.length,0);
  page.context.document.hidden=false;
  page.context.navigator.onLine=false;
  page.handlers.visibilitychange();
  assert.equal(page.reads.length,0);
  page.replies.push(receipt);
  page.context.navigator.onLine=true;
  page.handlers.online();
  page.handlers.visibilitychange();
  await page.ready();
  assert.equal(page.reads.length,1);
  assert.equal(page.completed.length,1);
});

test('missing receipts leave input retained with bounded polling and reconnect can still recover',async()=>{
  const page=fixture();
  page.controller.checkSaveReceipt(page.original);
  await page.ready();
  for(const delay of [5000,15000,45000,120000]){
    assert.equal(page.controller.exhausted(),false);
    assert.equal(page.tick(),delay);
    await page.ready();
  }
  assert.equal(page.controller.exhausted(),true);
  assert.equal(page.timers.size,0);
  assert.strictEqual(page.context.savePending,page.original);
  page.replies.push(receipt);
  page.handlers.online();
  await page.ready();
  assert.equal(page.completed.length,1);
});
