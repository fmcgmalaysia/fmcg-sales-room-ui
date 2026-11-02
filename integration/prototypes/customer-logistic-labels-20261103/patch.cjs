const assert=require('node:assert/strict'),build='20261103-customer-logistic-labels-v1';
const labels="({LAND:'Land delivery',SEA_20FT:'Sea 20ft',SEA_40FT:'Sea 40ft',OTHER:'Other'})";
function patchHistory(s){assert.equal(s.split('esc(r.transport)').length,2);assert.equal(s.split("' · '+row.transport").length,2);return s.replace('esc(r.transport)','esc('+labels+'[r.transport]||r.transport)').replace("' · '+row.transport","' · '+("+labels+'[row.transport]||row.transport)');}
function patchDelivery(s){const a="esc(shipment?.transport||'—')";assert.equal(s.split(a).length,2);return s.replace(a,"esc("+labels+"[shipment?.transport]||shipment?.transport||'—')");}
function patchHost(s){const re=/customer-history\/history.js\?v=[^"&]+/;assert(re.test(s));return s.replace(re,'customer-history/history.js?v='+build);}
function patchWarehouse(s){const re=/desk-delivery.js\?v=[^"&]+/;assert(re.test(s));return s.replace(re,'desk-delivery.js?v='+build);}
module.exports={build,labels,patchHistory,patchDelivery,patchHost,patchWarehouse};
