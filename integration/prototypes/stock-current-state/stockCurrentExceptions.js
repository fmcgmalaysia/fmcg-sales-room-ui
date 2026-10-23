import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { createStockExceptionOperations, readStockExceptions } from 'backend/inventoryExceptions.js';
import { createStockResolutionOperations } from 'backend/stockExceptionResolution.js';
import { requireStockStaff, projectStockWorkspace } from 'backend/stockExceptionWorkspace.js';
import { projectDepartmentMessages } from 'backend/departmentMessages.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/warehousePreparation.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseTables, readCurrentPurchaseProjection, createCurrentStockExceptionSave, createCurrentStockResolutionSave } from 'backend/stockCurrentCommands.js';
// All actual writer/native/recovery/capacity/cutover gates remain mandatory.
const writerCoverage=Object.freeze({});
const requiredWriters=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
async function originalStockStaff(){return requireStockStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'));}
export async function createCurrentStockExceptions(company){
 if(!['NCT','GHR'].includes(company))throw Error('Original stock company required');
 await originalStockStaff();
 const journal=company==='NCT'?'NCTActivity':'NCTActivity1',initial=await fulfilmentStore.read(journal,operationId(company,'STOCK_CONTROL'));
 if(initial?._id!==operationId(company,'STOCK_CONTROL')||initial.company!==company||initial.schemaVersion!==1||typeof initial.stockCommitVersion!=='string'||!initial.stockCommitVersion||!Number.isSafeInteger(initial.generation)||initial.generation<0||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(initial.mode))throw Error('Original stock control unavailable');
 if(initial.mode==='LEGACY'){if(initial.pending!==null)throw Error('Original stock legacy save pending');return{mode:'LEGACY'};}
 if(initial.mode!=='ACTIVE')return{mode:initial.mode};
 if(PURCHASE_CURRENT_PROJECTION_VERSION!==2)throw Error('Original paired current stock projector required');
 const [orders,tasks]=company==='NCT'?['NCTOrders','NCTTasks']:['NCTOrders1','NCTTasks1'];
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],[orders]:['masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
 const base=createSegmentedFencedProof({company,store,domainWrites:true}),protocol={...base,readSnapshot:read=>base.readSnapshot(control=>{
  if(control.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||!control.writerBuild||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==control.writerBuild))throw Error('All original stock exception co-writers required');return read(control);
 })};
 const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
 const readTasks=async(selected,ids)=>{if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current stock task scope required');const rows=[];for(const id of ids)rows.push(await store.read(tasks,id));return rows;};
 async function readContext(selected,staff,control){
  if(selected!==company)throw Error('Original stock projection company conflict');
  const tables=await readTables(company,staff),originalArguments={company,staff,orders:tables[orders],tasks:tables[tasks],activity:tables[journal],suppliers:tables.SharedSuppliers};
  const context={...projectPurchaseWorkspace(originalArguments),activity:tables[journal]};
  // The original stock-case workspace includes received historical source lines.
  // Retain those exact IDs; never display a CLOSED source as zero by omission.
  const retainedTaskIds=[...new Set([...context.tasks.filter(task=>task.warehouse?.hasPhysicalReceipt===true).map(task=>task.id),
   ...context.activity.filter(event=>event.action==='STOCK_EXCEPTION_REPORTED'&&event.stockAttribution==='CUSTOMER').map(event=>event.stockCustomerTaskId)])];
  const current=await readCurrentPurchaseProjection({company,context,staff,control,items,store,originalArguments,projectPurchaseWorkspace,currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,
   readCurrentTaskRows:readTasks,readPurchaseRecords:async()=>tables.PurchaseOrders,projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation,retainedTaskIds});
  return{context:{...current.workspace,activity:tables[journal]},records:tables.PurchaseOrders,products:current.products};
 }
 const dependencies={readMember:()=>currentMember.getMember({fieldsets:['FULL']}),readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),requireStockStaff,
  readContext:async(selected,staff)=>(await readContext(selected,staff,await protocol.readControl())).context,
  readPurchaseRecords:async selected=>{if(selected!==company)throw Error('Original stock PO company conflict');return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company).map(row=>store.normalizeListedRow('PurchaseOrders',row));},
  projectPurchaseOrders,createStockExceptionOperations,createStockResolutionOperations,readStockExceptions,readCurrentTaskRows:readTasks,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation,now:()=>new Date()};
 const report=createCurrentStockExceptionSave({company,items,store,protocol,coverage:writerCoverage,authorityDependencies:dependencies});
 const resolve=createCurrentStockResolutionSave({company,items,store,protocol,coverage:writerCoverage,authorityDependencies:dependencies});
 async function snapshot(expectedStaff,project){
  const staff=await originalStockStaff();if(staff.staffId!==expectedStaff?.staffId||staff.memberId!==expectedStaff?.memberId)throw Error('Original stock read actor changed');
  const value=await protocol.readSnapshot(async control=>{const data=await readContext(company,staff,control),purchaseOrders=projectPurchaseOrders({company,workspace:data.context,records:data.records});
   return{...project(data,purchaseOrders,staff),stockCurrent:{stockProtocol:1,stockBuild:control.writerBuild,stockGeneration:control.generation,stockIdentity:{staffId:staff.staffId,memberId:staff.memberId}}};});return value.rows;
 }
 return{mode:'ACTIVE',save:async request=>{
  const staff=await originalStockStaff();
  if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))||JSON.stringify(request).length>200000||request.stockIdentity?.staffId!==staff.staffId||request.stockIdentity?.memberId!==staff.memberId)throw Error('Original identified stock request required');
  return(request.input?.action==='QUARANTINE'?report:resolve)(request);
 },read:expectedStaff=>snapshot(expectedStaff,(data,purchaseOrders,staff)=>{
  const result=projectStockWorkspace(data.context,purchaseOrders,staff),sources=new Map([...data.products.values()].flatMap(product=>product.state.sources.map(source=>[source.id,source])));
  // Historical accepted is unchanged; only current physical display uses current rows.
  result.sources=result.sources.map(source=>{const current=sources.get(source.id);if(!current)throw Error('Exact current stock source display required');
   const owners=Object.entries(current.claims).filter(([,quantity])=>quantity>0),maximum=current.available>0?current.available:owners.length===1?owners[0][1]:0;
   return{...source,availablePhysical:current.onHand-current.isolated,stockReportMaximum:maximum,stockAttributionReviewRequired:maximum<current.onHand-current.isolated};});
  result.cases=result.cases.map(item=>{
   const event=data.context.activity.find(event=>event._id===item.id&&event.action==='STOCK_EXCEPTION_REPORTED');
   if(event?.stockAttribution!=='CUSTOMER')return{...item,source:result.sources.find(source=>source.id===item.source.id)};
   const state=[...data.products.values()].map(product=>product.state).find(state=>state.tasks.some(task=>task.id===event.stockCustomerTaskId));
   const task=state?.tasks.find(task=>task.id===event.stockCustomerTaskId);if(!task)throw Error('Exact isolated case customer required');
   const usable=state.sources.reduce((n,source)=>n+(source.claims[task.id]||0),0);
   return{...item,source:result.sources.find(source=>source.id===item.source.id),stockCustomerId:task.customerId,
    packingCorrectionRequired:state.packingHolds.heldByTask[task.id]>usable,
    packingRecheckRequired:readPackingLists(data.context.activity,company).some(list=>list.stockDamageReviewRequired===true&&list.stockDamageCases?.some(row=>row.caseId===item.id))};
  });return result;
 }),messages:(expectedStaff,department)=>snapshot(expectedStaff,(data,purchaseOrders)=>projectDepartmentMessages({company,department,staff:expectedStaff,orders:purchaseOrders,activity:data.context.activity}))};
}
