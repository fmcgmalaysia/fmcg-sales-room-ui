const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const folder=path.join(__dirname,'../prototypes/stock-current-state'),root=path.resolve(__dirname,'../..'),copy=value=>JSON.parse(JSON.stringify(value));
const meta={schema:'CURRENT_STOCK_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:3,stockIdentity:{staffId:'S',memberId:'SOURCE_SALES/S'}};
function fixture(){
 const calls=[],order={orderId:'O',customerId:'C',destination:'NCT',submittedAt:'2026-10-20',customerPoNumber:'PO',revision:4,masterReceipt:{submissionId:'SUB'}};
 let response={ok:true,requestId:'11111111-1111-4111-8111-111111111111',company:'NCT',orderId:'O',customerId:'C',date:'2026-11-01',revision:'R',stockGeneration:4},authorized=true,customer=true;
 const original=fs.readFileSync(path.join(folder,'source-onboarding.candidate.js'),'utf8'),start=original.indexOf('export const saveSalesRoomOrderPlanning = webMethod('),end=original.indexOf('\nasync function withSalesOrderMutation(',start);
 assert.ok(start>=0&&end>start);
 const save=vm.runInNewContext(original.slice(start,end).replace('export const','const')+';saveSalesRoomOrderPlanning;',{Permissions:{SiteMember:'ORIGINAL'},webMethod:(permission,method)=>{assert.equal(permission,'ORIGINAL');return method;},
  requireAuthorizedStaffContext:async()=>{calls.push('STAFF');if(!authorized)throw Error('Original staff denied');return{staffId:'S',staffName:'Sales'};},
  normalize:value=>String(value??'').trim(),normalizeEmail:value=>String(value??'').trim().toLowerCase(),upper:value=>String(value??'').trim().toUpperCase(),quantity:Number,
  withSalesOrderMutation:async(orderId,staff,action)=>{calls.push('SOURCE_ORDER_LOCK');assert.equal(orderId,'O');assert.equal(staff.staffId,'S');return action({data:copy(order),record:{title:'ORIGINAL_SOURCE_ORDER'}});},
  BUYER_ORDER_AUDIT_COLLECTION:'AUDIT',BUYER_ORDER_COLLECTION:'ORDER',readAllPayloadRows:async()=>[],
  findAuthorizedCustomer:async(customerId,staff)=>{calls.push('CUSTOMER');if(!customer)throw Error('Original customer denied');assert.equal(customerId,'C');assert.equal(staff.staffId,'S');return{companyName:'Customer'};},
  requestMasterFulfilment:async request=>{calls.push(copy(request));return copy(response);},
  putPayload:async()=>{calls.push('SOURCE_WRITE');},console});
 const args=['O','PO','2026-11-01',4,'11111111-1111-4111-8111-111111111111','BEFORE'];
 return{save,args,calls,order,setResponse:value=>response=value,denyStaff:()=>authorized=false,denyCustomer:()=>customer=false,response:()=>copy(response)};
}
test('Source parent forwards optional current metadata only through original existing planning method; generator exact',()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-source-date-transport.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const original=fs.readFileSync(path.join(root,'sales-room/wix/sales-room-page.js'),'utf8').replace(/\r\n/g,'\n'),candidate=fs.readFileSync(path.join(folder,'source-sales-room-page.candidate.js'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(candidate.replace("message.requestId || '', message.expectedShipmentRevision, message.stockCurrent);","message.requestId || '', message.expectedShipmentRevision);"),original);
 const backend=fs.readFileSync(path.join(folder,'source-onboarding.candidate.js'),'utf8'),prior=fs.readFileSync(path.join(root,'sales-room/wix/onboarding.web.js'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(backend.slice(0,backend.indexOf('export const saveSalesRoomOrderPlanning')),prior.slice(0,prior.indexOf('export const saveSalesRoomOrderPlanning')));
 assert.equal(backend.slice(backend.indexOf('\nasync function withSalesOrderMutation')),prior.slice(prior.indexOf('\nasync function withSalesOrderMutation')));
});
test('original source staff/customer/PO/revision/date guards run before optional current forwarding, with no Source business write',async()=>{
 const f=fixture(),reply=await f.save(...f.args,meta);assert.equal(reply.ok,true);assert.equal(reply.stockGeneration,4);assert.equal(reply.company,'NCT');assert.equal(reply.shipmentDateRevision,'R');
 const sent=f.calls.find(value=>typeof value==='object');assert.deepEqual(sent.input.stockCurrent,meta);assert.equal(sent.input.orderId,'O');assert.equal(sent.input.submissionId,'SUB');assert.equal(sent.input.version,'BEFORE');
 assert.deepEqual(f.calls.filter(value=>typeof value==='string'),['STAFF','SOURCE_ORDER_LOCK','CUSTOMER']);
 for(const fail of ['staff','customer','revision','po','date']){const g=fixture();if(fail==='staff')g.denyStaff();if(fail==='customer')g.denyCustomer();if(fail==='revision')g.args[3]=2;if(fail==='po')g.args[1]='OTHER';if(fail==='date')g.args[2]='2026-02-30';
  await assert.rejects(g.save(...g.args,meta));assert.equal(g.calls.some(value=>typeof value==='object'),false);assert.equal(g.calls.includes('SOURCE_WRITE'),false);}
});
test('only exact bounded current continuation is returned, never mislabeled as successful date save',async()=>{
 for(const phase of ['BEFORE','APPLY','VERIFY']){const f=fixture();f.setResponse({ok:false,pending:true,requestId:f.args[4],phase,completedCount:1,totalRecords:2});const result=await f.save(...f.args,meta);
  assert.equal(result.ok,false);assert.equal(result.pending,true);assert.equal(result.phase,phase);assert.equal(result.requestId,f.args[4]);assert.equal(result.company,'NCT');assert.equal(result.orderId,'O');assert.equal(result.shipmentDateRevision,undefined);}
 for(const bad of [{ok:false,pending:true,requestId:'OTHER',phase:'APPLY',completedCount:1,totalRecords:2},{ok:false,pending:true,requestId:'11111111-1111-4111-8111-111111111111',phase:'APPLY',completedCount:3,totalRecords:2},{}]){const f=fixture();f.setResponse(bad);await assert.rejects(f.save(...f.args,meta),/not confirmed/);}
});
test('current final receipt requires original identity/date/revision plus advanced generation; unknown final never succeeds',async()=>{
 for(const change of [{company:'GHR'},{orderId:'OTHER'},{customerId:'OTHER'},{requestId:'OTHER'},{date:'2026-11-02'},{revision:''},{stockGeneration:3},{stockGeneration:undefined}]){const f=fixture();f.setResponse({...f.response(),...change});await assert.rejects(f.save(...f.args,meta),/not confirmed/);}
});
test('original six-argument routed save and pre-transfer Source planning stay unchanged when no current metadata',async()=>{
 const f=fixture();const final=f.response();delete final.stockGeneration;f.setResponse(final);assert.deepEqual(copy(await f.save(...f.args)),{ok:true,orderId:'O',message:'Shipment date saved.',shipmentDateRevision:'R'});
 assert.equal(f.calls.find(value=>typeof value==='object').input.stockCurrent,undefined);
 const pre=fixture();Object.assign(pre.order,{destination:'',submittedAt:'',status:'CONFIRMED',estimatedShipmentDate:'2026-10-20'});const reply=await pre.save(...pre.args);
 assert.equal(reply.ok,true);assert.equal(pre.calls.filter(value=>value==='SOURCE_WRITE').length,2);assert.equal(pre.calls.some(value=>typeof value==='object'),false);
});
