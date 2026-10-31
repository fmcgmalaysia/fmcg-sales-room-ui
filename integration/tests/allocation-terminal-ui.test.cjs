const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const app=require('../prototypes/purchase-quantity-style-20261031/stage.cjs').plan().assets.get('purchase-live/app.js').toString();
const start=app.indexOf("  window.addEventListener('message',event=>{const message=event.data||{};if(event.source!==window.parent||message.type!=='PURCHASE_SAVE_RESULT'"),end=app.indexOf('  function saveEdits()',start);
assert(start>=0&&end>start);const source=app.slice(start,end);
function run(result){let handler,rejected,checks=0,successes=0;const parent={},field={textContent:''},company={disabled:true};
 const sandbox={window:{parent,addEventListener:(name,fn)=>{handler=fn;}},savePending:{type:'PURCHASE_SAVE_REQUEST',operation:'ALLOCATE',company:'NCT',requestId:'SAVE'},saveAttemptCount:2,saveDialog:null,saveOrigin:{},saveIssue:'',saveInFlight:true,draftConflict:false,sequenceDraft:null,view:'active',company:'NCT',document:{querySelector:s=>s==='#dialogError'?field:company},allocationUi:()=>({rejected:(request,error,terminal)=>{rejected={request,error,terminal};}}),saveDiagnostic:(request,error)=>error,showStatus:()=>{},saveButtonState:()=>{},freezeDialog:()=>{},migrateRowOrder:()=>{},cacheDraft:()=>{},paintSaveTracker:()=>{},checkSaveReceipt:()=>{checks++;},finishSave:()=>{successes++;}};
 vm.runInNewContext(source,sandbox);handler({source:parent,data:{type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:'SAVE',ok:false,result,error:result.error}});return {sandbox,rejected,checks,successes,field,company};
}
test('current deployed failure handler unlocks terminal stale allocation without success feedback',()=>{
 const r=run({ok:false,retryable:false,requestId:'SAVE',error:'Stock or allocations changed while saving. Review current stock before making a new allocation.'});
 assert.equal(r.sandbox.savePending,null);assert.equal(r.company.disabled,false);assert.equal(r.rejected.terminal,true);assert.equal(r.checks,0);assert.equal(r.successes,0);assert.match(r.field.textContent,/Review current stock/);
});
test('genuinely unknown processing remains pending on the same original request',()=>{
 const r=run({ok:false,pending:true,requestId:'SAVE',error:'A save is still processing.'});assert.equal(r.sandbox.savePending.requestId,'SAVE');assert.equal(r.rejected.terminal,false);assert.equal(r.checks,1);assert.equal(r.successes,0);
});
