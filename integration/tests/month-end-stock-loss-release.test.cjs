const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {plan}=require('../prototypes/month-end-stock-loss-20261101/stage.cjs'),load=require('./load-master-module.cjs');
test('Linux LF checkout produces the exact same 99 release hashes as Windows',()=>{
 const cp=require('node:child_process'),crypto=require('node:crypto');
 const expected=[...plan().assets].map(([file,bytes])=>[file,crypto.createHash('sha256').update(bytes).digest('hex')]);
 const script=`const fs=require('node:fs'),read=fs.readFileSync;fs.readFileSync=function(file,...args){const value=read.call(this,file,...args);if(typeof file==='string'&&/\\.(?:cjs|js|css|html|json)$/.test(file)){if(typeof value==='string')return value.replace(/\\r\\n/g,'\\n');return Buffer.from(value.toString().replace(/\\r\\n/g,'\\n'));}return value;};const crypto=require('node:crypto'),p=require('./integration/prototypes/month-end-stock-loss-20261101/stage.cjs').plan();process.stdout.write(JSON.stringify([...p.assets].map(([file,bytes])=>[file,crypto.createHash('sha256').update(bytes).digest('hex')])));`;
 const actual=JSON.parse(cp.execFileSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}));
 assert.deepEqual(actual,expected);
});
test('release retains all unrelated production resources and every consumer requests the new shared interface',()=>{
 const p=plan();assert.equal(p.assets.size,99);assert.equal(p.changed.length,11);
 for(const[file,bytes]of p.baseline)if(!p.changed.includes(file))assert(bytes.equals(p.assets.get(file)),file);
 for(const room of ['purchase-live','account-room','warehouse-room']){
  const html=p.assets.get(room+'/index.html').toString();for(const name of ['stock-exceptions.js','stock-exceptions.css'])assert(html.includes(name+'?v='+p.build));
 }
 for(const file of ['account-room/stock-list.html','warehouse-room/stock-control.html'])assert(p.assets.get(file).toString().includes('stock-control-app.js?v='+p.build));
 assert(p.assets.get('account-room/stock-list-link.js').toString().includes('stock-list.html?v='+p.build));
 assert(p.assets.get('warehouse-room/stock-control-link.js').toString().includes('stock-control.html?v='+p.build));
});
test('Purchase preview and backend use the same corrected planner and deny an already-Loaded batch',()=>{
 const p=plan(),window={};vm.runInNewContext(p.assets.get('purchase-live/customer-allocation-plan.js').toString(),{window});
 const server=load('customerAllocationPlan.js');
 for(const name of Object.keys(window.customerAllocationPlan))assert.equal(String(window.customerAllocationPlan[name]),String(server[name]));
 const script=p.assets.get('master-shared/stock-exceptions.js').toString();new vm.Script(script);new vm.Script(p.assets.get('warehouse-room/stock-control-app.js').toString());
 assert(!script.includes("choices.push('APPROVE_LOSS')"));
});
