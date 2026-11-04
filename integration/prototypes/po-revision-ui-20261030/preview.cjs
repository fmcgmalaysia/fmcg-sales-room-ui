'use strict';
// Preview only. Never deploy without the companion backend safeguards and live comparison.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process'),previous=require('../purchase-confirmed-feedback-20261030/stage.cjs'),root=path.resolve(__dirname,'../../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){
 const inherited=previous.plan(),baseline=new Map(inherited.assets);
 // That historical stage reads this mutable source; pin it back to the verified input first.
 baseline.set('purchase-live/supplier-allocation.js',Buffer.from(cp.execFileSync('git',['show','5bd47887d58fe44d23522149a4a5374b0d7dd789:purchase-live/supplier-allocation.js'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n')));
 for(const[file,expected]of Object.entries({'purchase-live/app.js':'aa689d8a29b6804a14b708fbf4f5ee245024af0790aeba9edb0950c2b20f801c','purchase-live/supplier-allocation.js':'5327aec725df75c8532822b74d91930f4b27c251a898e4f24198819a6a950f5d','purchase-live/style.css':'2d3552f02061edd9b1724b82db703286f897cb358f67f3513c8e754e569ba25e'}))assert.equal(hash(baseline.get(file)),expected,file+' fresh verified base');
 const assets=new Map(baseline),patches=JSON.parse(fs.readFileSync(path.join(__dirname,'UI_PATCHES.json'),'utf8'));
 for(const patch of patches.patches){let text=assets.get(patch.file).toString();for(const hunk of patch.hunks){assert.equal(text.split(hunk.find).length,2,patch.file+' unique amendment UI patch');text=text.replace(hunk.find,()=>hunk.replace);}assets.set(patch.file,Buffer.from(text));}
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file);assert.deepEqual(changed.sort(),['purchase-live/app.js','purchase-live/style.css','purchase-live/supplier-allocation.js']);return {assets,baseline,changed,deployable:false};
}
module.exports={plan};
