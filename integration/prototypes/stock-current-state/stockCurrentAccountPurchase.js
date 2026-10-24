import { items } from '@wix/data';
import { currentMember } from 'wix-members-backend';
import { requireAccountStaff, createAccountReviewOperations } from 'backend/accountPurchaseReview.js';
import { projectPurchaseWorkspace, PURCHASE_CURRENT_PROJECTION_VERSION } from 'backend/purchaseProjection.js';
import { fulfilmentStore } from 'backend/customerFulfilmentService.js';
import { createPurchaseOrderOperations, projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { createAccountSettlementOperations } from 'backend/accountSettlement.js';
import { createSupplierCreditOperations } from 'backend/supplierCredit.js';
import { requestPurchaseDocument } from 'backend/purchaseDocumentClient.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/warehousePreparation.js';
import { operationId } from 'backend/purchaseOperationJournal.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentPurchaseTables, readCurrentPurchaseProjection, createCurrentAccountOrderRecordSave, createCurrentAccountAuxiliarySave, createCurrentOrderFileSave, createOrderFileFencedStore } from 'backend/stockCurrentCommands.js';
// No new employee roles, bank action, invoice issue, endpoint or activation.
const writerCoverage=Object.freeze({});
const requiredWriters=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
const recordActions=Object.freeze(['CLOSE_ACCOUNT','REOPEN_ACCOUNT','DOCUMENT_ISSUE_REPORT','DOCUMENT_ISSUE_REVIEW','AMOUNTS','CN_NOT_APPLICABLE','CHECK','PLAN','RECOGNIZE_CREDIT','SHORTAGE_CLAIM','PAYMENT_REVIEW','REVIEW_LEGACY','TAKE_OWNERSHIP','RETURN_PROCUREMENT','PAYMENT_PROCESSING','PAYMENT_UNKNOWN','PAYMENT_RESOLVED']);
async function originalAccountStaff(){return requireAccountStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'));}
export async function createCurrentAccountPurchase(company){
  if(!['NCT','GHR'].includes(company))throw Error('Original shared Account company required');
  await originalAccountStaff();
  const journal=company==='NCT'?'NCTActivity':'NCTActivity1',initial=await fulfilmentStore.read(journal,operationId(company,'STOCK_CONTROL'));
  if(initial?._id!==operationId(company,'STOCK_CONTROL')||initial.company!==company||initial.schemaVersion!==1||typeof initial.stockCommitVersion!=='string'||!initial.stockCommitVersion
    ||!Number.isSafeInteger(initial.generation)||initial.generation<0||!['LEGACY','ACTIVE','SHADOW','MAINTENANCE'].includes(initial.mode))throw Error('Original shared Account inventory control unavailable');
  if(initial.mode==='LEGACY'){if(initial.pending!==null)throw Error('Original shared Account legacy save pending');return{mode:'LEGACY'};}
  if(initial.mode!=='ACTIVE')return{mode:initial.mode};
  if(PURCHASE_CURRENT_PROJECTION_VERSION!==2)throw Error('Original paired current shared Account projector required');
  const [orders,tasks]=company==='NCT'?['NCTOrders','NCTTasks']:['NCTOrders1','NCTTasks1'];
  const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:['activityTime'],
    [orders]:['masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
  const base=createSegmentedFencedProof({company,store,domainWrites:true}),protocol={...base,readSnapshot:read=>base.readSnapshot(control=>{
    if(control.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||!control.writerBuild
      ||requiredWriters.some(writer=>writerCoverage[writer]?.verified!==true||writerCoverage[writer].build!==control.writerBuild))throw Error('All original shared Account co-writers required');return read(control);
  })};
  const readTables=createCurrentPurchaseTables({company,store,readOriginalTable:collection=>fulfilmentStore.all(collection)});
  const readTasks=async(selected,ids)=>{
    if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current shared Account task scope required');
    const rows=[];for(const id of ids)rows.push(await store.read(tasks,id));return rows;
  };
  async function readRows(selected,staff,control){
    if(selected!==company)throw Error('Original shared Account projection company conflict');
    const tables=await readTables(company,staff),originalArguments={company,staff,orders:tables[orders],tasks:tables[tasks],activity:tables[journal],suppliers:tables.SharedSuppliers};
    const context={...projectPurchaseWorkspace(originalArguments),activity:tables[journal]};
    const current=await readCurrentPurchaseProjection({company,context,staff,control,items,store,originalArguments,projectPurchaseWorkspace,
      currentProjectionVersion:PURCHASE_CURRENT_PROJECTION_VERSION,readCurrentTaskRows:readTasks,readPurchaseRecords:async()=>tables.PurchaseOrders,
      projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation});
    const original=createPurchaseOrderOperations({store:{all:async collection=>{if(collection!=='PurchaseOrders')throw Error('Original shared Account list collection conflict');return tables.PurchaseOrders;}},
      names:{[company]:{activity:journal}},readWorkspace:async()=>({...current.workspace,activity:tables[journal]}),now:()=>new Date()});
    return original.list(company,staff);
  }
  const dependencies={readMember:()=>currentMember.getMember({fieldsets:['FULL']}),readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),requireAccountStaff,
    readOrders:async(selected,staff)=>readRows(selected,staff,await protocol.readControl()),createAccountSettlementOperations,createAccountReviewOperations,createSupplierCreditOperations,now:()=>new Date()};
  const recordSave=createCurrentAccountOrderRecordSave({company,store,protocol,coverage:writerCoverage,authorityDependencies:dependencies});
  const auxiliarySave=createCurrentAccountAuxiliarySave({company,store,protocol,coverage:writerCoverage,authorityDependencies:dependencies});
  const fileSave=createCurrentOrderFileSave({company,department:'ACCOUNT',store,coverage:writerCoverage,createAccountSettlementOperations,
    authenticateOriginal:originalAccountStaff,now:()=>new Date(),
    readOriginalContext:async(selected,staff)=>{if(selected!==company)throw Error('Original Account file company conflict');const tables=await readTables(company,staff);
      return{rows:await readRows(selected,staff,await protocol.readControl()),records:tables.PurchaseOrders,suppliers:tables.SharedSuppliers};},
    allocateDocumentSlot:async selected=>{if(selected!==company)throw Error('Original Account allocation company conflict');return(await requestPurchaseDocument({action:'ALLOCATE',company})).fileId;},
    createFileProtocol:({request,staff})=>({...createSegmentedFencedProof({company,store:createOrderFileFencedStore({company,department:'ACCOUNT',staff,request,store,documentService:requestPurchaseDocument}),domainWrites:true}),readSnapshot:protocol.readSnapshot})});
  return{mode:'ACTIVE',save:request=>{
    if(!request?.stockIdentity||JSON.stringify(request).length>(request.input?.action==='DOCUMENT_UPLOAD'?4400000:200000))throw Error('Original identified shared Account request required');
    if(['DOCUMENT_UPLOAD','PAYMENT_FILE_DELETE'].includes(request.input?.action))return fileSave(request);
    if(['INVOICE_CHECK','APPLY_CREDIT'].includes(request.input?.action))return auxiliarySave(request);
    if(recordActions.includes(request.input?.action))return recordSave(request);
    throw Error('Original shared Account action required');
  },list:async expectedStaff=>{
    const staff=await originalAccountStaff();if(staff.staffId!==expectedStaff?.staffId||staff.memberId!==expectedStaff?.memberId)throw Error('Original shared Account read actor changed');
    const snapshot=await protocol.readSnapshot(async control=>({rows:await readRows(company,staff,control),stockCurrent:{stockProtocol:1,stockBuild:control.writerBuild,
      stockGeneration:control.generation,stockIdentity:{staffId:staff.staffId,memberId:staff.memberId}}}));return snapshot.rows;
  }};
}
