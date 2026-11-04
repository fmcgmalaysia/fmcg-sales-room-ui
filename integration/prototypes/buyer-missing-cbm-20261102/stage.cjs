'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const prior=require('../purchase-compact-tasks-20261102/stage.cjs'),patch=require('./patch.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(){const baseline=prior.plan().assets,assets=new Map(baseline);assets.set('buyer-room.html',Buffer.from(patch.apply(baseline.get('buyer-room.html').toString())));const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file);assert.deepEqual(changed,['buyer-room.html']);assert.equal(assets.size,101);return {build:patch.build,baseline,assets,changed};}
function stage(destination){assert(destination);const target=path.resolve(destination);assert(!fs.existsSync(target)&&target!==path.parse(target).root);const p=plan();for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const report={build:p.build,baseline:'5194ed3',changed:p.changed,resources:[...p.assets].map(([file,bytes])=>({path:file,sha256:hash(bytes)}))};fs.writeFileSync(path.join(target,'buyer-cbm-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));module.exports={plan,stage,build:patch.build};
