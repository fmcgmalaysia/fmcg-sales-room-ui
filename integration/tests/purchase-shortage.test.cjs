const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createShortageOperations,readShortage,shortageVersion}=load('purchaseShortage.js');
function fixture(){
 const records=new Map(),row={id:'T',orderId:'O',sourceLineId:'L',editVersion:'V',ord:100,inc:90,po:'PO',supplierId:'S',warehouse:{accepted:90,issue:true},procurement:{revision:'P'}};
 const store={all:async()=>[...records.values()],read:async(c,id)=>records.get(id)||null,insert:async(c,event)=>{if(records.has(event._id))throw Error('duplicate');records.set(event._id,event);return event;},remove:async(c,id)=>records.delete(id)};
 const save=createShortageOperations({store,names:{NCT:{activity:'Activity'}},readWorkspace:async()=>({tasks:[row]})});
 const base={company:'NCT',staff:{memberId:'M',staffId:'P',staffName:'LAW'},requestId:'11111111-1111-4111-8111-111111111111'};
 const input=()=>({action:'SHORTAGE',taskId:'T',version:shortageVersion(row,[...records.values()]),customerDecision:'STOP',supplierDecision:'CREDIT',reason:'Supplier credit next purchase',customerMessage:'90 cartons available; no further delivery',financeRequired:true});
 return {records,row,save,base,input};
}
test('stop waiting retains original demand and records persistent supplier financial responsibility',async()=>{
 const f=fixture(),input=f.input();await f.save({...f.base,input});await f.save({...f.base,input});let state=readShortage('T',[...f.records.values()]);
 assert.equal(state.customerDecision,'STOP');assert.equal(state.financeRequired,true);assert.equal(state.shortCtn,10);assert.equal(state.by,'LAW');assert.equal(f.row.ord,100);
 f.row.warehouse.issue=false;const next={...f.input(),supplierDecision:'PENDING',financeRequired:false};await f.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:next});
 state=readShortage('T',[...f.records.values()]);assert.equal(state.financeRequired,true);
});
test('replenishment requires valid date, customer update is mandatory, and stale quantities reject',async()=>{
 for(const patch of [{customerDecision:'WAIT'},{supplierDecision:'REPLENISH',expectedDate:'2026-02-30'},{customerMessage:''},{version:'old'}]){
  const f=fixture();await assert.rejects(f.save({...f.base,input:{...f.input(),...patch}}));assert.equal(readShortage('T',[...f.records.values()]),null);
 }
});
