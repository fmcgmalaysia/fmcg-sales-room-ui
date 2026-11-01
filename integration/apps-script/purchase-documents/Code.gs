/* Dedicated purchase PDFs only. Never add this to Onboarding or Pointbase. */
const PURCHASE_ROOTS={NCT:'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS',GHR:'18w4I96N3PSCTv2Qxs_mycy-PMu-lth9w'};
const ACCOUNT_ROOTS={NCT:'1grq9bx7TcVhI3baSzpkLG0zglCuBorjA',GHR:'1hZ4qVKtNP2oc4Fj5NXbEamdIWU0RR30o'};
const SALES_ROOTS={NCT:'1omU7-s3sntQoajBBvOKVXzwS40N5Lmm0',GHR:'1uPcfFNLpXFDS5vn18hA5pbIdWRzxSzQ_'};
const CUSTOMER_ROOTS={NCT:'1j_nPM0vNZwYA3jyT_RKZ7uuIoZXxgTtP',GHR:'1M6Ahua23yx5TcsmTzhRxB0DWXP7fRABT'};
const SALES_TYPES=['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT'];
const SUPPORT_TYPES=['SUPPORT_SO','SUPPORT_BC','SUPPORT_SI','SUPPORT_DO','SUPPORT_CN','SUPPORT_DN','SUPPORT_PL','SUPPORT_INS','SUPPORT_CF','SUPPORT_BL','SUPPORT_PAYMENT'];
const FILE_FIELDS='id,name,mimeType,size,parents,appProperties,trashed,webViewLink';
function doPost(e) {
  let result;
  try {
    const input=JSON.parse(e.postData.contents),secret=PropertiesService.getScriptProperties().getProperty('PURCHASE_DOCUMENT_SHARED_SECRET');
    if(!secret||secret.length<32||typeof input.token!=='string'||input.token!==secret)throw Error('NOT_AUTHORIZED');
    if(!PURCHASE_ROOTS[input.company])throw Error('INVALID_COMPANY');
    if(input.action==='ALLOCATE')result={ok:true,fileId:Drive.Files.generateIds({count:1,space:'drive',type:'files'}).ids[0]};
    else if(input.action==='UPLOAD')result=uploadPurchasePdf_(input);
    else if(input.action==='DELIVER_CUSTOMER_DOCUMENT')result=deliverCustomerPdf_(input);
    else if(input.action==='TRASH')result=trashPurchasePdf_(input);
    else if(input.action==='PHOTO_UPLOAD')result=uploadWarehousePhoto_(input);
    else if(['CHAT_OPERATION','CHAT_SUMMARIES'].includes(input.action))result=taskChatService_(input);
    else throw Error('INVALID_ACTION');
  } catch(error) {
    const safe=['NOT_AUTHORIZED','INVALID_COMPANY','INVALID_ACTION','INVALID_DOCUMENT','INVALID_PDF','FILE_IDENTITY_CONFLICT','UPLOAD_UNCONFIRMED','CUSTOMER_DELIVERY_UNCONFIRMED'];
    result={ok:false,error:safe.includes(error.message)||/^CHAT_[A-Z_]+$/.test(error.message)?error.message:'DOCUMENT_SERVICE_UNAVAILABLE'};
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function uploadPurchasePdf_(input) {
  const sales=SALES_TYPES.includes(input.type),support=SUPPORT_TYPES.includes(input.type);
  let folder=(sales&&input.department==='SALES'||support&&input.department==='SUPPORT')?SALES_ROOTS[input.company]:input.type==='PAYMENT'&&input.department==='ACCOUNT'?ACCOUNT_ROOTS[input.company]:PURCHASE_ROOTS[input.company];
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(input.fileId||'')||!/^\w{32}$/.test(input.poId||'')||!/^\w{64}$/.test(input.sha256||'')||(!['PO','INV','CN','SO','PI','DO','PAYMENT'].includes(input.type)&&!sales&&!support)||(sales&&input.department!=='SALES')||(support&&input.department!=='SUPPORT')||(input.type==='PAYMENT'&&input.department!=='ACCOUNT')||typeof input.name!=='string'||!input.name.endsWith('.pdf')||input.name.length>300||typeof input.base64!=='string'||input.base64.length>4200000)throw Error('INVALID_DOCUMENT');
  const bytes=Utilities.base64Decode(input.base64);
  if(bytes.length<5||bytes.length>3*1024*1024||bytes.slice(0,5).map(n=>String.fromCharCode(n)).join('')!=='%PDF-')throw Error('INVALID_PDF');
  const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
  if(hash!==input.sha256)throw Error('INVALID_PDF');
  const props={company:input.company,poId:input.poId,sha256:hash,type:input.type,...(support?{department:'SUPPORT'}:{})};
  const customerDelivery=support&&input.customerId!==undefined;if(input.customerId!==undefined&&!customerDelivery)throw Error('INVALID_DOCUMENT');if(customerDelivery)validateCustomerDelivery_(input);
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    if(customerDelivery)folder=customerDestination_(input);
    let file;
    try {file=Drive.Files.create({id:input.fileId,name:input.name,mimeType:'application/pdf',parents:[folder],appProperties:props},Utilities.newBlob(bytes,'application/pdf',input.name),{fields:FILE_FIELDS});}
    catch(error){try{file=Drive.Files.get(input.fileId,{fields:FILE_FIELDS});}catch(unavailable){throw Error('UPLOAD_UNCONFIRMED');}}
    if(file.trashed||file.mimeType!=='application/pdf'||file.name!==input.name||Number(file.size)!==bytes.length||Object.keys(props).some(key=>file.appProperties?.[key]!==props[key]))throw Error('FILE_IDENTITY_CONFLICT');
    if(customerDelivery)file=finishCustomerFile_(file,input,folder);
    else if(file.parents?.length!==1||file.parents[0]!==folder){if(!(support||sales)||file.appProperties?.originalParent!==folder||!validCustomerLocation_(file,input.company))throw Error('FILE_IDENTITY_CONFLICT');}
    return {ok:true,fileId:file.id,name:file.name,size:Number(file.size),sha256:hash,company:input.company,poId:input.poId,url:file.webViewLink||null,...(customerDelivery?{customerId:input.customerId,customerLinkReady:true}: {})};
  } finally {lock.releaseLock();}
}


function trashPurchasePdf_(input) {
  const payment=input.type==='PAYMENT'&&input.department==='ACCOUNT',folder=payment?ACCOUNT_ROOTS[input.company]:PURCHASE_ROOTS[input.company];
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(input.fileId||'')||!/^\w{32}$/.test(input.poId||'')||!/^\w{64}$/.test(input.sha256||'')||(!['PO','INV','CN','SO','PI','DO'].includes(input.type)&&!payment)||typeof input.name!=='string'||input.name.length>300)throw Error('INVALID_DOCUMENT');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    let file=Drive.Files.get(input.fileId,{fields:FILE_FIELDS});
    const props={company:input.company,poId:input.poId,sha256:input.sha256,type:input.type};
    if(file.mimeType!=='application/pdf'||file.name!==input.name||!file.parents?.includes(folder)||Object.keys(props).some(key=>file.appProperties?.[key]!==props[key]))throw Error('FILE_IDENTITY_CONFLICT');
    if(!file.trashed)file=Drive.Files.update({trashed:true},input.fileId,null,{fields:FILE_FIELDS});
    if(file.trashed!==true)throw Error('UPLOAD_UNCONFIRMED');
    return {ok:true,fileId:file.id,name:file.name,company:input.company,poId:input.poId,sha256:input.sha256,type:input.type,trashed:true};
  } finally {lock.releaseLock();}
}

// One customer delivery mechanism. Folders stay private; only the validated PDF is shared.
function validateCustomerDelivery_(input){
  const customerType=SUPPORT_TYPES.includes(input.type)&&input.department==='SUPPORT'||SALES_TYPES.includes(input.type)&&input.department==='SALES';
  if(!customerType||!/^[A-Za-z0-9_-]{1,100}$/.test(input.customerId||'')||typeof input.customerName!=='string'||!input.customerName.trim()||input.customerName.length>300||!['CUSTOMER','ORDER','INVOICE','DESK','ACCOUNT'].includes(input.customerScope)||typeof input.businessId!=='string'||input.businessId.length>100||input.businessId&&!/^[A-Za-z0-9_-]+$/.test(input.businessId)||!['CUSTOMER','ACCOUNT'].includes(input.customerScope)&&!input.businessId)throw Error('INVALID_DOCUMENT');
  if(input.department==='SUPPORT'&&input.customerScope==='ACCOUNT'||input.department==='SALES'&&input.customerScope!=='ACCOUNT'||input.customerScope==='CUSTOMER'&&(!['SUPPORT_PAYMENT','SUPPORT_CN','SUPPORT_DN'].includes(input.type)||input.businessId))throw Error('INVALID_DOCUMENT');
}
function customerPermissions_(id){const result=Drive.Permissions.list(id,{pageSize:100,fields:'nextPageToken,permissions(id,type,role,allowFileDiscovery)'});if(result.nextPageToken||!Array.isArray(result.permissions))throw Error('CUSTOMER_DELIVERY_UNCONFIRMED');return result.permissions;}
function privateCustomerFolder_(id){const file=Drive.Files.get(id,{fields:FILE_FIELDS});if(file.trashed||file.mimeType!=='application/vnd.google-apps.folder'||customerPermissions_(id).some(p=>p.type==='anyone'||p.type==='domain'))throw Error('FILE_IDENTITY_CONFLICT');return file;}
function customerFolder_(parent,name,company,customerId,key){
  const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,Utilities.newBlob(JSON.stringify([company,customerId,key])).getBytes()).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
  const props={company,customerId,folderKey:hash},result=Drive.Files.list({q:"'"+parent+"' in parents and trashed = false and appProperties has { key='folderKey' and value='"+hash+"' }",pageSize:2,fields:'nextPageToken,files('+FILE_FIELDS+')'});
  if(result.nextPageToken||(result.files||[]).length>1)throw Error('FILE_IDENTITY_CONFLICT');
  const file=result.files?.[0]||Drive.Files.create({name,mimeType:'application/vnd.google-apps.folder',parents:[parent],appProperties:props},null,{fields:FILE_FIELDS});
  if(file.parents?.length!==1||file.parents[0]!==parent||Object.keys(props).some(k=>file.appProperties?.[k]!==props[k]))throw Error('FILE_IDENTITY_CONFLICT');
  privateCustomerFolder_(file.id);return file.id;
}
function customerDestination_(input){
  privateCustomerFolder_(CUSTOMER_ROOTS[input.company]);
  const clean=value=>String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,100),customer=customerFolder_(CUSTOMER_ROOTS[input.company],input.customerId+' '+clean(input.customerName),input.company,input.customerId,'CUSTOMER');
  const bucket=['SUPPORT_PAYMENT','CUSTOMER_RECEIPT'].includes(input.type)?'Customer Payments':['CUSTOMER','ACCOUNT'].includes(input.customerScope)?'Statements':'Shipments';
  const folder=customerFolder_(customer,bucket,input.company,input.customerId,bucket);
  return bucket==='Shipments'?customerFolder_(folder,clean(input.businessId),input.company,input.customerId,'SHIPMENT:'+input.businessId):folder;
}
function validCustomerLocation_(file,company){
  if(file.parents?.length!==1||file.appProperties?.company!==company||!/^[A-Za-z0-9_-]{1,100}$/.test(file.appProperties?.customerId||''))return false;
  let id=file.parents[0];for(let depth=0;depth<4;depth++){const folder=privateCustomerFolder_(id);if(id===CUSTOMER_ROOTS[company])return true;if(folder.appProperties?.company!==company||folder.appProperties?.customerId!==file.appProperties.customerId||folder.parents?.length!==1)return false;id=folder.parents[0];}return false;
}
function finishCustomerFile_(file,input,destination){
  if(customerPermissions_(file.id).some(p=>p.type==='domain'||p.type==='anyone'&&(p.role!=='reader'||p.allowFileDiscovery!==false)))throw Error('FILE_IDENTITY_CONFLICT');
  if(file.parents?.length!==1||file.appProperties?.customerId&&file.appProperties.customerId!==input.customerId||file.appProperties?.customerScope&&file.appProperties.customerScope!==input.customerScope||file.appProperties?.businessId!==undefined&&file.appProperties.businessId!==input.businessId)throw Error('FILE_IDENTITY_CONFLICT');
  const oldParent=file.parents[0],originalParent=file.appProperties.originalParent||SALES_ROOTS[input.company];
  if(originalParent!==SALES_ROOTS[input.company]||oldParent!==originalParent&&oldParent!==destination)throw Error('FILE_IDENTITY_CONFLICT');
  const props={...file.appProperties,customerId:input.customerId,customerScope:input.customerScope,businessId:input.businessId,originalParent};
  if(oldParent!==destination||Object.keys(props).some(k=>file.appProperties[k]!==props[k]))file=Drive.Files.update({appProperties:props},file.id,null,{fields:FILE_FIELDS,...(oldParent!==destination?{addParents:destination,removeParents:oldParent}:{})});
  if(file.parents?.length!==1||file.parents[0]!==destination||Object.keys(props).some(k=>file.appProperties?.[k]!==props[k])||!validCustomerLocation_(file,input.company))throw Error('CUSTOMER_DELIVERY_UNCONFIRMED');
  let permissions=customerPermissions_(file.id);if(permissions.some(p=>p.type==='domain'||p.type==='anyone'&&(p.role!=='reader'||p.allowFileDiscovery!==false)))throw Error('FILE_IDENTITY_CONFLICT');
  if(!permissions.some(p=>p.type==='anyone'&&p.role==='reader'&&p.allowFileDiscovery===false))Drive.Permissions.create({type:'anyone',role:'reader',allowFileDiscovery:false},file.id,{fields:'id,type,role,allowFileDiscovery'});
  permissions=customerPermissions_(file.id);if(!permissions.some(p=>p.type==='anyone'&&p.role==='reader'&&p.allowFileDiscovery===false))throw Error('CUSTOMER_DELIVERY_UNCONFIRMED');
  return file;
}
function deliverCustomerPdf_(input){
  validateCustomerDelivery_(input);
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(input.fileId||'')||!/^\w{32}$/.test(input.poId||'')||!/^\w{64}$/.test(input.sha256||'')||typeof input.name!=='string'||!input.name.endsWith('.pdf'))throw Error('INVALID_DOCUMENT');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{let file=Drive.Files.get(input.fileId,{fields:FILE_FIELDS});const props={company:input.company,poId:input.poId,sha256:input.sha256,type:input.type,...(input.department==='SUPPORT'?{department:'SUPPORT'}:{})};
    if(file.trashed||file.mimeType!=='application/pdf'||file.name!==input.name||!Number.isSafeInteger(Number(file.size))||Number(file.size)<5||Number(file.size)>3*1024*1024||Object.keys(props).some(k=>file.appProperties?.[k]!==props[k]))throw Error('FILE_IDENTITY_CONFLICT');
    file=finishCustomerFile_(file,input,customerDestination_(input));return {ok:true,fileId:file.id,name:file.name,size:Number(file.size),sha256:input.sha256,company:input.company,poId:input.poId,customerId:input.customerId,customerLinkReady:true,url:file.webViewLink||'https://drive.google.com/file/d/'+file.id+'/view'};
  }finally{lock.releaseLock();}
}
