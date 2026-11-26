import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildBuyerSelectionExcel } from '../backend/buyerSelectionExcel.js';

function workbookParts(out) {
  const raw=Buffer.from(out),files=new Map();
  for(let at=0;raw.readUInt32LE(at)===0x04034b50;) {
    assert.equal(raw.readUInt16LE(at+8),0);
    const size=raw.readUInt32LE(at+18),nameSize=raw.readUInt16LE(at+26),extra=raw.readUInt16LE(at+28);
    const start=at+30+nameSize+extra;
    files.set(raw.toString('utf8',at+30,at+30+nameSize),raw.toString('utf8',start,start+size));
    at=start+size;
  }
  return files;
}
const input={
  buyerRoomUrl:'https://www.fmcgmalaysia.com/buyer-room?remove=1#old',
  customerId:'CUS-QA-ALPHA',
  currency:'MYR',
  rows:[
    {selectionId:'SEL-demo_1',imageUrl:'https://static.wixstatic.com/media/raw-test.png',unitBarcode:'000145',
      itemName:'QA Product',packingSize:'12 pack',ea:12,unitPrice:1.25,cbmPerCtn:0},
    {selectionId:'bad/id',imageUrl:'https://other.invalid/photo.jpg',unitBarcode:'095234',itemName:'Synthetic second'}
  ]
};
test('My Selection workbook contains only scoped Buyer Room photo hyperlinks and preserves pricing cells',()=>{
  const file=workbookParts(buildBuyerSelectionExcel(input));
  const sheet=file.get('xl/worksheets/sheet1.xml');
  const rels=file.get('xl/worksheets/_rels/sheet1.xml.rels');
  assert.match(rels,/Id="rId2"[^>]+Target="https:\/\/www\.fmcgmalaysia\.com\/buyer-room\?company=CUS-QA-ALPHA&amp;imageSelection=SEL-demo_1"/);
  assert.match(sheet,/hyperlink ref="A3" r:id="rId2"/);
  assert.doesNotMatch(sheet,/hyperlink ref="A4"/);
  assert.match(sheet,/000145/);
  assert.match(sheet,/r="F3"[^>]*><v>1\.25<\/v>/);
  assert.match(sheet,/r="H3"[^>]*><v>0<\/v>/);
  assert.match(sheet,/E3\*F3/);
  assert.doesNotMatch([...file.values()].join(' '),/raw-test|other\.invalid|remove=1/);
  const foreign=workbookParts(buildBuyerSelectionExcel({...input,buyerRoomUrl:'https://other.invalid/buyer-room'}));
  assert.doesNotMatch(foreign.get('xl/worksheets/_rels/sheet1.xml.rels'),/imageSelection=/);
});
test('a sign-in round trip restores the image intent once and never combines a stale company with a new selection',()=>{
  const file=readFileSync(new URL('../buyer-room/wix/buyer-room-page.js',import.meta.url),'utf8');
  const code=file.slice(file.indexOf('const buyerWorkbookPhotoKey'),file.indexOf('function getAssistCustomerId'));
  const storage=new Map();
  storage.setItem=storage.set.bind(storage);
  storage.getItem=storage.get.bind(storage);
  storage.removeItem=storage.delete.bind(storage);
  const entry=runInNewContext(code+'\nbuyerWorkbookPhotoEntry',{selectedBuyerCompanyId:l=>l.query.company||''});
  const url={query:{company:'CUS-QA-ALPHA',imageSelection:'SEL-demo_1'}};
  assert.equal(entry(url,storage,false,100).selectionId,'SEL-demo_1');
  assert.equal(entry({query:{}},storage,true,200).company,'CUS-QA-ALPHA');
  assert.equal(entry({query:{}},storage,true,300),null);
  entry(url,storage,false,400);
  assert.equal(entry({query:{company:'CUS-QA-BETA'}},storage,true,450),null);
  assert.equal(entry({query:{}},storage,true,460),null);
  entry(url,storage,false,470);
  assert.equal(entry({query:{}},storage,true,470+20*60000),null);
});
