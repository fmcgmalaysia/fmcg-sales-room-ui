'use strict';
// Minimum original stock exception gateway seams. Does not install or activate.
const fs=require('node:fs'),path=require('node:path'),{WRITERS}=require('./stock-admission.cjs');
const root=path.resolve(__dirname,'../../..');
function once(source,before,after){if(source.split(before).length!==2)throw Error('Exact original stock exception root anchor changed: '+before.slice(0,70));return source.replace(before,()=>after);}
let web=fs.readFileSync(path.join(root,'integration/backend/stockExceptions.web.js'),'utf8').replace(/\r\n/g,'\n');
web="import { createCurrentStockExceptions } from 'backend/stockCurrentExceptions.js';\n"+web;
web=once(web,"async company=>{const staff=await staffContext(),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});return projectStockWorkspace(context,orders,staff);}",
 `async(company,readOptions)=>{const staff=await staffContext();
 if(readOptions!==undefined){if(!['NCT','GHR'].includes(company)||!readOptions||typeof readOptions!=='object'||Array.isArray(readOptions)||Object.keys(readOptions).length!==1||readOptions.contextOnly!==true)throw Error('Original stock context request required');return{ok:true,schema:'STOCK_EXCEPTION_ORIGINAL_CONTEXT_V1',company,staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName}};}
 const current=await createCurrentStockExceptions(company);if(current?.mode==='ACTIVE')return current.read(staff);if(current?.mode!=='LEGACY')throw Error('Current stock workspace unavailable');
 const context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});return projectStockWorkspace(context,orders,staff);}`);
web=once(web,'async(company,requestId,input)=>{','async(company,requestId,input,stockCurrent)=>{');
web=once(web," try{return await(input?.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});}",
 ` try{const current=await createCurrentStockExceptions(company);
 if(current?.mode==='LEGACY'&&stockCurrent===undefined)return await(input?.action==='QUARANTINE'?report:resolve)({company,staff,requestId,input});
 if(current?.mode!=='ACTIVE'||!stockCurrent||typeof stockCurrent!=='object'||Array.isArray(stockCurrent)||Object.keys(stockCurrent).some(key=>!['stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))||JSON.stringify({input,stockCurrent}).length>200000)throw Error('Current stock save unconfirmed');
 return await current.save({requestId,input,...stockCurrent});}`);
web=once(web," const staff=await messageStaffContext(),context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});",
 " const staff=await messageStaffContext(),current=await createCurrentStockExceptions(company);if(current?.mode==='ACTIVE')return current.messages(staff,department);if(current?.mode!=='LEGACY')throw Error('Current stock messages unavailable');\n const context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});");
const source=`import { items } from '@wix/data';
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
const requiredWriters=Object.freeze(${JSON.stringify(WRITERS)});
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
 const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],[orders]:['estimatedShipmentDate','masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
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
  const retainedTaskIds=context.tasks.filter(task=>task.warehouse?.hasPhysicalReceipt===true).map(task=>task.id);
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
  result.sources=result.sources.map(source=>{const current=sources.get(source.id);if(!current)throw Error('Exact current stock source display required');return{...source,availablePhysical:current.onHand-current.isolated};});
  result.cases=result.cases.map(item=>({...item,source:result.sources.find(source=>source.id===item.source.id)}));return result;
 }),messages:(expectedStaff,department)=>snapshot(expectedStaff,(data,purchaseOrders)=>projectDepartmentMessages({company,department,staff:expectedStaff,orders:purchaseOrders,activity:data.context.activity}))};
}
`;
for(const [name,text] of Object.entries({'stockExceptions.web.candidate.js':web,'stockCurrentExceptions.js':source})){
 new Function(text.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));const target=path.join(__dirname,name);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Original current stock exception root differs: '+name);}else fs.writeFileSync(target,text);
}
process.stdout.write('Original stock exception web/private current roots '+(process.argv.includes('--check')?'verified':'built')+'; not installed\n');
