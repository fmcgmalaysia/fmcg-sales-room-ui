const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const dir=path.resolve(process.argv[2]);
const data=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../integration/tests/finance-inventory-outlook.test.cjs'),'--sample'],{encoding:'utf8'}));
const shell=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Finance Inventory · QA preview</title>
<style>body{font:14px Arial;color:#19364c;margin:0}header{padding:8px 15px;background:#e1eff8}iframe{display:block;width:100%;height:94vh;border:0}</style>
<header>Finance Inventory · Local QA · 30 Nov 2026 · Synthetic AVATA and ALAMAK orders</header>
<iframe src="/account-room/index.html" title="Finance Inventory QA"></iframe>
<script>
const frame=document.querySelector('iframe');
addEventListener('message',e=>{const m=e.data;if(e.source!==frame.contentWindow||e.origin!==location.origin||m?.type!=='FINANCE_INVENTORY_OUTLOOK_REQUEST')return;
 const ok=m.company==='NCT'&&m.month==='2026-12'&&m.asOf==='2026-11-30';
 frame.contentWindow.postMessage({type:'FINANCE_INVENTORY_OUTLOOK_RESULT',ok,review:!ok,company:m.company,requestId:m.requestId,result:ok?${JSON.stringify(data)}:null},location.origin);
});
frame.onload=()=>{const doc=frame.contentDocument;doc.querySelector('button[data-view="stock"]').click();
 const date=doc.querySelector('#inventoryReport [type=date]');date.max=date.value='2026-11-30';
 doc.querySelector('#inventoryReport [type=month]').value='2026-12';doc.querySelector('[data-pane=outlook]').click();};
</script></html>`;
const pages=path.join(dir,'pages');
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(shell);}
 const file=path.resolve(pages,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(pages+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}).listen(8892,'127.0.0.1',()=>console.log('Finance Inventory QA: http://127.0.0.1:8892/'));
