const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../apps-script/pointbase-nonfood-20261101/COST_VERIFIED_MENU.gs'),'utf8');
function run(name,start,end,barcodes){
 const writes=[],reads=[],toasts=[];
 const sheet={getName:()=>name,getActiveRange:()=>({getRow:()=>start,getLastRow:()=>end}),
  getRange:(r,c,n,w)=>{reads.push([r,c,n,w]);return{getDisplayValues:()=>barcodes.map(x=>[x])}},
  getRangeList:cells=>({setValue:value=>{writes.push({cells,value});return{setNumberFormat:format=>{writes.at(-1).format=format;}};}})};
 const context={SpreadsheetApp:{getActiveSpreadsheet:()=>({getActiveSheet:()=>sheet,toast:(...x)=>toasts.push(x)}),flush:()=>{}},Date};
 vm.runInNewContext(source,context);context.markSelectedCostsVerifiedToday();return{writes,reads,toasts};
}
for(const name of ['FOOD','NONFOOD','OTHERS'])test(name+' confirms only selected nonblank barcode dates, excluding headers',()=>{const r=run(name,1,5,['123','','456']);assert.deepEqual(r.reads,[[3,6,3,1]]);assert.equal(JSON.stringify(r.writes[0].cells),JSON.stringify(['D3','D5']));assert(r.writes[0].value instanceof Date);assert.equal(r.writes[0].format,'dd/MM/yy');assert.equal(r.writes.length,1);});
test('unrelated sheet and header-only selection perform no writes',()=>{for(const [name,start,end]of [['LIST',3,5],['NONFOOD',1,2]]){const r=run(name,start,end,[]);assert.equal(r.writes.length,0);assert.equal(r.reads.length,0);}});
test('blank barcodes perform no writes',()=>assert.equal(run('NONFOOD',3,4,['',' ']).writes.length,0));
