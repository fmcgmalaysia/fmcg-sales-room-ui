const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const build='20261103-warehouse-read-recovery-v1';
const before="function request(quiet=false){if(view==='customers'&&window.warehousePackingTab){window.warehousePackingTab.refresh();if(quiet===true)return;}if(view==='stock'){window.warehouseStockTab?.refresh();return;}if(view==='dispatch'){window.warehouseDispatch.refresh();return;}if(saving||$('entry').open)return;readRequest=crypto.randomUUID();$('refresh').disabled=true;if(quiet!==true)notice('Loading receiving orders 正在读取收货订单…');parent.postMessage({type:'WAREHOUSE_ORDERS_REQUEST',company,requestId:readRequest},'*');clearTimeout(readTimer);readTimer=setTimeout(()=>{if($('refresh').disabled){$('refresh').disabled=false;notice('读取尚未确认，请点击刷新。现有记录保留。',true);}},30000);}";
const after=`let staffConfirmed=false;
function request(quiet=false){
 if(view==='customers'&&window.warehousePackingTab){window.warehousePackingTab.refresh();if(quiet===true)return;}
 if(view==='stock'){window.warehouseStockTab?.refresh();return;}if(view==='dispatch'){window.warehouseDispatch.refresh();return;}if(saving||$('entry').open)return;
 readRequest=crypto.randomUUID();const packet={type:'WAREHOUSE_ORDERS_REQUEST',company,requestId:readRequest};let attempts=0;
 if(quiet!==true)notice('Loading receiving orders 正在读取收货订单…');
 function send(){
  attempts++;$('refresh').disabled=true;parent.postMessage(packet,'*');clearTimeout(readTimer);
  readTimer=setTimeout(()=>{
   if(readRequest!==packet.requestId||company!==packet.company||!$('refresh').disabled)return;
   const safe=view==='receiving'&&!document.hidden&&!saving&&!pending&&!$('entry').open&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches?.('input,select,textarea');
   if(attempts<3&&safe){notice('Reconnecting… 正在恢复连接…');send();return;}
   $('refresh').disabled=false;if(!staffConfirmed)$('staff').textContent='Data unavailable 资料待连接';
   notice('Read timed out. Refresh to retry; existing records are retained. 读取超时，请刷新重试；现有记录保留。',true);
  },30000);
 }
 send();
}`;
function plan(){const baseline=require('../support-reusable-desk-20261103/stage.cjs').plan().assets,assets=new Map(baseline);let app=assets.get('warehouse-room/app.js').toString();assert.equal(app.split(before).length,2);app=app.replace(before,after);
 const errorBefore="if(!message.ok){notice(message.error||'读取失败，请登录后重试。',true);return;}";
 const errorAfter="if(!message.ok){const error=message.error||'Data could not be read. 资料读取失败。',loginRequired=/^Please sign in with your approved Master staff account\\./.test(error);$('login').hidden=!loginRequired;if(!staffConfirmed)$('staff').textContent=loginRequired?'Sign in required 请登录':'Access or data unavailable 权限或资料待确认';notice(error,true);return;}";
 assert.equal(app.split(errorBefore).length,2);app=app.replace(errorBefore,errorAfter);
 const staffBefore="$('staff').textContent=result.staff?.staffName||'';";assert.equal(app.split(staffBefore).length,2);app=app.replace(staffBefore,"staffConfirmed=Boolean(result.staff?.staffName);"+staffBefore);
 assets.set('warehouse-room/app.js',Buffer.from(app));let html=assets.get('warehouse-room/index.html').toString();html=html.replace(/(<meta name="build" content=")[^"]+/,'$1'+build).replace(/(app\.js\?v=)[^"&]+/,'$1'+build).replace('员工身份待连接</span>','Connecting 正在连接</span>').replace('<button id="login">','<button id="login" hidden>');assets.set('warehouse-room/index.html',Buffer.from(html));
 const changed=[...assets].filter(([p,b])=>!b.equals(baseline.get(p))).map(([p])=>p).sort();assert.deepEqual(changed,['warehouse-room/app.js','warehouse-room/index.html']);return {build,baseline,assets,changed};}
function stage(destination){const target=path.resolve(destination);assert(!fs.existsSync(target));const p=plan();for(const[file,bytes]of p.assets){const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);}const manifest={build,baseline:'3b6a1db',changed:p.changed,unchanged:99,resources:[...p.assets].map(([file,b])=>({path:file,sha256:crypto.createHash('sha256').update(b).digest('hex')}))};fs.writeFileSync(path.join(target,'warehouse-read-recovery-release.json'),JSON.stringify(manifest,null,2));return manifest;}
module.exports={build,before,after,plan,stage};if(require.main===module)console.log(JSON.stringify(stage(process.argv[2])));
