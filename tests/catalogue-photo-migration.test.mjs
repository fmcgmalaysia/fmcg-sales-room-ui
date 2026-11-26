import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateCataloguePhoto } from '../backend/cataloguePhotoMigration.js';
const image=id=>'wix:image://v1/'+id+'.png/product.png';
const product={_id:'demo',image:image('legacy')};
function fixture(){
  let row;
  const calls=[];
  const io={
    media:{getFileInfo:async()=>({mimeType:'image/png',isPrivate:false,opStatus:'READY',hash:'legacy',mediaType:'image',fileUrl:product.image,sizeInBytes:200,width:1024,height:768})},
    store:{
      get:async()=>row&&{...row},
      create:async(id,sourceId)=>({...row??(row={_id:id,sourceId,status:'NEW',version:1})}),
      move:async(old,status,patch)=>old.version!==row.version?null:{...row={...row,...patch,version:row.version+1,status}}
    },
    download:async(url,limit)=>{calls.push(['download',url]);return Buffer.alloc(Math.min(200,limit));},
    upload:async(bytes,name)=>{calls.push(['upload',name]);return {fileUrl:image(name.includes('-hd')?'copy':'thumbnail'),isPrivate:true};},
    verify:async refs=>{assert.equal(refs.original,image('copy'));assert.equal(refs.preview,image('thumbnail'));return {_id:refs.productId,status:'VERIFIED',originalHash:'h',previewHeight:192,previewWidth:256};},
    sourceNow:async()=>product.image
  };return { io,calls,read:()=>row };
}
test('a verified product has two private uploads, no legacy URL in the result, and can be resumed',async()=>{
  const {io,calls,read}=fixture();const result=await migrateCataloguePhoto(product,io);
  assert.deepEqual(result,{status:'VERIFIED',previewWidth:256,previewHeight:192});
  assert.equal(read().status,'VERIFIED');
  assert.equal(calls.filter(x=>x[0]==='upload').length,2);
  assert.equal((await migrateCataloguePhoto(product,io)).status,'VERIFIED');
  assert.equal(calls.length,4);
});
test('a lost upload receipt is held; a verifier outage uses the two saved IDs without recopying',async()=>{
  const a=fixture();a.io.upload=async()=>{throw Error('receipt lost');};
  await assert.rejects(migrateCataloguePhoto(product,a.io));
  assert.deepEqual(await migrateCataloguePhoto(product,a.io),{status:'REVIEW',stage:'COPYING_ORIGINAL'});
  const b=fixture();const verify=b.io.verify;b.io.verify=async()=>{throw Error('not ready');};
  await assert.rejects(migrateCataloguePhoto(product,b.io));b.io.verify=verify;
  assert.equal((await migrateCataloguePhoto(product,b.io)).status,'VERIFIED');assert.equal(b.calls.length,4);
});
test('concurrent workers only upload each derivative once; source changes never publish old media',async()=>{
  const {io,calls}=fixture();await Promise.all([migrateCataloguePhoto(product,io),migrateCataloguePhoto(product,io)]);
  assert.equal(calls.filter(x=>x[0]==='upload').length,2);
  const b=fixture();b.io.sourceNow=async()=>image('updated');
  assert.equal((await migrateCataloguePhoto(product,b.io)).status,'SOURCE_CHANGED');assert.notEqual(b.read().status,'VERIFIED');
});
test('only locally managed source IDs may reach media transport; oversize photo is held',async()=>{
  const {io,calls}=fixture();
  for(const image of ['https://other.example/p.jpg','https://static.wixstatic.com/media/../a.png','data:image/svg+xml,abcd'])
    assert.equal((await migrateCataloguePhoto({_id:'x',image},io)).status,'UNSUPPORTED_SOURCE');
  const info=await io.media.getFileInfo();io.media.getFileInfo=async()=>({...info,sizeInBytes:32*1024*1024});
  assert.equal((await migrateCataloguePhoto(product,io)).status,'SOURCE_REVIEW');assert.equal(calls.length,0);
});
