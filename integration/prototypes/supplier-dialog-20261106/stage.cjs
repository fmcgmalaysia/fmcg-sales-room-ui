const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const changed=['purchase-live/index.html','purchase-live/style.css','purchase-live/supplier-allocation.js','purchase-live/active-layout.js'];
function stage(previous,destination){
 const baseline=JSON.parse(fs.readFileSync(path.join(previous,'sales-quantity-save-response-release.json')));
 assert.equal(baseline.build,'20261105-sales-quantity-save-response-v1');assert.equal(baseline.resources.length,96);assert(!fs.existsSync(destination));
 const resources=baseline.resources.map(({path:file,sha256})=>{
  const original=fs.readFileSync(path.join(previous,file));assert.equal(hash(original),sha256,file);
  const bytes=changed.includes(file)?Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')):original;
  if(changed.includes(file))assert.notEqual(hash(bytes),sha256,file);
  const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return {path:file,sha256:hash(bytes)};
 });
 const manifest={build:'20261106-supplier-dialog-image-v2',changed,unchanged:92,resources};
 fs.writeFileSync(path.join(destination,'supplier-dialog-image-release.json'),JSON.stringify(manifest,null,2));return manifest;
}
module.exports={stage};if(require.main===module)stage(process.argv[2],process.argv[3]);
