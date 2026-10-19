const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',classList:{toggle(){}},handlers:{},addEventListener(name,handler){this.handlers[name]=handler;},querySelectorAll(){return [];}});return nodes.get(id);};
 const messages=[],parent={postMessage:value=>messages.push(value)},window={addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../warehouse-room/app.js'),'utf8'),{document:{getElementById:node,querySelector:node,querySelectorAll:()=>[]},window,parent,crypto:{randomUUID:()=> 'REQUEST'},setTimeout(){},clearTimeout(){},Intl,Date});
 const input=value=>({value,disabled:false,readOnly:false,dataset:{},validity:{badInput:false},matches:()=>true});
 return {input,focus:field=>node('entryLines').handlers.focusin({target:field}),blur:field=>node('entryLines').handlers.focusout({target:field}),messages};
}
test('quantity focus clears for replacement; an untouched positive total is restored, while a typed replacement remains',()=>{
 const f=fixture(),field=f.input('95');f.focus(field);assert.equal(field.value,'');f.blur(field);assert.equal(field.value,'95');
 f.focus(field);field.value='20';f.blur(field);assert.equal(field.value,'20');assert.equal(f.messages.length,1,'editing must not send a receipt');
});
test('zero can remain visually empty and disabled or read-only quantities are never cleared',()=>{
 const f=fixture(),zero=f.input('0');f.focus(zero);f.blur(zero);assert.equal(zero.value,'');
 for(const flag of ['disabled','readOnly']){const field=f.input('100');field[flag]=true;f.focus(field);assert.equal(field.value,'100');}
});
