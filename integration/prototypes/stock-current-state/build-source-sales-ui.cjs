'use strict';
// Mechanical asset overlays only; NOT a standalone ready-to-publish bundle.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../..'),out=path.join(__dirname,'source-ui');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');let html=read('index.html');
const anchor='<script src="sales-room/order-adjustment.js?v=20261020-order-adjustment-v1"></script>';
if(html.split(anchor).length!==2)throw Error('Exact original Sales adjustment script anchor changed');
html=html.replace(anchor,'<script src="sales-room/current-requests.js?v=20261022-current-sales-v1"></script><script src="sales-room/order-adjustment.js?v=20261022-current-sales-v1"></script>');
const shipment='<script src="sales-room/shipment-ui.js?v=20261017-site-bilingual-copy-v1"></script>';
if(html.split(shipment).length!==2)throw Error('Exact original Sales shipment script anchor changed');
html=html.replace(shipment,'<script src="sales-room/shipment-ui.js?v=20261022-current-sales-v1"></script>');
const files={'index.html':html,'current-requests.js':read('integration/prototypes/stock-current-state/source-sales-current-requests.js'),'order-adjustment.js':read('integration/prototypes/stock-current-state/sales-order-adjustment.candidate.js'),'shipment-ui.js':read('integration/prototypes/stock-current-state/sales-shipment-ui.candidate.js')};
for(const[name,text]of Object.entries(files)){if(name.endsWith('.js'))new Function(text);const target=path.join(out,name);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Original Sales UI overlay differs: '+name);}else{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(target,text);}}
process.stdout.write('Original Sales current request/adjustment overlays '+(process.argv.includes('--check')?'verified':'built')+'; production unchanged\n');
