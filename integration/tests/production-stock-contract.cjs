// Test-only reuse of real production workflow fixtures. Retired prototype
// assumptions are tested as refusals, followed by these positive current paths.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),load=require('./load-master-module.cjs');
function extract(file,name){const filename=path.join(__dirname,file),source=fs.readFileSync(filename,'utf8').replace(/const test\s*=\s*require\('node:test'\)/,'const test=()=>{}');return vm.runInNewContext(source+';'+name,{require:createRequire(filename),__dirname,Map,Buffer,Date});}
const prep=()=>extract('warehouse-preparation.test.cjs','fixture')();
const {projectPreparation}=load('warehousePreparation.js'),{physicalOutflowQuantity}=load('physicalOutflow.js');
const shipped=async f=>physicalOutflowQuantity((await f.context()).activity,{taskId:'T'});
async function loaded(){
 const f=prep();await f.call({action:'PACK'});await f.call({action:'UNPACK',note:'Before loading'});assert.equal(await shipped(f),0);
 await f.call({action:'PACK'});await f.call({action:'LOAD',loaded:40,note:'Partial'});assert.equal(await shipped(f),40);
 const row=projectPreparation(await f.context())[0],request={company:'NCT',staff:f.staff,requestId:'dddddddd-1111-4111-8111-111111111111',input:{action:'LOAD',id:row.id,version:row.version,loaded:60,note:'Second batch'}};
 await f.save(request);await f.save(request);assert.equal(await shipped(f),60);assert.equal((await f.context()).tasks[0].warehouse.stock.availablePhysical,40);
 await assert.rejects(f.call({action:'LOAD',loaded:0,note:'Attempted reversal'}),/supervised correction/);
 await assert.rejects(f.call({action:'UNPACK',note:'Attempted reversal'}),/unload first/);
 assert.equal(await shipped(f),60);assert.equal((await f.context()).activity.some(e=>e.action==='CUSTOMER_SHIPMENT_CHANGED'),false);
}
async function guards(){
 const f=prep();await assert.rejects(f.call({action:'LOAD',loaded:100}),/prepare this batch/);
 await f.call({action:'PACK'});await assert.rejects(f.call({action:'LOAD',loaded:40}),/explain partial/);
 const row=projectPreparation(await f.context())[0];
 await assert.rejects(f.save({company:'NCT',staff:{...f.staff,canPrepareWarehouse:false},requestId:'aaaaaaaa-1111-4111-8111-111111111111',input:{action:'LOAD',id:row.id,version:row.version,loaded:100}}),/not authorized/);
 await assert.rejects(f.call({action:'LOAD',loaded:100,version:'STALE'}),/changed/);
 assert.equal(await shipped(f),0);await f.call({action:'LOAD',loaded:40,note:'Partial'});
 await assert.rejects(f.call({action:'UNPACK',note:'Do not reverse'}),/unload first/);assert.equal(await shipped(f),40);
}
async function photos(){
 const f=prep(),bytes=Buffer.from([255,216,255,...Array(20).fill(2)]),photo={mimeType:'image/jpeg',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const row=projectPreparation(await f.context())[0],request={company:'NCT',staff:f.staff,requestId:'aaaaaaaa-1111-4111-8111-111111111111',input:{action:'PACK',id:row.id,version:row.version,photos:[photo],photoStage:'PACKING'}};
 f.loseUpload();await assert.rejects(f.save(request),/upload lost/);await f.save(request);await f.save(request);
 assert.equal(new Set(f.uploads.map(p=>p.fileId)).size,1);assert.equal(await shipped(f),0);
 await f.call({action:'PHOTOS',photos:[photo],photoStage:'PACKING'});
 await f.call({action:'LOAD',loaded:40,note:'Partial',photos:[photo],photoStage:'LOADING'});
 assert.equal(projectPreparation(await f.context())[0].photos.length,3);assert.equal(await shipped(f),40);
 assert.equal((await f.context()).tasks[0].warehouse.stock.availablePhysical,60);
 const count=f.uploads.length;await assert.rejects(f.call({action:'PHOTOS',photos:[{...photo,sha256:'0'.repeat(64)}],photoStage:'PACKING'}),/content/);assert.equal(f.uploads.length,count);
}
async function allocation(){
 const f=extract('customer-allocation-save.test.cjs','fixture')(),input=f.input(),before=JSON.stringify(f.tasks);
 await f.save({...f.base,input});await f.save({...f.base,input});
 const {allocatedTo}=load('plannerAllocation.js'),{readAllocationLoans}=load('customerAllocationContext.js');
 assert.equal(allocatedTo('A',f.activity()).quantity,250);assert.equal(readAllocationLoans(f.activity())[0].outstanding,30);
 assert.equal(f.activity().filter(e=>e.action==='PLANNER_ALLOCATION_SAVED').length,1);assert.equal(JSON.stringify(f.tasks),before);
 await assert.rejects(f.save({...f.base,requestId:'22222222-1111-4111-8111-111111111111',input:{...input,version:'STALE'}}),/changed/);
}
async function intakeLoaded(company){
 const f=await extract('master-workflow-scenarios.test.cjs','scenario')(company,100);
 await f.split([60,40]);await f.delivery(100,'DELIVERY');await f.allocate(100);
 const original=await f.task(),po=(await f.po()).number;await f.loadForInvoice(60);
 const context=await f.context();assert.equal(physicalOutflowQuantity(context.activity,{taskId:f.id}),60);
 assert.equal((await f.task()).warehouse.accepted,100);assert.equal((await f.task()).ord,original.ord);assert.equal((await f.po()).number,po);
 assert.equal((await f.task()).warehouse.stock.availablePhysical,40);
 assert.equal(context.activity.some(e=>e.action==='CUSTOMER_SHIPMENT_CHANGED'),false,'Loaded is the only stock deduction, before invoice or Dispatch');
 assert.equal(context.activity.filter(e=>e.action==='ORDER_RECEIVED').length,1);
 assert.deepEqual(Array.from(load('customerShipmentPlan.js').readShipmentPlans(context.activity)[0].batches,b=>b.lines[0].quantity),[60,40]);
}
module.exports={loaded,guards,photos,allocation,intakeLoaded,scenario:(...args)=>extract('master-workflow-scenarios.test.cjs','scenario')(...args)};
