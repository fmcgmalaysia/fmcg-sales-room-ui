const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),folder=path.join(__dirname,'../prototypes/stock-current-state'),copy=value=>JSON.parse(JSON.stringify(value));
test('exact original packing child keeps layout/handlers apart from explicit damage warning and usable limits; resources are cache fresh',()=>{
 for(const file of ['build-packing-current-ui.cjs','build-packing-transport-candidate.cjs','build-warehouse-current-ui.cjs'])assert.match(execFileSync(process.execPath,[path.join(folder,file),'--check'],{encoding:'utf8'}),/verified/);
 const candidate=fs.readFileSync(path.join(folder,'packing-ui/packing-workbench.js'),'utf8');
 const original=fs.readFileSync(path.join(__dirname,'../../support-room/packing-workbench.js'),'utf8').replace(/\r\n/g,'\n');
 let restored=candidate.replace('company:()=>company,department:()=>actor,onBusy:','company:()=>company,onBusy:');
 restored=restored.replace(/^.*\$\('pending-change'\).*$/m,original.match(/^.*\$\('pending-change'\).*$/m)[0]);
 for(const field of ['Packed','Loaded'])restored=restored.replace("max=\"'+Math.min(line.quantity,line.stockUsableForList??line.quantity)+'\" aria-label=\""+field,"max=\"'+line.quantity+'\" aria-label=\""+field);
 assert.equal(restored,original);
 assert.equal(fs.readFileSync(path.join(folder,'packing-ui/packing-transport.js'),'utf8'),fs.readFileSync(path.join(folder,'packing-transport.current.js'),'utf8'));
 assert.match(fs.readFileSync(path.join(folder,'packing-ui/packing-workbench.html'),'utf8'),/packing-transport.js\?v=20261023-current-packing-damage-v1/);
 const host=fs.readFileSync(path.join(folder,'warehouse-ui/packing-list-link.js'),'utf8');assert.match(host,/PACKING_RESUME_CONTEXT_REQUEST/);assert.match(host,/PACKING_RESUME_CONTEXT_RESULT/);assert.match(host,/packing-workbench.html\?v=20261023-current-packing-damage-v1/);
 assert.match(fs.readFileSync(path.join(folder,'packing-ui/support-department-page.js'),'utf8'),/packing-workbench.html\?v=20261023-current-packing-damage-v1/);
});

test('actual original detail displays mandatory damage warning and good-stock input limits, with unchanged planned quantity',()=>{
 const source=fs.readFileSync(path.join(folder,'packing-ui/packing-workbench.js'),'utf8'),start=source.indexOf('function openDetail(list){'),end=source.indexOf(" $('remainders')",start),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const render=vm.runInNewContext(source.slice(start,end)+'};openDetail;',{opened:null,$:node,taskFor:()=>null,labels:{PROCESSING:'Processing'},actor:'WAREHOUSE',product:line=>line.name,esc:String});
 const row={status:'PROCESSING',id:'L',customerId:'C',stockDamageReviewRequired:true,lines:[{taskId:'T',name:'Item',quantity:100,packed:100,loaded:100,reason:'',stockUsableForList:90}]};render(row);
 assert.equal(node('pending-change').hidden,false);assert.match(node('pending-change').textContent,/待复核破损影响/);assert.match(node('detail-lines').innerHTML,/max="90"/);assert.match(node('detail-lines').innerHTML,/>100<\/td>/);
 render({...row,stockDamageReviewRequired:false,lines:row.lines.map(line=>({...line,stockUsableForList:undefined}))});assert.equal(node('pending-change').hidden,true);assert.equal(node('pending-change').textContent,'');assert.match(node('detail-lines').innerHTML,/max="100"/);
});
test('actual existing packing bridge fixes parent department, maps auth-only recovery and forwards exact expected identity/version',async()=>{
 const calls=[],replies=[],context={getPackingLists:async(...args)=>{calls.push(copy(args));return{ok:true};},savePackingList:async(...args)=>{calls.push(copy(args));return{ok:false,pending:true};}};
 const source=fs.readFileSync(path.join(folder,'packing-ui/packingListBridge.js'),'utf8');vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''),context);
 const requestId='11111111-1111-4111-8111-111111111111',input={action:'SEND',id:'LIST'},stockIdentity={staffId:'S',memberId:'M'};
 await context.handlePackingList({type:'PACKING_SAVE_REQUEST',company:'NCT',department:'WAREHOUSE',requestId,input,stockProtocol:1,stockBuild:'TEST',stockGeneration:3,stockIdentity},'SUPPORT',reply=>replies.push(copy(reply)));
 assert.deepEqual(calls[0],['NCT','SUPPORT',requestId,input,{stockProtocol:1,stockBuild:'TEST',stockGeneration:3,stockIdentity}]);assert.equal(replies[0].result.pending,true);
 await context.handlePackingList({type:'PACKING_RESUME_CONTEXT_REQUEST',company:'NCT',requestId},'WAREHOUSE',reply=>replies.push(copy(reply)));
 assert.deepEqual(calls[1],['NCT','WAREHOUSE',{resume:'PACKING_V1'}]);assert.equal(replies[1].type,'PACKING_RESUME_CONTEXT_RESULT');
 await context.handlePackingList({type:'PACKING_RESUME_CONTEXT_REQUEST',company:'NCT',requestId,approved:true},'WAREHOUSE',()=>assert.fail('extra recovery input'));assert.equal(calls.length,2);
 await context.handlePackingList({type:'PACKING_READ_REQUEST',company:'OTHER',requestId},'SUPPORT',()=>assert.fail('foreign company'));assert.equal(calls.length,2);
 const original=fs.readFileSync(path.join(__dirname,'../wix/packingListBridge.js'),'utf8').replace(/\r\n/g,'\n');assert.equal(source.slice(source.indexOf(' catch(error)')),original.slice(original.indexOf(' catch(error)')));
});
