'use strict';
// Candidate-only exact existing child/bridge overlays. No layout/font redesign.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../..'),out=path.join(__dirname,'packing-ui');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'),marker='20261024-packing-arrangement-v1';
function replace(source,before,after){if(source.split(before).length!==2)throw Error('Exact original packing UI anchor changed: '+before.slice(0,70));return source.replace(before,()=>after);}
let app=replace(read('support-room/packing-workbench.js'),'createPackingTransport({company:()=>company,onBusy:', 'createPackingTransport({company:()=>company,department:()=>actor,onBusy:');
const damageWarning="Damage recheck required 待复核破损影响 · Inspect usable goods, correct Packed and Loaded with a reason, then save progress. 检查实货，更正备货与装柜数量，填写原因后保存进度。";
app=replace(app,"$('pending-change').hidden=!list.change;", "$('pending-change').hidden=!list.change&&!list.stockDamageReviewRequired;");
app=replace(app,"$('pending-change').textContent=list.change?", "$('pending-change').textContent=(list.stockDamageReviewRequired?"+JSON.stringify(damageWarning+' · ')+":'')+(list.change?");
app=replace(app,".join(' · '):'';", ".join(' · '):'');");
for(const field of ['Packed','Loaded'])app=replace(app,"max=\"'+line.quantity+'\" aria-label=\""+field, "max=\"'+Math.min(line.quantity,line.stockUsableForList??line.quantity)+'\" aria-label=\""+field);
app=require('./packing-arrangement-ui-overlay.cjs')(app);
let html=read('support-room/packing-workbench.html');
html=html.replace('2026-10-21-packing-candidate-v1','2026-10-24-packing-arrangement-v1');
html=replace(html,'packing-transport.js?v=20261021-packing-v1','packing-transport.js?v='+marker);
html=replace(html,'packing-workbench.js?v=20261021-packing-company-v1','packing-workbench.js?v='+marker);
let bridge=read('integration/wix/packingListBridge.js');
bridge=replace(bridge,"['PACKING_READ_REQUEST','PACKING_SAVE_REQUEST']","['PACKING_READ_REQUEST','PACKING_SAVE_REQUEST','PACKING_RESUME_CONTEXT_REQUEST']");
bridge=replace(bridge," const type=message.type==='PACKING_READ_REQUEST'?'PACKING_READ_RESULT':'PACKING_SAVE_RESULT';", " if(message.type==='PACKING_RESUME_CONTEXT_REQUEST'&&Object.keys(message).some(key=>!['type','company','requestId'].includes(key)))return true;\n const type=message.type==='PACKING_RESUME_CONTEXT_REQUEST'?'PACKING_RESUME_CONTEXT_RESULT':message.type==='PACKING_READ_REQUEST'?'PACKING_READ_RESULT':'PACKING_SAVE_RESULT';");
bridge=replace(bridge,"message.type==='PACKING_READ_REQUEST'?await getPackingLists(message.company,department):await savePackingList(message.company,department,message.requestId,message.input)",
 "message.type==='PACKING_RESUME_CONTEXT_REQUEST'?await getPackingLists(message.company,department,{resume:'PACKING_V1'}):message.type==='PACKING_READ_REQUEST'?await getPackingLists(message.company,department):await savePackingList(message.company,department,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined)");
const support=replace(read('integration/wix/support-department-page.js'),'packing-workbench.html?v=20261021-packing-v1','packing-workbench.html?v='+marker);
const files={'packing-workbench.js':app,'packing-workbench.html':html,'packing-transport.js':read('integration/prototypes/stock-current-state/packing-transport.current.js'),
 'packingListBridge.js':bridge,'support-department-page.js':support};
for(const[name,text]of Object.entries(files)){
 if(name.endsWith('.js'))new Function(text.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
 if(process.argv.includes('--check')){if(fs.readFileSync(path.join(out,name),'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Packing UI candidate differs: '+name);}
 else{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,name),text);}
}
process.stdout.write('Original packing child/relay current candidate '+(process.argv.includes('--check')?'verified':'built')+'; production unchanged\n');
