const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),build='20261106-purchase-waiting-borrow-v1';
const changed=['purchase-live/index.html','purchase-live/customer-allocation.js','purchase-live/customer-allocation-plan.js','purchase-live/active-layout.js'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function stage(previous,destination){
 const prior=JSON.parse(fs.readFileSync(path.join(previous,'purchase-receipt-ux-release.json')));assert.equal(prior.resources.length,96);
 assert.deepEqual(prior,JSON.parse(fs.readFileSync(path.join(__dirname,'baseline-manifest.json'))),'Verified receipt UX baseline must match exactly');
 const assets=new Map(prior.resources.map(({path:file,sha256})=>{const b=fs.readFileSync(path.join(previous,file));assert.equal(hash(b),sha256,file);return [file,b];}));
 for(const file of changed.filter(f=>!f.endsWith('index.html')&&!f.endsWith('customer-allocation-plan.js')))assets.set(file,Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')));
 const code=fs.readFileSync(path.join(root,'integration/backend/customerAllocationPlan.js'),'utf8').replace(/\r\n/g,'\n').replace(/^export /gm,'');
 assets.set('purchase-live/customer-allocation-plan.js',Buffer.from('(()=>{\n'+code+'\nwindow.customerAllocationPlan={quoteCustomerAllocation,planCustomerAllocation,planCustomerRepayment,planCustomerReturn,planCustomerReconciliation};\n})();\n'));
 let index=assets.get('purchase-live/index.html').toString().replace(/name="build" content="[^"]+"/,'name="build" content="'+build+'"');
 for(const file of changed.filter(f=>!f.endsWith('index.html')).map(f=>path.basename(f)))index=index.replace(new RegExp('('+file.replaceAll('.','\\.')+'\\?v=)[^"\\s]+','g'),'$1'+build);
 assets.set('purchase-live/index.html',Buffer.from(index));fs.writeFileSync(path.join(root,'purchase-live/index.html'),index);
 const resources=[...assets].map(([file,b])=>{const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);return {path:file,sha256:hash(b)};});
 const actual=resources.filter(r=>prior.resources.find(p=>p.path===r.path).sha256!==r.sha256).map(r=>r.path);assert.deepEqual(actual.slice().sort(),changed.slice().sort());
 const result={build,base:prior.build,changed,resources};fs.writeFileSync(path.join(destination,'purchase-waiting-borrow-release.json'),JSON.stringify(result,null,2));return result;
}
module.exports={stage,build,changed};if(require.main===module){const result=stage(process.argv[2],process.argv[3]);console.log(JSON.stringify({build,resources:result.resources.length,changed}));}
