const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup,request}=require('../prototypes/cms-read-review-20261103/read-growth-contract.cjs');
const load=require('./load-master-module.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const file=path.join(__dirname,'../backend/warehouseReceiving.web.js');
const rid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
function api(f,{old=false,denied=false,failedCollection='',pointbase}={}){
 const calls={preparation:0,cbm:0,queries:[],writes:[]};
 const query=collection=>{let filters=[],size=1000;const q={eq(k,v){filters.push(r=>r[k]===v);return q;},limit(n){size=n;return q;},async find(options){
  assert.equal(options.consistentRead,true);assert.equal(options.suppressAuth,true);if(collection===failedCollection)throw Error('CMS_READ_FAILED');
  const rows=[...f.rows].filter(([key,r])=>key.startsWith(collection+'/')&&filters.every(fn=>fn(r))).map(([,r])=>copy(r));
  const page=start=>{const items=rows.slice(start,start+size);calls.queries.push({collection,rows:items.length});return {items,hasNext:()=>start+size<rows.length,next:async()=>page(start+size)};};return page(0);
 }};return q;};
 const bindings=Object.assign({},...['purchasePlan.js','warehouseReceiving.js','purchaseProjection.js','purchaseOrderWorkflow.js','warehouseCustomerReadiness.js','warehousePreparation.js','warehouseCbm.js','warehouseDeliveryView.js'].map(name=>load(name)));
 const preparation=bindings.projectPreparation,cbm=bindings.warehouseCbm;
 bindings.projectPreparation=(...args)=>{calls.preparation++;return preparation(...args);};
 bindings.warehouseCbm=(...args)=>{calls.cbm++;return cbm(...args);};
 const wixData={query};for(const method of ['insert','remove'])wixData[method]=async(...args)=>{calls.writes.push(method);return f.store[method](...args);};
 let source=fs.readFileSync(file,'utf8');if(old)source=source.replace('readWarehouseData(company,staff,false)','readWarehouseData(company,staff)');
 source=source.replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');
 const exports=vm.runInNewContext(source+'\n({getWarehouseOrders,saveWarehouseReceipt,captureWarehouseCbm,readOrders});',{
  ...bindings,webMethod:(_p,fn)=>fn,Permissions:{SiteMember:1},wixData,
  currentMember:{getMember:async()=>denied?null:{_id:'MEMBER',loginEmail:'warehouse@example.test',status:'APPROVED'}},
  readCustomerShortNames:async ids=>ids.map(customerId=>({customerId,shortName:'CUSTOMER SHORT'})),
  capturePointbaseCosts:pointbase||(async()=>{throw Error('UNEXPECTED_POINTBASE_READ');}),requestPurchaseDocument:async()=>{throw Error('UNEXPECTED_FILE_WRITE');}
 });return {exports,calls};
}
async function seed({placed=true}={}){
 const f=setup();f.rows.set('StaffMasterAccess/STF',{title:'STF',description:'MEMBER',staffEmail:'warehouse@example.test',staffName:'LAW',staffStatus:'ACTIVE',role:'SUPER ADMIN'});
 await f.operate(request(f,1));if(placed)await f.operate({...f.base,requestId:rid(2),operation:'PO',input:{taskIds:[f.id,f.second],versions:f.versions(),poNumber:'NCT-TEST-MERGED'}});
 return f;
}
const stable=row=>{const value=copy(row);delete value.readAt;return value;};
async function equivalent(f,company='NCT'){
 const before=copy([...f.rows]),prior=api(f,{old:true}),current=api(f),a=await prior.exports.getWarehouseOrders(company),b=await current.exports.getWarehouseOrders(company);
 assert.deepEqual(stable(b),stable(a));assert.deepEqual(copy([...f.rows]),before);assert.equal(current.calls.writes.length,0);
 assert.equal(prior.calls.preparation,1);assert.equal(current.calls.preparation,0);assert.equal(current.calls.cbm,0);
 assert.deepEqual(current.calls.queries,prior.calls.queries);return {prior,current,result:b};
}
test('unplaced tasks: identical complete response without computing discarded preparation',async()=>{const f=await seed({placed:false}),r=await equivalent(f);assert.equal(r.result.orders.length,0);assert.equal(r.prior.calls.cbm,2);});
test('merged PO: same members, quantities, version and financial-field whitelist',async()=>{const f=await seed(),{result}=await equivalent(f);assert.equal(result.orders.length,1);assert.equal(result.orders[0].lines.length,2);assert.deepEqual(copy(result.deliveryTasks),[]);assert.ok(!JSON.stringify(result).includes('netCost'));assert.ok(!JSON.stringify(result).includes('lpCtn'));});
test('two receipts and repeated save: complete response retained and quantities counted once',async()=>{
 const f=await seed(),a=api(f);let orders=await a.exports.readOrders('NCT',f.base.staff);
 const first={id:orders[0].id,version:orders[0].version,action:'RECEIVE',lines:[{taskId:f.id,accepted:170,rejected:0,kind:'PARTIAL',reason:'Second delivery pending'}]};
 await a.exports.saveWarehouseReceipt('NCT',rid(3),first);await a.exports.saveWarehouseReceipt('NCT',rid(3),first);
 await equivalent(f);orders=await a.exports.readOrders('NCT',f.base.staff);
 await a.exports.saveWarehouseReceipt('NCT',rid(4),{...first,version:orders[0].version,lines:[{...first.lines[0],accepted:30,kind:'DELIVERY',reason:''}]});
 const {result}=await equivalent(f);assert.equal(result.orders[0].lines.find(x=>x.taskId===f.id).accepted,200);assert.equal(result.orders[0].history.length,2);assert.ok(a.calls.preparation>0,'receipt read path still runs its original preparation');
});
test('incomplete merged PO keeps pending flag and blocks receipt before any write',async()=>{
 const f=await seed({placed:false}),update=f.store.update;f.store.update=async(c,row)=>{if(c==='NCTTasks'&&row._id===f.second)throw Error('INTERRUPTED');return update(c,row);};
 await assert.rejects(f.operate({...f.base,requestId:rid(2),operation:'PO',input:{taskIds:[f.id,f.second],versions:f.versions(),poNumber:'NCT-PENDING'}}),/INTERRUPTED/);f.store.update=update;
 const {result,current}=await equivalent(f),p=result.orders[0];assert.equal(p.procurementSavePending,true);
 const before=copy([...f.rows]),reply=await current.exports.saveWarehouseReceipt('NCT',rid(3),{id:p.id,version:p.version,action:'RECEIVE',lines:[{taskId:f.id,accepted:10,rejected:0,kind:'PARTIAL',reason:'Offline test'}]});
 assert.equal(reply.ok,false);assert.match(reply.error,/save pending/);assert.deepEqual(copy([...f.rows]),before);
});
test('CBM capture retains full preparation and existing CBM without new facts',async()=>{
 const f=await seed();f.rows.get('NCTOrders/O0').cbmCtn=0.02;
 const a=api(f),before=copy([...f.rows]),result=await a.exports.captureWarehouseCbm('NCT',rid(5),f.id);
 assert.equal(result.ok,true);assert.equal(result.retained,true);assert.equal(result.cbmPerCtn,0.02);assert.equal(a.calls.preparation,1);assert.equal(a.calls.cbm,2);assert.deepEqual(copy([...f.rows]),before);
});
test('missing CBM still captures once through the unchanged full reader',async()=>{
 const f=await seed(),a=api(f,{pointbase:async()=>({B0:{unitBarcode:'B0',cbmPerCtn:0.025,capturedAt:'2026-11-04T00:00:00Z',source:{sheetName:'FOOD',row:3},costIssues:[]}})});
 const first=await a.exports.captureWarehouseCbm('NCT',rid(5),f.id),again=await a.exports.captureWarehouseCbm('NCT',rid(5),f.id);
 assert.equal(first.cbmPerCtn,0.025);assert.equal(again.retained,true);assert.equal(a.calls.writes.length,1);assert.equal(a.calls.preparation,4);
 await equivalent(f);
});
test('read failure is not converted to an empty successful list',async()=>{const f=await seed();for(const old of [true,false])await assert.rejects(api(f,{old,failedCollection:'NCTActivity'}).exports.getWarehouseOrders('NCT'),/CMS_READ_FAILED/);});
test('denied identity still stops before business collections',async()=>{const f=await seed(),a=api(f,{denied:true});await assert.rejects(a.exports.getWarehouseOrders('NCT'),/sign in/);assert.ok(a.calls.queries.every(q=>q.collection==='StaffMasterAccess'));assert.equal(a.calls.preparation,0);});
test('GHR and invalid company retain existing isolation',async()=>{const f=await seed(),r=await equivalent(f,'GHR');assert.equal(r.result.orders.length,0);assert.ok(!r.current.calls.queries.some(q=>['NCTOrders','NCTTasks','NCTActivity'].includes(q.collection)));await assert.rejects(r.current.exports.getWarehouseOrders('OTHER'),/Select NCT or GHR/);});
test('2,005 unrelated historical records: all pages retained, no new queries or writes',async()=>{const f=await seed();for(let i=0;i<2005;i++)f.rows.set('NCTActivity/H'+i,{title:'H'+i,action:'UNRELATED',result:'SAVED',activityTime:'2020-01-01'});const r=await equivalent(f);assert.equal(r.current.calls.queries.filter(q=>q.collection==='NCTActivity').length,3);assert.equal(r.result.orders.length,1);});
