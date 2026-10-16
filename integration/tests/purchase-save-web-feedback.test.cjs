const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../backend/purchaseOperations.web.js'),'utf8');
const callback=source.slice(source.indexOf('export const savePurchaseOperation='),source.indexOf('export const getSupplierProfile=')).replace('export const savePurchaseOperation=','this.save=');
function endpoint(operate,auth=async()=>({staffId:'STAFF',staffName:'LAW',memberId:'MEMBER'})){const context={webMethod:(_,fn)=>fn,Permissions:{SiteMember:1},getPurchaseStaffContext:auth,operate,console:{warn(){}}};vm.runInNewContext(callback,context);return context.save;}
test('known pre-write negative-cost rejection returns actionable feedback instead of a Wix masked exception',async()=>{const result=await endpoint(async()=>{throw Error('Net cost cannot be negative.');})('NCT','REQUEST','EDIT',{});assert.equal(result.ok,false);assert.equal(result.requestId,'REQUEST');assert.equal(result.error,'Net cost cannot be negative.');});
test('PO identity and prefix rejections return actionable feedback without exposing unknown errors',async()=>{for(const message of ['Enter the P.O. number after the company prefix.','This P.O. has saved records. Select all its tasks when changing its number.','Two purchase orders with saved records cannot be merged.']){const result=await endpoint(async()=>{throw Error(message);})('NCT','REQUEST','PO',{});assert.equal(result.ok,false);assert.equal(result.error,message);}});
test('unknown failures and authorization failures remain unconfirmed; successful saves retain their receipt',async()=>{await assert.rejects(endpoint(async()=>{throw Error('Response lost');})('NCT','REQUEST','EDIT',{}),/Response lost/);await assert.rejects(endpoint(async()=>{},async()=>{throw Error('Access denied');})('NCT','REQUEST','EDIT',{}),/Access denied/);const receipt={ok:true,requestId:'REQUEST'};assert.equal(await endpoint(async()=>receipt)('NCT','REQUEST','EDIT',{}),receipt);});

test('pre-write cost, plan and reorder validation reaches the caller with its exact cause',async()=>{
 for(const message of ['Check cost and discount values.','EA is unavailable.','Row order changed. Refresh before saving.','Row order must include every active task for this customer.','Check supplier costs and discounts.','Supplier quantity must be between 1 and 9999 cartons.','A procurement reason is required.','Confirm extra cartons and whether they are free goods or paid procurement.','Procurement plan changed. Refresh before saving; your input is retained.']){
  const result=await endpoint(async()=>{throw Error(message);})('NCT','REQUEST','PLAN',{});
  assert.equal(result.ok,false);assert.equal(result.error,message);assert.equal(result.requestId,'REQUEST');
 }
});

test('CMS instance failure is identified without exposing instance IDs or claiming no write happened',async()=>{
 for(const error of [Object.assign(Error('CMS failed'),{code:'WDE0118'}),Error('WDE0118: GridAppId PRIVATE-APP not found in instance PRIVATE-INSTANCE.')]){
  const result=await endpoint(async()=>{throw error;})('NCT','REQUEST','EDIT',{});
  assert.equal(result.ok,false);assert.equal(result.pending,true);assert.equal(result.errorCode,'WDE0118');assert.equal(result.requestId,'REQUEST');
  assert.match(result.error,/not confirmed/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-|not saved/i);
 }
});

test('errors during apply and operation lock failures still propagate for receipt reconciliation',async()=>{
 for(const message of ['Task changed while this save was pending.','Procurement plan changed while this save was pending.','A save is still processing. Refresh before retrying the same save.','Save time limit reached. Refresh and retry this same save.'])await assert.rejects(endpoint(async()=>{throw Error(message);})('NCT','REQUEST','EDIT',{}));
});

test('CMS error reading staff context gives diagnostics but cannot enter any business operation',async()=>{
 let calls=0;const result=await endpoint(async()=>{calls++;},async()=>{throw Object.assign(Error('CMS lookup failed'),{code:'WDE0118'});})('NCT','REQUEST','EDIT',{});
 assert.equal(calls,0);assert.equal(result.pending,true);assert.equal(result.errorCode,'WDE0118');
});

test('unchanged PO is a definite pre-write validation result, allowing the client to release its pending lock',async()=>{const result=await endpoint(async()=>{throw Error('P.O. number has not changed.');})('NCT','ORIGINAL-REQUEST','PO',{});assert.equal(result.ok,false);assert.equal(result.error,'P.O. number has not changed.');assert.equal(result.requestId,'ORIGINAL-REQUEST');assert.notEqual(result.pending,true);});
