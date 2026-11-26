import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanCatalogueJpeg, createCatalogueLegacyPreview } from '../backend/catalogueLegacyPreview.js';

function segment(marker, body) {
  const header=Buffer.from([0xff,marker,0,0]);
  header.writeUInt16BE(body.length+2,2);
  return Buffer.concat([header,body]);
}
const metadata=Buffer.from('https://static.wixstatic.com/media/legacy.png');
function jpeg(width=128,height=88,payload=Buffer.from([1,2,3]),progressive=false) {
  const frame=Buffer.from([8,0,0,0,0,1,1,0x11,0]);
  frame.writeUInt16BE(height,1);
  frame.writeUInt16BE(width,3);
  return Buffer.concat([Buffer.from([0xff,0xd8]),segment(0xe1,metadata),segment(0xfe,metadata),
    segment(progressive?0xc2:0xc0,frame),segment(0xda,Buffer.from([1,1,0,0,63,0])),payload,Buffer.from([0xff,0xd9])]);
}
function dataFixture(rows) {
  return { query:()=>({
    eq(){return this;},hasSome(field,ids){assert.equal(field,'_id');return dataFixture(rows.filter(row=>ids.includes(row._id))).query();},
    fields(){return this;},limit(){return this;},async find(){return {items:rows};}
  }) };
}
test('inline legacy previews remove metadata and enforce JPEG dimensions and scan limits',()=>{
  const result=cleanCatalogueJpeg(jpeg());
  assert.ok(result.startsWith('data:image/jpeg;base64,'));
  const output=Buffer.from(result.split(',')[1],'base64');
  assert.ok(!output.includes(metadata));
  assert.equal(cleanCatalogueJpeg(jpeg(129)),'');
  const scans=Buffer.concat([Buffer.from([1,2,3]),segment(0xe1,metadata),segment(0xda,Buffer.from([1,1,0,0,63,0])),Buffer.from([4,5,6])]);
  const progressive=cleanCatalogueJpeg(jpeg(128,88,scans,true));
  assert.ok(progressive);
  assert.ok(!Buffer.from(progressive.split(',')[1],'base64').includes(metadata));
  assert.equal(cleanCatalogueJpeg(jpeg(128,129)),'');
  assert.equal(cleanCatalogueJpeg(jpeg(100,100,Buffer.from([0xff,0xe1]))),'');
  assert.equal(cleanCatalogueJpeg(jpeg(100,100,Buffer.alloc(24001))),'');
});
test('an already registered image always wins and fallback stays within the authorized page',async()=>{
  const events=[];
  const data=dataFixture([{_id:'1',image:'wix:image://v1/legacy.png/Name.png'},
    {_id:'2',image:'https://other.invalid/p.jpg'},{_id:'3',image:'https://static.wixstatic.com/media/three.png'},
    {_id:'4',image:'https://static.wixstatic.com/media/outside.png'}]);
  const preview=createCatalogueLegacyPreview({data,download:async url=>{events.push(url);return jpeg();}});
  const request=[{id:'1'},{id:'2'},{id:'3',image:'https://signed.example/preview'}];
  const [a,b]=await Promise.all([preview(request),preview(request)]);
  assert.deepEqual(a,b);
  assert.equal(a[2].image,request[2].image);
  assert.equal(a[1].image,undefined);
  assert.match(a[0].image,/^data:image\/jpeg;base64,/);
  assert.deepEqual(events,['https://static.wixstatic.com/media/legacy.png/v1/fit/w_128,h_128/file.jpg']);
});
