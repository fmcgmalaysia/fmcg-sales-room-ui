import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';
import { requirePurchaseStaff, projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/r2purchaseProjection.js';
import { fulfilmentStore } from 'backend/r2customerFulfilmentService.js';
import { createPurchaseOrderOperations, projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';
import { requestPurchaseDocument } from 'backend/r2purchaseDocumentClient.js';
import { readAllocations } from 'backend/r2plannerAllocation.js';
import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';
import { readPackingLists } from 'backend/r2packingListOperations.js';
import { packingHeld } from 'backend/r2packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/r2warehousePreparation.js';
import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseTables, readCurrentPurchaseProjection, createCurrentPurchaseOrderRecordSave, createCurrentOrderFileSave, createOrderFileFencedStore, createPurchaseDeleteProtocol } from 'backend/r2stockCurrentCommands.js';
// No public endpoint, new role or financial policy. Empty coverage prevents ACTIVE.
const writerCoverage = Object.freeze({});
const requiredWriters = Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
const actions = Object.freeze(['TERM','ACK_PAYMENT','REQUEST_PAYMENT','SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN','DOCUMENT_ISSUE_RESPONSE']);
export async function createCurrentPurchaseOrders(company) {
  if (!['NCT','GHR'].includes(company)) throw Error('Original Purchase company required');
  await getPurchaseStaffContext();
  const journal=company==='NCT'?'R2NCTActivity':'R2NCTActivity1';
  const initial=await fulfilmentStore.read(journal,operationId(company,'STOCK_CONTROL'));
  if(initial?._id!==operationId(company,'STOCK_CONTROL')||initial.company!==company||initial.schemaVersion!==1
    ||typeof initial.stockCommitVersion!=='string'||!initial.stockCommitVersion||!Number.isSafeInteger(initial.generation)||initial.generation<0
    ||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(initial.mode))throw Error('Original purchase order control unavailable');
  if(initial.mode==='LEGACY'){if(initial.pending!==null)throw Error('Legacy purchase order save pending');return{mode:'LEGACY'};}
  if(initial.mode!=='ACTIVE')return{mode:initial.mode};
  if(PURCHASE_CURRENT_PROJECTION_VERSION!==2)throw Error('Original paired current Purchase projector required');
  const [orders,tasks]=company==='NCT'?['R2NCTOrders','R2NCTTasks']:['R2NCTOrders1','R2NCTTasks1'];
  const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],
    [orders]:['masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
  const base=createSegmentedFencedProof({company,store,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,batchNewInserts:true});
  const protocol={...base,readSnapshot:read=>base.readSnapshot(control=>{
    if(control.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||!control.writerBuild
      ||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==control.writerBuild))throw Error('All original PO co-writers required');
    return read(control);
  })};
  const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
  const readRecords=async selected=>{if(selected!==company)throw Error('PO company conflict');return(await fulfilmentStore.all('R2PurchaseOrders')).filter(row=>row.company===company).map(row=>store.normalizeListedRow('R2PurchaseOrders',row));};
  const readTasks=async(selected,ids)=>{
    if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current PO tasks required');
    const rows=[];for(const id of ids)rows.push(await store.read(tasks,id));return rows;
  };
  async function readContext(selected,staff,control){
    if(selected!==company)throw Error('Original PO context company conflict');
    const tables=await readTables(company,staff),originalArguments={company,staff,orders:tables[orders],tasks:tables[tasks],activity:tables[journal],suppliers:tables.SharedSuppliers};
    const context={...projectPurchaseWorkspace(originalArguments),activity:tables[journal]};
    const current=await readCurrentPurchaseProjection({company,context,staff,control,items,store,originalArguments,projectPurchaseWorkspace,
      currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,readCurrentTaskRows:readTasks,readPurchaseRecords:async()=>tables.R2PurchaseOrders,
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
      ?createPurchaseDeleteProtocol({company,coordination:'CONTROL_CAS_CANDIDATE',request,staff,store,documentService:requestPurchaseDocument})
      :createSegmentedFencedProof({company,coordination:'CONTROL_CAS_CANDIDATE',store:createOrderFileFencedStore({company,coordination:'CONTROL_CAS_CANDIDATE',department:'PURCHASE',staff,request,store,documentService:requestPurchaseDocument}),domainWrites:true});
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
      const original=createPurchaseOrderOperations({store:{all:async collection=>{if(collection!=='R2PurchaseOrders')throw Error('PO list collection conflict');return records;}},
        names:{[company]:{activity:journal}},readWorkspace:async()=>context,now:()=>new Date()});
      return {rows:await original.list(company,staff),stockCurrent:{stockProtocol:1,stockBuild:control.writerBuild,stockGeneration:control.generation,
        stockIdentity:{staffId:staff.staffId,memberId:staff.memberId}}};
    });return snapshot.rows;
  }};
}
