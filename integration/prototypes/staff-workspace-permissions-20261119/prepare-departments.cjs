// Permission-only patches against captured formal sources. Business bodies,
// request IDs, receipt readers and financial/inventory operations stay intact.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),formal=path.join(__dirname,'formal');
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const existing=new Map(['warehouseReceiving.web.js','packingLists.web.js','customerFulfilment.web.js','accountPurchase.web.js','stockExceptions.web.js','stockValuation.web.js','warehouseStockIssues.web.js','taskChat.web.js'].map(name=>[name,read(path.join(root,'integration/backend',name))]));
function between(source,start,end){const a=source.indexOf(start),b=end?source.indexOf(end,a):source.length;assert(a>=0&&b>a,start);return source.slice(a,b);}
function prepare(name,edit){
 let source=read(path.join(formal,name));
 const r=(old,next)=>{assert.equal(source.split(old).length,2,name+': '+old.slice(0,100));source=source.replace(old,()=>next);};
 const all=(old,next,count)=>{assert.equal(source.split(old).length-1,count,name+': count '+old);source=source.split(old).join(next);};
 const section=(start,end,editPart)=>{const part=between(source,start,end);r(part,editPart(part));};
 edit({r,all,section,source:()=>source});
 fs.writeFileSync(path.join(root,'integration/backend',name),source.trimEnd()+'\n');
}

prepare('warehouseReceiving.web.js',({r,all,section})=>{
 r("import { currentMember } from 'wix-members-backend';","import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';");
 r('async function staffContext(){return requireWarehouseStaff(await currentMember.getMember({fieldsets:[\'FULL\']}),await store.all(\'StaffMasterAccess\'));}',"async function staffContext(company,action='VIEW'){return getManagedDepartmentContext('WAREHOUSE',company,action);}");
 all('await staffContext()','await staffContext(company)',5);
 for(const name of ['saveWarehouseReceipt','saveWarehousePreparation','captureWarehouseCbm'])section('export const '+name,'\n});',part=>part.replace('await staffContext(company)',"await staffContext(company,'EDIT')"));
});

prepare('accountPurchase.web.js',({r,all,section})=>{
 r("import { currentMember } from 'wix-members-backend';","import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';");
 r('async function accountStaff(){return requireAccountStaff(await currentMember.getMember({fieldsets:[\'FULL\']}),await store.all(\'StaffMasterAccess\'));}',"async function accountStaff(company,action='VIEW'){return getManagedDepartmentContext('ACCOUNT',company,action);}");
 all('await accountStaff()','await accountStaff(company)',7);
 for(const name of ['saveAccountSettlement','maintainAccountReadIndex','saveAccountInvoiceCheck'])section('export const '+name,'\n});',part=>part.replace('await accountStaff(company)',"await accountStaff(company,'EDIT')"));
});

prepare('warehouseStockIssues.web.js',({r,all,section,source})=>{
 r("import { currentMember } from 'wix-members-backend';","import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';");
 r(between(source(),'async function staffContext()', '\nasync function listOrders'),between(existing.get('warehouseStockIssues.web.js'),'async function staffContext(', '\nasync function listOrders'));
 all('await staffContext()','await staffContext(company)',3);
 section('export const saveWarehouseStockIssue','\n});',part=>part.replace('await staffContext(company)',"await staffContext(company,'EDIT')"));
});

prepare('stockExceptions.web.js',({r,all,source})=>{
 r("import { currentMember } from 'wix-members-backend';","import { readManagedCompanyAccess, readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';");
 r(between(source(),'async function staffContext()', '\nasync function listOrders'),between(existing.get('stockExceptions.web.js'),'async function staffContext(', '\nasync function listOrders'));
 r(between(source(),'async function messageStaffContext()', '\nconst saveMessage='),between(existing.get('stockExceptions.web.js'),'async function messageStaffContext(', '\nexport const getDepartmentMessages'));
 all('await staffContext()','await staffContext(company)',3);
 all('await messageStaffContext()','await messageStaffContext(company,department)',2);
});

prepare('taskChat.web.js',({r,all,section,source})=>{
 r("import { currentMember } from 'wix-members-backend';","import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';");
 r(between(source(),'async function staffContext(department)', '\nconst index='),between(existing.get('taskChat.web.js'),'async function staffContext(company', '\nconst index='));
 all('await staffContext(department)','await staffContext(company,department)',3);
 section('export const saveTaskChat','\n});',part=>part.replace('await staffContext(company,department)',"await staffContext(company,department,'EDIT')"));
 r('return {...result,nextHistory:',"return {...result,...(department==='SUPPORT'?{tasks:result.tasks.filter(task=>staff.chatCustomerAllowed?.(task.customerId)),legacyArchive:[]}:{}),nextHistory:");
});

prepare('packingLists.web.js',({r,source,section})=>{
 r("import { currentMember } from 'wix-members-backend';","import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';\nimport { readPackingLists } from 'backend/packingListOperations.js';");
 r(between(source(),'async function staffContext(', '\nexport const getPackingLists'),between(existing.get('packingLists.web.js'),'async function workroom(', '\nexport const getPackingLists'));
 r(between(source(),'export const getPackingLists=', '\nexport const savePackingList'),between(existing.get('packingLists.web.js'),'export const getPackingLists=', '\nexport const savePackingList'));
 r(' const staff=await staffContext(department);',between(existing.get('packingLists.web.js'),' const access=await workroom(company,department),staff=access.staff;', '\n try{return await savePackingOperation'));
 r(" const staff=await staffContext('WAREHOUSE');"," const {staff}=await workroom(company,'WAREHOUSE');");
});

prepare('stockValuation.web.js',({r,source})=>{
 // Same validation and projection as the existing reader, with request-local
 // MASTER permission replacing its legacy employee-list adapter.
 r("import { currentMember } from 'wix-members-backend';","import { getManagedDepartmentContext } from 'backend/staffManagementAccess.js';\nimport { validateStockListInput } from 'backend/stockControlService.js';");
 r("import { createStockValuationReader } from 'backend/stockValuationService.js';","import { projectStockValuationPage } from 'backend/stockValuationService.js';");
 r(between(source(),'const read = createStockValuationReader(',''),between(existing.get('stockValuation.web.js'),'export const getFinanceStockList','').replace("async (company, input = {}) => {\n  const staff", "async (company, input = {}) => {\n  if (!['NCT', 'GHR'].includes(company)) throw Error('Select NCT or GHR.');\n  const staff"));
});

prepare('customerFulfilment.web.js',({r,source})=>{
 r("import { currentMember } from 'wix-members-backend';","import { readManagedCompanyAccess } from 'backend/staffManagementAccess.js';\nimport { PURCHASE_COLLECTIONS } from 'backend/purchaseProjection.js';\nimport { readCustomerShipments } from 'backend/customerShipmentLedger.js';");
 for(const [start,end]of [['async function staffContext()', '\nexport const getCustomerFulfilment'],['export const getCustomerFulfilment=', '\nexport const saveCustomerShipment'],['export const saveCustomerShipment=', '\n\nexport const confirmCustomerAccount'],['export const confirmCustomerAccount=','']]){
   const canonicalStart=start==='async function staffContext()'?'async function staffContext(company)':start;
   r(between(source(),start,end),between(existing.get('customerFulfilment.web.js'),canonicalStart,end));
 }
});

prepare('supportWorkroom.web.js',({r,all,section})=>{
 r("import { currentMember } from 'wix-members-backend';","import { readManagedWorkroomAccess } from 'backend/staffManagementAccess.js';");
 r("async function supportStaff(){return requirePackingStaff(await currentMember.getMember({fieldsets:['FULL']}),await fulfilmentStore.all('StaffMasterAccess'),'SUPPORT');}",`async function supportAccess(company){
 const access=await readManagedWorkroomAccess('SUPPORT',company);
 return {...access,staff:{...access.staff,packingDepartment:'SUPPORT'}};
}
async function supportStaff(company,customerId){const access=await supportAccess(company);access.require('EDIT',customerId);return access.staff;}
const visible=(access,rows)=>rows.filter(row=>access.can('VIEW',row.customerId));
function scopedPacking(access,view){
 const tasks=visible(access,view.tasks),ids=new Set(tasks.map(row=>row.taskId));
 return {...view,tasks,lists:visible(access,view.lists),portions:visible(access,view.portions),deskSummaries:view.deskSummaries.filter(row=>ids.has(row.taskId)),pendingResolutions:visible(access,view.pendingResolutions),pendingAuthorizations:view.pendingAuthorizations.filter(row=>access.can('VIEW',row.input?.customerId))};
}`);
 r('function projectSupportBookings(company,staff,activity){','function projectSupportBookings(company,staff,activity,access){');
 r('const deskLocks=readSupportDeskLocks({company,activity});','const deskLocks=visible(access,readSupportDeskLocks({company,activity}));');
 r("activity.filter(row=>row.action==='SUPPORT_INVOICE_PREPARED'&&row.details?.desk)","activity.filter(row=>row.action==='SUPPORT_INVOICE_PREPARED'&&row.details?.desk&&access.can('VIEW',row.image))");
 r('bookings:readSupportBookings(activity,company),desks:readSupportDesks(activity,company).map','bookings:visible(access,readSupportBookings(activity,company)),desks:visible(access,readSupportDesks(activity,company)).map');
 all('  const staff=await supportStaff();','  const access=await supportAccess(company),staff=access.staff;',2);
 r('projectSupportBookings(company,staff,await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity))','projectSupportBookings(company,staff,await fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity),access)');
 r('readPackingWorkroom(company,staff,{activityRead}),','readPackingWorkroom(company,staff,{activityRead}).then(view=>scopedPacking(access,view)),');
 r('activityRead.then(activity=>projectSupportBookings(company,staff,activity))','activityRead.then(activity=>projectSupportBookings(company,staff,activity,access))');
 for(const name of ['saveSupportBooking','issueSupportInvoice','uploadSupportDocument','saveSupportCustomer'])section('export const '+name,'\n',part=>part.replace('await supportStaff()', 'await supportStaff(company,input?.customerId)'));
 // uploadSupportDocument puts its staff adapter on the following line.
 r("try{return await (input?.action==='DELIVER'?deliverDocument:saveDocument)({company,staff:await supportStaff(),requestId,input});}","try{return await (input?.action==='DELIVER'?deliverDocument:saveDocument)({company,staff:await supportStaff(company,input?.customerId),requestId,input});}");
 r("export const getSupportInvoiceState=webMethod(Permissions.SiteMember,async company=>{const staff=await supportStaff();if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');return readSupportInvoiceState(await readFulfilmentContext(company,staff),readCurrentAdminFx);});",`export const getSupportInvoiceState=webMethod(Permissions.SiteMember,async company=>{const access=await supportAccess(company),context=await readFulfilmentContext(company,access.staff),state=await readSupportInvoiceState(context,readCurrentAdminFx),allowed=new Set(context.tasks.filter(row=>access.can('VIEW',row.customerId)).map(row=>row.id));return {...state,lines:state.lines.filter(row=>allowed.has(row.taskId)),deskLines:state.deskLines.filter(row=>allowed.has(row.taskId))};});`);
 r('export const withdrawSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>cancelInvoice({company,staff:await supportStaff(),requestId,input}));',`export const withdrawSupportInvoice=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{
 const access=await supportAccess(company);
 if(!/^[a-f0-9-]{36}$/i.test(input?.invoiceRequestId||''))throw Error('Select the original invoice request.');
 const intent=await fulfilmentStore.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,input.invoiceRequestId,access.staff.memberId,'SUPPORT_INVOICE_PREPARED'));
 if(!intent||intent.details?.memberId!==access.staff.memberId)throw Error('This pending invoice is unavailable.');
 access.require('EDIT',intent.image);
 return cancelInvoice({company,staff:access.staff,requestId,input});
});`);
 r('const staff=await supportStaff();if(![\'NCT\',\'GHR\'].includes(company))throw Error(\'Select NCT or GHR.\');const activity=', 'const access=await supportAccess(company),staff=access.staff;const activity=');
 r('pendingUploads:pendingSupportDocumentUploads(activity,company,staff),documents:readSupportDocuments(activity,company).map(withFinance),customerFiles:supportCustomerFiles({company,activity}).map(withFinance)',"pendingUploads:pendingSupportDocumentUploads(activity,company,staff).filter(row=>access.can('VIEW',row.context?.customerId)),documents:visible(access,readSupportDocuments(activity,company)).map(withFinance),customerFiles:visible(access,supportCustomerFiles({company,activity})).map(withFinance)");
 r('export const getSupportCustomers=webMethod(Permissions.SiteMember,async company=>requestSupportCustomers({company,staff:await supportStaff()}));',"export const getSupportCustomers=webMethod(Permissions.SiteMember,async company=>{const access=await supportAccess(company),result=await requestSupportCustomers({company,staff:access.staff});return {...result,customers:result.customers.filter(row=>access.can('VIEW',row.id))};});");
 // Receipt correlation and the original request are preserved; this is read-only.
 r(' const staff=await supportStaff();'," const access=await supportAccess(company),staff=access.staff;access.require('VIEW',customerId);");
});
console.log('Prepared 9 permission adapters from preserved formal originals');
