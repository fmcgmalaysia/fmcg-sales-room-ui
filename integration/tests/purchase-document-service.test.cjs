const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
function service(){const files=new Map();let calls=0;const secret='test-only-not-a-live-secret-123456789';
 const context={PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
 Utilities:{base64Decode:s=>[...Buffer.from(s,'base64')],computeDigest:(_,bytes)=>[...crypto.createHash('sha256').update(Buffer.from(bytes)).digest()],DigestAlgorithm:{SHA_256:'sha'},newBlob:(bytes,mime,name)=>({bytes,mime,name})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Drive:{Files:{generateIds:()=>{calls++;return {ids:['generated_file_id_123']};},create:(metadata,blob)=>{calls++;if(files.has(metadata.id))throw Error('conflict');const file={...metadata,size:blob.bytes.length,webViewLink:'https://drive.google.com/file/d/'+metadata.id+'/view'};files.set(metadata.id,file);return file;},get:id=>{calls++;if(!files.has(id))throw Error('not found');return files.get(id);}}}};
 context.Drive.Files.update=(patch,id)=>{calls++;const file=files.get(id);if(!file)throw Error('not found');Object.assign(file,patch);return file;};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/purchase-documents/Code.gs'),'utf8'),context);
 const bytes=Buffer.from('%PDF-1.4\ntest fixture');return {files,calls:()=>calls,run:input=>context.doPost({postData:{contents:JSON.stringify(input)}}),input:{token:secret,action:'UPLOAD',company:'NCT',fileId:'generated_file_id_123',poId:'a'.repeat(32),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64'),name:'2026-10-11 SUP INV 001.pdf',type:'INV'}};
}
test('unauthorized or invalid-company upload cannot call Google Drive',()=>{const f=service();assert.equal(f.run({...f.input,token:'wrong'}).error,'NOT_AUTHORIZED');assert.equal(f.run({...f.input,company:'OTHER'}).error,'INVALID_COMPANY');assert.equal(f.calls(),0);});
test('upload fixes company folder and retry reuses the generated file ID without a duplicate',()=>{const f=service();assert.equal(f.run(f.input).ok,true);assert.equal(f.run(f.input).ok,true);assert.equal(f.files.size,1);assert.equal([...f.files.values()][0].parents[0],'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS');assert.equal(f.run({...f.input,company:'GHR'}).error,'FILE_IDENTITY_CONFLICT');assert.equal(f.files.size,1);});
test('corrupt PDF or hash cannot create a file; changed metadata cannot hijack an existing ID',()=>{const f=service();assert.equal(f.run({...f.input,sha256:'b'.repeat(64)}).error,'INVALID_PDF');assert.equal(f.calls(),0);f.run(f.input);assert.equal(f.run({...f.input,name:'different.pdf'}).error,'FILE_IDENTITY_CONFLICT');});
test('payment proofs require Account routing and fixed company Account roots; DO retains Purchase routing',()=>{
 for(const [company,folder] of [['NCT','1grq9bx7TcVhI3baSzpkLG0zglCuBorjA'],['GHR','1hZ4qVKtNP2oc4Fj5NXbEamdIWU0RR30o']]){const f=service();assert.equal(f.run({...f.input,company,type:'PAYMENT'}).error,'INVALID_DOCUMENT');assert.equal(f.calls(),0);assert.equal(f.run({...f.input,company,type:'PAYMENT',department:'ACCOUNT'}).ok,true);assert.equal([...f.files.values()][0].parents[0],folder);}
 const f=service();assert.equal(f.run({...f.input,type:'DO'}).ok,true);assert.equal([...f.files.values()][0].parents[0],'12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS');
});

test('Sales PDFs route only to fixed Sales folders and retain company isolation',()=>{for(const [company,folder] of [['NCT','1omU7-s3sntQoajBBvOKVXzwS40N5Lmm0'],['GHR','1uPcfFNLpXFDS5vn18hA5pbIdWRzxSzQ_']])for(const type of ['SALES_INV','SALES_CN','DEBIT_NOTE','CUSTOMER_RECEIPT']){const f=service();assert.equal(f.run({...f.input,company,type}).error,'INVALID_DOCUMENT');assert.equal(f.calls(),0);assert.equal(f.run({...f.input,company,type,department:'SALES'}).ok,true);assert.equal([...f.files.values()][0].parents[0],folder);}});

test('trash is recoverable and same-file retry succeeds without permanent deletion',()=>{
 const f=service();f.run(f.input);const input={...f.input,action:'TRASH'};delete input.base64;
 const result=f.run(input);assert.equal(result.ok,true);assert.equal(result.trashed,true);assert.equal(f.files.size,1);assert.equal(f.files.get(input.fileId).trashed,true);assert.equal(result.poId,input.poId);assert.equal(result.type,'INV');
 const calls=f.calls();assert.equal(f.run(input).ok,true);assert.equal(f.calls(),calls+1);
});

test('trash cannot target a different company, PO, hash, name or department document',()=>{
 for(const change of [{company:'GHR'},{poId:'b'.repeat(32)},{sha256:'b'.repeat(64)},{name:'another.pdf'},{type:'PAYMENT'},{type:'SALES_INV'}]){
  const f=service();f.run(f.input);assert.equal(f.run({...f.input,...change,action:'TRASH'}).ok,false);assert.notEqual(f.files.get(f.input.fileId).trashed,true);
 }
 const f=service();f.run(f.input);f.files.get(f.input.fileId).parents=['UNRELATED_FOLDER'];assert.equal(f.run({...f.input,action:'TRASH'}).error,'FILE_IDENTITY_CONFLICT');assert.notEqual(f.files.get(f.input.fileId).trashed,true);
});

test('Our PO PDFs upload to each fixed Purchase folder and can be trashed with exact identity',()=>{
 for(const [company,folder] of [['NCT','12gCZmqioYGZyRmgW3CsWyobBBcUnCFUS'],['GHR','18w4I96N3PSCTv2Qxs_mycy-PMu-lth9w']]){const f=service(),input={...f.input,company,type:'PO',name:'2026-10-16 SUP PO 001.pdf'};assert.equal(f.run(input).ok,true);assert.equal(f.files.get(input.fileId).parents[0],folder);assert.equal(f.run({...input,action:'TRASH'}).trashed,true);}
});

test('Account proof trash requires Account routing and exact company folder, and retries safely',()=>{
 for(const company of ['NCT','GHR']){const f=service(),input={...f.input,company,type:'PAYMENT',department:'ACCOUNT'};assert.equal(f.run(input).ok,true);assert.equal(f.run({...input,action:'TRASH',department:'PURCHASE'}).error,'INVALID_DOCUMENT');assert.equal(f.run({...input,action:'TRASH'}).trashed,true);assert.equal(f.run({...input,action:'TRASH'}).trashed,true);}
});
