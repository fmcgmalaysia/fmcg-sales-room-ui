import { createHash } from 'crypto';
const text=value=>String(value??'').trim();
// Same editable fields and validation as the existing Sales customer profile.
// Identity, country, assignment, access and QD routing remain locked.
export const SUPPORT_PROFILE_FIELDS=Object.freeze(['natureOfBusiness','picTitle','picName','mobileNo','whatsapp','preferredCurrency','destinationPortName','address1','address2','address3','primaryEmail','companyWebsite']);
const choices={natureOfBusiness:['WHOLESALE','RETAIL','E-COMMERCE','SOURCING AGENT','OTHERS'],picTitle:['','MR','MRS','MS','DR'],whatsapp:['YES','NO'],preferredCurrency:['USD','MYR','SGD','RMB','JPY']};
export const profileHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function supportProfilePatch(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).some(key=>!SUPPORT_PROFILE_FIELDS.includes(key)))throw Error('Only editable customer profile fields may be changed.');
 const patch={};for(const key of SUPPORT_PROFILE_FIELDS){if(!Object.hasOwn(input,key))continue;if(typeof input[key]!=='string'||input[key].length>500)throw Error('Invalid profile value.');let value=text(input[key]);if(choices[key]){value=value.toUpperCase();if(!choices[key].includes(value))throw Error('Invalid '+key+'.');}if(key==='primaryEmail'){value=value.toLowerCase();if(value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error('Invalid primary email.');}if(key==='mobileNo'&&value&&value.replace(/\D/g,'').length<4)throw Error('Mobile number must contain at least 4 digits.');patch[key]=value;}return patch;
}
export function supportCustomerView(row){
 if(!row?.customerId||!row.title)throw Error('Customer profile identity is incomplete.');
 const fields=Object.fromEntries(SUPPORT_PROFILE_FIELDS.map(key=>[key,text(row[key])])),revision=profileHash([row._id,row.customerId,row._updatedDate?new Date(row._updatedDate).toISOString():'',fields]);
 return {id:text(row.customerId),name:text(row.title),country:text(row.country),currency:text(row.preferredCurrency),port:text(row.destinationPortName),profile:{...fields,revision}};
}
export function createSupportCustomerOperations({store,now=()=>new Date()}){
 return async({action,company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||staff?.department!=='SUPPORT'||!text(staff.memberId)||!text(staff.staffId)||!text(staff.staffName))throw Error('Support access is required.');
  const rows=await store.customers(),ids=rows.map(row=>row.customerId);if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw Error('Customer identities require review.');
  if(action==='READ')return {company,customers:rows.map(supportCustomerView)};
  if(action!=='SAVE'||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||typeof input.customerId!=='string'||!/^[a-f0-9]{64}$/.test(input.revision||''))throw Error('Invalid customer profile save.');
  let row=rows.find(row=>row.customerId===input.customerId);if(!row)throw Error('Customer was not found.');
  const patch=supportProfilePatch(input.patch),id=profileHash(['SUPPORT_PROFILE',staff.memberId,requestId]),digest=profileHash([company,staff.staffId,input.customerId,input.revision,patch]);
  let intent=await store.audit(id);
  if(intent){if(intent.afterValue!==JSON.stringify({digest,patch})||intent.customerId!==input.customerId||intent.changedByStaffId!==staff.staffId)throw Error('This save request was already used for different changes.');}
  else{
   if(supportCustomerView(row).profile.revision!==input.revision)throw Error('The customer profile changed. Close this window and refresh before editing.');
   intent={_id:id,title:id,auditId:id,customerId:row.customerId,entityId:row.customerId,action:'SUPPORT_PROFILE_REQUEST',fieldId:'profile',fieldLabel:'Customer Profile',beforeValue:JSON.stringify(supportCustomerView(row).profile),afterValue:JSON.stringify({digest,patch}),changedAt:now().toISOString(),changedByStaffId:staff.staffId,changedByStaffName:staff.staffName,changedByRole:'SUPPORT'};
   try{await store.insertAudit(intent);}catch(error){const saved=await store.audit(id);if(saved?.afterValue!==intent.afterValue||saved?.customerId!==intent.customerId)throw error;}
  }
  // Re-read after the durable request. Reject a changed version observed before saving; existing Sales saves use Wix Data update.
  row=await store.customer(row._id);if(!row||row.customerId!==input.customerId)throw Error('Customer identity changed.');
  const applied=()=>Object.keys(patch).every(key=>text(row[key])===patch[key]);
  if(!applied()){
   if(supportCustomerView(row).profile.revision!==input.revision)throw Error('The customer profile changed. Close this window and refresh before editing.');
   try{await store.updateCustomer({...row,...patch});}catch(error){row=await store.customer(row._id);if(!row||!applied())throw error;}
  }
  row=await store.customer(row._id);if(!row||!applied())throw Error('Customer profile save is not confirmed. Retry the same save.');
  const before=JSON.parse(intent.beforeValue);
  for(const key of Object.keys(patch)){
   const auditId=profileHash([id,key,'APPLIED']),event={_id:auditId,title:auditId,auditId,customerId:row.customerId,entityId:row.customerId,action:'PROFILE_FIELD_UPDATED',fieldId:key,fieldLabel:key,beforeValue:text(before[key]),afterValue:patch[key],changedAt:now().toISOString(),changedByStaffId:staff.staffId,changedByStaffName:staff.staffName,changedByRole:'SUPPORT'};
   const prior=await store.audit(auditId);if(prior){if(prior.afterValue!==patch[key]||prior.customerId!==row.customerId)throw Error('Profile audit requires review.');continue;}
   try{await store.insertAudit(event);}catch(error){const saved=await store.audit(auditId);if(saved?.afterValue!==patch[key]||saved?.customerId!==row.customerId)throw error;}
  }
  return {company,requestId,customerId:row.customerId,saved:true};
 };
}
