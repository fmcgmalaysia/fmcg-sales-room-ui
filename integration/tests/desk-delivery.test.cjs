const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const {createSupportDeskOperations,readSupportDesks}=load('supportDesk.js'),{createPackingListOperations,packingVersion}=load('packingListOperations.js'),{projectDeskDeliverySummaries,pendingDeskAuthorizations}=load('deskDelivery.js');
async function setup(){
 const f=fixture(),deskSave=createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'},GHR:{activity:'G'}},readContext:f.context,now:()=>new Date('2026-10-29T06:00:00Z')});
 const deskState=async()=>readSupportDesks((await f.context()).activity,'NCT').find(row=>row.customerId==='CUSTOMER-A');
 const assign=async(desk,revision)=>{if(revision===undefined)revision=(await deskState())?.revision||'';return deskSave({company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'},requestId:f.nextId(),input:{action:'DESK_ASSIGN',customerId:'CUSTOMER-A',desk,taskId:'A',revision}});};
 await assign(1);
 const request=async(input,department='SUPPORT')=>({company:'NCT',staff:{...f.staff,packingDepartment:department},requestId:f.nextId(),input:{version:packingVersion(await f.packingContext('NCT')),...input}});
 const sendRequest=async()=>request({action:'DESK_SEND',customerId:'CUSTOMER-A',desk:1,deskRevision:(await deskState()).revision,lines:[{taskId:'A',quantity:100}]});
 const send=async()=>f.packingSave(await sendRequest());
 const loadRequest=async(list,loaded,extra={})=>request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'A',loaded,reasonCodes:loaded===100?[]:['INSUFFICIENT'],...extra},'WAREHOUSE');
 return {...f,deskSave,deskState,assign,request,sendRequest,send,loadRequest};
}
test('only current allocated Desk members become one authorized task, without physical outflow',async()=>{
 const f=await setup(),request=await f.sendRequest(),first=await f.packingSave(request),again=await f.packingSave(request);
 assert.equal(first.list.desk.number,1);assert.deepEqual(Array.from(first.list.lines,l=>l.taskId),['A']);assert.equal(first.list.status,'SENT');assert.equal(first.id,again.id);assert(first.deskState.revision);assert.equal((await f.stock()).onHand,150);
 assert.equal((await f.packingContext('NCT')).lists.length,1);await assert.rejects(f.assign(2),/authorized to Warehouse/);
});
test('stale Desk, stale displayed allocation, wrong department and wrong company cannot send',async()=>{
 const f=await setup(),request=await f.sendRequest();
 await assert.rejects(f.packingSave({...request,input:{...request.input,deskRevision:''}}),/classification changed/);
 await assert.rejects(f.packingSave({...request,input:{...request.input,lines:[{taskId:'A',quantity:101}]}}),/allocation changed/);
 await assert.rejects(f.packingSave({...request,staff:{...request.staff,packingDepartment:'WAREHOUSE'}}),/requires Support/);
 await assert.rejects(f.packingSave({...request,company:'GHR'}),/classification changed/);
 assert.equal((await f.packingContext('NCT')).lists.length,0);
});
test('Desk task movement and authorization share one deterministic successor, admitting exactly one',async()=>{
 const f=await setup(),request=await f.sendRequest(),revision=(await f.deskState()).revision;
 const results=await Promise.allSettled([f.packingSave(request),f.assign(2,revision)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const lists=(await f.packingContext('NCT')).lists,state=await f.deskState();if(lists.length){assert.equal(state.assignments[0].desk,1);assert.equal(lists[0].desk.number,1);}else assert.equal(state.assignments[0].desk,2);
});
test('lost send acknowledgement resumes the original task and returns the confirmed Desk receipt',async()=>{
 const f=await setup(),request=await f.sendRequest();f.lose('SUPPORT_PACKING_LIST_CURRENT');await assert.rejects(f.packingSave(request),/lost acknowledgement/);
 const result=await f.packingSave(request);assert.equal(result.list.status,'SENT');assert(result.deskState?.revision);assert.equal((await f.packingContext('NCT')).lists.length,1);assert.equal((await f.stock()).onHand,150);
});
test('one line confirmation starts/completes the task and deducts Loaded once; repeated result is identical',async()=>{
 const f=await setup(),sent=await f.send(),request=await f.loadRequest(sent.list,80),first=await f.packingSave(request),again=await f.packingSave(request);
 assert.equal(first.list.lines[0].loaded,80);assert.equal(first.list.status,'COMPLETED');assert.equal(first.revision,again.revision);assert.equal((await f.stock()).onHand,70);
 const summary=projectDeskDeliverySummaries((await f.context()).activity)[0];assert.equal(summary.loadedQty,80);assert.equal(summary.difference,20);assert.equal(summary.issue,true);
 const complete=await f.packingSave(await f.loadRequest(first.list,100));assert.equal(complete.list.lines[0].loaded,100);assert.equal((await f.stock()).onHand,50);assert.equal(projectDeskDeliverySummaries((await f.context()).activity)[0].issue,false);
});
test('Warehouse cannot exceed allocation, reduce confirmed Loaded, spoof Support, or omit shortfall reasons',async()=>{
 const f=await setup(),sent=await f.send();await assert.rejects(f.packingSave(await f.loadRequest(sent.list,101)),/within authorized/);
 await assert.rejects(f.packingSave(await f.loadRequest(sent.list,80,{reasonCodes:[]})),/select a reason/);
 const request=await f.loadRequest(sent.list,80);await assert.rejects(f.packingSave({...request,staff:{...request.staff,packingDepartment:'SUPPORT'}}),/requires Warehouse/);
 const loaded=await f.packingSave(request);await assert.rejects(f.packingSave(await f.loadRequest(loaded.list,60)),/cannot reduce/);assert.equal((await f.stock()).onHand,70);
});
test('confirmed zero is an actual shortfall receipt, not the allocated default and not an outflow',async()=>{
 const f=await setup(),sent=await f.send(),loaded=await f.packingSave(await f.loadRequest(sent.list,0));assert(loaded.list.lines[0].loadedConfirmedAt);assert.equal((await f.stock()).onHand,150);assert.equal(projectDeskDeliverySummaries((await f.context()).activity)[0].difference,100);
});
test('photo failure cannot commit Loaded; original request retries one file and one physical outflow',async()=>{
 const f=await setup(),sent=await f.send(),bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]),photo={mimeType:'image/png',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};let allocations=0,uploads=0;
 const save=createPackingListOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.packingContext,documentService:async input=>{if(input.action==='ALLOCATE'){allocations++;return {fileId:'PHOTO-1'};}uploads++;if(uploads===1)throw Error('Synthetic photo interruption');return {...input,ok:true};}});
 const request=await f.loadRequest(sent.list,80,{photos:[photo],reasonCodes:['DAMAGED']});await assert.rejects(save(request),/photo interruption/);assert.equal((await f.stock()).onHand,150);
 const result=await save(request);await save(request);assert.equal((await f.stock()).onHand,70);assert.equal(allocations,1);assert.equal(uploads,2);assert.equal(result.list.lines[0].photos.length,1);assert(!JSON.stringify([...f.records.values()]).includes(photo.base64));
});
test('Support can recall zero-loaded authorization, preserving evidence, but cannot recall an actual outflow',async()=>{
 const f=await setup(),sent=await f.send(),cancelled=await f.packingSave(await f.request({action:'DESK_RECALL',id:sent.id,revision:sent.revision,reason:'Not required yet'}));assert.equal(cancelled.status,'CANCELLED');await f.assign(2);assert.equal((await f.stock()).onHand,150);
 const g=await setup(),other=await g.send(),loaded=await g.packingSave(await g.loadRequest(other.list,80));await assert.rejects(g.packingSave(await g.request({action:'DESK_RECALL',id:loaded.id,revision:loaded.revision,reason:'Cancel'})),/zero Loaded/);
});
test('production service rejects standalone CREATE and only returns Desk-authorized execution records',async()=>{
 const f=await setup(),source=fs.readFileSync(path.join(__dirname,'../backend/packingListService.js'),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''),context=await f.packingContext('NCT');
 const api=vm.runInNewContext('(function(){'+source+';return {savePackingOperation,readPackingWorkroom};})()', {fulfilmentStore:f.store,readFulfilmentContext:f.context,PURCHASE_COLLECTIONS:{NCT:{activity:'N'}},createPackingListOperations,projectPackingContext:()=>context,projectPackingWorkroom:load('packingListOperations.js').projectPackingWorkroom,projectDeskDeliverySummaries,pendingDeskAuthorizations,readSupportDesks,...load('warehouseDeliveryView.js'),requestPurchaseDocument:async()=>{throw Error('External call forbidden');}});
 await assert.rejects(api.savePackingOperation(await f.request({action:'CREATE'})),/standalone Packing List is retired/);const result=await api.readPackingWorkroom('NCT',{...f.staff,packingDepartment:'WAREHOUSE'});assert.equal(result.deskDeliveryVersion,2);assert.equal(result.lists.length,0);
});
test('an interrupted Desk authorization restores only its owner and original digest after the window is lost',async()=>{
 const f=await setup(),request=await f.sendRequest(),insert=f.store.insert;let fail=true;f.store.insert=async(collection,row)=>{if(fail&&row.action==='SUPPORT_PACKING_LIST_CURRENT'){fail=false;throw Error('Synthetic interruption before current');}return insert(collection,row);};
 await assert.rejects(f.packingSave(request),/interruption before current/);const activity=(await f.context()).activity,pending=pendingDeskAuthorizations(activity,'NCT',f.staff.memberId);assert.equal(pending.length,1);assert.equal(pending[0].requestId,request.requestId);assert.equal(pendingDeskAuthorizations(activity,'NCT','OTHER-EMPLOYEE').length,0);const recovered=await f.packingSave({...request,input:pending[0].input});assert(recovered.list);assert.equal(pendingDeskAuthorizations((await f.context()).activity,'NCT',f.staff.memberId).length,0);assert.equal((await f.stock()).onHand,150);
});
