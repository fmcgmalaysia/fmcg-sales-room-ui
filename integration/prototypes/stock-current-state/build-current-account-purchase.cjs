'use strict';
// Original Account co-writer binding, not new finance policy or public endpoints.
const fs = require('node:fs'), path = require('node:path'), { WRITERS } = require('./stock-admission.cjs');
const root = path.resolve(__dirname, '../../..');
function once(source, before, after) { if (source.split(before).length !== 2) throw Error('Exact original shared Account root anchor changed: ' + before.slice(0, 80)); return source.replace(before, () => after); }
let web = fs.readFileSync(path.join(root, 'integration/backend/accountPurchase.web.js'), 'utf8').replace(/\r\n/g, '\n');
web = "import { createCurrentAccountPurchase } from 'backend/stockCurrentAccountPurchase.js';\n" + web;
web = once(web, 'const accountIndex=staff=>', `async function accountAuthorityRows(company,staff){
  const current=await createCurrentAccountPurchase(company);
  if(current?.mode==='LEGACY')return{rows:await orders.list(company,staff)};
  if(current?.mode!=='ACTIVE')throw Error('Original shared Account rows unavailable');return current.list(staff);
}
function accountCurrentRequest(requestId,input,stockCurrent){
  if(!stockCurrent||typeof stockCurrent!=='object'||Array.isArray(stockCurrent)||Object.keys(stockCurrent).some(key=>!['stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
    ||JSON.stringify({input,stockCurrent}).length>(input?.action==='DOCUMENT_UPLOAD'?4400000:200000))throw Error('Original current shared Account request unconfirmed');
  return{requestId,input,...stockCurrent};
}
const accountIndex=staff=>`);
web = once(web, 'readRows:company=>orders.list(company,staff)', 'readRows:async company=>(await accountAuthorityRows(company,staff)).rows');
const signature = 'webMethod(Permissions.SiteMember,async(company,requestId,input)=>{';
if (web.split(signature).length !== 3) throw Error('Exactly original settlement and legacy-review endpoints required');
web = web.replaceAll(signature, 'webMethod(Permissions.SiteMember,async(company,requestId,input,stockCurrent)=>{');
web = once(web, "  try{return input?.action==='APPLY_CREDIT'?await applySupplierCredit({company,staff,requestId,input}):await settlements.save({company,staff,requestId,input});}",
  "  try{const current=await createCurrentAccountPurchase(company);\n    if(current?.mode==='LEGACY'&&stockCurrent===undefined)return input?.action==='APPLY_CREDIT'?await applySupplierCredit({company,staff,requestId,input}):await settlements.save({company,staff,requestId,input});\n    if(current?.mode!=='ACTIVE'||input?.action==='INVOICE_CHECK')throw Error('Original shared Account save unavailable');return await current.save(accountCurrentRequest(requestId,input,stockCurrent));}");
web = once(web, '  try{return await reviews.save({company,staff,requestId,input});}',
  "  try{const current=await createCurrentAccountPurchase(company);\n    if(current?.mode==='LEGACY'&&stockCurrent===undefined)return await reviews.save({company,staff,requestId,input});\n    if(current?.mode!=='ACTIVE'||input?.action!=='INVOICE_CHECK')throw Error('Original legacy invoice review unavailable');return await current.save(accountCurrentRequest(requestId,input,stockCurrent));}");
const list = "  const staff=await accountStaff(),rows=await orders.list(company,staff),suppliers=await store.all('SharedSuppliers');";
if (web.split(list).length !== 3) throw Error('Exactly original Account full and paged reader required');
web = web.replaceAll(list, "  const staff=await accountStaff(),authority=await accountAuthorityRows(company,staff),rows=authority.rows,suppliers=await store.all('SharedSuppliers');");
web = once(web, '  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName,role:staff.role},orders:', '  return {company,...(authority.stockCurrent?{stockCurrent:authority.stockCurrent}:{}),staff:{staffId:staff.staffId,staffName:staff.staffName,role:staff.role},orders:');
web = once(web, '  return {company,staff:{staffId:staff.staffId,staffName:staff.staffName,role:staff.role},...result,', '  return {company,...(authority.stockCurrent?{stockCurrent:authority.stockCurrent}:{}),staff:{staffId:staff.staffId,staffName:staff.staffName,role:staff.role},...result,');
web = once(web, 'export const getAccountPurchaseOrders=webMethod(Permissions.SiteMember,async company=>{', 'export const getAccountPurchaseOrders=webMethod(Permissions.SiteMember,async(company,readOptions)=>{');
web = once(web, "  const staff=await accountStaff(),authority=await accountAuthorityRows(company,staff),rows=authority.rows,suppliers=await store.all('SharedSuppliers');let names=[],customerNamesError='';",
  "  const staff=await accountStaff();\n  if(readOptions!==undefined){if(!['NCT','GHR'].includes(company)||!readOptions||typeof readOptions!=='object'||Array.isArray(readOptions)||Object.keys(readOptions).length!==1||readOptions.contextOnly!==true)throw Error('Original Account context request required');\n    return{ok:true,schema:'ACCOUNT_ORIGINAL_CONTEXT_V1',company,staff:{staffId:staff.staffId,staffName:staff.staffName,memberId:staff.memberId}};}\n  const authority=await accountAuthorityRows(company,staff),rows=authority.rows,suppliers=await store.all('SharedSuppliers');let names=[],customerNamesError='';");
const source = `import { items } from '@wix/data';
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
const requiredWriters=Object.freeze(${JSON.stringify(WRITERS)});
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
    [orders]:['estimatedShipmentDate','masterReceivedTime','salesSubmissionTime'],[tasks]:['lastCostCaptureTime']}});
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
`;
for (const [name, text] of Object.entries({ 'accountPurchase.web.candidate.js': web, 'stockCurrentAccountPurchase.js': source })) {
  new Function(text.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  const target = path.join(__dirname, name);
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('Original shared Account candidate differs: ' + name); }
  else fs.writeFileSync(target, text);
}
process.stdout.write('Original shared Account web/private current record/file root ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; not installed\n');
