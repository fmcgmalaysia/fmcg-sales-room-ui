const assert=require('node:assert/strict');
const build='20261102-warehouse-desk-route-v1';
const active="document.querySelector('nav[aria-label=\"Warehouse navigation\"] [data-view=\"customers\"].active')";
const changes=[
 ["if(!state.container?.isConnected)return;","if(!state.container?.isConnected||!"+active+")return;"],
 ["if(window.warehousePackingTab?.state.company===message.company)window.warehousePackingTab.refresh();","if(window.warehousePackingTab?.state.company===message.company&&"+active+")window.warehousePackingTab.refresh();"]
];
function patchShared(source){for(const[from,to]of changes){assert.equal(source.split(from).length-1,1);source=source.replace(from,to);}return source;}
function patchIndex(source){for(const[from,to]of [['<meta name="build" content="20261102-two-site-closeout-v1">','<meta name="build" content="'+build+'">'],['desk-delivery.js?v=20261101-po-auto-allocation-v1','desk-delivery.js?v='+build]]){assert.equal(source.split(from).length-1,1);source=source.replace(from,to);}return source;}
module.exports={build,active,changes,patchShared,patchIndex};
