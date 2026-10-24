const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs'),{captureOriginalWarehousePhotoPlan,assertWarehousePhotoUploads,uploadWarehousePhotoSlot}=require('../prototypes/stock-current-state/warehouse-photo-plan.cjs');
const source=require.resolve('./stock-current-warehouse-preparation-save.test.cjs'),copy=value=>JSON.parse(JSON.stringify(value));
const original=vm.runInNewContext(fs.readFileSync(source,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
 {require:createRequire(source),__dirname:path.dirname(source),Map,Buffer});
async function fixture(){
 const f=await original(),staff=await f.deps.authenticateOriginalWarehouse(),{row}=await f.quote('B');
 const control=await f.protocol.readControl(),data=await f.deps.readCurrentContext('NCT',staff,control);
 const context=require('../prototypes/stock-current-state/current-warehouse-ready-context.cjs').currentWarehouseReadyContext({context:{...data.workspace,activity:data.originalContext.activity},
  states:[...data.products.values()].map(product=>product.state),requiredTaskIds:['A','B'],readAllocations:f.deps.readAllocations,readCustomerShipments:f.deps.readCustomerShipments});
 const bytes=Buffer.from([255,216,255,...Array(20).fill(1)]),photo={mimeType:'image/jpeg',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const args={company:'NCT',staff:{...staff,canPrepareWarehouse:true},requestId:'44444444-4444-4444-8444-444444444444',input:{action:'PACK',id:row.id,version:row.version,photos:[photo],photoStage:'PACKING',note:''},context,
  createPreparationOperations:f.deps.createPreparationOperations,now:f.deps.now,slots:['original-photo-slot-12345']};
 return{f,args,photo};
}
test('actual original photo prepare validation yields immutable fixed server slots without original apply, live writes or any external allocation',async()=>{
 const{f,args}=await fixture(),before=JSON.stringify([...f.db]);const plan=await captureOriginalWarehousePhotoPlan(args);
 assert.equal(plan.uploads[0].fileId,args.slots[0]);assert.equal(plan.event.details.state.photos.at(-1).fileId,args.slots[0]);assert.equal(JSON.stringify([...f.db]),before);
 assert.equal(assertWarehousePhotoUploads({...args,plan}),true);assert.equal(JSON.stringify(plan).includes(args.input.photos[0].base64),false,'raw file bytes never enter original journal plan');
});
test('original file signatures/hash/total/task version/physical ownership validators cannot be bypassed by predetermined slots',async()=>{
 const{args}=await fixture();for(const patch of [{version:'STALE'},{photos:[{...args.input.photos[0],sha256:'0'.repeat(64)}]},{photos:[{...args.input.photos[0],base64:Buffer.from('not a photo').toString('base64')}]},{photoStage:'LOADING'}]){
  await assert.rejects(captureOriginalWarehousePhotoPlan({...args,input:{...args.input,...patch}}));
 }
 await assert.rejects(captureOriginalWarehousePhotoPlan({...args,slots:[]}),/scope/);
 await assert.rejects(captureOriginalWarehousePhotoPlan({...args,slots:['INVALID']}),/scope/);
 await assert.rejects(captureOriginalWarehousePhotoPlan({...args,input:{...args.input,photos:[...args.input.photos,...args.input.photos]},slots:[args.slots[0],args.slots[0]]}),/scope/);
});
function service(){
 const files=new Map(),calls=[],env={FILE_FIELDS:'id,name,mimeType,size,parents,appProperties,trashed,webViewLink',Error,
  Utilities:{base64Decode:value=>[...Buffer.from(value,'base64')],computeDigest:(_,bytes)=>[...crypto.createHash('sha256').update(Buffer.from(bytes)).digest()],DigestAlgorithm:{SHA_256:'SHA256'},newBlob:(bytes,type,name)=>({bytes,type,name})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Drive:{Files:{create:(meta,blob)=>{calls.push(copy(meta));if(files.has(meta.id))throw Error('exists');const file={...meta,size:blob.bytes.length,trashed:false};files.set(meta.id,file);return file;},get:id=>{if(!files.has(id))throw Error('missing');return files.get(id);}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps-script/purchase-documents/WarehousePhotos.gs'),'utf8'),env);
 return{files,calls,upload:env.uploadWarehousePhoto_};
}
test('lost upload acknowledgement retries original create-only service with identical file ID/content, never allocate, trash or another customer file',async()=>{
 const{args}=await fixture(),plan=await captureOriginalWarehousePhotoPlan(args),drive=service(),commands=[];let lost=true;
 const documentService=async command=>{commands.push(copy(command));const result=drive.upload(command);if(lost){lost=false;throw Error('Lost reply');}return result;};
 await assert.rejects(uploadWarehousePhotoSlot({...args,plan,index:0,documentService}),/Lost reply/);
 assert.equal(drive.files.size,1);const receipt=await uploadWarehousePhotoSlot({...args,plan,index:0,documentService});assert.equal(receipt.fileId,args.slots[0]);assert.equal(drive.files.size,1);
 assert.deepEqual(commands[0],commands[1]);assert.equal(commands.every(command=>command.action==='PHOTO_UPLOAD'),true);assert.equal(drive.calls.length,2);
});
test('changed immutable slot/receipt/staff/event is refused; file conflict never yields success or another file identity',async()=>{
 const{args}=await fixture(),plan=await captureOriginalWarehousePhotoPlan(args);let calls=0;
 for(const mutate of [p=>p.uploads[0].fileId='different-slot-12345',p=>p.event.description='OTHER',p=>p.event.details.state.photos[0].stage='LOADING',p=>p.uploads[0].company='GHR']){
  const changed=copy(plan);mutate(changed);await assert.rejects(uploadWarehousePhotoSlot({...args,plan:changed,index:0,documentService:async()=>{calls++;}}));
 }
 assert.equal(calls,0);await assert.rejects(uploadWarehousePhotoSlot({...args,staff:{...args.staff,memberId:'OTHER'},plan,index:0,documentService:async()=>{calls++;}}));assert.equal(calls,0);
 await assert.rejects(uploadWarehousePhotoSlot({...args,plan,index:0,documentService:async()=>({ok:true,...plan.uploads[0],fileId:'WRONG'})}),/unconfirmed/);
 const drive=service();await uploadWarehousePhotoSlot({...args,plan,index:0,documentService:drive.upload});drive.files.get(args.slots[0]).appProperties.poId='other-customer';
 await assert.rejects(uploadWarehousePhotoSlot({...args,plan,index:0,documentService:drive.upload}),/IDENTITY_CONFLICT/);assert.equal(drive.files.size,1);
});
