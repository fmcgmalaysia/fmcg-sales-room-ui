const assert = require('node:assert/strict');
function patchOrderSort(html) {
  const before = "scope=state.orderFilter==='qty'?qtyItems:state.my,items=bySelectionOrder(scope.filter(x=>matches(x,q)));";
  assert.equal(html.split(before).length,2,'Unexpected Order Form source');
  return html.replace(before,before.replace('items=bySelectionOrder(', 'items=byPointBaseSortId('));
}
module.exports={patchOrderSort};
