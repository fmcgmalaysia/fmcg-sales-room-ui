const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),{createHash}=require('node:crypto');
const current=fs.readFileSync('backend/buyerSelectionExcel.js','utf8');
function api(source=current){return new Function('TextEncoder',source.replace(/export function /g,'function ')+'\nreturn {buildBuyerSelectionExcel,buildBuyerOrderExcel}')(TextEncoder)}
function entries(bytes){const files=new Map();let offset=0;while(offset+30<bytes.length){const v=new DataView(bytes.buffer,bytes.byteOffset+offset);if(v.getUint32(0,true)!==0x04034b50)break;const size=v.getUint32(18,true),names=v.getUint16(26,true),extra=v.getUint16(28,true),start=offset+30+names+extra;files.set(Buffer.from(bytes.subarray(offset+30,offset+30+names)).toString(),Buffer.from(bytes.subarray(start,start+size)).toString());offset=start+size}return files}
function selection(rows,currency='USD'){return entries(api().buildBuyerSelectionExcel({buyerRoomUrl:'https://example.test/buyer-room?assist=private#old',currency,rows}))}
const row={imageUrl:'https://example.test/image.jpg?size=large&v=2',unitBarcode:'0123456789012',itemName:'Test item',packingSize:'12 x 500ML',ea:12,unitPrice:1.25,cbmPerCtn:.0123};
test('image URLs are native external hyperlinks with the original Buyer Room link and URL text preserved',()=>{
 const files=selection([row,{...row,imageUrl:'https://example.test/other.jpg'}]),sheet=files.get('xl/worksheets/sheet1.xml'),rels=files.get('xl/worksheets/_rels/sheet1.xml.rels');
 assert.match(sheet,/<hyperlink ref="A1" r:id="rId1" tooltip="Open your Buyer Room"\/>/);
 assert.match(sheet,/<hyperlink ref="A3" r:id="rId2" tooltip="Open product image"\/>/);
 assert.match(sheet,/<hyperlink ref="A4" r:id="rId3" tooltip="Open product image"\/>/);
 assert.match(sheet,/<c r="A3" s="1" t="inlineStr"><is><t>https:\/\/example.test\/image.jpg\?size=large&amp;v=2/);
 assert.match(rels,/Id="rId2"[^>]+Target="https:\/\/example.test\/image.jpg\?size=large&amp;v=2" TargetMode="External"/);
 assert.match(rels,/Id="rId1"[^>]+Target="https:\/\/example.test\/buyer-room"/);
 assert.doesNotMatch(sheet,/<f>HYPERLINK/,'use native links, not formula strings');
});
test('missing, malformed and non-web image links stay plain text without breaking row alignment',()=>{
 const files=selection([{...row,imageUrl:''},{...row,imageUrl:'javascript:alert(1)'},{...row,imageUrl:'not a URL'},row]),sheet=files.get('xl/worksheets/sheet1.xml'),rels=files.get('xl/worksheets/_rels/sheet1.xml.rels');
 for(const ref of ['A3','A4','A5'])assert.doesNotMatch(sheet,new RegExp('<hyperlink ref="'+ref+'"'));
 assert.match(sheet,/<hyperlink ref="A6" r:id="rId5"/);assert.match(rels,/Id="rId5"/);assert.doesNotMatch(rels,/javascript:|not a URL/);
 assert.match(sheet,/<c r="B6" s="7" t="inlineStr"><is><t>0123456789012/);
 assert.match(sheet,/IF\(OR\(E6=&quot;&quot;,F6=&quot;&quot;\),&quot;&quot;,E6\*F6\)/);
});
test('selection formulas, print/frozen/filter settings and non-A cells remain unchanged',()=>{
 const prior=cp.execFileSync('git',['show','verified/buyer-selection-excel-20261104:backend/buyerSelectionExcel.js'],{encoding:'utf8'});
 const args={buyerRoomUrl:'https://example.test/buyer-room',currency:'SGD',rows:[row,{...row,unitPrice:null,ea:0}]};
 const old=entries(api(prior).buildBuyerSelectionExcel(args)),next=entries(api().buildBuyerSelectionExcel(args));
 const withoutImages=s=>s.replace(/<c r="A[3-9]\d*"[^>]*>.*?<\/c>/g,'').replace(/<hyperlinks>.*?<\/hyperlinks>/,'').replace(/<c r="[FG]2"[^>]*>.*?<\/c>/g,'').replace(/Exported .*? \(MYT\)/,'Exported TIMESTAMP (MYT)');
 assert.equal(withoutImages(next.get('xl/worksheets/sheet1.xml')),withoutImages(old.get('xl/worksheets/sheet1.xml')));
 for(const[file,body]of old){if(file!=='xl/worksheets/sheet1.xml'&&file!=='xl/worksheets/_rels/sheet1.xml.rels')assert.equal(next.get(file),body,file)}
});

test('F/G headers use each customer currency; numeric price and per-carton formula do not change',()=>{
 for(const currency of ['USD','SGD']){const files=selection([row],currency),sheet=files.get('xl/worksheets/sheet1.xml');
  assert.match(sheet,new RegExp('<c r="F2"[^>]*><is><t>'+currency+' / EA</t>'));
  assert.match(sheet,new RegExp('<c r="G2"[^>]*><is><t>'+currency+' / CTN</t>'));
  assert.match(sheet,/<c r="F3" s="5"><v>1.25<\/v>/);
  assert.match(sheet,/IF\(OR\(E3=&quot;&quot;,F3=&quot;&quot;\),&quot;&quot;,E3\*F3\)/);
 }
});
test('shared Order Received workbook builder stays byte-identical',()=>{
 const prior=cp.execFileSync('git',['show','verified/buyer-selection-excel-20261104:backend/buyerSelectionExcel.js'],{encoding:'utf8'});
 const args={buyerRoomUrl:'https://example.test/buyer-room',orderId:'ORD-1',companyName:'Test',submittedAt:'04/11/2026 15:26',currency:'USD',rows:[{barcode:row.unitBarcode,itemName:row.itemName,packingSize:row.packingSize,eaPerCtn:12,unitPrice:1.25,quantityCtn:100,cbmPerCtn:.0123}]};
 assert.deepEqual(api().buildBuyerOrderExcel(args),api(prior).buildBuyerOrderExcel(args));
});
test('format revision avoids reusing the previous plain-URL file while keeping content-based reuse',async()=>{
 const source=fs.readFileSync('backend/buyerSelectionDownload.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export async function /g,'async function ');
 const data={WixCustomers:[{customerId:'CUS-1',preferredCurrency:'USD'}],WixBuyerListItems:[{_id:'sel-1',payload:{customerId:'CUS-1',productId:'prod-1',barcode:row.unitBarcode,quoteStatus:'VIEW QUOTE',vipPriceEa:1.25}}],FMCGMALAYSIA:[{_id:'prod-1',barcode:row.unitBarcode,name:row.itemName,description:row.packingSize,ea:12,image:row.imageUrl,m3Ctn:.0123}]};
 const wixData={query(collection){return {eq(){return this},hasSome(){return this},limit(){return this},find:async()=>({items:data[collection],hasNext:()=>false})}}};
 const build=new Function('wixData','mediaManager','createHash','buildBuyerSelectionExcel','Buffer',source+'\nreturn buildBuyerSelectionDownload')(wixData,{},createHash,api().buildBuyerSelectionExcel,Buffer);
 const first=await build('CUS-1','https://example.test/buyer-room'),second=await build('CUS-1','https://example.test/buyer-room');
 assert.equal(first.versionKey,second.versionKey);assert.equal(first.rowCount,1);
 const old=new Function('wixData','mediaManager','createHash','buildBuyerSelectionExcel','Buffer',source.replace("format: 'selection-image-links-v1', ",'')+'\nreturn buildBuyerSelectionDownload')(wixData,{},createHash,api().buildBuyerSelectionExcel,Buffer);
 assert.notEqual(first.versionKey,(await old('CUS-1','https://example.test/buyer-room')).versionKey);
});
