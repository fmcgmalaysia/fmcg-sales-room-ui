const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const release=require('../prototypes/warehouse-effective-quantity-20261031/stage.cjs').plan();
const current=release.assets.get('master-shared/desk-delivery.js').toString();
const old=release.baseline.get('master-shared/desk-delivery.js').toString();
function displayed(source,line){
 const row=source.split('\n').find(text=>text.includes("number(line.orderQty)+'</td>"));
 const expression=row.match(/number\(line\.orderQty\).*?<td class="dd-number">'\+number\((.*?)\)\+'<\/td>/)[1];
 return vm.runInNewContext(expression,{line});
}
for(const [name,line,wanted] of [
 ['untouched authorization',{orderQty:250,quantity:250},250],
 ['cancel20 afterLoaded230',{orderQty:250,quantity:250,loaded:230,resolution:{maximum:230,removed:20,resolved:true}},230],
 ['transfer20 to anotherDesk',{orderQty:250,quantity:250,loaded:230,resolution:{maximum:230,removed:20,resolved:true}},230],
 ['continue20 on sameDesk',{orderQty:250,quantity:250,loaded:230,resolution:{maximum:250,remaining:20,pending:true}},250],
 ['cancelentirezeroLoaded',{orderQty:250,quantity:250,loaded:0,resolution:{maximum:0,removed:250,resolved:true}},0]
])test(name,()=>{const before=JSON.stringify(line);assert.equal(displayed(current,line),wanted);assert.equal(JSON.stringify(line),before);});
test('original renderer reproduces stale250 after cancellation',()=>assert.equal(displayed(old,{orderQty:250,quantity:250,resolution:{maximum:230}}),250));
test('only two visible text expressions change, all handlers and stock semantics remain exact',()=>{
 assert.equal(current,old.replace("number(line.quantity)+'</td><td class=\"dd-number\"><button","number(line.resolution?.maximum??line.quantity)+'</td><td class=\"dd-number\"><button").replace("<p>Authorized Alloc Qty 已授权数量 <b>'+line.quantity+'</b></p>","<p>Alloc Qty 本次待交总量 <b>'+(line.resolution?.maximum??line.quantity)+'</b></p>"));
 assert.equal(release.assets.size,99);assert.equal(release.changed.length,4);
 for(const [file,bytes]of release.assets){if(!release.changed.includes(file))assert.ok(bytes.equals(release.baseline.get(file)));if(file.endsWith('.js'))new vm.Script(bytes.toString(),{filename:file});}
});
