const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const previous=require('../purchase-ready-stock-20261031/stage.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-company-stock-list-v1';
function replace(text,find,value){assert.equal(text.split(find).length,2,'Unique stock-list patch: '+find);return text.replace(find,()=>value);}
function plan(){
 const prior=previous.plan(),baseline=new Map(prior.assets),assets=new Map(baseline);
 for(const file of ['warehouse-room/stock-control.html','warehouse-room/stock-control-app.js','warehouse-room/stock-control-link.js','account-room/stock-list.html','account-room/stock-list-link.js','master-shared/stock-list.css'])assets.set(file,fs.readFileSync(path.join(root,file)));
 let wh=assets.get('warehouse-room/stock-control.html').toString();
 wh=replace(wh,'<title>Stock Control · Warehouse</title>','<title>Stock List · Warehouse</title>');
 wh=replace(wh,'</head>','<link rel="stylesheet" href="../master-shared/stock-list.css?v='+build+'"></head>');
 wh=wh.replace(/2026-10-21-stock-tab-v1|20261021-stock-tab-v1/g,build);assets.set('warehouse-room/stock-control.html',Buffer.from(wh));
 let index=assets.get('warehouse-room/index.html').toString();index=replace(index,'Stock Control 库存管理','Stock List 库存清单');
 index=index.replace(/(<meta name="build" content=")[^"]+/,'$1'+build).replace(/(stock-control-link\.js\?v=)[^"&]+/,'$1'+build);assets.set('warehouse-room/index.html',Buffer.from(index));
 let account=assets.get('account-room/index.html').toString();account=replace(account,'<button data-view="activity">','<button data-view="stock">Stock List</button><button data-view="activity">');
 account=replace(account,'<script src="app.js?','<script src="stock-list-link.js?v='+build+'"></script><script src="app.js?');
 account=account.replace(/(<meta name="build" content=")[^"]+/,'$1'+build).replace(/(src="app\.js\?v=)[^"&]+/,'$1'+build);assets.set('account-room/index.html',Buffer.from(account));
 let app=assets.get('account-room/app.js').toString();app=replace(app,"  if(view==='history')app.innerHTML", "  if(window.accountStockList?.render({company:company.value,view}))return;\n  if(view==='history')app.innerHTML");assets.set('account-room/app.js',Buffer.from(app));
 const changed=[...assets].filter(([file,b])=>!baseline.has(file)||!b.equals(baseline.get(file))).map(([file])=>file).sort();
 assert(changed.every(file=>file.startsWith('warehouse-room/')||file.startsWith('account-room/')||file==='master-shared/stock-list.css'));
 return {assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'3401d75'};fs.writeFileSync(path.join(target,'stock-list-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
