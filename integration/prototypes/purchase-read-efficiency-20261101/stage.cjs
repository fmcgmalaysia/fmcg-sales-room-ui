'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const previous=require('../purchase-origin-view-source-20261031/stage.cjs'),build='20261101-purchase-read-efficiency-v1';
function once(text,from,to){assert.equal(text.split(from).length,2,from.slice(0,90));return text.replace(from,()=>to);}
function patchApp(app){
 app=once(app,"    data = result;if(!quiet)poData=null;draftKey=", "    const bundledOrders=result.purchaseOrders;\n    if(bundledOrders&&(bundledOrders.company!==company||!Array.isArray(bundledOrders.orders))){showStatus('采购单回执不完整，当前资料已保留。',true);return;}\n    data = result;if(bundledOrders){poData=bundledOrders;poLoadError='';}else if(!quiet)poData=null;draftKey=");
 app=once(app,"if(quiet&&(window.masterTaskSignals||['po','pohistory','payments'].includes(view)))loadPurchaseOrders();","if(quiet&&!bundledOrders&&(window.masterTaskSignals||['po','pohistory','payments'].includes(view)))loadPurchaseOrders();");
 app=once(app,"const requestedCompany=company;readOperation('PURCHASE_ORDERS_REQUEST').then(result=>{if(company!==requestedCompany)return;", "const requestedCompany=company,requestedBundle=data?.purchaseOrders;readOperation('PURCHASE_ORDERS_REQUEST').then(result=>{if(company!==requestedCompany||data?.purchaseOrders!==requestedBundle)return;");
 app=once(app,"catch(error=>{if(company===requestedCompany)poLoadError=error.message;})", "catch(error=>{if(company===requestedCompany&&data?.purchaseOrders===requestedBundle)poLoadError=error.message;})");
 return app;
}
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 assets.set('purchase-live/app.js',Buffer.from(patchApp(assets.get('purchase-live/app.js').toString())));
 let index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
 index=index.replace(/(app\.js\?v=)[^"&]+/,'$1'+build);assets.set('purchase-live/index.html',Buffer.from(index));
 const changed=[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file);
 assert.deepEqual(changed.sort(),['purchase-live/app.js','purchase-live/index.html']);
 return cached={assets,baseline,build,changed};
}
function stage(destination){const target=path.resolve(destination||''),root=path.resolve(__dirname,'../../..');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);const result=plan();fs.mkdirSync(target,{recursive:true});for(const[file,bytes]of result.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const report={build,changed:result.changed,resources:[...result.assets].map(([file,bytes])=>({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})),backendFilesIncluded:false,recovery:'b86805a exact static composition; fresh Wix originals preserved privately'};fs.writeFileSync(path.join(target,'purchase-read-efficiency-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const result=stage(process.argv[2]);console.log(JSON.stringify({build,changed:result.changed,resources:result.resources.length}));}
module.exports={plan,stage,build,patchApp};
