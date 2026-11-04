const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
test('scoped release changes four frontend resources and is byte-identical across LF and CRLF checkouts',()=>{
 const plan=require('../prototypes/finance-payable-confirmation-20261101/stage.cjs').plan(),recovery=require('../prototypes/month-end-stock-loss-20261101/stage.cjs').plan().assets;
 assert.equal(plan.assets.size,99);assert.deepEqual([...plan.assets].filter(([f,b])=>!b.equals(recovery.get(f))).map(([f])=>f).sort(),['account-room/index.html','account-room/payment-layout.js','purchase-live/index.html','purchase-live/supplier-allocation.js']);
 const expected=[...plan.assets].map(([f,b])=>[f,crypto.createHash('sha256').update(b).digest('hex')]);
 const script=`const fs=require('fs'),read=fs.readFileSync;fs.readFileSync=function(file,...args){const v=read.call(this,file,...args);if(typeof file==='string'&&/\\.(?:cjs|js|css|html|json)$/.test(file))return typeof v==='string'?v.replace(/\\r\\n/g,'\\n'):Buffer.from(v.toString().replace(/\\r\\n/g,'\\n'));return v;};const c=require('crypto'),p=require('./integration/prototypes/finance-payable-confirmation-20261101/stage.cjs').plan();process.stdout.write(JSON.stringify([...p.assets].map(([f,b])=>[f,c.createHash('sha256').update(b).digest('hex')])));`;
 assert.deepEqual(JSON.parse(cp.execFileSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'})),expected);
});
