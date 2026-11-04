'use strict';
const assert=require('node:assert/strict');
const build='20261102-purchase-merge-po-entry-v1';
const before="[['moveSelected','Move selected ↕']";
const after="[...(selected.size&&!selectedDisplayRows.size?[['createSelectedPo','Create P.O. 开采购单']]:[]),['moveSelected','Move selected ↕']";
function patchApp(source){assert.equal(source.split(before).length-1,1);return source.replace(before,after);}
function patchIndex(source){for(const [from,to]of [["<meta name=\"build\" content=\"20261102-purchase-compact-tasks-v1\">",'<meta name="build" content="'+build+'">'],['app.js?v=20261102-purchase-compact-tasks-v1','app.js?v='+build]]){assert.equal(source.split(from).length-1,1);source=source.replace(from,to);}return source;}
module.exports={build,before,after,patchApp,patchIndex};
