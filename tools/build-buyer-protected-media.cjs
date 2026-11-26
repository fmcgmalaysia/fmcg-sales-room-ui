const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const input = execFileSync('git',['show','a6fa7233:backend/catalogueAuth.web.js'],{encoding:'utf8'});
const base = input.replace(/\r\n/g,'\n').trimEnd();
if(createHash('sha256').update(base).digest('hex')!=='fdb274bb95a84bef454177c758193b06fba9bf38124787f0eb1f6fea49897c1f') {
  throw Error('The verified live Buyer Room auth baseline is required.');
}
let out = base;
function change(anchor,replacement) {
  const index = out.indexOf(anchor);
  if(index<0||out.indexOf(anchor,index+1)!==-1) throw Error('Missing expected live anchor: '+anchor);
  out = out.replace(anchor,replacement);
}
const projection = fs.readFileSync('backend/buyerMediaProjection.js','utf8').replace(/\r\n/g,'\n').replace(/^export /gm,'');
change("import { createBuyerSelectionMediaDownload } from 'backend/buyerSelectionDownload.js';", "$&\nimport { readOwnedSelectionPreviews } from 'backend/catalogueProtectionRuntime.js';");
change('async function workspaceItems(buyer) {', projection+'\n$&');
change('orders: page.map(record => payloadData(record)),','orders: page.map(record => withoutBuyerOriginalImages(payloadData(record))),');
change('myList: items.filter(item => !item.removed), removed, orders: orderPage.orders', 'myList: items.filter(item => !item.removed).map(withoutBuyerOriginalImages), removed: removed.map(withoutBuyerOriginalImages), orders: orderPage.orders');
change('order: { ...projected, editHistory: [...editHistory, ...(projected.masterQuantityHistory || [])] }','order: withoutBuyerOriginalImages({ ...projected, editHistory: [...editHistory, ...(projected.masterQuantityHistory || [])] })');
change('export const requestBuyerCustomerUser =', `export const getBuyerSelectionPreviews = webMethod(Permissions.SiteMember, async (ids, buyerScope = '', fullSize = false) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 25 ||
      (fullSize === true && ids.length !== 1) ||
      ids.some(id=>typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return [];
  const buyer = await resolveBuyerContext(buyerScope);
  const found = await wixData.query(BUYER_LIST_COLLECTION).eq('customerId',buyer.customerId)
    .hasSome('_id',[...new Set(ids)]).limit(ids.length).find({suppressAuth:true,consistentRead:true});
  const owned = buyerPreviewProducts(fullSize === true
    ? found.items.filter(row => !row.removed && !payloadData(row).removed)
    : found.items,buyer.customerId,payloadData);
  const scope = ['ADMIN','STAFF'].includes(buyer.actorType) ? {assistCustomerId:buyer.customerId} : {buyerCompanyId:buyer.customerId};
  return readOwnedSelectionPreviews(scope,owned,fullSize === true);
});

export const requestBuyerCustomerUser =`);
fs.writeFileSync('handoff/catalogueAuth.protected-media.wix.js',out+'\n');
