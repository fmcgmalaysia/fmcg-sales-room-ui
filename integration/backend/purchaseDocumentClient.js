import { request as httpsRequest } from 'https';
import { getSecret } from 'wix-secrets-backend';
const ENDPOINT='https://script.google.com/macros/s/AKfycbzjlAYtCCwqVg_tQXXuh34GTYQdknnjR2omKGj95wAUY12USDjJ5joAl98gI0Dr9sTU/exec';
function send(url,options){
  return new Promise((resolve,reject)=>{
    const request=httpsRequest(url,{method:options.method,headers:options.headers||{}},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>100000)request.destroy(Error('Document response too large.'));});
      response.on('end',()=>resolve({status:response.statusCode,location:response.headers.location,body}));
      response.on('error',()=>reject(Error('Document service response interrupted.')));
    });
    request.setTimeout(20000,()=>request.destroy(Error('Document upload timed out. Retry the same upload.')));
    request.on('error',()=>reject(Error('Document service unavailable. Retry the same upload.')));
    if(options.body)request.write(options.body);request.end();
  });
}
export function createPurchaseDocumentClient({request=send,secret=()=>getSecret('PURCHASE_DOCUMENT_SHARED_SECRET')}={}){
  return async input=>{
    const token=await secret();if(typeof token!=='string'||token.length<32)throw Error('Purchase document service is not configured.');
    let response=await request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,token})});
    for(let hop=0;[301,302,303,307,308].includes(response.status);hop++){
      if(hop>=3)throw Error('Document service redirect limit.');
      let url;try{url=new URL(response.location);}catch{throw Error('Document service returned an invalid redirect.');}
      if(url.protocol!=='https:'||url.hostname!=='script.googleusercontent.com'||url.username||url.password)throw Error('Document service redirect rejected.');
      response=await request(url.href,{method:'GET'});
    }
    if(response.status!==200)throw Error('Document service unavailable. Retry the same upload.');
    let result;try{result=JSON.parse(response.body);}catch{throw Error('Document upload could not be confirmed.');}
    if(result?.ok!==true)throw Error(result?.error==='NOT_AUTHORIZED'?'Upload credentials do not match. Contact Admin.':'Document upload could not be confirmed. Retry the same upload.');
    if(!/^[A-Za-z0-9_-]{10,200}$/.test(result.fileId||''))throw Error('Document service returned an invalid file identity.');
    if(input.action==='UPLOAD'&&(result.fileId!==input.fileId||result.company!==input.company||result.poId!==input.poId||result.sha256!==input.sha256||result.name!==input.name))throw Error('Uploaded document receipt does not match this purchase order.');
    return result;
  };
}
export const requestPurchaseDocument=createPurchaseDocumentClient();
