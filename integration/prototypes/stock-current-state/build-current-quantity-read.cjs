'use strict';
// Minimum seams for the ORIGINAL bearer quantity endpoint and safe formatter.
// No production edit, CMS installation, mode switch or new customer permission.
const fs=require('node:fs'),path=require('node:path'),{WRITERS}=require('./stock-admission.cjs');
const original=path.resolve(__dirname,'../../backend');
const once=(source,before,after)=>{if(source.split(before).length!==2)throw Error('Original quantity anchor changed: '+before.slice(0,60));return source.replace(before,()=>after);};
let web=fs.readFileSync(path.join(original,'purchaseQuantityRead.js'),'utf8').replace(/\r\n/g,'\n');
web="import { createCurrentPurchaseQuantityRead } from 'backend/stockCurrentQuantityRead.js';\n"+web;
web=once(web,'    const names=PURCHASE_COLLECTIONS[body.company];',`    const current=await createCurrentPurchaseQuantityRead(body.company);
    if(current?.mode==='ACTIVE')return {status:200,body:await current.read(body)};
    if(current?.mode!=='LEGACY')throw Error('Current customer quantity snapshot unavailable');
    const names=PURCHASE_COLLECTIONS[body.company];`);
let projection=fs.readFileSync(path.join(original,'purchaseQuantityProjection.js'),'utf8').replace(/\r\n/g,'\n');
projection='export const PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION = 2;\n'+projection;
projection=once(projection,'      const warehouse=readWarehouseTask(task,activity),decision=',`      const originalWarehouse=readWarehouseTask(task,activity),current=workspace?.stockAllocationView==='CURRENT_V2';
      if(current&&(!adjusted||!Number.isSafeInteger(adjusted.inc)||adjusted.inc<0||adjusted.inc>quantity||!Number.isFinite(Date.parse(workspace.stockQuantityUpdatedAtByTask?.[task.title]))))throw Error('Verified current customer quantity required');
      const warehouse=current?{...(originalWarehouse||{}),customerReceived:adjusted.inc,allocationAt:originalWarehouse&&originalWarehouse.customerReceived===adjusted.inc&&!activity.some(event=>event.action==='STOCK_TRANSFER_CURRENT'&&event.participantTaskIds?.includes(task.title)||event.action==='STOCK_EXCEPTION_REPORTED'&&event.stockAttribution==='CUSTOMER'&&event.stockCustomerTaskId===task.title)?originalWarehouse.allocationAt||originalWarehouse.at:workspace.stockQuantityUpdatedAtByTask[task.title]}:originalWarehouse,decision=`);
const source=`import { items } from '@wix/data';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { projectPurchaseQuantities, PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION } from 'backend/purchaseQuantityProjection.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation, WAREHOUSE_CURRENT_READY_VERSION } from 'backend/warehousePreparation.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseTables, readCurrentPurchaseProjection } from 'backend/stockCurrentCommands.js';
// Private constructor ONLY after the original shared-secret/customer-body checks.
// This read-only system identity grants no Sales, Purchase or Warehouse mutation.
const writerCoverage=Object.freeze({});
const requiredWriters=Object.freeze(${JSON.stringify(WRITERS)});
export async function createCurrentPurchaseQuantityRead(company){
 if(!['NCT','GHR'].includes(company))throw Error('Known original quantity company required');
 const names=PURCHASE_COLLECTIONS[company],id=operationId(company,'STOCK_CONTROL'),control=await fulfilmentStore.read(names.activity,id);
 if(!control||control._id!==id||control.company!==company||typeof control.stockCommitVersion!=='string'||!control.stockCommitVersion||control.schemaVersion!==1||!Number.isSafeInteger(control.generation)||control.generation<0||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(control.mode))throw Error('Original quantity control unavailable; no fallback');
 if(control.mode==='LEGACY'){if(control.pending!==null)throw Error('Original quantity legacy pending');return{mode:'LEGACY'};}
 if(control.mode!=='ACTIVE')return{mode:control.mode};
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2||PURCHASE_CURRENT_QUANTITY_PROJECTION_VERSION!==2||WAREHOUSE_CURRENT_READY_VERSION!==2)throw Error('Paired current quantity calculators required');
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[names.activity]:['activityTime']}}),protocol=createSegmentedFencedProof({company,store,domainWrites:true});
 const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
 const staff={memberId:'SYSTEM_CUSTOMER_READ',staffId:'SYSTEM_CUSTOMER_READ',staffName:'System'};
 return{mode:'ACTIVE',read:async body=>{
  if(body?.company!==company||typeof body.customerId!=='string'||!body.customerId||!Array.isArray(body.orders)||!body.orders.length||body.orders.length>100)throw Error('Original customer quantity scope required');
  const snapshot=await protocol.readSnapshot(async checkpoint=>{
   if(checkpoint.mode!=='ACTIVE'||!checkpoint.writerBuild||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==checkpoint.writerBuild))throw Error('All original writers required before current quantity read');
   const tables=await readTables(company,staff),args={company,staff,orders:tables[names.orders],tasks:tables[names.tasks],activity:tables[names.activity],suppliers:tables.SharedSuppliers};
   const context={...projectPurchaseWorkspace(args),activity:args.activity};
   const retainedTaskIds=context.tasks.filter(task=>task.customerId===body.customerId&&body.orders.some(order=>order.orderId===task.orderId)&&!task.procurementSource&&!task.specialPurchase).map(task=>task.id);
   const current=await readCurrentPurchaseProjection({company,context,staff,control:checkpoint,items,store,originalArguments:args,retainedTaskIds,projectPurchaseWorkspace,currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,
    readCurrentTaskRows:async(selected,ids)=>{if(selected!==company||!Array.isArray(ids)||ids.length>2000||new Set(ids).size!==ids.length)throw Error('Bounded original quantity task scope required');const rows=[];for(const id of ids)rows.push(await store.read(names.tasks,id));return rows;},
    readPurchaseRecords:async()=>tables.PurchaseOrders,projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation});
   const workspace={...current.workspace,activity:args.activity},purchaseOrders=projectPurchaseOrders({company,workspace,records:tables.PurchaseOrders});
   // Validate the ORIGINAL accepted customer/order/submission identities BEFORE
   // querying any per-customer claim timestamp. No arbitrary requested task IDs.
   projectPurchaseQuantities({...args,customerId:body.customerId,requests:body.orders,purchaseOrders,workspace:context});
   const selected=workspace.tasks.filter(task=>task.customerId===body.customerId&&body.orders.some(order=>order.orderId===task.orderId)&&!task.procurementSource&&!task.specialPurchase);
   const timestamps={};
   for(const task of selected){
    const page=await items.query('StockClaims').eq('company',company).eq('taskId',task.id).descending('_updatedDate').limit(1).find({consistentRead:true,returnTotalCount:true});
    if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount<0||page.items.length!==Math.min(1,page.totalCount))throw Error('Current quantity timestamp unavailable');
    const row=page.items[0];
    if(row){
     const exact=await store.read('StockClaims',row._id);
     const key=JSON.stringify([company,task.barcode,task.packing,task.ea]);
     if(row.company!==company||row.taskId!==task.id||row.stockKey!==key||row._id!==operationId(company,row.positionId,task.id))throw Error('Current quantity timestamp identity changed');
     if(!exact||exact.company!==company||exact.taskId!==task.id||exact.stockKey!==key||row.stockCommitVersion!==exact._version||Object.prototype.toString.call(row._updatedDate)!=='[object Date]'||!Number.isFinite(row._updatedDate.getTime()))throw Error('Current quantity timestamp version changed');
     timestamps[task.id]=row._updatedDate.toISOString();
    }else{
     if(task.inc!==0)throw Error('Current customer allocation timestamp missing');
     const receipt=args.activity.find(event=>event.action==='ORDER_RECEIVED'&&event.result==='ACCEPTED'&&event.description===task.orderId&&event.details?.taskIds?.includes(task.id));
     if(!Number.isFinite(Date.parse(receipt?.activityTime)))throw Error('Original zero-stock receipt time missing');timestamps[task.id]=new Date(receipt.activityTime).toISOString();
    }
   }
   return projectPurchaseQuantities({...args,customerId:body.customerId,requests:body.orders,purchaseOrders,workspace:{...workspace,stockQuantityUpdatedAtByTask:timestamps}});
  });return snapshot.rows;
 }};
}
`;
for(const [name,value]of [['purchaseQuantityRead.candidate.js',web],['purchaseQuantityProjection.candidate.js',projection],['stockCurrentQuantityRead.js',source]]){
 new Function(value.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));const target=path.join(__dirname,name);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==value)throw Error('Original current quantity candidate differs: '+name);}else fs.writeFileSync(target,value);
}
process.stdout.write('Original current quantity endpoint/projection '+(process.argv.includes('--check')?'verified':'built')+'; no deployment\n');
