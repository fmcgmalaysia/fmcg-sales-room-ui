'use strict';
// Original PO metadata/read/file binding. Activation and native acceptance OFF.
const fs = require('node:fs'), path = require('node:path'), { WRITERS } = require('./stock-admission.cjs');
const root = path.resolve(__dirname, '../../..');
function once(source, before, after) { if (source.split(before).length !== 2) throw Error('Exact original PO web anchor changed'); return source.replace(before, () => after); }
let web = fs.readFileSync(path.join(root, 'integration/backend/purchaseOrders.web.js'), 'utf8').replace(/\r\n/g, '\n');
web = "import { createCurrentPurchaseOrders } from 'backend/stockCurrentPurchaseOrders.js';\n" + web;
web = once(web, '  const staff=await getPurchaseStaffContext(),rows=await orders.list(company,staff);',
  "  const staff=await getPurchaseStaffContext(),current=await createCurrentPurchaseOrders(company);\n  if(!['LEGACY','ACTIVE'].includes(current?.mode))throw Error('Current purchase order read unavailable');\n  const currentRead=current.mode==='ACTIVE'?await current.list(staff):null;\n  const rows=currentRead?currentRead.rows:await orders.list(company,staff);");
web = once(web, 'return {company,orders:rows.map(', 'return {company,...(currentRead?{stockCurrent:currentRead.stockCurrent}:{}),orders:rows.map(');
web = once(web, 'async(company,requestId,input)=>{', 'async(company,requestId,input,stockCurrent)=>{');
web = once(web, '  try{return await orders.save({company,requestId,input,staff});}',
  "  try{const current=await createCurrentPurchaseOrders(company);\n    if(current?.mode==='LEGACY'&&stockCurrent===undefined)return await orders.save({company,requestId,input,staff});\n    if(current?.mode!=='ACTIVE'||!stockCurrent||typeof stockCurrent!=='object'||Array.isArray(stockCurrent)||Object.keys(stockCurrent).some(key=>!['stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))||JSON.stringify({input,stockCurrent}).length>(input?.action==='DOCUMENT'?4400000:200000))throw Error('Current purchase order save unconfirmed');\n    return await current.save({requestId,input,...stockCurrent});}");
const source = `import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { requirePurchaseStaff, projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { createPurchaseOrderOperations, projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/warehousePreparation.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseTables, readCurrentPurchaseProjection, createCurrentPurchaseOrderRecordSave, createCurrentOrderFileSave, createOrderFileFencedStore, createPurchaseDeleteProtocol } from 'backend/stockCurrentCommands.js';
// No public endpoint, new role or financial policy. Empty coverage prevents ACTIVE.
const writerCoverage = Object.freeze({});
const requiredWriters = Object.freeze(${JSON.stringify(WRITERS)});
const actions = Object.freeze(['TERM','ACK_PAYMENT','REQUEST_PAYMENT','SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN','DOCUMENT_ISSUE_RESPONSE']);
export async function createCurrentPurchaseOrders(company) {
  if (!['NCT','GHR'].includes(company)) throw Error('Original Purchase company required');
  await getPurchaseStaffContext();
  const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
  const initial=await fulfilmentStore.read(journal,operationId(company,'STOCK_CONTROL'));
  if(initial?._id!==operationId(company,'STOCK_CONTROL')||initial.company!==company||initial.schemaVersion!==1
    ||typeof initial.stockCommitVersion!=='string'||!initial.stockCommitVersion||!Number.isSafeInteger(initial.generation)||initial.generation<0
    ||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(initial.mode))throw Error('Original purchase order control unavailable');
  if(initial.mode==='LEGACY'){if(initial.pending!==null)throw Error('Legacy purchase order save pending');return{mode:'LEGACY'};}
  if(initial.mode!=='ACTIVE')return{mode:initial.mode};
  if(PURCHASE_CURRENT_PROJECTION_VERSION!==2)throw Error('Original paired current Purchase projector required');
  const [orders,tasks]=company==='NCT'?['NCTOrders','NCTTasks']:['NCTOrders1','NCTTasks1'];
  const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],
    [orders]:['masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
  const base=createSegmentedFencedProof({company,store,domainWrites:true});
  const protocol={...base,readSnapshot:read=>base.readSnapshot(control=>{
    if(control.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||!control.writerBuild
      ||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==control.writerBuild))throw Error('All original PO co-writers required');
    return read(control);
  })};
  const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
  const readRecords=async selected=>{if(selected!==company)throw Error('PO company conflict');return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company).map(row=>store.normalizeListedRow('PurchaseOrders',row));};
  const readTasks=async(selected,ids)=>{
    if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current PO tasks required');
    const rows=[];for(const id of ids)rows.push(await store.read(tasks,id));return rows;
  };
  async function readContext(selected,staff,control){
    if(selected!==company)throw Error('Original PO context company conflict');
    const tables=await readTables(company,staff),originalArguments={company,staff,orders:tables[orders],tasks:tables[tasks],activity:tables[journal],suppliers:tables.SharedSuppliers};
    const context={...projectPurchaseWorkspace(originalArguments),activity:tables[journal]};
    const current=await readCurrentPurchaseProjection({company,context,staff,control,items,store,originalArguments,projectPurchaseWorkspace,
      currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,readCurrentTaskRows:readTasks,readPurchaseRecords:async()=>tables.PurchaseOrders,
      projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation});
    return{...current.workspace,activity:tables[journal]};
  }
  const dependencies={readMember:()=>currentMember.getMember({fieldsets:['FULL']}),readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),requirePurchaseStaff,
    createPurchaseOrderOperations,readPurchaseRecords:readRecords,readContext:async(selected,staff)=>readContext(selected,staff,await protocol.readControl()),now:()=>new Date()};
  const save=createCurrentPurchaseOrderRecordSave({company,store,protocol,coverage:writerCoverage,authorityDependencies:dependencies});
  const fileSave=createCurrentOrderFileSave({company,department:'PURCHASE',store,coverage:writerCoverage,createPurchaseOrderOperations,
    authenticateOriginal:()=>getPurchaseStaffContext(),now:()=>new Date(),
    readOriginalContext:async(selected,staff)=>({context:await readContext(selected,staff,await protocol.readControl()),records:await readRecords(selected)}),
    allocateDocumentSlot:async selected=>{if(selected!==company)throw Error('Original file allocation company conflict');return(await requestPurchaseDocument({action:'ALLOCATE',company})).fileId;},
    createFileProtocol:({request,staff})=>{const file=request.input.action==='DELETE_DOCUMENT'
      ?createPurchaseDeleteProtocol({company,request,staff,store,documentService:requestPurchaseDocument})
      :createSegmentedFencedProof({company,store:createOrderFileFencedStore({company,department:'PURCHASE',staff,request,store,documentService:requestPurchaseDocument}),domainWrites:true});
      return{...file,readSnapshot:protocol.readSnapshot};}});
  return{mode:'ACTIVE',save:request=>{
    if(!request||!request.stockIdentity||JSON.stringify(request).length>(request.input?.action==='DOCUMENT'?4400000:200000))throw Error('Original identified purchase order request required');
    if(['DOCUMENT','DELETE_DOCUMENT'].includes(request.input?.action))return fileSave(request);
    if(!actions.includes(request.input?.action))throw Error('Original purchase order action required');return save(request);
  },list:async expectedStaff=>{
    const staff=await getPurchaseStaffContext();
    if(staff.staffId!==expectedStaff?.staffId||staff.memberId!==expectedStaff?.memberId)throw Error('Original PO read actor changed');
    const snapshot=await protocol.readSnapshot(async control=>{
      const context=await readContext(company,staff,control),records=await readRecords(company);
      // ORIGINAL list applies its original document visibility/delete blockers.
      const original=createPurchaseOrderOperations({store:{all:async collection=>{if(collection!=='PurchaseOrders')throw Error('PO list collection conflict');return records;}},
        names:{[company]:{activity:journal}},readWorkspace:async()=>context,now:()=>new Date()});
      return {rows:await original.list(company,staff),stockCurrent:{stockProtocol:1,stockBuild:control.writerBuild,stockGeneration:control.generation,
        stockIdentity:{staffId:staff.staffId,memberId:staff.memberId}}};
    });return snapshot.rows;
  }};
}
`;
for (const [name, text] of Object.entries({ 'purchaseOrders.web.candidate.js': web, 'stockCurrentPurchaseOrders.js': source })) {
  new Function(text.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  const target = path.join(__dirname, name);
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('Current PO root differs: ' + name); }
  else fs.writeFileSync(target, text);
}
process.stdout.write('Original Purchase order web/private current metadata root ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; not installed\n');
