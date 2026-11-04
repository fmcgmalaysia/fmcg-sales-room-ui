// Warehouse evidence only. Existing PDF destinations and Drive sharing remain unchanged.
const WAREHOUSE_PHOTO_ROOTS={NCT:'1ui3hr9QGJDo1jgFm2E45pAxXhGNJGXs6',GHR:'1SjJmq7NvjqV7_0V_gAYhztmN3uWwikhj'};
function uploadWarehousePhoto_(input){
 const folder=WAREHOUSE_PHOTO_ROOTS[input.company],extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 if(!folder||input.department!=='WAREHOUSE'||!['PACKING','LOADING'].includes(input.type)||!extensions[input.mimeType]||!/^[A-Za-z0-9_-]{10,200}$/.test(input.fileId||'')||!/^\w{32}$/.test(input.poId||'')||!/^\w{64}$/.test(input.sha256||'')||typeof input.name!=='string'||input.name.length>300||!input.name.endsWith('.'+extensions[input.mimeType])||typeof input.base64!=='string'||input.base64.length>2800000)throw Error('INVALID_DOCUMENT');
 const bytes=Utilities.base64Decode(input.base64),unsigned=bytes.map(n=>(n+256)%256),ascii=(a,b)=>unsigned.slice(a,b).map(n=>String.fromCharCode(n)).join('');
 const signatures={'image/jpeg':unsigned[0]===255&&unsigned[1]===216&&unsigned[2]===255,'image/png':unsigned.slice(0,8).join(',')==='137,80,78,71,13,10,26,10','image/webp':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'};
 if(bytes.length<12||bytes.length>2*1024*1024||!signatures[input.mimeType])throw Error('INVALID_DOCUMENT');
 const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
 if(hash!==input.sha256||input.size!==bytes.length)throw Error('INVALID_DOCUMENT');
 const props={company:input.company,poId:input.poId,sha256:hash,type:input.type,department:'WAREHOUSE'},lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  let file;
  try{file=Drive.Files.create({id:input.fileId,name:input.name,mimeType:input.mimeType,parents:[folder],appProperties:props},Utilities.newBlob(bytes,input.mimeType,input.name),{fields:FILE_FIELDS});}
  catch(error){try{file=Drive.Files.get(input.fileId,{fields:FILE_FIELDS});}catch(unavailable){throw Error('UPLOAD_UNCONFIRMED');}}
  if(file.trashed||file.mimeType!==input.mimeType||file.name!==input.name||!file.parents?.includes(folder)||Number(file.size)!==bytes.length||Object.keys(props).some(key=>file.appProperties?.[key]!==props[key]))throw Error('FILE_IDENTITY_CONFLICT');
  return {ok:true,fileId:file.id,name:file.name,size:Number(file.size),mimeType:file.mimeType,sha256:hash,company:input.company,poId:input.poId,url:file.webViewLink||null};
 }finally{lock.releaseLock();}
}
