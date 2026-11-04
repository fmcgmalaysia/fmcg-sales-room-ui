'use strict';
// Standalone isolated READ-ONLY Admin test wrapper, excluded from production install.
const fs=require('node:fs'),path=require('node:path');
let body=fs.readFileSync(path.join(__dirname,'native-read-capacity-probe.cjs'),'utf8').replace(/^'use strict';\r?\n/,'').replace(/module\.exports=\{measureNativeReadCapacity,measureNativeBatchRead\};\s*$/,'');
if(/require\(|module\.exports/.test(body))throw Error('Unexpected diagnostic dependency');
const split=body.indexOf('// Separately invoked readonly SDK capability check.');
if(split<0)throw Error('Exact appended batch diagnostic boundary required');
const text="import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\n"+body.slice(0,split)+
 "\n// Not a stock endpoint, installer, mode switch or write-capacity acceptance.\nexport const measureStockReadCapacity = webMethod(Permissions.Admin, async input => {\n try { return await measureNativeReadCapacity({items,input}); }\n catch (_) { return {ok:false,readOnly:true,error:'Bounded read-only capacity input required. No recovery performed.'}; }\n});\n"+
 body.slice(split)+"\nexport const measureStockBatchRead = webMethod(Permissions.Admin, async input => {\n try { return await measureNativeBatchRead({items,input}); }\n catch (_) { return {ok:false,readOnly:true,error:'Bounded read-only batch input required. No recovery performed.'}; }\n});\n";
new Function(text.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'stockProtocolReadCapacity.web.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text.replace(/\r\n/g,'\n'))throw Error('Read-only capacity diagnostic differs');}else fs.writeFileSync(target,text);
process.stdout.write('Read-only Admin capacity diagnostic '+(process.argv.includes('--check')?'verified':'built')+'; isolated existing test rows ONLY; NOT installed or executed\n');
