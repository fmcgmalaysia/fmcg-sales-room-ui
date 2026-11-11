const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const load = require('./load-master-module.cjs');
const {fixture} = require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const {createSupportDeskOperations, readSupportDesks} = load('supportDesk.js');
const {createPackingListOperations, packingVersion} = load('packingListOperations.js');
const {readDeskCommitments} = load('shortloadResolutionModel.js');
const {projectWarehouseDeliveryList} = load('warehouseDeliveryView.js');

async function setup() {
  const f = fixture();
  f.tasks.push({id:'C', orderId:'OC', sourceLineId:'LC', customerId:'CUSTOMER-C',
    barcode:'DEMO-C', name:'Pending product', packing:'12 x 1', ea:12, ord:100,
    requested:100, inc:0, supplyAllocation:{planned:0}, transactionCurrency:'USD',
    sellingPricePc:2, netCostCtn:60, procurement:{totalCtn:0, customerCtn:0},
    warehouse:{hasPhysicalReceipt:false, accepted:0}});
  const state = async () => readSupportDesks((await f.context()).activity, 'NCT').find(row=>row.customerId==='CUSTOMER-C');
  const assign = createSupportDeskOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context});
  await assign({company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'},requestId:f.nextId(),
    input:{action:'DESK_ASSIGN',customerId:'CUSTOMER-C',taskId:'C',desk:1,revision:''}});
  const files=[];
  const save=createPackingListOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.packingContext,
    documentService:async input=>{
      if(input.action==='ALLOCATE')return {fileId:'receipt-image-'+String(files.length+1).padStart(6,'0')};
      files.push(input);return {...input,ok:true};
    }});
  const request=async(input,department='WAREHOUSE')=>({company:'NCT',staff:{...f.staff,packingDepartment:department},
    requestId:f.nextId(),input:{version:packingVersion(await f.packingContext('NCT')),...input}});
  const send=async()=>save(await request({action:'DESK_SEND',customerId:'CUSTOMER-C',desk:1,
    deskRevision:(await state()).revision,lines:[{taskId:'C',quantity:100}]},'SUPPORT'));
  const current=async id=>(await f.packingContext('NCT')).lists.find(row=>row.id===id);
  const receive=quantity=>{
    const task=f.tasks.find(row=>row.id==='C');
    Object.assign(task,{inc:quantity,po:'PO-C',supplyAllocation:{planned:quantity},procurement:{totalCtn:quantity,customerCtn:quantity}});
    task.warehouse={hasPhysicalReceipt:true,accepted:quantity};
    f.records.set('N/ALLOCATION-C',{_id:'ALLOCATION-C',title:'ALLOCATION-C',imageAltText:'C',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',
      activityTime:'2026-10-28T08:00:00Z',details:{beforeRevision:'',targets:[{taskId:'C',quantity}]}});
  };
  const stock=async()=>({onHand:load('stockCardProjection.js').projectStockCard(await f.context()).items.reduce((sum,row)=>sum+row.onHand,0)});
  return {...f,state,assign,save,request,send,current,receive,files,stock};
}

test('Open Task exposes a Desk before procurement while COMMITTED and Loaded remain zero',async()=>{
  const f=await setup(),opened=await f.send(),list=await f.current(opened.id);
  assert.equal(list.lines[0].requestedQuantity,100);
  assert.equal(list.lines[0].quantity,0);
  const context=await f.context(),task=context.tasks.find(row=>row.id==='C');
  assert.equal(readDeskCommitments(context.activity,'NCT','C',task,await f.state()).quantity,0);
  await assert.rejects(f.save(await f.request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'C',loaded:1})),/wait for stock/);
  assert.equal((await f.stock()).onHand,150);
});

test('later allocation appears without a new Open Task and confirmed loading deducts only its increase',async()=>{
  const f=await setup(),opened=await f.send();
  f.receive(60);
  let list=await f.current(opened.id),context=await f.context(),task=context.tasks.find(row=>row.id==='C');
  assert.equal(list.lines[0].quantity,60);
  assert.equal(list.lines[0].requestedQuantity,100);
  assert.equal(readDeskCommitments(context.activity,'NCT','C',task,await f.state()).quantity,60);
  const first=await f.request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'C',loaded:60,reasonCodes:[]});
  await f.save(first);await f.save(first);
  assert.equal((await f.stock()).onHand,150);
  f.receive(100);list=await f.current(opened.id);
  assert.equal(list.lines[0].quantity,100);
  assert.equal(list.lines[0].loaded,60);
  assert.equal(list.lines[0].loadedConfirmedAt,undefined);
  await f.save(await f.request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'C',loaded:100,reasonCodes:[]}));
  assert.equal((await f.stock()).onHand,150);
});

test('container evidence is attached once to the Desk and thirty photos do not create stock outflows',async()=>{
  const f=await setup(),opened=await f.send();
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(8)]);
  const photo={mimeType:'image/png',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  for(let index=0;index<10;index++){
    const list=await f.current(opened.id);
    const request=await f.request({action:'DESK_PHOTOS',id:list.id,revision:list.revision,photos:[photo,photo,photo]});
    await f.save(request);await f.save(request);
  }
  const list=await f.current(opened.id);
  assert.equal(list.photos.length,30);
  assert.equal(f.files.length,30);
  assert.equal(list.lines[0].photos.length,0);
  await assert.rejects(f.save(await f.request({action:'DESK_PHOTOS',id:list.id,revision:list.revision,photos:[photo]})),/thirty/);
  assert.equal(f.files.length,30);
  assert.equal((await f.stock()).onHand,150);
});

test('expiry uses the existing Desk identity and Warehouse projection omits commercial values',async()=>{
  const f=await setup(),opened=await f.send();
  let list=await f.current(opened.id);
  await assert.rejects(f.save(await f.request({action:'DESK_EXPIRY',id:list.id,revision:list.revision,taskId:'C',expiryDate:'2027-02-30'})),/valid expiry/);
  const result=await f.save(await f.request({action:'DESK_EXPIRY',id:list.id,revision:list.revision,taskId:'C',expiryDate:'2027-11-01'}));
  assert.equal(result.list.lines[0].expiryDate,'2027-11-01');
  const projected=projectWarehouseDeliveryList(result.list);
  assert.equal(projected.lines[0].expiryDate,'2027-11-01');
  assert.equal(projected.lines[0].pricePc,undefined);
  assert.equal(projected.lines[0].priceCtn,undefined);
  assert.equal(projected.currency,undefined);
  assert.equal((await f.stock()).onHand,150);
});

test('splitting an unallocated open Desk leaves the split quantity pending without reducing demand',async()=>{
  const f=await setup(),opened=await f.send();
  await f.assign(await f.request({action:'DESK_SPLIT',customerId:'CUSTOMER-C',taskId:'C',desk:1,revision:(await f.state()).revision,parts:[{desk:1,quantity:60},{desk:0,quantity:40}]},'SUPPORT'));
  const list=await f.current(opened.id);
  assert.equal(list.lines[0].requestedQuantity,60);
  assert.equal(list.lines[0].quantity,0);
  assert.equal(f.tasks.find(task=>task.id==='C').requested,100);
  const context=await f.context(),parts=load('shortloadResolutionModel.js').deskTaskPortions(context.activity,await f.state(),context.tasks.find(task=>task.id==='C'));
  assert.equal(parts.find(part=>part.desk===0).quantity,40);
  assert.equal((await f.stock()).onHand,150);
});

test('confirmed Desk allocation cannot be moved to pending by a split',async()=>{
  const f=await setup();f.receive(60);await f.send();
  await assert.rejects(f.assign(await f.request({action:'DESK_SPLIT',customerId:'CUSTOMER-C',taskId:'C',desk:1,revision:(await f.state()).revision,parts:[{desk:1,quantity:59},{desk:0,quantity:41}]},'SUPPORT')),/confirmed|committed|below/i);
});

test('a lost container-photo receipt resumes the original file and adds no stock outflow',async()=>{
  const f=await setup(),opened=await f.send(),list=await f.current(opened.id),bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(8)]),photo={mimeType:'image/png',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const request=await f.request({action:'DESK_PHOTOS',id:list.id,revision:list.revision,photos:[photo]});
  f.lose('PURCHASE_OPERATION_RESULT');await assert.rejects(f.save(request),/lost acknowledgement/);await f.save(request);
  assert.equal((await f.current(opened.id)).photos.length,1);
  assert.equal(f.files.length,1);
  assert.equal((await f.stock()).onHand,150);
});

test('zero allocation stays visible and cannot be loaded merely because another product has stock',async()=>{
  const f=await setup(),opened=await f.send(),list=await f.current(opened.id);
  assert.equal(projectWarehouseDeliveryList(list).lines.length,1);
  await assert.rejects(f.save(await f.request({action:'DESK_LOAD',id:list.id,revision:list.revision,taskId:'C',loaded:1,reasonCodes:['INSUFFICIENT']})),/wait for stock/);
  assert.equal(load('physicalOutflow.js').readPhysicalOutflows((await f.context()).activity).length,0);
});
