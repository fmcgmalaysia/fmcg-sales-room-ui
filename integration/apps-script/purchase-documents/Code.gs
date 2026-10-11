/* Dedicated purchase PDFs only. Never add this to Onboarding or Pointbase. */
const PURCHASE_ROOTS={NCT:'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS',GHR:'18w4I96N3PSCTv2Qxs_mycy-PMu-lth9w'};
const FILE_FIELDS='id,name,mimeType,size,parents,appProperties,trashed,webViewLink';
function doPost(e) {
  let result;
  try {
    const input=JSON.parse(e.postData.contents),secret=PropertiesService.getScriptProperties().getProperty('PURCHASE_DOCUMENT_SHARED_SECRET');
    if(!secret||secret.length<32||typeof input.token!=='string'||input.token!==secret)throw Error('NOT_AUTHORIZED');
    if(!PURCHASE_ROOTS[input.company])throw Error('INVALID_COMPANY');
    if(input.action==='ALLOCATE')result={ok:true,fileId:Drive.Files.generateIds({count:1,space:'drive',type:'files'}).ids[0]};
    else if(input.action==='UPLOAD')result=uploadPurchasePdf_(input);
    else throw Error('INVALID_ACTION');
  } catch(error) {
    const safe=['NOT_AUTHORIZED','INVALID_COMPANY','INVALID_ACTION','INVALID_DOCUMENT','INVALID_PDF','FILE_IDENTITY_CONFLICT','UPLOAD_UNCONFIRMED'];
    result={ok:false,error:safe.includes(error.message)?error.message:'DOCUMENT_SERVICE_UNAVAILABLE'};
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function uploadPurchasePdf_(input) {
  const folder=PURCHASE_ROOTS[input.company];
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(input.fileId||'')||!/^\w{32}$/.test(input.poId||'')||!/^\w{64}$/.test(input.sha256||'')||!['INV','CN','SO','PI'].includes(input.type)||typeof input.name!=='string'||!input.name.endsWith('.pdf')||input.name.length>300||typeof input.base64!=='string'||input.base64.length>4200000)throw Error('INVALID_DOCUMENT');
  const bytes=Utilities.base64Decode(input.base64);
  if(bytes.length<5||bytes.length>3*1024*1024||bytes.slice(0,5).map(n=>String.fromCharCode(n)).join('')!=='%PDF-')throw Error('INVALID_PDF');
  const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
  if(hash!==input.sha256)throw Error('INVALID_PDF');
  const props={company:input.company,poId:input.poId,sha256:hash,type:input.type};
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    let file;
    try {file=Drive.Files.create({id:input.fileId,name:input.name,mimeType:'application/pdf',parents:[folder],appProperties:props},Utilities.newBlob(bytes,'application/pdf',input.name),{fields:FILE_FIELDS});}
    catch(error){try{file=Drive.Files.get(input.fileId,{fields:FILE_FIELDS});}catch(unavailable){throw Error('UPLOAD_UNCONFIRMED');}}
    if(file.trashed||file.mimeType!=='application/pdf'||file.name!==input.name||!file.parents?.includes(folder)||Number(file.size)!==bytes.length||Object.keys(props).some(key=>file.appProperties?.[key]!==props[key]))throw Error('FILE_IDENTITY_CONFLICT');
    return {ok:true,fileId:file.id,name:file.name,size:Number(file.size),sha256:hash,company:input.company,poId:input.poId,url:file.webViewLink||null};
  } finally {lock.releaseLock();}
}
