const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {plan}=require('./stage.cjs'),root='https://fmcgmalaysia.github.io/fmcg-sales-room-ui/',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const normalized=(file,bytes)=>/\.(?:js|css|html|svg)$/.test(file)?Buffer.from(bytes.toString().replace(/\r\n/g,'\n')):bytes;
async function verify(mode){const release=plan(),expected=mode==='before'?release.baseline:release.assets,queue=[...expected],results=[];
 await Promise.all(Array.from({length:6},async()=>{while(queue.length){const[file,wanted]=queue.shift(),response=await fetch(root+file+'?verify='+Date.now(),{cache:'no-store'}),bytes=Buffer.from(await response.arrayBuffer());results.push({path:file,status:response.status,exact:bytes.equals(wanted),normalized:normalized(file,bytes).equals(normalized(file,wanted)),sha256:hash(bytes)});}}));
 const report={at:new Date().toISOString(),mode,build:mode==='before'?'20261031-purchase-origin-view-source-v1':release.build,resources:results.length,exact:results.filter(x=>x.exact).length,normalized:results.filter(x=>x.normalized).length,mismatches:results.filter(x=>!x.normalized||x.status!==200),productionBusinessWrites:0};
 fs.writeFileSync(process.argv[3],JSON.stringify({...report,assets:results},null,2));console.log(JSON.stringify(report));assert.equal(report.mismatches.length,0);
}
verify(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
