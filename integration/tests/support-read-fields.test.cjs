const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const load=require('./load-master-module.cjs'),{warehouseCbm,CBM_ACTION}=load('warehouseCbm.js'),{operationId}=load('purchaseOperationJournal.js');
const serviceSource=fs.readFileSync(path.join(__dirname,'../backend/customerFulfilmentService.js'),'utf8');
function fixture(){
 const task={id:'T1',customerId:'C1',orderId:'O1',sourceLineId:'L1',barcode:'001',name:'Product',packing:'24 x 1',ord:90,requested:100,inc:80,ea:24,sellingPricePc:1.25,transactionCurrency:'USD',cbmPerCtn:null};
 const context={company:'NCT',tasks:[task],customers:[{id:'C1',name:'Customer'}],activity:[]};
 const bindings={readFulfilmentContext:async()=>context,readCustomerShipments:()=>[],projectCustomerAccount:()=>({entries:[],balances:[]}),salesAdjustmentVersion:()=>'',shipmentPlanVersion:()=>'',readShipmentPlans:()=>[],customerAccountVersion:()=>'',projectCustomerDebtors:()=>[],shipmentVersion:()=>'',reservedCartons:()=>0,projectPreparation:load('warehousePreparation.js').projectPreparation,warehouseCbm,Date,Math};
 const read=vm.runInNewContext(serviceSource.slice(serviceSource.indexOf('export async function readCustomerFulfilment(')).replace(/^export /gm,'')+';readCustomerFulfilment;',bindings);
 return {task,context,read};
}
test('Support gets actual piece price and existing CBM without modifying requested quantities',async()=>{const f=fixture();f.task.cbmPerCtn=.024;const line=(await f.read('NCT',{readSupportDetails:true})).lines[0];assert.equal(line.sellingPricePc,1.25);assert.equal(line.sellingPriceCtn,30);assert.equal(line.cbmPerCtn,.024);assert.equal(line.originalRequested,100);assert.equal(line.requested,90);assert.equal(line.allocated,80);});
test('missing CBM uses the Warehouse-owned capture evidence',async()=>{const f=fixture(),id=operationId('NCT','T1',CBM_ACTION);f.context.activity.push({_id:id,action:CBM_ACTION,imageAltText:'T1',description:'O1',result:'SAVED',details:{company:'NCT',sourceLineId:'L1',barcode:'001',cbmPerCtn:.035}});assert.equal((await f.read('NCT',{readSupportDetails:true})).lines[0].cbmPerCtn,.035);});
test('unknown CBM stays unknown; regular and delegated reads retain original shape',async()=>{const f=fixture();assert.equal((await f.read('NCT',{readSupportDetails:true})).lines[0].cbmPerCtn,null);for(const staff of [{},{readFinancial:false},{customerId:'C1'},{readSupportDetails:false}]){const line=(await f.read('NCT',staff)).lines[0];assert.equal(Object.hasOwn(line,'sellingPricePc'),false);assert.equal(Object.hasOwn(line,'cbmPerCtn'),false);}});
test('cross-customer reads do not expose Support line additions',async()=>{const f=fixture();assert.equal((await f.read('NCT',{readSupportDetails:true},'C2')).lines.length,0);});
test('Support detail authority is server-derived and does not enable selection, dispatch or payment',async()=>{
 const src=fs.readFileSync(path.join(__dirname,'../backend/customerFulfilment.web.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 for(const departments of [['SUPPORT'],['WAREHOUSE'],['ACCOUNT']]){
  const calls=[],ctx={Permissions:{SiteMember:'member'},webMethod:(_,fn)=>fn,currentMember:{getMember:async()=>({_id:'M',status:'APPROVED',loginEmail:'staff@example.test'})},fulfilmentStore:{all:async()=>[{staffEmail:'staff@example.test',description:'M',staffStatus:'ACTIVE',title:'S',staffName:'Staff',role:'STAFF',departments}]},readCustomerFulfilment:async(_company,staff)=>{calls.push(staff);return {lines:[],shipments:[]};},saveCustomerFulfilment:async()=>{},Error,String};
  const api=vm.runInNewContext(src+';({getCustomerFulfilment});',ctx);await api.getCustomerFulfilment('NCT');assert.equal(calls[0].readSupportDetails,departments[0]==='SUPPORT');assert.equal(calls[0].canSelectShipment,false);assert.equal(calls[0].canDispatchShipment,departments[0]==='WAREHOUSE');
 }
});
