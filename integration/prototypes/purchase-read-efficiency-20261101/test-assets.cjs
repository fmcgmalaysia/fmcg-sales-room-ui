// Test-only preload: the legacy UI harness must load the same published asset cohort.
const fs=require('node:fs'),path=require('node:path'),original=fs.readFileSync,root=path.resolve(__dirname,'../../..'),folder=process.env.PURCHASE_TEST_ASSETS;
if(!folder)throw Error('PURCHASE_TEST_ASSETS is required');
fs.readFileSync=function(file,options){if(typeof file==='string'){const relative=path.relative(root,path.resolve(file)).split(path.sep).join('/');if(relative.startsWith('purchase-live/')||relative.startsWith('master-shared/')){const candidate=path.join(folder,relative);if(fs.existsSync(candidate))return original.call(fs,candidate,options);}}return original.call(fs,file,options);};
