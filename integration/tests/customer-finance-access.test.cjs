const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {resolveManagedStaff,canEnterDepartment,canUseDepartment}=require('./load-master-module.cjs')('staffManagementPolicy.js');
function evaluate(file,bindings,names){const source=fs.readFileSync(path.join(__dirname,'../backend',file),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');return vm.runInNewContext('(function(){'+source+'\nreturn {'+names.join(',')+'};})()',bindings);}
function wrapper(departments,role='STAFF',staffOverrides={}){
 let approved=true,posts=0,last=null;
 const departmentAccess=Object.fromEntries(departments.filter(department=>department!=='SALES').map(department=>[department,'EDIT']));
 if(role==='TOP MANAGEMENT') departmentAccess.ACCOUNT='EDIT';
 const record={staffEmail:'test@example.invalid',description:'M',staffStatus:'ACTIVE',title:'S',staffName:'Staff',role,
  staffAccess:{departmentAccess,companyIds:['NCT'],customerAccess:{C:'EDIT'}},...staffOverrides};
 const readManagedCompanyAccess=async company=>{
  const member={_id:'M',status:approved?'APPROVED':'BLOCKED',loginEmail:'test@example.invalid'};
  const resolved=resolveManagedStaff(member,[record]);
  const can=(department,action,customerId)=>canUseDepartment(resolved,department,action,customerId,company);
  return {staff:{staffId:resolved.title,staffName:resolved.staffName,role:resolved.role,memberId:member._id},can,
   enter:(department,action)=>canEnterDepartment(resolved,department,action,company),
   require:(department,action,customerId)=>{if(!can(department,action,customerId))throw Error('Staff permission does not allow this operation.');}};
 };
 const api=evaluate('customerFulfilment.web.js',{
  webMethod:(_,fn)=>fn,Permissions:{SiteMember:'MEMBER'},readManagedCompanyAccess,
  readCustomerFulfilment:async()=>({customers:[{id:'C'}],plans:[],deskRemainders:[],
   customerAccount:{pendingDocuments:[{customerId:'C',referenceAmountCents:10000}],entries:[],balances:[],invoicePayments:{invoices:[],unapplied:[]}},
   accountVersion:'V',debtorInvoices:[{customerId:'C',amountCents:10000}],lines:[{customerId:'C',sellingPriceCtn:10}],shipments:[]}),
  saveCustomerFulfilment:async()=>({ok:true}),confirmCustomerAccountDocument:async request=>{posts++;last=request;return {ok:true,company:request.company,requestId:request.requestId};}
 },['confirmCustomerAccount','getCustomerFulfilment']);
 return {api,posts:()=>posts,last:()=>last,block:()=>approved=false};
}
test('Finance and existing super-admin can reach confirmation with server-derived authority',async()=>{for(const [departments,role] of [[['ACCOUNT'],'STAFF'],[[],'SUPER ADMIN']]){const f=wrapper(departments,role);await f.api.confirmCustomerAccount('NCT','request',{action:'CONFIRM_DOCUMENT'});assert.equal(f.posts(),1);assert.equal(f.last().staff.canPostCustomerAccount,true);assert.equal(f.last().staff.staffId,'S');}});
test('Support and Warehouse cannot obtain confirmation authority from a forged request',async()=>{for(const dep of ['SUPPORT','WAREHOUSE']){const f=wrapper([dep]);await assert.rejects(f.api.confirmCustomerAccount('NCT','request',{canPostCustomerAccount:true,staff:{role:'SUPER ADMIN'}}),/permission/);assert.equal(f.posts(),0);}});
test('blocked member cannot read or confirm regardless of staff department',async()=>{const f=wrapper(['ACCOUNT']);f.block();await assert.rejects(f.api.confirmCustomerAccount('NCT','r',{}),/approved/);await assert.rejects(f.api.getCustomerFulfilment('NCT'),/approved/);assert.equal(f.posts(),0);});
test('Warehouse does not receive reference amounts, pending customer proofs or customer ledger version',async()=>{const f=wrapper(['WAREHOUSE']),r=await f.api.getCustomerFulfilment('NCT');assert.equal(r.customerAccount,undefined);assert.equal(r.accountVersion,undefined);assert.equal(r.debtorInvoices.length,0);assert.equal(r.lines[0].sellingPriceCtn,undefined);assert.equal(r.permissions.customerAccountConfirm,false);});
test('Support can read the account result but never receives a Finance confirmation permission',async()=>{const f=wrapper(['SUPPORT']),r=await f.api.getCustomerFulfilment('NCT');assert.equal(r.customerAccount.pendingDocuments[0].referenceAmountCents,10000);assert.equal(r.permissions.customerAccountConfirm,false);});
test('TOP MANAGEMENT retains existing Finance receipt authority without gaining Support invoice or Warehouse dispatch authority',async()=>{const f=wrapper([],'TOP MANAGEMENT'),r=await f.api.getCustomerFulfilment('NCT');assert.equal(r.permissions.customerAccountConfirm,true);assert.equal(r.permissions.invoice,false);assert.equal(r.permissions.dispatch,false);await f.api.confirmCustomerAccount('NCT','top-management-receipt',{action:'CONFIRM_DOCUMENT'});assert.equal(f.posts(),1);assert.equal(f.last().staff.role,'TOP MANAGEMENT');});
test('TOP MANAGEMENT must still have an active exact staff identity',async()=>{for(const overrides of [{staffStatus:'INACTIVE'},{description:'OTHER_MEMBER'},{title:''},{staffName:''}]){const f=wrapper([],'TOP MANAGEMENT',overrides);await assert.rejects(f.api.getCustomerFulfilment('NCT'),/not authorized/);await assert.rejects(f.api.confirmCustomerAccount('NCT','r',{}),/not authorized/);assert.equal(f.posts(),0);}});
test('Purchase and Sales departments cannot acquire customer Finance posting authority',async()=>{for(const department of ['PURCHASE','SALES']){const f=wrapper([department]);await assert.rejects(f.api.confirmCustomerAccount('NCT','r',{canPostCustomerAccount:true}),/not authorized/);assert.equal(f.posts(),0);}});
test('Sales relay ignores forged Finance flags and only permits historical DOCUMENT recovery',async()=>{
 const secret='test-only-shared-secret',seen=[];
 const api=evaluate('customerFulfilmentGateway.js',{Buffer,timingSafeEqual:require('node:crypto').timingSafeEqual,getSecret:async()=>secret,handleSalesTaskChat:async()=>({}),readCustomerFulfilment:async()=>({}),readCustomerTransactionHistory:async()=>({}),saveCustomerFulfilment:async()=>({}),saveCustomerAccountDocument:async r=>{seen.push(r);return {ok:false};}},['handleSalesFulfilment']);
 const request=action=>({headers:{Authorization:'Bearer '+secret},body:{json:async()=>({company:'NCT',customerId:'C',customerName:'Customer',staff:{staffId:'S',staffName:'Sales',role:'SUPER ADMIN',canPostCustomerAccount:true},action,requestId:'r',input:{canPostCustomerAccount:true}})}});
 await api.handleSalesFulfilment(request('DOCUMENT'));assert.equal(seen.length,1);assert.equal(seen[0].staff.canPostCustomerAccount,false);assert.equal(seen[0].staff.canUploadCustomerDocument,false);
 const denied=await api.handleSalesFulfilment(request('CONFIRM_DOCUMENT'));assert.equal(denied.status,400);assert.equal(seen.length,1);
});
