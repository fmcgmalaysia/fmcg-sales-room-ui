'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const previous=require('../purchase-quiet-quantities-20261031/stage.cjs'),root=path.resolve(__dirname,'../../..'),build='20261031-purchase-payment-message-v1';
function once(source,before,after){assert.equal(source.split(before).length,2,'Payment message hunk: '+before.slice(0,100));return source.replace(before,()=>after);}
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 let app=assets.get('purchase-live/app.js').toString();
 app=once(app,"esc(shortTime(at).replace(' ','T '))","esc(shortTime(at))");
 app=once(app,"function purchaseRequestEditable(row){return row.state!=='HISTORY'&&","function purchaseRequestEditable(row){return row.procurementContentLocked===false&&!row.invoiceChecked&&!row.supplierAccount?.closed&&row.state!=='HISTORY'&&");
 assets.set('purchase-live/app.js',Buffer.from(app));
 let chat=assets.get('master-shared/task-chat.js').toString();
 chat=once(chat,"function messagePreview(m){return (m?.presentation==='MESSAGE'?'Purchaser Dept: ':'')+messageBody(m);}","function updateDepartment(m){return ({PURCHASE:'Purchaser Dept',ACCOUNT:'Finance Dept.',WAREHOUSE:'Warehouse',SUPPORT:'Support',SALES:'Sales Dept.'})[m?.displayFrom||m?.from]||'Update';}\nfunction messagePreview(m){return (m?.presentation==='MESSAGE'?updateDepartment(m)+': ':'')+messageBody(m);}");
 chat=once(chat,"function decisionBubble(m){return '<article class=\"tc-bubble '+(m.from===department?'out':'in')","function decisionBubble(m){return '<article class=\"tc-bubble '+((m.from||m.displayFrom)===department?'out':'in')");
 chat=once(chat,"esc('Purchaser Dept')+' · '+esc(m.by)","esc(updateDepartment(m))+' · '+esc(m.by||'')");
 assets.set('master-shared/task-chat.js',Buffer.from(chat));
 for(const file of ['purchase-live/index.html','account-room/index.html','warehouse-room/index.html','support-room/workroom.html']){
  let html=assets.get(file).toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);
  html=html.replace(/(task-chat\.js\?v=)[^"&]+/,'$1'+build);
  if(file==='purchase-live/index.html')html=html.replace(/(src="app\.js\?v=)[^"&]+/,'$1'+build);
  assets.set(file,Buffer.from(html));
 }
 const changed=[...assets].filter(([file,b])=>!b.equals(baseline.get(file))).map(([file])=>file).sort();assert.equal(assets.size,98);assert.equal(changed.length,6);
 return cached={assets,baseline,changed,build};
}
function stage(destination){const p=plan(),target=path.resolve(destination||'');assert(destination&&!fs.existsSync(target)&&target!==root&&!target.startsWith(root+path.sep)&&target!==path.parse(target).root);fs.mkdirSync(target,{recursive:true});for(const[file,b]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);}const report={build,changed:p.changed,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')})),backendFilesIncluded:false,recovery:'1e883b8 runtime /ace8e5c record/quiet quantities v1'};fs.writeFileSync(path.join(target,'payment-message-release.json'),JSON.stringify(report,null,2));return report;}
if(require.main===module){const p=stage(process.argv[2]);console.log(JSON.stringify({build,changed:p.changed,resources:p.resources.length}));}module.exports={plan,stage};
