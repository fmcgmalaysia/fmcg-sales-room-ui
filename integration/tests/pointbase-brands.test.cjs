const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../apps-script/MasterPointbaseCost.gs'),'utf8');
test('brand mode reads only header and brand cells, deduplicates all three tabs and never reads costs or writes',()=>{
 const reads=[],rows={FOOD:['Cadbury','MAGGI',''],NONFOOD:['cadbury','DOVE'],OTHERS:['  MAGGI  ']};
 const sheet=name=>({getLastRow:()=>rows[name].length+2,getRange:(row,col,count,width)=>{reads.push({name,row,col,count,width});return {getDisplayValues:()=>row===1?[['STATUS','PRINCIPLE','BRAND NAME',...Array(24).fill('')]]:rows[name].map(value=>[value])};}});
 const context=vm.createContext({SpreadsheetApp:{openById:()=>({getSheetByName:sheet})}});vm.runInContext(source,context);const result=context.WIX_masterCaptureCost({mode:'BRANDS'});
 assert.equal(result.kind,'MASTER_POINTBASE_BRANDS_V1');assert.deepEqual([...result.brands],['CADBURY','DOVE','MAGGI']);assert.equal(reads.filter(read=>read.row>=3).length,3);assert(reads.filter(read=>read.row>=3).every(read=>read.col===3&&read.width===1));
});
test('missing brand header fails explicitly instead of returning a partial brand list',()=>{
 const context=vm.createContext({SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getLastRow:()=>3,getRange:()=>({getDisplayValues:()=>[['WRONG']]})})})}});vm.runInContext(source,context);assert.throws(()=>context.WIX_masterCaptureCost({mode:'BRANDS'}),/header missing/);
});
