const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const load=require('./load-master-module.cjs'),{projectStockControlPage}=load('stockControlService.js'),{projectStockValuationPage}=load('stockValuationService.js');
const root=path.resolve(__dirname,'../..');
function fixture(finance=false){
 const nodes=new Map(),listeners={},messages=[],timers=new Map();let sequence=0;
 function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='filter'?'ON_HAND':'',dataset:{},textContent:'',innerHTML:'',open:false,hidden:false,disabled:false,nextElementSibling:{textContent:''},classList:{toggle(){},add(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id);}
 const parent={postMessage:m=>messages.push(JSON.parse(JSON.stringify(m)))},window={addEventListener:(type,fn)=>listeners[type]=fn};
 const document={body:{dataset:{department:finance?'ACCOUNT':'WAREHOUSE'},scrollHeight:560},documentElement:{classList:{add(){}}},getElementById:node,querySelectorAll:()=>[]};
 vm.runInNewContext(fs.readFileSync(path.join(root,'warehouse-room/stock-control-app.js'),'utf8'),{window,document,parent,location:{search:'',origin:'https://example.test'},URLSearchParams,Intl,crypto:{randomUUID:()=>String(++sequence)},setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id)});
 const result=company=>(finance?projectStockValuationPage:projectStockControlPage)({company,tasks:[],activity:[],customers:[]});
 function reply(request=messages.at(-1),patch={}){listeners.message({source:parent,data:{type:request.type.replace('_REQUEST','_RESULT'),company:request.company,requestId:request.requestId,ok:true,result:result(request.company),...patch}});}
 return {node,messages,reply,timers,listeners,parent};
}
test('changing company clears old stock immediately and ignores a late previous-company reply',()=>{
 const f=fixture(true),old=f.messages[0];f.node('company').value='GHR';f.node('company').onchange();
 assert.equal(f.messages[1].company,'GHR');f.reply(old);assert.equal(f.node('count-stock').textContent,'—');f.reply();assert.equal(f.node('count-stock').textContent,'0');
});
test('rapid filter changes coalesce into one follow-up read and retain previous rows on failure',()=>{
 const f=fixture();f.reply();const html=f.node('stock-rows').innerHTML;
 f.node('refresh').onclick();f.node('filter').value='ALL';f.node('filter').onchange();f.node('filter').value='ISOLATED';f.node('filter').onchange();
 assert.equal(f.messages.length,2);f.reply();assert.equal(f.messages.length,3);assert.equal(f.messages[2].input.filter,'ISOLATED');
 f.reply(undefined,{ok:false,error:'Read unavailable'});assert.equal(f.node('stock-rows').innerHTML,html);assert.equal(f.node('refresh').disabled,false);
 assert(f.messages.every(m=>m.type==='STOCK_CONTROL_READ_REQUEST'));
});
test('open source detail blocks refresh and Finance uses only the finance-authorized read route',()=>{
 const f=fixture(true);f.reply();f.node('source-dialog').open=true;f.node('refresh').onclick();assert.equal(f.messages.length,1);
 assert.equal(f.messages[0].type,'FINANCE_STOCK_LIST_READ_REQUEST');assert.doesNotMatch(f.node('stock-rows').innerHTML,/[\u3400-\u9fff]/);
});
test('release preserves non-stock resources and deactivates old Finance renderers before mounting Stock List',()=>{
 const p=require('../prototypes/company-stock-list-20261031/stage.cjs').plan();
 for(const [file,b]of p.baseline)if(!p.changed.includes(file))assert(b.equals(p.assets.get(file)));
 const app=p.assets.get('account-room/app.js').toString();assert(app.indexOf('accountPayments?.render')<app.indexOf('accountStockList?.render'));assert(app.indexOf('accountCustomerDebtors?.render')<app.indexOf('accountStockList?.render'));
 assert.equal(p.changed.length,9);assert.equal(p.assets.size,97);
 assert.match(p.assets.get('master-shared/stock-list.css').toString(),/#notice\{height:17px/);
});
