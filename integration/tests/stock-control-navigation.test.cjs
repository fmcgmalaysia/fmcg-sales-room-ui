const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../..');
test('stock navigation opens the selected company separately without touching receiving state',()=>{
 let click;const calls=[],company={value:'GHR'},elements={openStockControl:{addEventListener:(event,fn)=>{assert.equal(event,'click');click=fn;}},company};
 vm.runInNewContext(fs.readFileSync(path.join(root,'warehouse-room/stock-control-link.js'),'utf8'),{document:{getElementById:id=>elements[id]},window:{open:(...args)=>calls.push(args)}});
 click();assert.deepEqual(calls[0],['https://fmcg999.wixstudio.com/master/stock-control?company=GHR','_blank','noopener']);
 company.value='NCT';click();assert.match(calls[1][0],/company=NCT$/);
 company.value='OTHER';click();assert.equal(calls.length,2);
 const html=fs.readFileSync(path.join(root,'warehouse-room/index.html'),'utf8');assert.match(html,/id="openStockControl"/);assert.match(html,/src="stock-control-link\.js\?v=20261021-stock-control-v1"/);
});
test('new Wix entry validates company before selecting its stock iframe; requests retain existing site-member service',()=>{
 const source=fs.readFileSync(path.join(root,'integration/wix/stock-control-page.js'),'utf8').replace(/^import .*;\r?$/gm,'');
 for(const [input,wanted] of [['GHR','GHR'],['NCT','NCT'],['OTHER','NCT'],[undefined,'NCT']]){
  const room={onMessage(){}},$w=()=>room;$w.onReady=fn=>fn();
  vm.runInNewContext(source,{$w,wixLocationFrontend:{query:{company:input}},authentication:{},getWarehouseStockControl(){throw Error('No business calls during entry setup.');}});
  assert.match(room.src,new RegExp('&company='+wanted+'$'));
 }
});
