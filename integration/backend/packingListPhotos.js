import { createHash } from 'crypto';
import { Buffer } from 'buffer';
export function validatePackingPhotos(photos){
 if(!Array.isArray(photos)||!photos.length||photos.length>3)throw Error('Warehouse choose one to three photos per save.');
 let total=0;
 return photos.map(photo=>{
  if(!photo||!['image/jpeg','image/png','image/webp'].includes(photo.mimeType)||typeof photo.base64!=='string'||photo.base64.length>2800000||!/^[a-f0-9]{64}$/i.test(photo.sha256||''))throw Error('Warehouse photo format is invalid.');
  const bytes=Buffer.from(photo.base64,'base64');total+=bytes.length;
  const valid=photo.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:photo.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid||bytes.length<12||total>2*1024*1024||createHash('sha256').update(bytes).digest('hex')!==photo.sha256)throw Error('Warehouse photo content or total size is invalid.');
  return {mimeType:photo.mimeType,base64:photo.base64,sha256:photo.sha256,size:bytes.length};
 });
}
