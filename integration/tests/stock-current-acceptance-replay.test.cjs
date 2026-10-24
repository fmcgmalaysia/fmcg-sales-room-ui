const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const folder=path.join(__dirname,'../prototypes/stock-current-state/preview');
const packet=JSON.parse(fs.readFileSync(path.join(folder,'acceptance-replay.data.json'),'utf8'));
test('replay evidence names exact unchanged test source and explicitly denies CMS/native verification',()=>{
 const source=fs.readFileSync(path.join(__dirname,packet.sourceTest),'utf8');
 assert.equal(packet.sourceSha256,createHash('sha256').update(source).digest('hex'));
 assert.equal(packet.cmsConnected,false);assert.equal(packet.nativeWixVerified,false);assert.equal(packet.readOnlyReplay,true);
 assert.equal(packet.assertionsPassed,true);assert.equal(packet.cases.length,4);
 for(const scenario of packet.cases){
  assert.equal(scenario.steps.length,7);
  assert.deepEqual(scenario.steps.map(s=>s.outstanding),[0,0,30,30,30,10,0]);
  assert.deepEqual(scenario.steps.map(s=>s.onHand),[0,100,100,100,100,120,200]);
  assert.equal(scenario.steps.every(s=>s.dispatched===0),true);
  for(const s of scenario.steps)assert.equal(s.tasks.every(t=>t.requested===100),true);
  assert.deepEqual(scenario.steps[3].tasks.map(t=>t.batches),[[30,70],[30,70]]);
  assert.deepEqual(scenario.steps[3].tasks.map(t=>t.owned),[30,70]);
  assert.deepEqual(scenario.steps[4].tasks.map(t=>t.loaded),[30,0]);
  assert.deepEqual(scenario.steps[5].tasks.map(t=>t.owned),[30,90]);
  assert.deepEqual(scenario.steps[6].tasks.map(t=>t.owned),[100,100]);
  assert.deepEqual(scenario.steps[6].tasks.map(t=>t.readyToArrange),[70,100]);
  assert.equal(scenario.steps.every(s=>s.tasks.every(t=>t.halo===(s.outstanding>0))),true);
  assert.equal(scenario.steps[6].counts.receipts,3);assert.equal(scenario.steps[6].counts.splits,2);assert.equal(scenario.steps[6].counts.transfers,1);
 }
});
test('all replay controls and person detail update actual captured values without network or business write code',()=>{
 const source=fs.readFileSync(path.join(folder,'acceptance-replay.template.html'),'utf8');
 assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|postMessage/.test(source),false);
 const elements=new Map();
 function element(){return {value:'',textContent:'',disabled:false,children:[],attrs:{},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(k,v){this.attrs[k]=v;}};}
 for(const match of source.matchAll(/id="([^"]+)"/g))elements.set(match[1],element());
 const root=elements.get('stock-acceptance-replay');root.querySelector=selector=>elements.get(selector.slice(1));
 const document={getElementById:id=>elements.get(id),createElement:element};
 const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('/*__REPLAY_DATA__*/null',JSON.stringify(packet));
 new vm.Script(script);
 vm.runInNewContext(script,{document,window:{addEventListener(){}}});
 assert.equal(elements.get('sr-onhand').textContent,0);assert.equal(elements.get('sr-prev').disabled,true);
 for(let i=0;i<6;i++)elements.get('sr-next').onclick();
 assert.equal(elements.get('sr-onhand').textContent,200);assert.equal(elements.get('sr-debt').textContent,0);assert.equal(elements.get('sr-next').disabled,true);
 elements.get('sr-prev').onclick();assert.equal(elements.get('sr-debt').textContent,10);
 const person=elements.get('sr-rows').children[0].children.at(-1).children[0];person.onclick();assert.match(elements.get('sr-detail').textContent,/待补 10/);
 for(const scenario of packet.cases){elements.get('sr-case').value=scenario.id;elements.get('sr-case').onchange();assert.equal(elements.get('sr-onhand').textContent,0);}
 elements.get('sr-next').onclick();elements.get('sr-start').onclick();assert.equal(elements.get('sr-onhand').textContent,0);
});
